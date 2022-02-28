const { timeout, TimeoutError }     = require('promise-timeout');
const merge                         = require('merge-deep');
const materialize                   = require("../helperModules/materialize.min.js");
const Header                        = require('./Header');
const _                             = require('lodash');
const Clean                         = require('./Clean');
const Utils                         = require('./Utils');
const Threader                      = require('./Threader');
const IMAPClient                    = require('./IMAPClient');


function MailPage (ipcRenderer, app, logger, stateManager, utils, accountManager, mailStore) {
  this.ipcRenderer = ipcRenderer;
  this.app = app;
  this.logger = logger;
  this.stateManager = stateManager;
  this.utils = utils;
  this.accountManager = accountManager;
  this.mailStore = mailStore;
  //this.imapClient -> defined in 'initializeIMAP()'
  //this.personalBoxesLinear -> defined in 'getFolderInfo()'
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
    if (initialized) return true;
    else return false;
  }
  else return true;
}


MailPage.prototype.renderMailPage = function (accountInfo) {
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
    
    document.querySelector('#mail').innerHTML = `
      <span id="doing"></span> 
      <span id="number"></span><br>
      <span id="mailboxes"></span>
    `;

    // Get the mailboxes info for the particular user (along with potential out of date folder info
    // from previous sessions).
    this.getFolderInfo(accountInfo);
  } 
}


MailPage.prototype.getFolderInfo = async function(accountInfo){
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
    if (namespaces.type[i] === 'personal'){
      personalBoxes = merge(personalBoxes, await this.imapClient.getBoxes(namespaces.prefix[i]));
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

  // Render compose button since page content is now loaded.
  this.renderComposeButton();

  // Render actions button and nested buttons.
  this.addActionsButtonFunctionality(accountInfo);

  // Get the necessary information from the IMAP server in order to render the email inside the folder 
  // that 'state.json' dictates.
  this.getChosenFolderInfo(accountInfo, this.stateManager.state.account.folder);
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
    let id = btoa(JSON.stringify(pathSoFar));
    html += `
        <div class="no-padding center-align">
          <div class="folder-button waves-effect waves-light btn-flat wide folder-tree" id="${id}">${folder}
          </div>
        </div>
      `;
    html += await this.generateFolderList(undefined, folders[folder].children, pathSoFar);
    }
  return html;
}

