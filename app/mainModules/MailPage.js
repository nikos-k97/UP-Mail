const URL                           = require('url')
const merge                         = require('merge-deep');
const _                             = require('lodash');
const Utils                         = require('./Utils');
const IMAPClient                    = require('./IMAPClient');
const Header                        = require('./Header');
const Clean                         = require('./Clean');
const Encrypt                       = require('./Encrypt');
const materialize                   = require("../helperModules/materialize.min.js");


function MailPage (app, logger, stateManager, utils, accountManager, mailStore) {
  this.app = app;
  this.logger = logger;
  this.stateManager = stateManager;
  this.utils = utils;
  this.accountManager = accountManager;
  this.mailStore = mailStore;
  this.ipcRenderer = this.accountManager.ipcRenderer;
  //this.imapClient -> defined in 'initializeIMAP()'
  this.checkedUIDs = [];
}


MailPage.prototype.initializeIMAP = async function(accountInfo) {
  /*
    Try to establish an IMAP connection with the server. If it fails, return to the welcome page to log in again.
    > For example, a reason of not being able to connect is that the user is an existing user that
      has changed their password since their last login, but their old password is saved in the accounts.db.
      If this scenario happens, the user is considered a new user (state = new). The accounts database has already
      an entry with the user's email, so because of the unique constraint on the 'user' field, the user's account
      details in the database are updated with the new ones that the user entered in the login form.
  */
  let client = new IMAPClient(this.app, this.logger, this.utils, this.stateManager, this.accountManager, accountInfo);
  // Attempts to connect and authenticate with the IMAP server.
  try {
    // [resolved_value] = await [Y_Promise] <=> [Y_Promise].then( [resolved_value] => ... )
    this.imapClient = await client;
    client = null;
    this.logger.info(`User : '${accountInfo.user}' successfully connected to IMAP server.`);

    return true;
  } catch (error) {
    // Revert back to 'new' state if the connection is not possible.
    this.logger.error(error);
    client = null;
    this.imapClient = null;
    materialize.toast({html: 'Could not connect to IMAP server. Navigating back to login screen ...', displayLength : 3000 ,classes: 'rounded'});
    this.logger.warn('Could not connect to IMAP server. Navigating back to login screen ...');
    this.stateManager.change('state', 'new');
    this.stateManager.checkUserState();
    // Re-emit window.load event so that the StateManager.style function can work properly.
    // (it is waiting for the window.load event to apply style)
    dispatchEvent(new Event('load'));
    return false;
  }
}


MailPage.prototype.checkIMAPStatus = async function (accountInfo) {
  // Possible client / connection states are: 'connected', 'authenticated', 'disconnected'. 
  // We always want to be in the 'authenticated' state in order to be able to perform IMAP operations.
  if (this.imapClient.client.state === 'disconnected' || this.imapClient.client.state === 'connected') {
    this.logger.log('Client disconnected. Reconnecting...');
    //this.imapClient.client.end();
    this.imapClient = null;
    let initialized = await this.initializeIMAP(accountInfo);
    if (initialized) {
      Header.showTLSBar(this.imapClient.client._sock.encrypted, this.imapClient.client._sock.servername);
      return true;
    }
    else {
      return false;
    };
  }
  else return true;
}

// If this function is called from 'MailPage.reload()' then 'reloading' is true. If not its undefined.
MailPage.prototype.renderMailPage = async function (reloading) {
  // No need to decrypt the password again - User is already logged in, so the accountInfo.password remains
  // encrypted from now on for safety.
  let accountInfo = await this.accountManager.findAccount(this.stateManager.state.account.user);

  if (!this.utils.testLoaded('mailbox')){
    this.logger.warning('For some reason the setup is not completed. Redirecting to welcome page... ');
    this.imapClient = null;
    materialize.toast({html: 'A problem occured. Reperforming setup operations...', displayLength : 3000 ,classes: 'rounded'});
    this.stateManager.checkUserState();
    // Re-emit window.load event so that the StateManager.style function can work properly.
    // (it is waiting for the window.load event to apply style)
    dispatchEvent(new Event('load'));
  }
  else {
    this.stateManager.page('mailbox', ['basic','mailbox']);
    this.logger.debug('Mailbox page is now loading...');
    dispatchEvent(new Event('load'));
    Header.setLoc([accountInfo.user]);
    Header.showTLSBar(this.imapClient.client._sock.encrypted, this.imapClient.client._sock.servername, false);
    document.querySelector('#mail').innerHTML = `
      <span id="doing"></span> 
      <span id="number"></span><br>
      <span id="mailboxes"></span>
    `;

    // Get the mailboxes info for the particular user (along with potential out of date folder info
    // from previous sessions).
    await this.getFolderInfo(accountInfo, reloading);
  } 
}


/*
  We need the reloading variable (passed from 'MailPage.checkIMAPStatus') to determine how this function
  was called. If it was because of a reload -> reloading = true. If reloading is true then we dont attach
  new listeners for the mail and expunge events to the 'Connection' object (aka. this.imapClient.client).
  Otherwise, each time we do a reload, there the 'Connection' object will have multiple mail and expunge events
  handlers.
*/
MailPage.prototype.getFolderInfo = async function(accountInfo, reloading){
  // Get namespaces - they may be used for fetching emails from other mailboxes using the necessary prefix and delimiter.
  let statusOK = await this.checkIMAPStatus(accountInfo);
  if ( !statusOK ) return;
  let namespaces = await this.imapClient.fetchNamespaces();
  this.logger.debug(`Number of available namespaces that probably contain mailboxes : ${namespaces.prefix.length}`);
 
  // Get mailboxes / folders of all namespaces.
  statusOK = await this.checkIMAPStatus(accountInfo);
  if ( !statusOK ) return;
  document.querySelector('#doing').innerText = 'Grabbing your mailboxes ...';
  let personalBoxes = {};
  // ...
  
  for (let i=0 ; i < namespaces.prefix.length; i++){
    let boxes = JSON.parse(JSON.stringify(await this.imapClient.getBoxes(namespaces.prefix[i]),this.utils.getCircularReplacer()));
    if (namespaces.type[i] === 'personal'){
      personalBoxes = merge(personalBoxes, boxes);
    }
  }

  // // Get the boxes/ folders with a different structure and keep only the 'delimeter' and 'name' fields.
  // // The linear box structure is used for easier traversal of the the folders while fetching emails.
  // let personalBoxesLinear = IMAPClient.linearBoxes(personalBoxes);
  // personalBoxesLinear.reverse();
  // personalBoxesLinear = personalBoxesLinear.filter((n) => { return n != undefined && JSON.stringify(n) != '[]' });
  
  // // Store the new boxes format as a data member in the MailPage 'class'.
  // this.personalBoxesLinear = personalBoxesLinear;
  
  // Merge current folders (information stored in account database for an existing user) with the new folder
  // information we obtained via the IMAP getBoxes() call. Each conficting field is overrided with the new info.
  /* 
    > Structure of the value returned by 'this.utils.removeCircular(personalBoxes)'
      (in other words this is the new folder infromation we obtain from IMAP.getboxes() -> personalBoxes)
      {
        Inbox: {
        attribs: (2) ['\Marked', '\HasNoChildren']
        children: null
        delimiter: "/"
        parent: null }
      },
      {
        Sent: ...
      }

    > Structure of the value stored in accountInfo.personalFolders (from an existing user - the previous time
      they used the application). The extra values (like 'uidvalidity') are retrived from IMAP.openBox() -> this.imapClient.mailbox
      {
        Inbox: {
          attribs: (2) ['\Marked', '\HasNoChildren']
          children: null
          delimiter: "/"
          flags: (6) ['\Seen', '\Answered', '\Flagged', '\Deleted', '\Draft', '$MDNSent']
          highest: 1
          keywords: []
          messages: {total: 3, new: 3}
          name: "Inbox"
          newKeywords: false
          nomodseq: false
          parent: null
          permFlags: []
          persistentUIDs: true
          readOnly: true
          uidnext: 23
          uidvalidity: 14,
          highestSeqNo : 1,
          messageCount : 1,
          UIDSequence : [1,3,4]
        }
      }
  */

  /* 
    For new user the 'accountInfo.personalFolders' is undefined (no folder data from previous session).
    For existing user the 'accountInfo.personalFolders' has the old/ potentially out of date folder data.
    We merge the data we just got from 'client.getBoxes()' and the extra folder info from previous session
    and store it again in the accounts.db so that both cases of new and existing users have folder info.
    The 'extra' folder info like 'uidvalidity' etc. will be updated with the new values when we open each
    individual box.
  */
  let personalFolders = accountInfo.personalFolders || {};
  //personalFolders = merge(personalFolders, this.utils.removeCircular(personalBoxes));
  personalFolders = merge(personalFolders, personalBoxes);
  this.logger.log(`Retrieved all mailboxes from ${accountInfo.user}.`);
  
  // Save all the folders data in the accounts database for the next client session.
  //await this.accountManager.editAccount(accountInfo.user, {'personalFolders' : this.utils.removeCircular(personalFolders)});
  await this.accountManager.editAccount(accountInfo.user, {'personalFolders' : personalFolders});
  // Load the new data we just stored.
  accountInfo = await this.accountManager.findAccount(accountInfo.user);

  // Find the last folder opened in the last session, or pick 'Inbox' as the folder to render emails.
  this.pickFolderToRenderEmails(accountInfo);

  // Render folders in the sidebar (mailbox.html)
  await this.renderFolderStructure(accountInfo);

  // Render 'Key Management' button
  this.createKeyManagementButton();

  // Render compose button since page content is now loaded.
  this.renderComposeButton();

  // Render actions button and nested buttons.
  this.addActionsButtonFunctionality(accountInfo);

  // Get the necessary information from the IMAP server in order to render the email inside the folder 
  // that 'state.json' dictates.
  await this.getChosenFolderInfo(this.stateManager.state.account.folder);

  document.querySelector('.navlink-delete').addEventListener('click', async (e) => {
    let newFlag = '\\Deleted';
    let path = this.imapClient.compilePath(this.stateManager.state.account.folder);  
    for (let i = 0; i < this.checkedUIDs.length; i++){
      let metadata = await this.mailStore.loadEmail(this.checkedUIDs[i]);
      let updatedFlags = await this.imapClient.updateFlag(metadata.folder, false, metadata.uid, metadata.flags, newFlag);
      await this.mailStore.updateEmailByUid(metadata.uid, {'flags' : updatedFlags});
    }
    let uids = [];
    this.checkedUIDs.forEach(uid => uids.push(this.utils.stripStringOfNonNumericValues(uid)));
    //await this.imapClient.expungeEmails(path, false, uids);
  });

  /*
    We define the event listeners for the active mailbox here and not inside the 'getChosenFolderInfo'
    function, otherwise we create a new listener for the same event each time we change folder.
  */
  if (!reloading){
    // Listen for new mails in the active mailbox.
    this.imapClient.client.on('mail', async (numNewMsgs) => {
      this.logger.debug(`Number of new messages arrived: ${numNewMsgs}`);
      await this.newMailReceived();
    });
    
    // Listen for expunged mails in the active mailbox.
    this.imapClient.client.on('expunge', async (deletedSeqNo) => {
      this.logger.info(`Server message with seqno : '${deletedSeqNo}' was expunged externally.`);
      await this.messageWasExpunged();
    });

    // Listen for UIDValidity change in the active mailbox. This should never happen. 
    this.imapClient.client.on('uidvalidity', async (uidvalidity) => {
      this.logger.info(`UIDValidity value for the current mailbox changed from: ${this.imapClient.mailbox.uidvalidity} to: ${uidvalidity}`);
      this.logger.info(`Reloading all the folder data...`);
      await this.UIDValidityChanged();
    });
  }
}


