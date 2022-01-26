const { timeout, TimeoutError } = require('promise-timeout');
const Header = require('./Header');
const Clean = require('./Clean');

function MailPage (app, logger, stateManager, utils, accountManager) {
  this.app = app;
  this.logger = logger;
  this.stateManager = stateManager;
  this.utils = utils;
  this.accountManager = accountManager;
  // this.client ->  defined in MailPage.prototype.reload()
  // this.mailStore -> defined in MailPage.prototype.render() = client.mailStore
}

MailPage.prototype.load = async function () {
  if (!this.utils.testLoaded('mailbox')) return;

  // Change internal state to 'mail'.
  this.stateManager.page('mailbox', new Array('basic','mailbox'));
  this.logger.debug('Mailbox Page is now loading...');


  /*----------  ENSURE ACCOUNT SET IN STATE  ----------*/
  if (typeof this.stateManager.state.account === 'undefined') {
    let account = (await this.accountManager.listAccounts())[0];
    this.stateManager.change('account', Object.assign(this.stateManager.state.account, { hash: account.hash, email: account.user }))
  }

  /*----------  RETRIEVE & SETUP ACCOUNT  ----------*/
  // Retrive data from accounts.db
  let account = await this.accountManager.findAccount(this.stateManager.state.account.emailAddress);
  let folders = account.folders;


  /*----------  ENSURE FOLDER SET IN STATE  ----------*/
  if (typeof this.stateManager.state.account.folder === 'undefined') {
    // Due to companies not all naming their main inbox "INBOX" (as defined in the RFC),
    // we have to search through them, looking for one which contains the word "inbox".
    for (let folder in folders) {
      if (folder.toLowerCase() === 'inbox') {
         /*
          {"state": "mail","account": {"hash": "9c6abxxxxxxxxxxxxxx19477","email": "test-mail@test.com",
            "folder": [ {"name": "Inbox","delimiter": "/"}]  }}
        */
        this.stateManager.change('account', Object.assign(this.stateManager.state.account, {
          folder: [{ name: folder, delimiter: account.folders[folder].delimiter }]
        }));
      }
    }
  }
   
  /*----------  ACTIVATE MAIL BUTTON  ----------*/
      //$('#compose-button').click(() => {
        //ipcRenderer.send('open', { file: 'compose' })
      //})

  /*----------  ACTIVATE RELOAD BUTTON  ----------*/
  document.querySelector('#refresh-button').addEventListener('click', () => {
    this.reload();
  });

  /*----------  SET FOLDER LIST  ----------*/
  // The false in the third argument position defines whether folders should have depth or not.
  document.querySelector('#folders').innerHTML = await (this.generateFolderList(undefined, folders, [], false));
  let firstChildren = document.querySelector('#folders').children;
  let secondChildren = [];
  for (let i=0; i<firstChildren.length; i++){
    let secondChild = firstChildren[i].children;
    secondChildren[i] = secondChild[0]; //Remove the HTMLCollection - get only its value
  };
  this.linkFolders(secondChildren);
 
  // Highlight (css) the folder that is selected as current in 'state.json' .
  this.highlightFolder();

/*----------  ADD MAIL ITEMS  ----------*/
  this.render();
 
//   /*----------  SEARCH IN MAIL WINDOW  ----------*/
//   // MailPage.enableSearch() to xei sxoliasmeno o "dimiourgos leme twra"
}

MailPage.prototype.reload = async function() {
  // Add the fields that we were using (dynamically) in 'welcome.html' to 'mail.html', since we 
  // need them for not breaking the code that uses them (IMAP.updateAccount)
  document.querySelector('.wrapper').innerHTML = `
    <span id="doing"></span> 
    <span id="number"></span><br>
    <span id="mailboxes"></span>
  `;
  this.logger.log('Reloading mail messages...');
  let client = (await this.accountManager.getIMAP(this.stateManager.state.account.emailAddress));
  await client.updateAccount();
  this.client = client;
}