MailPage.prototype.linkFolders = function (accountInfo, children) {
  // Children are all the (inside - second level) div elements 
  // with id either the (base64) email hash or the (base64) folder path.
  children.forEach( 
    (element) => {
      // Replace every '=' in the div id with the escaped '\='.
      let divElement = document.querySelector(`#${element.id.replace(/=/g,'\\=')}`);
      // Add 'click' functionality only on folders- not on accounts. 
      if (divElement.classList.contains('folder-tree')){
        divElement.addEventListener('click', (clickedElement) => {
          // example: Switching page to [{"name": "Inbox", "delimeter":"/""}]
          this.logger.log(`Switching page to ${atob(clickedElement.target.id)}`);
  
          // Store in 'state.json' the folder that user has selected last.
          // example: {"state": "mail","account": {"hash": "9xxxxxxxxxxxxxxxxx77","emailAddress": "test@test.com",
          //           "folder": [{"name": "Inbox","delimiter": "/"}]}}            
          this.stateManager.change('account', Object.assign(this.stateManager.state.account, 
            { folder: JSON.parse(atob(clickedElement.target.id)) }
          ));
          
          // Change the css for the currently selected / clicked folder.
          let otherFolders = document.querySelectorAll('.folder-tree');
          for (let i=0; i<otherFolders.length; i++){
            otherFolders[i].classList.remove('amber','lighten-1','grey-text','text-darken-1');
          }
          document.querySelector(`#${clickedElement.target.id.replace(/=/g, '\\=')}`).classList.add('amber','lighten-1','grey-text','text-darken-1');
          this.getChosenFolderInfo(accountInfo, JSON.parse(atob(clickedElement.target.id)));                  
        });
      }
      // Search for child folders.
      let firstChildren = document.querySelector(`#${element.id.replace(/=/g, '\\=')}`).children;
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
  let currentFolder = document.querySelector(`#${btoa(JSON.stringify(this.stateManager.state.account.folder)).replace(/=/g, '\\=')}`);
  currentFolder.classList.add('amber','lighten-1','grey-text','text-darken-1');
}


MailPage.prototype.getChosenFolderInfo = async function(accountInfo, chosenFolder) {
  document.querySelector('#mail').innerHTML = `
    <span id="doing"></span> 
    <span id="number"></span><br>
    <span id="mailboxes"></span>
  `;

  // Grab user emails only for the selected folder.
  document.querySelector('#doing').innerText = 'Grabbing your emails ...';

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
        }
        break;
    }
  }
  catch (error) { // Example of error is inability to openBox -> we skip fetching emails for this box and use only the locally stored..
    this.logger.error(error);
    // Skip the emails fetch for this particular mailbox.
    return;
  }


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
          console.log(email['flags'])
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

  // Look for threads.
  document.querySelector('#number').innerText = '';
  document.querySelector('#doing').innerText = 'Looking for threads ...';
  // threads : object containing arrays with parent messages. 
  // These arrays contain all the children that originated for each of the parents
  let threads;
  try {
    threads = Threader.applyThreads(await this.mailStore.findEmails());
  } catch (error) {
    this.logger.error(error);
    return;
  }

  for (let parentUid in threads) {
    // Add a field 'threadMsg' to every email in the database that is a parent email.
    // The 'threadMsg' field contains an array with the children of the email.
    await this.mailStore.updateEmailByUid(parentUid, { threadMsg: threads[parentUid] });
    // Add a 'isThreadChild' field to each children email.
    // The 'isThreadChild' field contains the UID of the parent email (the first parent - root).
    for (let i = 0; i < threads[parentUid].length; i++) {
      await this.mailStore.updateEmailByUid(threads[parentUid][i], { isThreadChild: parentUid });
    }
  }
  // Render email subject, sender and date for each email in the selected folder.
  this.render(accountInfo);
}



MailPage.prototype.reload = async function (accountInfo){
  document.querySelector('#actions-button').classList.add('disabled');
  this.logger.log('Reloading mail messages...')
  this.renderMailPage(accountInfo);
}