MailPage.prototype.pickFolderToRenderEmails = function(accountInfo){
  /*
    Choose the folder that is present in 'state.json' (the folder that was last opened 
    in the previous session). If 'folder' is not specified in 'state.json' then we assign 'Inbox'
    as the folder.
  */

  // Ensure folder is set in state.json
  if (typeof this.stateManager.state.account.folder === 'undefined') {
    // Due to companies not all naming their main inbox "INBOX" (as defined in the RFC),
    // we have to search through them, looking for one which contains the word "inbox" or "incoming".
    for (let folder in accountInfo.personalFolders) {
      if (folder.toLowerCase() === 'inbox' || folder.toLowerCase() === 'incoming') {
         /*
          {"state": "mail","account": {"hash": "9c6abxxxxxxxxxxxxxx19477","email": "test-mail@test.com",
            "folder": [ {"name": "Inbox","delimiter": "/"}]  }}
        */
        this.stateManager.change('account', Object.assign(this.stateManager.state.account, {
          'folder': [{ 'name': folder, 'delimiter': accountInfo.personalFolders[folder].delimiter }]
        }));
      }
    }
  }
}


MailPage.prototype.renderFolderStructure = async function(accountInfo){
  // Generate folder list to render.
  document.querySelector('#folders').innerHTML = await (this.generateFolderList(accountInfo.user, accountInfo.personalFolders, []));
  let firstChildren = document.querySelector('#folders').children;
  let secondChildren = [];
  for (let i=0; i<firstChildren.length; i++){
    let secondChild = firstChildren[i].children;
    secondChildren[i] = secondChild[0]; //Remove the HTMLCollection - get only its value.
  };

  this.linkFolders(accountInfo, secondChildren);

  // Highlight (css) the folder that is selected as current in 'state.json'.
  this.highlightFolder();
}


MailPage.prototype.generateFolderList = async function (email, folders, journey) {
  let html = '';
  if (email){
    html += `
    <div class="no-padding center-align">
      <div class="user-button waves-effect waves-light btn-flat wide" id="${btoa(email)}">
        ${email.toLowerCase()}
      </div>
      <hr>
      <div class="button-container no-padding center-align"></div>
    </div>
    `;
  }
  
  for (let folder in folders) {
    let pathSoFar = journey.concat({ name: folder, delimiter: folders[folder].delimiter });

    let id = btoa(unescape(encodeURIComponent(JSON.stringify(pathSoFar))));
    if (folders[folder].children){
      html += await this.generateFolderList(undefined, folders[folder].children, pathSoFar);
    }
    else {
      html += `
      <div class="no-padding center-align">
        <div class="folder-button waves-effect waves-light btn-flat wide folder-tree" id="${id}">${folder}
        </div>
      </div>
    `;
    }
  }
  return html;
}

MailPage.prototype.linkFolders = function (accountInfo, children) {
  // Children are all the (inside - second level) div elements 
  // with id either the (base64) email hash or the (base64) folder path.
  children.forEach( 
    (element) => {
      // Replace every '=' in the div id with the escaped '\='.
      let divElement = document.querySelector(`#${CSS.escape(element.id)}`);

      // Add 'click' functionality only on folders- not on accounts. 
      if (divElement.classList.contains('folder-tree')){
        divElement.addEventListener('click', (clickedElement) => {
          // example: Switching page to [{"name": "Inbox", "delimeter":"/""}]
          this.logger.log(`Switching page to ${decodeURIComponent(escape(atob(clickedElement.target.id)))}`);
  
          // Store in 'state.json' the folder that user has selected last.
          // example: {"state": "mail","account": {"hash": "9xxxxxxxxxxxxxxxxx77","emailAddress": "test@test.com",
          //           "folder": [{"name": "Inbox","delimiter": "/"}]}}            
          this.stateManager.change('account', Object.assign(this.stateManager.state.account, 
            { folder: JSON.parse(decodeURIComponent(escape(atob(clickedElement.target.id)))) }
          ));
          
          // Change the css for the currently selected / clicked folder.
          let otherFolders = document.querySelectorAll('.folder-tree');
          for (let i=0; i<otherFolders.length; i++){
            otherFolders[i].classList.remove('amber','lighten-1','grey-text','text-darken-1');
          }
          document.querySelector(`#${CSS.escape(clickedElement.target.id)}`).classList.add('amber','lighten-1','grey-text','text-darken-1');
          this.getChosenFolderInfo(JSON.parse(decodeURIComponent(escape(atob(clickedElement.target.id)))));                  
        });
      }
      // Search for child folders.
      let firstChildren = document.querySelector(`#${CSS.escape(element.id)}`).children;
      let secondChildren = [];
      for (let i=0; i<firstChildren.length; i++){
        let secondChild = firstChildren[i].children;
        secondChildren[i] = secondChild[0]; //Remove the HTMLCollection - get only its value
      };
      if (secondChildren.length) {
        this.linkFolders(accountInfo, secondChildren);
      }
    }
  );
}


MailPage.prototype.highlightFolder = function () {
  let folders = document.querySelectorAll('.folder-tree');
  for (let i=0; i< folders.length; i++){
    folders[i].classList.remove('amber','lighten-1','grey-text','text-darken-1');
  }
  
  //CSS.escape(btoa(JSON.stringify(this.stateManager.state.account.folder)))
  let currentFolder = document.querySelector(`#${CSS.escape(btoa(unescape(encodeURIComponent(JSON.stringify(this.stateManager.state.account.folder)))))}`);
  currentFolder.classList.add('amber','lighten-1','grey-text','text-darken-1');
}