MailPage.prototype.generateFolderList = async function (email, folders, journey, depth) {
  if (typeof email === 'undefined') {
    // Get all the accouns present in the accounts db.
    let accounts = await this.accountManager.listAccounts();
    let html = '';
    for (let i = 0; i < accounts.length; i++) {
      // If 'depth' leave the <div> elements open, otherwise close them.
      if (depth) {
        html += `
          <div class="col s12 no-padding center-align">
            <div class="waves-effect waves-teal btn-flat wide" id="${btoa(email)}">
              ${accounts[i].name || accounts[i].user}
        `;
      } else {
        html += `
          <div class="col s12 no-padding center-align">
            <div class="waves-effect waves-teal btn-flat wide" id="${btoa(email)}">
              ${accounts[i].name || accounts[i].user}
            </div>
          </div>
        `;
      }
      html += await this.generateFolderList(accounts[i].user, accounts[i].folders, [], depth);
      if (depth) {
        html += `
            </div>
          </div>
        `
      }
      // html += await MailPage.generateFolderList(accounts[i].user, accounts[i].folders, [], depth)
    }
    return html
  }
  let html = '';
  for (let folder in folders) {
    let pathSoFar = journey.concat({ name: folder, delimiter: folders[folder].delimiter });
    let id = btoa(JSON.stringify(pathSoFar));
    if (depth) {
      html += `
        <div class="col s12 no-padding center-align">
          <div class="waves-effect waves-teal btn-flat wide folder-tree" id="${id}">
            ${folder} ${await this.generateFolderList(email, folders[folder].children, pathSoFar, depth)}
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="col s12 no-padding center-align">
          <div class="waves-effect waves-teal btn-flat wide folder-tree" id="${id}">${folder}
          </div>
        </div>
      `;
      html += await this.generateFolderList(email, folders[folder].children, pathSoFar, depth);
    }
  }
  return html;
}

MailPage.prototype.linkFolders = function (children) {
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
            otherFolders[i].classList.remove('teal','lighten-2');
          }
          document.querySelector(`#${clickedElement.target.id.replace(/=/g, '\\=')}`).classList.add('teal','lighten-2');
          this.render();                     
        });
      }
      // Search for child forlders.
      let firstChildren = document.querySelector(`#${element.id.replace(/=/g, '\\=')}`).children;
      let secondChildren = [];
      for (let i=0; i<firstChildren.length; i++){
        let secondChild = firstChildren[i].children;
        secondChildren[i] = secondChild[0]; //Remove the HTMLCollection - get only its value
      };
      if (secondChildren.length) {
        this.linkFolders(secondChildren);
      }
    }
  );
}

MailPage.prototype.highlightFolder = function () {
  let folders = document.querySelectorAll('.folder-tree');
  for (let i=0; i< folders.length; i++){
    folders[i].classList.remove('teal','lighten-2');
  }
  let currentFolder = document.querySelector(`#${btoa(JSON.stringify(this.stateManager.state.account.folder)).replace(/=/g, '\\=')}`);
  currentFolder.classList.add('teal','lighten-2');
}