MailPage.prototype.renderComposeButton = function () {
  let html = `
    <a id='compose-button' class="btn-floating btn-large waves-effect waves-light amber lighten-1"><i id='icompose' class="material-icons">mode_edit</i></a>
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
    connectionEnded.then(() => {
      this.imapClient = null;
      Header.setLoc('Login');
      this.stateManager.change('state', 'new');
      this.stateManager.checkUserState();
      // Re-emit window.load event so that the StateManager.style function can work properly.
      // (it is waiting for the window.load event to apply style)
      dispatchEvent(new Event('load'));
    });
  });
}


// Render the currently selected folder (in state.json). Render is also called each time we click a folder.
MailPage.prototype.render = async function(accountInfo, folderPage) {
  let page = folderPage || 0;

  // Get the UID and the 'isThreadChild' fields of all the emails inside the current folder (folder stored in state.json).
  let mail = await this.mailStore.findEmails(this.imapClient.compilePath(this.stateManager.state.account.folder), { uid: 1, isThreadChild: 1 }, page * 100, 100);
  // Show in header the emailAddress followed by the folder currently selected.
  Header.setLoc([accountInfo.user].concat(this.stateManager.state.account.folder.map((val) => { return val.name })));

  // If this is the first mail page initialize the html content.
  let mailDiv = document.getElementById('mail');
  if (!page) {
    mailDiv.innerHTML = '';
  }

  // Create <e-mail> tags equal to mailbox length.
  let html = "";
  for (let i = 0; i < mail.length; i++) {
    if (! mail[i].isThreadChild) {
      html += `<e-mail class="email-item" data-uid="${escape(mail[i].uid)}"></e-mail>`; // data-uid 
    }
  }
  if (mail.length === 0) html = 'This folder is empty.';
  if (await this.mailStore.countEmails(this.imapClient.compilePath(this.stateManager.state.account.folder)) > 100 * (page + 1)) {
    html += `<button class='load-more'>Load more...</button>`;
  }
  document.querySelector('#mail').innerHTML = html;


  // Populate the <e-mail> tags with the mail content (header and title).
  let emailCustomElements = document.getElementsByTagName('e-mail');
  for (let i=0; i < emailCustomElements.length; i++){
    let shadowRoot = emailCustomElements[i].shadowRoot;
    
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

    let email = emailCustomElements[i].getAttribute('data-email') || accountInfo.user;
    let uid = unescape(emailCustomElements[i].getAttribute('data-uid')); //data-uid attribute is inserted to the html in MailPage.render().
    this.mailStore.loadEmail(uid).then((mail) => {
      // NOTE: All of these *have* to be HTML escaped -> `Clean.escape(string)`.
      shadowRoot.innerHTML = `
        <div class="mail-item">
          <div class="multi mail-checkbox">
            <input type="checkbox" id="${mail.uid}">
            <label for="${mail.uid}"></label>
          </div>
          <div class="text ${mail.flags.includes('\\Seen') ? `read` : `unread`}">
            <div class="sender">
              <div class="sender-text left-align">${Clean.escape(
                (mail.envelope.from === undefined ||  mail.envelope.from === null)  ? 'Unknown Sender'  : 
                `${mail.envelope.from[0].mailbox}@${mail.envelope.from[0].host} (${mail.envelope.from[0].name})`)}</div>
            </div>
            <div class="subject">
              <div class="subject-text center-align">${mail.threadMsg && mail.threadMsg.length ? `(${mail.threadMsg.length + 1})` : ``} ${Clean.escape(mail.envelope.subject)}</div>
            </div>
            <div class="date teal-text right-align">${this.utils.alterDate(mail.date)}</div>
          </div>
          <div id="message-holder"></div>
        </div>
        <style>
        .read {
          color: #A0A0A0;
        }
        
        .unread {
          font-weight: bolder;
        }
        
        .mail-item {
          cursor: pointer;
          align-items: center;
          padding: 2px 1rem 2px 1rem;
          background-color: #FFF;
          max-width: 100%;
          min-width: 100%;
          width: 100%;
          border-radius : 3px;
          border: 0.5px solid gray;
        }
        .mail-item:hover {
          filter: brightness(90%);
        }
      
        .mail-item label {
          padding-left: 1.7em;
        }
        .mail-item .multi {
          display: flex;
          align-items: center;
          display: inline-block;
          height: 100%;
          display: flex;
          align-items: center;
        }
        .mail-item .star {
          display: flex;
          align-items: center;
          display: inline-block;
          height: 100%;
        }
        .mail-item .text {
          display: flex;
          align-items: center;
          max-width: 100%;
          min-width: 100%;
          width: 100%;
          height: 100%;
        }
        .mail-item .text .sender {
          display: flex;
          align-items: center;
          width: 45%;
          height: 100%;
        }
        .mail-item .text .sender .sender-text {
          display: inline-block;
          width: 90%;
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
        }
        .mail-item .text .subject {
          display: flex;
          align-items: center;
          width: 45%;
          height: 100%;
        }
        .mail-item .text .subject .subject-text {
          display: inline-block;
          width: 90%;
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
          padding-left : 3px;
        }
        .mail-item .text .date {
          width: 10%;
          float: right;
          position: relative;
          right: 25.25px;
          padding-left : 3px;
        }
        
        .selected-mail-item {
          cursor: inherit;
          filter: brightness(100%) !important;
        }
        
        .padding {
          padding: 10px 10px 10px 10px;
        }
        </style>`;
        
    })
  }

  // Get the email details when a user clicks on the email.
  if (mail.length > 0){
    let emailItems = document.querySelectorAll('.email-item');
    for (let i=0; i < emailItems.length; i++){
      emailItems[i].addEventListener('click', (e) => {
        /*
          Since the user clicks on the email, we mark it as seen. Inside the MailPage.renderEmail() function,
          the flag : '\Seen' is added to both the server and the local email store (and body.json) IF the email
          is fetched for the first time (its body doesnt exist in 'mail/hash/hashuid' folder). If it exists,
          then this means that the message is already seen from a previous session and is up to date.
        */
        emailItemText = e.target.shadowRoot.querySelector('.text');
        if (emailItemText.classList.contains('unread')){
          emailItemText.classList.remove('unread');
          emailItemText.classList.add('read');
        } 
        this.renderEmail(accountInfo, unescape(e.currentTarget.attributes['data-uid'].nodeValue));
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

  //this.retrieveEmailBodies();
}

MailPage.prototype.renderEmail = async function (accountInfo, uid, childNumber) {
  let number = childNumber || 0;
  let metadata = await this.mailStore.loadEmail(uid);

  let emailElements = document.querySelectorAll('e-mail');
  if ( ! number ) {
    for (i=0 ; i < emailElements.length; i++){
      let messageHolder = emailElements[i].shadowRoot.querySelector('div.mail-item div#message-holder');
      if (messageHolder) messageHolder.innerHTML = '';
      
      let unselectedMailItem = emailElements[i].shadowRoot.querySelector('div.mail-item');
      if (unselectedMailItem) unselectedMailItem.classList.remove('selected-mail-item');

      let dataUidAttributes = emailElements[i].getAttribute('data-uid');
    
      if (dataUidAttributes===`${escape(uid)}`) {
        let selectedMailItem = emailElements[i].shadowRoot.querySelector(`div.mail-item`);
        // If user clicks an already selected mail -> deselect it
        if (selectedMailItem.classList.contains('selected-mail-item')){
          selectedMailItem.querySelector('div#message-holder').innerHTML = '';
          return;
        }
        else{
          selectedMailItem.classList.add('selected-mail-item');
        }
        

        let selectedItemWrapper = emailElements[i].shadowRoot.querySelector(`div.mail-item div#message-holder`);
        selectedItemWrapper.innerHTML = '<div class="message-wrapper" id="message-0"></div>';
        if (metadata.threadMsg) {
          for (let i = 1; i < metadata.threadMsg.length + 1; i++) {
            selectedItemWrapper.appendChild(document.createElement('hr'));
            selectedItemWrapper.appendChild(document.createElement('hr'));
            let appendedDiv = document.createElement('div');
            appendedDiv.setAttribute('id',`message-${i}`);
            appendedDiv.classList.add('message-wrapper');
            selectedItemWrapper.appendChild(appendedDiv);
            this.renderEmail(accountInfo, metadata.threadMsg[i - 1], i);
          }
        }
      }
    }
  }
  let selectedItemMessage;
  if (!number){
    for (let i=0; i<emailElements.length; i++){
      let messageWrapper = emailElements[i].shadowRoot.querySelector('div.mail-item div#message-holder div.message-wrapper#message-0');
      if (messageWrapper) {
        selectedItemMessage = messageWrapper;
        break;
      }
    }
  }
  else{
    for (let i=0; i<emailElements.length; i++){
      let messageWrapper = emailElements[i].shadowRoot.querySelector(`div.mail-item div#message-holder div.message-wrapper#message-${number}`);
      if (messageWrapper) {
        selectedItemMessage = messageWrapper;
        break;
      }
    }
  }

  let emailContent = await this.mailStore.loadEmailBody(uid, accountInfo.user);
  // The mail content is not yet stored in the database. Fetch it with the help of IMAP Client.
  if (typeof emailContent === 'undefined') {
    selectedItemMessage.innerHTML = 'Loading email content ...';
    statusOK = await this.checkIMAPStatus(accountInfo);
    if ( !statusOK ) return;
    let message = await this.mailStore.loadEmail(uid, accountInfo.user);
    try {
      await this.fetchEmailBody(accountInfo, message);
      emailContent = await this.mailStore.loadEmailBody(uid, accountInfo.user);
    } catch (error) {
      this.logger.error(error);
      return;
    }
  }
  
  // The user clicked on the email, so we can safely mark it as 'Seen' both to the server and to the local storage.
  // uid and metadata.uid are in the format 'folderUID'
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
        images[i].setAttribute('src', src);
      }
      // Reading the value of outerHTML returns a DOMString containing an HTML serialization of the element and its descendants  
      dirtyContent = dirtyHTML.outerHTML;
    }
    else{
      dirtyContent = emailContent.html;
    }
  }
  else{
    dirtyContent = emailContent.textAsHtml || emailContent.text;
  } 
  //let cleanContent = Clean.cleanHTML(dirtyContent);
  let cleanContent = dirtyContent; //allow images etc...
  selectedItemMessage.innerHTML = cleanContent;
}