MailPage.prototype.getChosenFolderInfo = async function(chosenFolder) {
  // Reset checkboxes since we changed folder.
  this.checkedUIDs = [];
  document.querySelector('.nav-wrapper').classList.add('hide');

  this.logger.debug(this.imapClient.client._events);

  document.querySelector('#mail').innerHTML = `
    <span id="doing"></span> 
    <span id="number"></span><br>
    <span id="mailboxes"></span>
  `;

  // Grab user emails only for the selected folder.
  document.querySelector('#doing').innerText = 'Grabbing your emails ...';

  let accountInfo = await this.accountManager.findAccount(this.stateManager.state.account.user);

  let personalFolders = accountInfo.personalFolders;
  let totalEmails = 0;
  // chosenFolder : [ {"delimiter": "/" ,"name": "Inbox"} ]
  // path         : Inbox
  // objectPath   : ["Inbox"]
  let path = this.imapClient.compilePath(chosenFolder);  
  let objectPath = IMAPClient.compileObjectPath(chosenFolder); 

  /*
    'folderInfo' contains all the information we got from merging the folder info stored in accounts.db and
    the new folder info we got from fetching the folders inside the personal namespace. Because 
    IMAP.openBox() hasnt been used yet, the UIDValidity value of each folder is the old one (the one saved
    from a previous session, so we use that to see if we need to re-fetch the emails or load them from the db)
    The only updated fields of the 'personalFolders' variable are:
        attribs: (2) ['\Marked', '\HasNoChildren']
        children: null
        delimiter: "/"
        parent: null }
    due to the merge with the new values gained from IMAP.getBoxes().
  */
  // The line '_get(personalFolders, objectPath)' is the same as the line 'personalFolders[chosenFolder[chosenFolder.length - 1].name]'
  // The core concept is that we get the attributes of the 'personalFolders[specificFolder]' using the more
  // convenient way of personalBoxesLinear since we can't iterate using the personalFolders object itself.
  // _.get is an even more convenient way of doing it.
  let folderInfo = _.get(personalFolders, objectPath);

  // Get the 'highest message sequence number' value from the last session 
  // If it is a new user then 'highest' defaults to 1.
  let highestSeqNo = folderInfo.highestSeqNo || 1;
  // Get the mailbox length = message count from the last session.
  let messageCount = folderInfo.messageCount || undefined;
  // Get the array containing all the UIDs from the last session.
  let UIDSequence = folderInfo.UIDSequence || undefined;
  // Get the UIDValidity and UIDNext values from the last session.
  let previousUIDValidity = folderInfo.uidvalidity || undefined;
  let previousUIDNext = folderInfo.uidnext || undefined;

  // Database Insert / Update promises from the saveEmail() function in 'MailStore.js' waiting to be resolved.
  let promises = []; // For each mailbox's message.

  // Check box status since last login.
  statusOK = await this.checkIMAPStatus(accountInfo);
  if ( !statusOK ) return;

  document.querySelector('#doing').innerText = `Grabbing '${path}' mail ...`;
  let serverMessageCount;
  let serverUidSequence;
  let uidsToDelete;
  try {
    let checkResult = await this.imapClient.checkUID(path, true, previousUIDValidity, previousUIDNext, highestSeqNo, messageCount, UIDSequence);
    serverUidSequence = this.imapClient.mailbox.serverUidSequence;
    delete this.imapClient.mailbox.serverUidSequence;
    serverMessageCount = this.imapClient.mailbox.messages.total;
    switch (checkResult) {
      case 'Sync':
        this.logger.log(`Folder '${path}' is up to date with server.`);
        break;
      case 'SyncDelete':
        this.logger.log(`Folder '${path}' has no messages. Deleting all the locally stored mails, if there are any.`);
        this.mailStore.deleteEmails(path);
        highestSeqNo = 1;
        break;
      case 'DeleteSelected':
        this.logger.log(`Folder '${path}' has deleted messages. Deleting the necessary emails from the local cache.`);
        uidsToDelete = Utils.findMissing(UIDSequence,serverUidSequence);
        uidsToDelete.forEach(element => this.mailStore.deleteEmailByUID(path, element));
        highestSeqNo = serverUidSequence.length + 1;
        break;
      case 'UpdateFirstTime':
        this.logger.log(`Folder '${path}' needs to be updated. Deleting local cache and fetching all emails.`);
        this.mailStore.deleteEmails(path); // For safety
        highestSeqNo = 1; // For safety
        try {
          await this.imapClient.getEmails(path, true, true, highestSeqNo, 
            {
            // fetch(source, options). For options we use the 'options' object which 
            // contains the 'bodies','envelope' and 'struct' options.
              /*
                An envelope includes the following fields (a value is only included in the response if it is set).
                  -date :         is a date (string) of the message
                  -subject :      is the subject of the message
                  -from :         is an array of addresses from the from header
                  -sender :       is an array of addresses from the sender header
                  -reply-to :     is an array of addresses from the reply-to header
                  -to :           is an array of addresses from the to header
                  -cc :           is an array of addresses from the cc header
                  -bcc :          is an array of addresses from the bcc header
                  -in-reply-to :  is the message-id of the message is message is replying to
                  -message-id :   is the message-id of the message
              */
              bodies: 'HEADER.FIELDS (TO FROM SUBJECT)',
              envelope: true
            }, 
            // The 'onLoad' function is run for each message inside a mailbox.
            // (highestSeqNo, parsedContent from mailParser, attribues)
            function onLoad(seqno, msg, attributes) {  
              promises.push(this.mailStore.saveEmail(accountInfo.user, seqno, msg, attributes, path));
              if (seqno > highestSeqNo) highestSeqNo = seqno;
              document.querySelector('#number').innerText = `Total emails: ${++totalEmails}`;
            }.bind(this)
          );
          highestSeqNo = highestSeqNo + 1;
        } catch (error) {
          this.logger.error(error);
          // Skip the emails fetch for this particular mailbox.
          return;
        }
        break;
      case 'Update':
        this.logger.log(`Folder '${path}' needs to be updated. Deleting and fetching the necessary emails.`);
        // Every UID that is locally stored but not on the server is deleted from local cache.
        uidsToDelete = Utils.findMissing(UIDSequence, serverUidSequence);
        uidsToDelete.forEach(element => this.mailStore.deleteEmailByUID(path, element));
        // We deleted the mails that were incorrectly stored locally. Now we need to fetch the new emails.
        // So we make the highestSeqNo = Number of locally stored emails prior to deletion - number of deleted emails
        // We add 1 to prepare for the new mail that will come.
        highestSeqNo = (UIDSequence.length - uidsToDelete.length) + 1 ;
        let newUids = Utils.findMissing(serverUidSequence, UIDSequence);
        if (newUids.length !== 0) {
          try {
            await this.imapClient.getEmails(path, true, true, highestSeqNo, 
              {
                bodies: 'HEADER.FIELDS (TO FROM SUBJECT)',
                envelope: true
              }, 
              function onLoad(seqno, msg, attributes) {  
                promises.push(this.mailStore.saveEmail(accountInfo.user, seqno, msg, attributes, path));
                if (seqno > highestSeqNo) highestSeqNo = seqno;
                document.querySelector('#number').innerText = `Total emails fetched: ${++totalEmails}`;
              }.bind(this)
            );
          } catch (error) {
            this.logger.error(error);
            return;
          }
          highestSeqNo = highestSeqNo + 1;
        }
        break;
    }
  }
  catch (error) { // Example of error is inability to openBox -> we skip fetching emails for this box and use only the locally stored..
    this.logger.error(error);
    // Skip the emails fetch for this particular mailbox.
    return;
  }

  this.logger.info(`Highest Local SeqNo after switch: ${highestSeqNo}`);
  this.logger.info(`Highest Server SeqNo after switch: ${this.imapClient.mailbox.messages.total}`);
  
  // Check for flag changes since last login.
  statusOK = await this.checkIMAPStatus(accountInfo);
  if ( !statusOK ) return;
  document.querySelector('#doing').innerText = `Checking flags ...`;
  let flagInformation;
  try {
    flagInformation = await this.imapClient.checkFlags(path, true);

    // The UID returned from 'findEmails' is formatted 'folderUID'.
    // The UIDs present in 'flagInformation' are not.
    // So we strip the UIDs returned from 'findEmails' from all non numeric values to keep the real UID.
    let emails = await this.mailStore.findEmails(path, { uid: 1, flags: 1, _id : 0 });
    emails.forEach(email => {
      let uid = parseInt(this.utils.stripStringOfNonNumericValues(email['uid']));
      // The server says that the particular message that is stored in the db is marked as 'Seen'.
      if (flagInformation.seenMessages.includes(uid)){
        // If the local copy of the particular message is already marked as 'Seen' -> do nothing.
        // Otherwise we mark it as seen.
        if (! email['flags'].includes('\\Seen')) {
          email['flags'].push('\\Seen');
          this.mailStore.updateEmailByUid(email['uid'], {'flags' : email['flags']})
        }
      }
      // The server says that the particular message is not marked as 'Seen'.
      else {
        // If the local copy is marked as 'Seen', remove the flag.
        // Otherwise do nothing.
        if (email['flags'].includes('\\Seen')) {
          let newFlags = email['flags'].filter(e => e !== '\\Seen');
          this.mailStore.updateEmailByUid(email['uid'], {'flags' : newFlags})
        }
      }
    });

  } catch (error) {
    this.logger.error(error);
    return;
  }
 
  // Wait for all the database inserts/ updated to be resolved.
  await Promise.all(promises);

  _.set(personalFolders, objectPath.concat(['highestSeqNo']), highestSeqNo);
  _.set(personalFolders, objectPath.concat(['UIDSequence']), serverUidSequence);
  _.set(personalFolders, objectPath.concat(['messageCount']), serverMessageCount);
  _.set(personalFolders, objectPath.concat(['flagInformation']), flagInformation)

  // 'this.imapClient.mailbox' is an object representing the currently open mailbox, defined in getEmails() method.
  let boxKeys = Object.keys(this.imapClient.mailbox);
  for (let j = 0; j < boxKeys.length; j++) {
    _.set(personalFolders, objectPath.concat([boxKeys[j]]), this.imapClient.mailbox[boxKeys[j]]);
  }

  // Save all the folders data in the accounts database for the next client session.
  //await this.accountManager.editAccount(accountInfo.user, {'personalFolders' : this.utils.removeCircular(personalFolders)});
  await this.accountManager.editAccount(accountInfo.user, {'personalFolders' : personalFolders});

  // Get the new info that we just stored in the accounts database.
  accountInfo = await this.accountManager.findAccount(this.stateManager.state.account.user);

  // Delete all the email bodies (.json files in mail/emailHash directory) that are not relevant anymore.
  // (the emails we deleted from this.mailStore.db need to have their bodies deleted too).
  // The emails present in this.mailstore.db are useful, since we just updated it. So we dont delete them.
  // The mails that are present in mail/emailHash directory and not present in this.mailStore.db are deleted
  let usefulEmails = await this.mailStore.findEmails(undefined, { uid: 1 , _id : 0 });
  await this.mailStore.deleteEmailBodies(accountInfo.user, usefulEmails);

  // Render email subject, sender and date for each email in the selected folder.
  await this.render(accountInfo);
}


MailPage.prototype.reload = async function (accountInfo){
  document.querySelector('#actions-button').classList.add('disabled');
  this.logger.log('Reloading mail messages...')
  this.renderMailPage(true); // 'reloading' = true
}


MailPage.prototype.renderComposeButton = function () {
  let html = `
    <a id='compose-button' class="btn-floating btn-large waves-effect waves-light amber lighten-1" title="Compose"><i id='icompose' class="material-icons">mode_edit</i></a>
  `;
  document.querySelector('.button-container').innerHTML = html;

  document.querySelector('#compose-button').addEventListener('click', (e) => {
    this.ipcRenderer.send('open', { file: 'composeWindow' });
  });

}


MailPage.prototype.addActionsButtonFunctionality = async function(accountInfo) {
  document.querySelector('#actions-button').classList.remove('disabled');

  // Activate send mail button
  let actionsButton = document.querySelector('.fixed-action-btn');
  materialize.FloatingActionButton.init(actionsButton, {
    direction: 'left'
  });

  // Activate reload button
  document.querySelector('#refresh-button').addEventListener('click', () => {
    this.reload(accountInfo);
  });

   // Add functionality to newly added 'Logout' button.
   document.querySelector('#logout-button').addEventListener('click', (e) => {
    let connectionEnded = new Promise (resolve => {
      this.imapClient.client.end();
      resolve();
    });
    connectionEnded.then( async () => {
      materialize.toast({html: 'Logging out and deleting all locally stored data...', displayLength : 1000 ,classes: 'rounded'});
      await this.mailStore.deleteEmails();
      await this.mailStore.deleteEmailBodies(accountInfo.user, [], true);
      await this.accountManager.removeAccount(accountInfo.user);
      // Delete whole db folder
      this.mailStore.deleteDB();
      // Delete the app-general-key from the OS keychain.
      await Encrypt.deleteAppKey();
      this.imapClient = null;
      Header.hideTLSBar();
      this.stateManager.change('state', 'new');
      this.stateManager.checkUserState();
      // Re-emit window.load event so that the StateManager.style function can work properly.
      // (it is waiting for the window.load event to apply style)
      dispatchEvent(new Event('load'));
    });
  });
}


MailPage.prototype.createKeyManagementButton = function(){
  let folderDiv = document.querySelector('#folders');

  // Create div wrapper for the Key Management elements.
  let keyManagementWrapper = document.createElement('div');
  keyManagementWrapper.classList.add('key-management-wrapper', 'no-padding', 'center-align');
  folderDiv.insertAdjacentElement('afterend', keyManagementWrapper);

  // Create 'Manage keys' button.
  let manageKeysButton = document.createElement('button');
  manageKeysButton.innerHTML = `
    <i class="material-icons imanage">vpn_key</i>
  `;
  keyManagementWrapper.appendChild(manageKeysButton);
  manageKeysButton.classList.add('manage-keys-button','center-align', 'waves-effect', 'waves-light', 'btn-floating','btn-large');
  manageKeysButton.setAttribute('title','Manage keys')

  
}