// Render the currently selected folder (in state.json). Render is also called each time we click a folder.
MailPage.prototype.render = async function(folderPage) {
  // For a returning user we go straight into the /mail route so the ImapClient and MailStore are not
  // initialized, unless we perform a reload.
  if (this.mailStore === undefined){
    await this.reload();
    let client = this.client; // this.client is defined in MailPage.prototype.reload()
    this.mailStore = client.mailStore;
    return; //dont do recursion (when reload is called the rest of the function will run a second time)
  }
  let page = folderPage || 0;

  // Get the UID and the 'isThreadChild' fields of all the emails inside the current folder (folder stored in state.json).
  let mail = await this.mailStore.findEmails(this.stateManager.state.account.folder, { uid: 1, isThreadChild: 1 }, page * 250, 250);
  // Show in header the emailAddress followed by the folder currently selected.
  Header.setLoc([this.stateManager.state.account.emailAddress].concat(this.stateManager.state.account.folder.map((val) => { return val.name })));

  // If this is the first mail page initialize the html content.
  let mailDiv = document.querySelector('#mail');
  if (!page) {
    mailDiv.innerHTML = '';
    //document.querySelector('#message-holder').innerHTML = '<div id="message"></div>';
  }

  // Create <e-mail> tags equal to mailbox length.
  let html = "";
  for (let i = 0; i < mail.length; i++) {
    if (! mail[i].isThreadChild) {
      html += `<e-mail class="email-item" data-uid="${escape(mail[i].uid)}"></e-mail>`; // data-uid 
    }
  }
  if (mail.length === 0) html = 'This folder is empty.';
  if (await this.mailStore.countEmails(this.stateManager.state.account.folder) > 250 * (page + 1)) {
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
    // We're able to assume some values from the current state.
    // However, we don't rely on it, preferring instead to find it in the email itself.
    let email = emailCustomElements[i].getAttribute('data-email') || this.stateManager.state.account.emailAddress;
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
            <div class="subject">
              <div class="subject-text">${mail.threadMsg && mail.threadMsg.length ? `(${mail.threadMsg.length + 1})` : ``} ${Clean.escape(mail.envelope.subject)}</div>
            </div>
            <div class="sender">
              <div class="sender-text">${Clean.escape(typeof mail.envelope.from[0].name !== 'undefined' ?  `${mail.envelope.from[0].name} (${mail.envelope.from[0].mailbox}@${mail.envelope.from[0].host})`  : 'Unknown Sender')}</div>
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
          width: 25%;
          height: 100%;
        }
        .mail-item .text .sender .sender-text {
          display: inline-block;
          width: 100%;
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
        }
        .mail-item .text .subject {
          display: flex;
          align-items: center;
          width: 60%;
          height: 100%;
        }
        .mail-item .text .subject .subject-text {
          display: inline-block;
          width: 100%;
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
        }
        .mail-item .text .date {
          width: 15%;
          float: right;
          position: relative;
          right: 25.25px;
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
  // Inside the event the state of the Imap client is disconnected.
  if (mail.length > 0){
    let emailItems = document.querySelectorAll('.email-item');
    for (let i=0; i<emailItems.length; i++){
      emailItems[i].addEventListener('click', (e) => {
        this.renderEmail(unescape(e.currentTarget.attributes['data-uid'].nodeValue));
        //this.renderEmail(unescape(document.querySelector('.email-item').attributes['data-uid'].nodeValue));
      });
    }
  }


  // If the 'load-more button exists (many emails) then add the event listener.
  let loadMoreButton = document.querySelector('.load-more');
  if (loadMoreButton) {
    loadMoreButton.addEventListener('click', (e) => {
      this.render(page + 1);
      // Remove it after press. If it's needed again it will be rendered again in the next page's render call.
      loadMoreButton.remove();
    });
  }

  //this.retrieveEmailBodies();
}

MailPage.prototype.renderEmail = async function (uid, childNumber) {
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
          console.log('already')
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
            this.renderEmail(metadata.threadMsg[i - 1], i);
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

  let emailContent = await this.mailStore.loadEmailBody(uid, this.stateManager.state.account.emailAddress);

  //The mail content is not yet stored in the database.
  if (typeof emailContent === 'undefined') {
    selectedItemMessage.innerHTML = 'Loading email content ...';
    // The original client is now disconnected since renderEmail() is called via an event listener.
    let client = await this.accountManager.getIMAP(this.stateManager.state.account.emailAddress);
    emailContent = await client.getEmailBody(uid);
    this.client.client.end();
  }

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
            src = `${app.getAppPath()}\\mailAttachments\\${emailContent.attachments[j].filename}`;;
            break;
          }
        }
        images[i].setAttribute('src',src);
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