MailPage.prototype.fetchEmailBody = async function(accountInfo, message){
  let fetchedPromise = new Promise(async function(resolve,reject){
    try {
      emailContent = await this.imapClient.getEmails(message.folder, false, false, message.seqno, 
        {bodies: '', struct: true, envelope: true}, 
        async function (seqno, content, attributes) {
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


// Retrieve some bodies in the background (store them in mail/hash.json) so that they are marked as 
// 'retrieved' -> we dont fetch the body when user clicks on the email since the body is stored in the
// .json file (see Mailstore.prototype.loadMailWithoutBody').

// Since this method is not called via an event (email click) we can use the same IMAPclient (this.client).
// However only works for the first grab of emails (in the default folder saved in state.json)
// After the user clicks on another folder to read the messages there, we are inside an event
// handler and the client.state = disconnected, so this.client doesnt work.
// MailPage.prototype.retrieveEmailBodies = async function() {
//   let email =  this.stateManager.state.account.emailAddress;
//   let toGrab = await this.mailStore.loadEmailsWithoutBody();
//   let total = toGrab.length;
 
//   if (total) {
//     let limit = 10;
//     if (total < limit) limit = total; //So that don't open useless connections that give timeout errors.
//     let currentIter = 0;
//     let currentCount = 0;

//     let promises = [];
//     for (let j = 0; j < limit; j++) {
//       promises.push(this.accountManager.getIMAP(email));
//     }
//     let clientsFree = await Promise.all(promises);
  
//     let interval = setInterval(async function retrieveEmail() {
//       if (currentIter === total - 1) {
//         clearInterval(interval);
//         setTimeout (function () {
//           for (let i = 0; i < clientsFree.length; i++) {
//             clientsFree[i].client.end();
//           }
//         }, 20000);
//       }
//       else if (currentCount < limit) {
//         this.logger.log(`Grabbing email body ${currentIter + 1} / ${total - 1}`);
//         currentCount++;
//         currentIter++;
//         let client = clientsFree.pop();
//         try { 
//           await timeout(client.getEmailBody(toGrab[currentIter].uid), 2000) 
//         }
//         catch(e) {
//           if (e instanceof TimeoutError) this.logger.error('Timeout reached on one of the emails grabs...');
//           else throw e;
//         }
//         clientsFree.push(client);
//         currentCount--;
//       }
//     }.bind(this), 50);
//   }
// }

module.exports = MailPage;