// Render the currently selected folder (in state.json). Render is also called each time we click a folder.
MailPage.prototype.render = async function(accountInfo, folderPage) {
  let page = folderPage || 0;

  // Get the UID field of all the emails inside the current folder (folder stored in state.json).
  let mail = await this.mailStore.findEmails(this.imapClient.compilePath(this.stateManager.state.account.folder), {uid: 1}, page * 100, 100);
  // Show in header the emailAddress followed by the folder currently selected.
  Header.setLoc([accountInfo.user].concat(this.stateManager.state.account.folder.map((val) => { return val.name })));

  /*
    Callbacks for the 'push' and 'splice' methods of the 'this.checkedUIDs' array.
    When an email checkbox is selected or unselected, one of the two callbacks is called.
    The 'this.checkedUIDs' array is resetted ([]) each time the 'MailPage.getChosenFolderInfo' is run
    (whenever user changes folder -> we dont have to worry about stacking same type listeners on the array)
  */
  Utils.listenPushinArray(this.checkedUIDs, (uid) => {
    console.log(this.checkedUIDs)
    if (this.checkedUIDs.length) {
      setTimeout(() => {document.querySelector('.nav-wrapper').classList.remove('hide');}, 25);
    }
  });
  Utils.listenSpliceinArray(this.checkedUIDs, () => {
    console.log(this.checkedUIDs)
    if (!this.checkedUIDs.length) {
      setTimeout(() => {document.querySelector('.nav-wrapper').classList.add('hide');}, 25);
    }
  });

  // If this is the first mail page initialize the html content.
  let mailDiv = document.getElementById('mail');
  if (!page) {
    mailDiv.innerHTML = '';
  }

  let html = "";
  if (mail.length === 0) {
    html = 'This folder is empty.';
    document.querySelector('#mail').innerHTML = html;
  }
  else {
    // For the menu - desciption
    if (!page) html += `
      <div class='email-wrapper wrapper-description'>
        <div class="multi mail-checkbox checkbox-description">
          <label>
            <input type="checkbox" class="filled-in" id="all" />
            <span></span>
          </label>
        </div>
        <e-mail class="email-item description"></e-mail>
      </div>
    `; 

    // Create <e-mail> tags equal to mailbox length.
    for (let i = 0; i < mail.length; i++) {
      html += `
        <div class='email-wrapper'>
          <div class="multi mail-checkbox">
            <label>
              <input type="checkbox" class="filled-in" id="${mail[i].uid}" />
              <span></span>
            </label>
          </div>
          <e-mail class="email-item" data-uid="${escape(mail[i].uid)}"></e-mail>
        </div>
      `; 
    }

    if (await this.mailStore.countEmails(this.imapClient.compilePath(this.stateManager.state.account.folder)) > 100 * (page + 1)) {
      html += `
        <div class="load-more-container">
          <button class="btn waves-effect waves-light load-more">
            <i class="material-icons iloadmore">expand_more</i>
          </button>
        </div>
      `;
    }
    document.querySelector('#mail').innerHTML = document.querySelector('#mail').innerHTML + html;

    // Populate the <e-mail> tags with the mail content (header and title).
    let emailCustomElements = document.getElementsByTagName('e-mail');
    for (let i=0; i < emailCustomElements.length; i++){
      let shadowRoot = emailCustomElements[i].shadowRoot;
      
      if (emailCustomElements[i].classList.contains('description')){
        shadowRoot.innerHTML = this.utils.createDescriptionItem(this.imapClient.compilePath(this.stateManager.state.account.folder));
      }
      else {
        // Show loading message until mail has loaded.
        shadowRoot.innerHTML = 'Loading...';
        /*
        ------------------------------ DATA ATTRIBUTES --------------------------------------------
        Any attribute on any element whose attribute name starts with data- is a data attribute. 
        Used to store some extra information that doesn't have any visual representation.
        Reading the values of these attributes out in JavaScript is done by either:
        - getting the property by the part of the attribute name after data- (dashes are converted to camelCase).
          example: <article id="electric-cars" data-columns="3" data-index-number="12314" </article>
                    JS:       article.dataset.indexNumber // "12314"
        - using getAttribute() with their full HTML name to read them.
        --------------------------------------------------------------------------------------------
        */
        let uid = unescape(emailCustomElements[i].getAttribute('data-uid')); //data-uid attribute is inserted to the html in MailPage.render().
        this.mailStore.loadEmail(uid).then((mail) => {
          let newHTML = this.utils.createNewMailElement(mail, this.imapClient.compilePath(this.stateManager.state.account.folder), this.stateManager.state.account.user);
          shadowRoot.innerHTML = newHTML;
        });
      }
    }

    // Get the email details when a user clicks on the email.
    let emailItems = document.querySelectorAll('.email-item');
    for (let i=0; i < emailItems.length; i++){
      if (i !== 0){
        emailItems[i].addEventListener('click', (e) => {
          // Check if the email item is already selected.
          let isSelected = e.target.shadowRoot.querySelector('div.mail-item').classList.contains('selected-mail-item');
          if (! isSelected) {
          /*
              Since the user clicks on the email, we mark it as seen. Inside the MailPage.renderEmail() function,
              the flag : '\Seen' is added to both the server and the local email store (and body.json) IF the email
              is fetched for the first time (its body doesnt exist in 'mail/hash/hashuid' folder). If it exists,
              then this means that the message is already seen from a previous session and is up to date.
          */
            let emailItemText = e.target.shadowRoot.querySelector('.text');
            if (emailItemText.classList.contains('unread')){
              emailItemText.classList.remove('unread');
              emailItemText.classList.add('read');
            } 
            this.renderEmail(accountInfo, unescape(e.currentTarget.attributes['data-uid'].nodeValue));
          }
        });
      }
    }

    // Checkbox functionality - Add uids to 'this.checkedUIDs' array. When unchecked the UID is removed from the array.
    let emailCheckboxes = document.querySelectorAll('.mail-checkbox');
    for (let j=0; j < emailCheckboxes.length; j++){
      if (emailCheckboxes[j].classList.contains('checkbox-description')){
        emailCheckboxes[j].addEventListener('change', (e) => {
          let input = e.currentTarget.querySelector('label input');
          if (input.checked) {
            emailCheckboxes.forEach(el => {
              let id = el.querySelector('label input').getAttribute('id');
              // If the UID is not 'all' and doesnt already exist in the array, push it.
              const index = this.checkedUIDs.indexOf(id);
              if (index < 0) {
                el.querySelector('label input').checked = true;
                if (id !== 'all') return this.checkedUIDs.push(id);
              }
            });
          }
          else {
            emailCheckboxes.forEach(el => {
              el.querySelector('label input').checked = false;
            });
            // We reset the array by reseting its length, not by 'this.checkedUIDs' = [], because we want to
            // keep the event listeners.
            this.checkedUIDs.splice(0); 
          }
        });
      }
      else {
        emailCheckboxes[j].addEventListener('change', (e) => {
          let input = e.currentTarget.querySelector('label input');
          let uid = input.getAttribute('id');
          if (input.checked) {
            const index = this.checkedUIDs.indexOf(uid);
            if (index < 0) {
              this.checkedUIDs.push(uid);
            }
          }
          else {
            const index = this.checkedUIDs.indexOf(uid);
            if (index > -1) {
              this.checkedUIDs.splice(index, 1); // 2nd parameter means remove one item only
              document.querySelector('.checkbox-description label input').checked = false;
            }
          }
        });
      }
    }

    // If the 'load-more button exists (many emails) then add the event listener.
    let loadMoreButton = document.querySelector('.load-more');
    if (loadMoreButton) {
      loadMoreButton.addEventListener('click', (e) => {
        this.render(accountInfo, page + 1);
        // Remove it after press. If it's needed again it will be rendered again in the next page's render call.
        loadMoreButton.remove();
      });
    }
  }
}



/*
  For this function to run, it means the folder that the new Mail just arrived, has been opened
  at least once in the current session, so we have the mailbox info from the server (UIDValidity etc)
  However we need to check these values because there is a chance that UIDValidity changes during the 
  current session, and the other values (UIDNext, MessageCount etc.) change too every time a new mail arrives.
  The change in UIDValidity is handled by another function. -> 'MailPage.UIDValidityChanged()'
  In the case that a message is deleted and and then a new message arrives , the deletion is handled by
  the function 'MailPage.messageWasExpunged()', followed by the current function.
*/
// This function runs as many times as the new mails in the currently selected mailbox.
MailPage.prototype.newMailReceived = async function (){
  let accountInfo = await this.accountManager.findAccount(this.stateManager.state.account.user);
  let statusOK = await this.checkIMAPStatus(accountInfo);
  if ( !statusOK ) return;

  let personalFolders = accountInfo.personalFolders;
  let path = this.imapClient.compilePath(this.stateManager.state.account.folder);  
  let objectPath = IMAPClient.compileObjectPath(this.stateManager.state.account.folder); 
  // This is the folder info got from 'MailPage.getChosenFolderInfo()' , in other words the updated info
  // from the IMAP server. However for each new mail that the current mailbox receives, we need to also
  // update the local store.
  let folderInfo = _.get(personalFolders, objectPath);

  // Get information from the current session (before the new mail was received).
  let highestSeqNo = folderInfo.highestSeqNo || 1;
  let storedMessageCount = folderInfo.messageCount || 0;
  let storedUIDSequence = folderInfo.UIDSequence || [];

  this.logger.info(`Highest seqno from the local store : ${highestSeqNo}`);
  this.logger.info(`Message count from the local store : ${storedMessageCount}`);
  this.logger.info(`Highest seqno from the server : ${this.imapClient.mailbox.messages.total}`);
  this.logger.info(`Message count from the server : ${this.imapClient.mailbox.messages.total}`);
  this.logger.info(`Server has : ${this.imapClient.mailbox.messages.new} new messages.`);


  let checkPassed = false;
  /*
    Check if the message count in the server is indeed higher than the locally stored one.
    If it's not, then a possible case is that an email was expunged externally and it was not
    observed by 'MailPage.messageWasExpunged()'. Also check that the new messages in the mailbox
    (in the server side) is indeed > 0. If they are not, then no new mails arrived, we just somehow
    got the new mail event, and for some reason the locally stored message count < server's message count.
    Also check the UIDNext (must be higher than the stored value) and the UIDValidity (must be same).
    In both cases we do nothing. The new mails will arrive when the mailbox is reloaded.
  */

  if (this.imapClient.mailbox.messages.total > storedMessageCount && this.imapClient.mailbox.messages.new > 0){
      checkPassed = true;
  }

  if ( !checkPassed ) return;

  // Fetch the new mail.
  let uid ; // Will have the format 'folderUID'
  let pureUid; // Just the number.
  try {
    await this.imapClient.getEmails(path, true, false, highestSeqNo, 
      {
        bodies: 'HEADER.FIELDS (TO FROM SUBJECT)',
        envelope: true
      }, 
      async function onLoad(seqno, msg, attributes) {  
        // If the UID is already present we dont fetch it again.
        if (storedUIDSequence.includes(attributes.uid)) return ;
        await this.mailStore.saveEmail(accountInfo.user, seqno, msg, attributes, path);
        this.logger.info(`Saved email with ${attributes.uid} to mailstore`)
        if (seqno > highestSeqNo) highestSeqNo = seqno;
        this.logger.info(`Was highest seqno incremented again? -> ${highestSeqNo}`)
        pureUid = attributes.uid;
        uid = `${path}${attributes.uid}`;
      }.bind(this)
    );
  } catch (error) {
    this.logger.error(error);
    return;
  }

  // UID is undefined since we didnt fetch any emails (the mail was already in the DB)
  // If multiple mail come at the same time, there might be some problems with the highestSeqNo (local < server)
  // even after reloading the mailbox via clicking the folder again. 
  // So we increment the highestSeqNo and call this function again until there is no problem.
  if (!uid){
    this.logger.info('Uid was not found.');
    _.set(personalFolders, objectPath.concat(['highestSeqNo']), ++highestSeqNo);
    await this.accountManager.editAccount(accountInfo.user, {'personalFolders' : personalFolders});
    this.newMailReceived();
    return;
  } 

  /*
    The mailStore is already updated when we fetched the new mail. The 'personalFolders' field in the 
    accounts.db needs to also be updated with the new UIDNext, messageCount, highestseqNo and 
    UIDsequence array. 
  */
  // We know that the server's UIDsequence array and the locally store UIDsequence array are the same.
  // So we just push the new UID to the local array.
  // Prepare the hightestseqno for the new mail
  storedMessageCount = this.imapClient.mailbox.messages.total;
  storedUIDSequence.push(pureUid);
  // Prepare the highestseqno for new emails.
  highestSeqNo = highestSeqNo + 1;

  this.logger.info(`Highest seqno from the local store after finish: ${highestSeqNo}`);
  this.logger.info(`Message count from the local store after finish: ${storedMessageCount}`);
  this.logger.info(`Highest seqno from the server after finish: ${this.imapClient.mailbox.messages.total}`);
  this.logger.info(`Message count from the server after finish : ${this.imapClient.mailbox.messages.total}`);
  this.logger.info(`Server has : ${this.imapClient.mailbox.messages.new} new messages after finish.`);


  // No need to check for flagInformation, since the email is new and we just got it. So the account.db's 
  // 'personalFolders.flagInformation' attribute has not changed.

  _.set(personalFolders, objectPath.concat(['highestSeqNo']), highestSeqNo);
  _.set(personalFolders, objectPath.concat(['UIDSequence']), storedUIDSequence);
  _.set(personalFolders, objectPath.concat(['messageCount']), storedMessageCount);
  
  try {
    // Reload box to get the new uidnext
    await this.imapClient.reloadBox(path,false);
  } catch (error) {
    this.logger.error(error);
    return;
  }
  let boxKeys = Object.keys(this.imapClient.mailbox);
  for (let j = 0; j < boxKeys.length; j++) {
    _.set(personalFolders, objectPath.concat([boxKeys[j]]), this.imapClient.mailbox[boxKeys[j]]);
  }
  
  // Save all the folders data in the accounts database.
  await this.accountManager.editAccount(accountInfo.user, {'personalFolders' : personalFolders});
  
  // Get the new info that we just stored in the accounts database.
  accountInfo = await this.accountManager.findAccount(this.stateManager.state.account.user);
  
  // Insert new mail node just beneath the description node. (The new mail must appear first in the mailbox).
  let html = '';
  html += `
    <div class='email-wrapper'>
      <div class="multi mail-checkbox">
      <label>
        <input type="checkbox" class="filled-in" id="${escape(uid)}" />
        <span></span>
      </label>
      </div>
      <e-mail class="email-item new" data-uid="${escape(uid)}"></e-mail>
    </div>
  `; // data-uid 
  let description = document.querySelector('.wrapper-description');

  if (description) {
    description.insertAdjacentHTML("afterend", html);
  }
  // This means that the folder was empty and this is the first email to come so the description item is not there yet.
  else {
    document.querySelector('#mail').innerHTML = `
      <div class='email-wrapper wrapper-description'>
        <div class="multi mail-checkbox checkbox-description">
          <label>
            <input type="checkbox" class="filled-in" id="all" />
            <span></span>
          </label>
        </div>
        <e-mail class="email-item description"></e-mail>
      </div>
    `;
    description = document.querySelector('.wrapper-description');
    let shadow = description.shadowRoot;
    shadow.innerHTML = this.utils.createDescriptionItem(this.imapClient.compilePath(this.stateManager.state.account.folder));
    description.insertAdjacentHTML("afterend", html);
  }

  let newEmailTag = document.querySelector('.new');
  let shadowRoot = newEmailTag.shadowRoot;
  uid = unescape(newEmailTag.getAttribute('data-uid')); //data-uid attribute is inserted to the html in MailPage.render().
  
  await this.mailStore.loadEmail(uid).then((mail) => {
    let newHTML = this.utils.createNewMailElement(mail, this.imapClient.compilePath(this.stateManager.state.account.folder), this.stateManager.state.account.user);
    shadowRoot.innerHTML = newHTML;
  });

  // The new mail tag has no event listener. Add one.
  newEmailTag.addEventListener('click', (e) => {
    /*
      Since the user clicks on the email, we mark it as seen. Inside the MailPage.renderEmail() function,
      the flag : '\Seen' is added to both the server and the local email store (and body.json) IF the email
      is fetched for the first time (its body doesnt exist in 'mail/hash/hashuid' folder). If it exists,
      then this means that the message is already seen from a previous session and is up to date.
    */

    let isSelected = e.target.shadowRoot.querySelector('div.mail-item').classList.contains('selected-mail-item');

    if (!isSelected) {
      let emailItemText = e.target.shadowRoot.querySelector('.text');
      if (emailItemText.classList.contains('unread')){
        emailItemText.classList.remove('unread');
        emailItemText.classList.add('read');
      } 
      this.renderEmail(accountInfo, unescape(e.currentTarget.attributes['data-uid'].nodeValue));
    }

  });

  // Checkbox functionality - Add uids to 'this.checkedUIDs' array. When unchecked the UID is removed from the array.
  let emailCheckboxes = document.querySelectorAll('.mail-checkbox');
  for (let j=0; j < emailCheckboxes.length; j++){
    if (emailCheckboxes[j].classList.contains('checkbox-description')){
      emailCheckboxes[j].addEventListener('change', (e) => {
        let input = e.currentTarget.querySelector('label input');
        if (input.checked) {
          emailCheckboxes.forEach(el => {
            let id = el.querySelector('label input').getAttribute('id');
            // If the UID is not 'all' and doesnt already exist in the array, push it.
            const index = this.checkedUIDs.indexOf(id);
            if (index < 0) {
              el.querySelector('label input').checked = true;
              if (id !== 'all') return this.checkedUIDs.push(id);
            }
          });
        }
        else {
          emailCheckboxes.forEach(el => {
            el.querySelector('label input').checked = false;
          });
          // We reset the array by reseting its length, not by 'this.checkedUIDs' = [], because we want to
          // keep the event listeners.
          this.checkedUIDs.splice(0); 
        }
      });
    }
    else {
      emailCheckboxes[j].addEventListener('change', (e) => {
        let input = e.currentTarget.querySelector('label input');
        let uid = input.getAttribute('id');
        if (input.checked) {
          const index = this.checkedUIDs.indexOf(uid);
          if (index < 0) {
            this.checkedUIDs.push(uid);
          }
        }
        else {
          const index = this.checkedUIDs.indexOf(uid);
          if (index > -1) {
            this.checkedUIDs.splice(index, 1); // 2nd parameter means remove one item only
            document.querySelector('.checkbox-description label input').checked = false;
          }
        }
      });
    }
  }

}


/*
  This function is run when a change in UIDValidity of the current mailbox is observed during the current
  session (the user has not refreshed the mailbox yet, and has not changed folder. If the user
  changes the folder , the function 'MailPage.getChosenFolderInfo()' also detects the change in UIDValidity
  so this function is not used in this case). IMAP RFC specifies that UIDValidity MUST never change during a session.
*/
MailPage.prototype.UIDValidityChanged = async function(){
  this.getChosenFolderInfo(this.stateManager.state.account.folder);
  return;
}

/*
  This function is run when an external message deletion (EXPUNGE) is observed.
*/
MailPage.prototype.messageWasExpunged = async function(){
  let accountInfo = await this.accountManager.findAccount(this.stateManager.state.account.user);
  let statusOK = await this.checkIMAPStatus(accountInfo);
  if ( !statusOK ) return;

  let personalFolders = accountInfo.personalFolders;
  let path = this.imapClient.compilePath(this.stateManager.state.account.folder);  
  let objectPath = IMAPClient.compileObjectPath(this.stateManager.state.account.folder); 

  let folderInfo = _.get(personalFolders, objectPath);

  // Get information from the current session (before the new mail was received).
  let highestSeqNo = folderInfo.highestSeqNo;
  let storedMessageCount = folderInfo.messageCount;
  let storedUIDSequence = folderInfo.UIDSequence;

  this.logger.info(`Highest seqno from the local store : ${highestSeqNo}`);
  this.logger.info(`Message count from the local store : ${storedMessageCount}`);
  this.logger.info(`Highest seqno from the server : ${this.imapClient.mailbox.messages.total}`);
  this.logger.info(`Message count from the server : ${this.imapClient.mailbox.messages.total}`);

  let checkPassed = false;
  if (this.imapClient.mailbox.messages.total < storedMessageCount){
    checkPassed = true;
  }
  if ( !checkPassed ) return;

  let search = new Promise((resolve,reject) => {
    this.imapClient.client.search( [[`UID`,`1:*`]] , (error, UIDs) => {
      if (error) reject(error);
      resolve(UIDs);
    });
  });

  let serverUIDSequence;
  try {
    serverUIDSequence = await search;
  } catch (error) {
    this.logger.error(error);
    return;
  }

  let UIDsToDelete = Utils.findMissing(storedUIDSequence, serverUIDSequence);
  UIDsToDelete.forEach(element => this.mailStore.deleteEmailByUID(path, element));

  highestSeqNo = serverUIDSequence.length + 1;
  storedMessageCount = serverUIDSequence.length;
  storedUIDSequence = serverUIDSequence;

  this.logger.info(`Highest seqno from the local store after finish: ${highestSeqNo}`);
  this.logger.info(`Message count from the local store after finish: ${storedMessageCount}`);
  this.logger.info(`Highest seqno from the server after finish: ${this.imapClient.mailbox.messages.total}`);
  this.logger.info(`Message count from the server after finish : ${this.imapClient.mailbox.messages.total}`);
  this.logger.info(`Server has : ${this.imapClient.mailbox.messages.new} new messages after finish.`);
  this.logger.info(`UIDNext from the server after finish: ${this.imapClient.mailbox.uidnext}`);
  this.logger.info(`UIDNext from the local store after finish : ${folderInfo.uidnext}`);

  _.set(personalFolders, objectPath.concat(['highestSeqNo']), highestSeqNo);
  _.set(personalFolders, objectPath.concat(['UIDSequence']), storedUIDSequence);
  _.set(personalFolders, objectPath.concat(['messageCount']), storedMessageCount);
  
  // Reload box to get the new uidnext
  // try {
  //   await this.imapClient.reloadBox(path,false);
  // } catch (error) {
  //   this.logger.error(error);
  //   return;
  // }

  let boxKeys = Object.keys(this.imapClient.mailbox);
  for (let j = 0; j < boxKeys.length; j++) {
    _.set(personalFolders, objectPath.concat([boxKeys[j]]), this.imapClient.mailbox[boxKeys[j]]);
  }
  
  // Save all the folders data in the accounts database.
  await this.accountManager.editAccount(accountInfo.user, {'personalFolders' : personalFolders});

  // Delete the mail bodies of the UIDs we just deleted.
  let usefulEmails = await this.mailStore.findEmails(undefined, { uid: 1 , _id : 0 });
  await this.mailStore.deleteEmailBodies(accountInfo.user, usefulEmails);
  
  // Get the new info that we just stored in the accounts database.
  accountInfo = await this.accountManager.findAccount(this.stateManager.state.account.user);

  // Delete the <e-mail> element(s) with the deleted UID(s).
  let emailWrappers = document.querySelectorAll('.email-wrapper');
  for (let i = 0; i < emailWrappers.length; i++){
    let emailCustomElement = emailWrappers[i].querySelector('.email-item');
    let uid = unescape(emailCustomElement.getAttribute('data-uid'));
    if (UIDsToDelete.includes(parseInt(this.utils.stripStringOfNonNumericValues(uid)))){
      emailCustomElement.shadowRoot.innerHTML = '';
      emailWrappers[i].remove();
      const index = this.checkedUIDs.indexOf(uid);
      if (index > -1) {
        this.checkedUIDs.splice(index, 1); // 2nd parameter means remove one item only
        if (document.querySelector('.checkbox-description label input').checked) document.querySelector('.checkbox-description label input').checked = false;
      }
    }
  }
}

/*
  Since this function is run inside an event listener (when a user clicks an email), the Shadow DOM has been
  loaded, so we can use 'shadowRoot.querySelector' sucessfully.
*/
MailPage.prototype.renderEmail = async function (accountInfo, uid, reloadedFromAttachmentButton) {
  let metadata = await this.mailStore.loadEmail(uid);

  let emailElements = document.querySelectorAll('e-mail');
  /*
    For each <e-mail> element we clear its HTML content and remove the selected attribute. One of the emails
    is the currently selected email, so we add the selected attribute only to this specific email and
    make it's HTML content (message-holder) equal to the contents of the email body.
  */
  let selectedItemWrapper = undefined;
  let selectedMailItem = undefined;
  let selectedEmailElement = undefined;
  for (i = 0; i < emailElements.length; i++){
    // Reset each message holder.
    let messageHolder = emailElements[i].shadowRoot.querySelector('div.mail-item div#message-holder');
    if (messageHolder) messageHolder.innerHTML = '';
    // Remove selected tag for each email (clear the previously selected email).
    let notSelectedMailItem = emailElements[i].shadowRoot.querySelector('div.mail-item');
    if (notSelectedMailItem) notSelectedMailItem.classList.remove('selected-mail-item');
    // Get the UID of each <e-mail>.
    let dataUidAttribute = emailElements[i].getAttribute('data-uid');

    // If the UID of the email is equal to this function's 'UID' parameter, it means that this is the email
    // that we need to render, so we need to add the 'selected' attribute.
    if (dataUidAttribute === `${escape(uid)}`) {
      selectedEmailElement = emailElements[i];
      selectedMailItem = emailElements[i].shadowRoot.querySelector(`div.mail-item`);
      selectedMailItem.classList.add('selected-mail-item');
      
      // Add the <div> wrapper, inside which the message body will be rendered.
      let selectedItemHolder = selectedMailItem.querySelector(`div#message-holder`);
      selectedItemHolder.innerHTML = '<div class="message-wrapper" id="message-0"></div>';
      selectedItemWrapper = selectedItemHolder.querySelector(`div.message-wrapper#message-0`);
    }
  }


 
  // Load the email body either from the DB if this message's body has been retrieved again, or fetch it.
  let emailContent = await this.mailStore.loadEmailBody(uid, accountInfo.user);
  let emailHeaders = await this.mailStore.loadEmail(uid, accountInfo.user);
  let path = emailHeaders.folder;
 
  // The mail content is not yet stored in the database. Fetch it with the help of IMAP Client.
  if (typeof emailContent === 'undefined') {
    selectedItemWrapper.innerHTML = 'Loading email body ...';
    statusOK = await this.checkIMAPStatus(accountInfo);
    if ( !statusOK ) return;

    let message = emailHeaders;

    try {
      await this.fetchEmailBody(accountInfo, message);
      emailContent = await this.mailStore.loadEmailBody(uid, accountInfo.user);
    } catch (error) {
      this.logger.error(error);
      return;
    }
  }
  
  // The user clicked on the email, so we can safely mark it as 'Seen' both to the server and to the local storage.
  // 'uid' and 'metadata.uid' are in the format 'folderUID'
    /*
      If the message on the server is not flagged as 'Seen' then we flag it and update the local store
      via 'updateMailByUid' (the mail body is not updated - it contains the flags too).
      If the message on the server is flagged as 'Seen' then our local mail store is already up to date 
      because of imapClient.checkFlags(). In other words we only need to update the local storage if this 
      client is the first one to mark the message as seen.
    */
  let newFlag = '\\Seen';
  let updatedFlags = await this.imapClient.updateFlag(metadata.folder, false, metadata.uid, metadata.flags, newFlag);
  this.mailStore.updateEmailByUid(metadata.uid, {'flags' : updatedFlags});
  
  /*
    DirtyContent (message that will be rendered before escape from 'Clean.js') can be rendered with these formats:
    - text : includes the plaintext version of the message. Is set if the message has at least one ‘text/plain’ node
    - html : includes the HTML version of the message. Is set if the message has at least one ‘text/html’ node
    - textAsHtml : includes the plaintext version of the message in HTML format. Is set if the message has at least one ‘text/plain’ node.
  */
  const app = this.app;
  let dirtyContent;
  if (emailContent.html){
    if (emailContent.attachments){
      let dirtyHTML = this.utils.stringToHTML(emailContent.html);
      let images = dirtyHTML.querySelectorAll('img') ;
      for (let i=0; i<images.length; i++){
        let src = images[i].getAttribute('src');
        for (let j=0; j < emailContent.attachments.length; j++){
          let attachmentCID = emailContent.attachments[j].cid;
          if (src.includes(attachmentCID)){
            try {
              src = `${app.getPath('userData')}\\mail\\${accountInfo.hash}\\${this.utils.md5(`${uid}`)}\\${emailContent.attachments[j].filename}`;
            } catch (error) {
              this.logger.error(error);
            }
            break;
          }
        }
        if (src.includes('C:')){
          images[i].setAttribute('src', URL.pathToFileURL(src));
        }
        else {
          images[i].setAttribute('src',src);
        }
   
      }
      // Reading the value of outerHTML returns a DOMString containing an HTML serialization of the element and its descendants  
      dirtyContent = dirtyHTML.outerHTML;
    }
    else{
      dirtyContent = emailContent.html;
    }
    
    /*
      Inject 'target=_blank' to all <a> elements inside the HTML. If the links are not pointing to '_target=blank'
      then due to the electron security policies defined in 'main.js', the link won't open at all. (If the links
      are pointing to 'target=_blank' then in a normal browser environment the link would have opened in a new tab
      - in main.js we configured all the links that are designed to open in new tabs to be opened in the OS default
      browser. However without 'target=_blank' links in a normal browser environment would have opened in the same
      tab - in main.js we prohibited redirection inside the electron app.)
    */
    // Also add a 'title' attribute to the <a> tag -> user can see the tooltip for the link that will be clicked
    let htmlDirtyContent = this.utils.stringToHTML(dirtyContent);
    let aArray = htmlDirtyContent.querySelectorAll('a');
    for (let i=0; i<aArray.length; i++){
      let title = aArray[i].getAttribute('title');
      if (!title) aArray[i].setAttribute('title', aArray[i].getAttribute('href'));

      if (aArray[i].target === '') {
        aArray[i].target = '_blank';
      } 
    }
    // back to string
    dirtyContent = htmlDirtyContent.outerHTML ;
  }
  else{
    dirtyContent = emailContent.textAsHtml || emailContent.text;
  } 

  let cleanContent;
  if (reloadedFromAttachmentButton){
    cleanContent = Clean.cleanHTMLNonStrict(dirtyContent);
    
  }
  else {
    cleanContent = Clean.cleanHTMLStrict(dirtyContent);
  }


  selectedItemWrapper.innerHTML = '';

  let headerContentNode = document.createElement('div');
  headerContentNode.classList.add('header-content');
  let envelope = emailHeaders.envelope;
  let toArray = envelope.to;
  let toHTML = '';
  let ccArray = envelope.cc;
  let ccHTML = '';
  let bccArray = envelope.bcc;
  let bccHTML = '';
  // This is done because the to, cc, bcc fields can contain multiple email adresses.
  if (toArray && toArray.length){
    for (let i=0; i<toArray.length; i++){
      if (i===0){
        toHTML = toHTML + `
          <tr>
            <th>To: &nbsp;</th>
            <td><a href="javascript:void(0)">${envelope.to[i].mailbox}@${envelope.to[i].host}</a>  ${envelope.to[i].name ? ' &nbsp; ('+envelope.to[i].name+')' : ''}</td>
          </tr>
        `;
      }
      else {
        toHTML = toHTML + `
        <tr>
          <td></td>
          <td><a href="javascript:void(0)">${envelope.to[i].mailbox}@${envelope.to[i].host}</a>  ${envelope.to[i].name ? ' &nbsp; ('+envelope.to[i].name+')' : ''}</td>
        </tr>
      `;
      }
    }
  }
  else {
    toHTML = toHTML + `
      <tr>
        <th>To: &nbsp;</th>
        <td><a href="javascript:void(0)">Unknown</td>
      </tr>
    `;
  }

  
  if (ccArray && ccArray.length){
    for (let i=0; i<ccArray.length; i++){
      if (i===0){
        ccHTML = ccHTML + `
          <tr>
            <th>Cc: &nbsp;</th>
            <td><a href="javascript:void(0)">${envelope.cc[i].mailbox}@${envelope.cc[i].host}</a>  ${envelope.cc[i].name ? ' &nbsp; ('+envelope.cc[i].name+')' : ''}</td>
          </tr>
        `;
      }
      else {
        ccHTML = ccHTML + `
        <tr>
          <td></td>
          <td><a href="javascript:void(0)">${envelope.cc[i].mailbox}@${envelope.cc[i].host}</a>  ${envelope.cc[i].name ? ' &nbsp; ('+envelope.cc[i].name+')' : ''}</td>
        </tr>
      `;
      }
    }
  }
  else {
    ccHTML = ccHTML + `
      <tr>
        <th>Cc: &nbsp;</th>
        <td><a href="javascript:void(0)">-</td>
      </tr>
    `;
  }
 
  if (bccArray && bccArray.length){
    for (let i=0; i<bccArray.length; i++){
      if (i===0){
        bccHTML = bccHTML + `
          <tr>
            <th>Bcc: &nbsp;</th>
            <td><a href="javascript:void(0)">${envelope.bcc[i].mailbox}@${envelope.bcc[i].host}</a>  ${envelope.bcc[i].name ? ' &nbsp; ('+envelope.bcc[i].name+')' : ''}</td>
          </tr>
        `;
      }
      else {
        bccHTML = bccHTML + `
        <tr>
          <td></td>
          <td><a href="javascript:void(0)">${envelope.bcc[i].mailbox}@${envelope.bcc[i].host}</a>  ${envelope.bcc[i].name ? ' &nbsp; ('+envelope.bcc[i].name+')' : ''}</td>
        </tr>
      `;
      }
    }
  }
  else {
    bccHTML = bccHTML + `
    <tr>
      <th>Bcc: &nbsp;</th>
      <td><a href="javascript:void(0)">-</td>
    </tr>
  `;
  }

  let headerContent = `
    <br>
    <table class='header-table'>
      <thead>
        <tr>
          <th>From: &nbsp;</th>
          <td><a href="javascript:void(0)">${envelope.from[0].mailbox}@${envelope.from[0].host}</a>  ${envelope.from[0].name ? ' &nbsp; ('+envelope.from[0].name+')' : ''}</td>
        </tr>
  `;

  headerContent = headerContent + toHTML;
  headerContent = headerContent + ccHTML;
  headerContent = headerContent + bccHTML;
       
  headerContent = headerContent + `
        <tr>
          <th>Date: &nbsp;</th>
          <td>${envelope.date}</td>
        </tr>
        <tr>
          <th>Subject: &nbsp;</th>
          <td>${envelope.subject}</td>
        </tr>
      </thead>
    </table>

    <div class='button-wrapper'>
      <button class = 'show-headers'>Show All Headers</button>
    </div>
    <br>

    <style>
      .header-table {
        table-layout: fixed;
        width: 100%;
        text-align: left; 
        vertical-align: middle;
        border-spacing:0;
        margin-bottom : 8px;
      }

      .header-table thead tr {
        height: 16px;
        line-height: 16px;
      }

      .header-table thead tr td a {
        text-decoration: none;
      }

      .header-table thead tr td {
        max-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .header-table thead tr th {
        width: 40%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .attachment-content-wrapper {
        display:flex;
      }

      ul.attachments {
        color : rgb(97,97,97)
      }

      ul li small {
        color : rgb(255, 120, 0) ;
      }

      .button-wrapper{
        display: flex;
      }

      .show-headers{
        display: flex;
        cursor: pointer; 
        border: 1px solid rgb(255,202,40);
        border-radius: 6px;
        color: rgb(97,97,97);
        height: fit-content;
        width : fit-content;
        padding: 7px;
        margin-right: 4px;
      }

      .show-headers:hover{
        background-color : whitesmoke ;
      }

      .fetch-inline{
        display: flex;
        cursor: pointer; 
        border: 0px;
        border-radius: 6px;
        color: rgb(97,97,97);
        background-color : rgb(255,202,40);
        height: fit-content;
        width : fit-content;
        padding: 7px;
        margin-right: 4px;
      }

      .fetch-inline:hover{
        background-color : rgb(255, 179, 0) ;
      }

      .fetch-attachments{
        display: flex;
        cursor: pointer; 
        border: 0px;
        border-radius: 6px;
        color: whitesmoke;
        background-color : rgb(97,97,97);
        height: fit-content;
        width : fit-content;
        padding: 7px;
        margin-right: 4px;
      }

      .fetch-attachments:hover{
        background-color : rgb(60, 60, 60) ;
      }

    </style>
  `;
  headerContentNode.innerHTML = headerContent;
  selectedItemWrapper.appendChild(headerContentNode);

  // Create attachment div in the headers, if there are attachments.
  let attachmentsToShow = [];
  if (emailContent.attachments && emailContent.attachments.length){
    for (let k=0; k<emailContent.attachments.length; k++){
      if (emailContent.attachments[k]['contentDisposition'] === 'attachment'){
        attachmentsToShow.push(emailContent.attachments[k]);
      }
    }
  }
  if (attachmentsToShow.length) {
    let attachmentContentWrapperNode = document.createElement('div');
    attachmentContentWrapperNode.classList.add('attachment-content');
    let attachmentContentNode = document.createElement('div');
    attachmentContentNode.classList.add('attachment-content');
    let attachmentContent = `<strong>Attachments:</strong><ul class='attachments'>`;
    for (let j =0 ; j < attachmentsToShow.length; j++){
      attachmentContent = attachmentContent + `<li class='attachment'>${attachmentsToShow[j]['filename']} <small>&nbsp;(content-type: "${attachmentsToShow[j]['contentType']}")</small></li>`
    }
    attachmentContent  = attachmentContent + `</ul>`
    attachmentContentNode.innerHTML = attachmentContent;
    attachmentContentWrapperNode.appendChild(attachmentContentNode);
    selectedItemWrapper.appendChild(attachmentContentWrapperNode);
    // Attachment button
    selectedItemWrapper.querySelector('.attachment-content').insertAdjacentHTML('afterend', 
    `<button class = 'fetch-attachments'>Download attachments</button><br><br><br>`);

    selectedItemWrapper.querySelector('.fetch-attachments').addEventListener('click', async (e) => {
      let element = e.currentTarget;
      element.disabled = true;
      selectedItemWrapper.querySelector('.show-headers').disabled = true;
      selectedItemWrapper.querySelector('.fetch-inline').disabled = true;
      selectedMailItem.querySelector('#message-holder').querySelector('.back').disabled = true;
      
      // Choose folder via dialog box and fetch chosen attachment(s) via fetch().
      materialize.toast({html: 'Choose folder where the attachments will be fetched', displayLength : 3000 ,classes: 'rounded'});
      let fetched = await this.imapClient.fetchAttachments(emailContent, this.utils.stripStringOfNonNumericValues(uid), path, this.ipcRenderer);
      if (fetched){
        materialize.toast({html: 'Attachments fetched.', displayLength : 3000 ,classes: 'rounded'});
      }
      else {
        materialize.toast({html: 'Cancelled.', displayLength : 3000 ,classes: 'rounded'});
      }
      element.disabled = false;
      selectedItemWrapper.querySelector('.show-headers').disabled = false;
      selectedItemWrapper.querySelector('.fetch-inline').disabled = false;
      selectedMailItem.querySelector('#message-holder').querySelector('.back').disabled = false;
    });
  }


  let bodyContentNode = document.createElement('div');
  bodyContentNode.classList.add('body-content');
  bodyContentNode.innerHTML = cleanContent + ' <br><br>';
  selectedItemWrapper.appendChild(bodyContentNode);

  // Show 'Enable inline attachments button' if the email has attachments.
  if (reloadedFromAttachmentButton){
    selectedItemWrapper.querySelector('.show-headers').insertAdjacentHTML('afterend', 
    `<button class = 'fetch-inline'>Disable inline style (and images)</button>`);
    selectedItemWrapper.querySelector('.fetch-inline').classList.add('enabled');
  } 
  else {
    selectedItemWrapper.querySelector('.show-headers').insertAdjacentHTML('afterend', 
    `<button class = 'fetch-inline'>Enable inline style (and images)</button>`);
  }
  
  // Enable style and inline data (eg. images with content-disposition = inline)
  // Only inline images will be fetched.
    selectedItemWrapper.querySelector('.fetch-inline').addEventListener('click', async (e) => {
      if (e.target.classList.contains('enabled')){
        e.target.classList.remove('enabled');
      } 
      else e.target.classList.add('enabled');

      if (e.target.classList.contains('enabled')){
        let attachmentsToCheck = [];
        if (emailContent.attachments && emailContent.attachments.length){
          for (let k=0; k < emailContent.attachments.length; k++){
            if (emailContent.attachments[k]['contentDisposition'] === 'inline'){
              attachmentsToCheck.push(emailContent.attachments[k]);
            }
          }
        }
        // Determine if inline attachments were already fetched before.
        let noFetch = await this.mailStore.findIfAttachmentsExist(attachmentsToCheck, uid, accountInfo.user);
  
        if (noFetch === false) {
          e.currentTarget.disabled = true;
          selectedItemWrapper.querySelector('.show-headers').disabled = true;
          selectedMailItem.querySelector('#message-holder').querySelector('.back').disabled = true;
      
          // Fetch attachments via fetch().
          materialize.toast({html: 'Fetching...', displayLength : 3000 ,classes: 'rounded'});
          await this.imapClient.fetchInlineAttachments(emailContent, this.utils.stripStringOfNonNumericValues(uid), path);
          // The third arguement 'true' is for the parameter : 'reloadedFromAttachmentButton' -> it will reload
          // the message with the inline attachments, but the 'Enable inline attachments button' will now say
          // 'Hide inline attachments'
          this.renderEmail(accountInfo, uid, true);
          return;
        }
        else {
          this.renderEmail(accountInfo, uid, true);
        }
      }
      else {
        this.renderEmail(accountInfo, uid, false);
      }
    });
  

  selectedItemWrapper.querySelector('.show-headers').addEventListener('click', (e) => {
    e.target.textContent = 'Hide All Headers';
    if (e.target.classList.contains('active')){
      e.target.classList.remove('active');
      e.target.textContent = 'Show All Headers';
    } 
    else e.target.classList.add('active');
    
    if (e.target.classList.contains('active')){
      for (let i=0; i < emailContent.headers.length; i++){
        this.createTableRow(selectedItemWrapper, emailContent.headers[i], false);
      }
    }
    else{
      selectedItemWrapper.querySelector('.header-table thead').innerHTML = `
      <table class='header-table'>
        <thead>
          <tr>
            <th>From: &nbsp;</th>
            <td><a href="javascript:void(0)">${envelope.from[0].mailbox}@${envelope.from[0].host}</a>  ${envelope.from[0].name ? ' &nbsp; ('+envelope.from[0].name+')' : ''}</td>
          </tr>
      `;

      selectedItemWrapper.querySelector('.header-table thead').innerHTML = selectedItemWrapper.querySelector('.header-table thead').innerHTML + toHTML;
      selectedItemWrapper.querySelector('.header-table thead').innerHTML = selectedItemWrapper.querySelector('.header-table thead').innerHTML + ccHTML;
      selectedItemWrapper.querySelector('.header-table thead').innerHTML = selectedItemWrapper.querySelector('.header-table thead').innerHTML + bccHTML;
         
      selectedItemWrapper.querySelector('.header-table thead').innerHTML = selectedItemWrapper.querySelector('.header-table thead').innerHTML + `
          <tr>
            <th>Date: &nbsp;</th>
            <td>${envelope.date}</td>
          </tr>
          <tr>
            <th>Subject: &nbsp;</th>
            <td>${envelope.subject}</td>
          </tr>
        </thead>
      </table>
      <style>
        .header-table {
          table-layout: fixed;
          width: 100%;
          text-align: left; 
          vertical-align: middle;
          border-spacing:0;
          margin-bottom : 8px;
        }
  
        .header-table thead tr {
          height: 16px;
          line-height: 16px;
        }
  
        .header-table thead tr td a {
          text-decoration: none;
        }
  
        .header-table thead tr td {
          max-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .header-table thead tr th {
          width: 40%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    `;
    }
  });

  // Add 'back' button which closes the currently open email, without removing the selected-mail-item class.
  selectedMailItem.querySelector('#message-holder .message-wrapper').insertAdjacentHTML("beforebegin", 
    `
      <button class='back'><strong>Back<strong></button>
      <style>
        .back{
          cursor: pointer; 
          border: 1px solid rgb(97,97,97);
          border-radius: 6px;
          color: rgb(97,97,97);
          height: fit-content;
          width : fit-content;
          padding: 10px;
        }

        .back:hover{
          background-color : whitesmoke ;
        };
      </style>
    `
  );
  selectedMailItem.querySelector('#message-holder').querySelector('.back').addEventListener('click', (e) => {
    e.currentTarget.parentNode.innerHTML = ``;
  });
}

MailPage.prototype.createTableRow = function(wrapper, header, recursion){
  let entities;
  if (!recursion) entities = {'<': '&lt;', '>': '&gt;'};
  let headerName = header.name;
  let headerValue = header.value;

  if (typeof headerValue === 'object'){
    let tableRow = document.createElement('tr');
    let tableRowHTML;
    if (recursion){
      tableRowHTML = `
      <td title=${headerName}>&nbsp;&nbsp;&nbsp; => ${headerName}: &nbsp;</td>
      <td></td>
    `;
    }
    else {
      tableRowHTML = `
      <th title=${headerName}>${headerName}: &nbsp;</th>
      <td></td>
    `;
    }
   
    tableRow.innerHTML = tableRowHTML;
    wrapper.querySelector('.header-table thead').appendChild(tableRow);
    if (headerValue.length){
      for (let j = 0 ; j < headerValue.length; j++){
        if ( typeof headerValue.value === 'object'){
          let tableRow = document.createElement('tr');
          let tableRowHTML = `
            <td>&nbsp;&nbsp;&nbsp; => &nbsp;</td>
            <td title=${(headerValue.text || headerValue.value || headerValue[j] || '').replace(/([<>])/g, function (s) { return entities[s]; }).replace(/[ ]/g,"\u00a0")}>${(headerValue.text || headerValue.value || headerValue[j] || '').replace(/([<>])/g, function (s) { return entities[s]; }).replace(/[ ]/g,"\u00a0")}</td>
          `;
          tableRow.innerHTML = tableRowHTML;
          wrapper.querySelector('.header-table thead').appendChild(tableRow);
        }
        else {
          let tableRow = document.createElement('tr');
          let tableRowHTML = `
            <td>&nbsp;&nbsp;&nbsp; => &nbsp;</td>
            <td title=${(headerValue.text || headerValue.value || headerValue[j] || '').replace(/([<>])/g, function (s) { return entities[s]; }).replace(/[ ]/g,"\u00a0")}>${(headerValue.text || headerValue.value || headerValue[j] || '').replace(/([<>])/g, function (s) { return entities[s]; }).replace(/[ ]/g,"\u00a0")}</td>
          `;
          tableRow.innerHTML = tableRowHTML;
          wrapper.querySelector('.header-table thead').appendChild(tableRow);
        }
      }
    }
    else {
      if (headerValue.params){
        let tableRow = document.createElement('tr');
        let tableRowHTML = `
          <td>&nbsp;&nbsp;&nbsp; => &nbsp;</td>
          <td title=${(headerValue.text || headerValue.value || '').replace(/([<>])/g, function (s) { return entities[s]; }).replace(/[ ]/g,"\u00a0")}>${(headerValue.text || headerValue.value || '').replace(/([<>])/g, function (s) { return entities[s]; }).replace(/[ ]/g,"\u00a0")}</td>
        `;
        tableRow.innerHTML = tableRowHTML;
        wrapper.querySelector('.header-table thead').appendChild(tableRow);
        for (let i in headerValue.params){
          let key = i;
          let val = headerValue.params[i];
          if (key && key !== ' ' && val && val !== ' ')
          this.createTableRow(wrapper, {'name':key, 'value':val}, true);
        }
      }
      else {
        let tableRow = document.createElement('tr');
        let tableRowHTML = `
          <td>&nbsp;&nbsp;&nbsp; => &nbsp;</td>
          <td title=${(headerValue.text || headerValue.value || '').replace(/([<>])/g, function (s) { return entities[s]; }).replace(/[ ]/g,"\u00a0")}>${(headerValue.text || headerValue.value || '').replace(/([<>])/g, function (s) { return entities[s]; }).replace(/[ ]/g,"\u00a0")}</td>
        `;
        tableRow.innerHTML = tableRowHTML;
        wrapper.querySelector('.header-table thead').appendChild(tableRow);
      }
    }
  }
  else {
    let tableRow = document.createElement('tr');
    let tableRowHTML;
    if (recursion){
      tableRowHTML = `
        <td title=${headerName}>&nbsp;&nbsp;&nbsp; => ${headerName}: &nbsp;</td>
        <td title=${(headerValue || '').replace(/([<>])/g, function (s) { return entities[s]; }).replace(/[ ]/g,"\u00a0")}>${(headerValue || '').replace(/([<>])/g, function (s) { return entities[s]; }).replace(/[ ]/g,"\u00a0")}</td>
      `;
    }
    else {
      tableRowHTML = `
      <th title=${headerName}>${headerName }: &nbsp;</th>
      <td title=${(headerValue || '').replace(/([<>])/g, function (s) { return entities[s]; }).replace(/[ ]/g,"\u00a0")}>${(headerValue || '').replace(/([<>])/g, function (s) { return entities[s]; }).replace(/[ ]/g,"\u00a0")}</td>
    `;
    }
  
    tableRow.innerHTML = tableRowHTML;
    wrapper.querySelector('.header-table thead').appendChild(tableRow);
  }
}


MailPage.prototype.fetchEmailBody = async function(accountInfo, message){
  let fetchedPromise = new Promise(async function(resolve,reject){
    try {
      emailContent = await this.imapClient.getEmails(message.folder, false, false, message.seqno, 
        {bodies: '', struct: true, envelope: true}, 
        async function (seqno, content, attributes) {
          // Convert 'Map' of headers into 'Array' of headers for storage.
          let headers= [];
          for (const [name, value] of content.headers) {
            headers.push({ name, value });
          }
          content.headers = headers;

          if (content.attachments && content.attachments.length){
            // Convert 'Map' of possible attachment headers into 'Array' of headers for storage.
            let attachmentHeaders = [];
            for (let j = 0; j < content.attachments.length; j++){
              attachmentHeaders.push([]);
            }
            for (let j = 0; j < content.attachments.length; j++){
              for (const [name, value] of content.attachments[j].headers) {
                attachmentHeaders[j].push({ name, value });
              }
            }
            content.attachmentHeaders = attachmentHeaders;
          }
     
          // The attributes.uid here is from the server so its not in the format 'folderUID'.
          // The message.uid is in the format 'folderUID' since we got it from our local DB.
          let compiledContent = Object.assign({ seqno: seqno }, content, attributes);
          await this.mailStore.saveMailBody(message.uid, compiledContent, accountInfo.user);

          // Mark the mail body as retrived so that we dont fetch its body again with 
          // 'MailPage.prototype.retrieveEmailBodies'.
          this.mailStore.updateEmailByUid(message.uid, {'retrieved': true }, {flags : attributes.flags});
          this.logger.log(`Added ${accountInfo.user} : ${message.uid} to the file system.`);  
          resolve(); 
        }.bind(this)
      );
    } catch (error) {
      this.logger.error(error);
      reject(error);
    }
  }.bind(this));
  return fetchedPromise;
}


module.exports = MailPage;
