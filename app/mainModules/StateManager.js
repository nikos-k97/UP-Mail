const jetpack          = require('fs-jetpack');
const AccountManager   = require('./AccountManager');
const ContactsManager  = require('./ContactsManager');
const WelcomePage      = require('./WelcomePage');
const MailPage         = require('./MailPage');
const MailStore        = require('./MailStore');


// Constructor function
function StateManager (app, ipcRenderer, logger, utils, router) {
  this.app = app;
  this.ipcRenderer = ipcRenderer;
  this.logger = logger;
  this.utils = utils;
  this.router = router;
  /*
    Set cwd for jetpack module to app.getPath('userData') instead of the directory that the project is saved.
    cwd: current working directory
    app.getPath('userData'):    C:\Users\xxx\AppData\Roaming\project-xxx (OS: Windows)
    app.getAppPath():           C:\Users\xxx\Desktop\project-xxx (the directory where the project is saved)
  */

  this.accountManager = new AccountManager(this.app, this.logger, this, this.utils, this.ipcRenderer);
  this.contactsManager = new ContactsManager(this.app, this.utils);
  this.welcomePage = new WelcomePage(this.logger, this, this.utils, this.accountManager); 
  this.mailStore = new MailStore(this.app,this.utils); 
  this.mailPage = new MailPage(this.app, this.logger, this, this.utils, this.accountManager, this.mailStore);
    
  this.storeDir = jetpack.cwd(this.app.getPath('userData'));
  this.appDir = jetpack.cwd(this.app.getAppPath());
  this.state = this.storeDir.read('./state.json', 'json') || { state: 'new' };
}
                      /*
                        {
                          "state": "existing",
                          "account": {
                            "hash": "9c6ab7112801d9d3eadf36f0d6c19477",
                            "user": "testmail@domain.com",
                            "folder": [
                              {
                                "name": "Inbox",
                                "delimiter": "/"
                              }
                            ]
                          }
                        }
                      */

StateManager.prototype.initialize = async function(){
  this.logger.info('*** Secure email client ***');
  this.logger.info(`Application Paths Found:
    App Dir   - ${this.app.getAppPath()}
    Store Dir - ${this.app.getPath('userData')}
    Temp Dir  - ${this.app.getPath('temp')}`
  );
  this.logger.info(`Other Paths Found:
    Exe Path  - ${this.app.getPath('exe')}`
  );

  /*
   Check 'state' to determine if we have a new or an existing user.
   New user -> Welcome.js (fill login data) -> AccountManager.js (add Account to DB) -> StateManager.js (setup())
   Existing user -> AccountManager.js (fetch account from DB) -> StateManager.js (setup())
  */
  this.checkUserState();
}


StateManager.prototype.setup = async function (loginInfo) {
  /* During this time the HTML file loaded is either none (existing user) or welcome.html (new user).
     During this time 'state' = 'existing'.
     Login info may also contain folder information, if the user was an existing one.
  */

  // Create (or load if it exists) the database that stores the emails for the (newly created or already existing) 
  // email account.
  await this.mailStore.createEmailDB(loginInfo.user); // The email database can be accessed via 'mailStore.db'
  this.logger.log(`Email database for user: '${loginInfo.user}' was initialized successfully.`);

  let emailsFound = await this.mailStore.findEmails();

  if (emailsFound.length === 0 && loginInfo.personalFolders !== undefined){
    this.logger.info('Something went wrong!');
    // The accounts database has folder information (uidvalidity etc) from a previous session, but the 
    // email database is empty, so we revert back to 'new'. 
    await this.mailStore.deleteEmails();
    await this.mailStore.deleteEmailBodies(loginInfo.user, [], true);
    await this.accountManager.removeAccount(loginInfo.user);
    this.change('state', 'new');
    this.checkUserState();
    // Re-emit window.load event so that the StateManager.style function can work properly.
    // (it is waiting for the window.load event to apply style)
    dispatchEvent(new Event('load'));
  }
  else {
    // Create the folders where the mail bodies for this specific user will be stored.
    // (If they dont already exist) 
    // Also create keys directory.
    const hash = String(loginInfo.user).includes('@') ? this.utils.md5(loginInfo.user) : loginInfo.user;
    let fs = jetpack.cwd(this.app.getPath('userData'));
    fs.dir(`mail`).dir(`${hash}`);
    fs.dir(`keys`);
    fs = jetpack.cwd(this.app.getPath('userData'), `keys`);
    fs.dir(`${this.utils.md5(loginInfo.user)}`);
    fs = jetpack.cwd(this.app.getPath('userData'), `keys`, `${this.utils.md5(loginInfo.user)}`);

    // Global variable 'setupComplete' is used for 'Utils.testLoaded()' to indicated that the setup and 
    // the configuration info have been completed successfully so we can safely proceed to the MailPage.
    /* User account is already present in the accounts database. Folders may or may not exist depending on new
       or existing user. Email database was created (if it not already existed). The emails DB may be empty
       in the case of a new user (or if the current user logged off or if uid validity changed).
    */
    this.logger.debug(`Setup complete, the state file has been read and the databases have been loaded.`);
    global.setupComplete = true; 
     
    // Make the final connection to the IMAP server. New user -> second connection (first one was a test one
    // when the user submits the form data). Existing user with every database field OK -> fist connection.
    // If the connection is successful proceed and give the coordination login to MailPage.js
    let initialized = await this.mailPage.initializeIMAP(loginInfo);
   
    // Proceed to MailPage.js, where the email Database is populated with (new) emails, depending on 
    // the currently stored UIDvalidity value.
    /* While in MailPage.js if a disconnect happens, and the client can't reconnect, the function where
      the disconnection happened returns recursively until it reaches the StateManager.setup() where 
      the renderMailPage was first called, while also reverting the state to 'new' and starting the cycle again.
      (The old cycle is terminated when it reaches stateManager.setup() after the renderMailPage call, after
      which no more methods are called).
    */
    // Logged in to IMAP and SMTP servers. From now on password from the DB will not be decrypted again.
    // (was decrypted once in AccountManager.existingAccount or AccountManager.newAccount)
    if (initialized) this.mailPage.renderMailPage();
  }
}


StateManager.prototype.cleanUp = function() {
  // Delete all instances and do garbage collection.
}

/* 
********************************* Explanation of various user states ****************************************
  -If state:new and state.account = undefined -> welcome form
  -If state:new and state.account != undefined -> welcome form - state.account is updated with new data
   > In both above cases, if the accounts database already have an entry for the new user, the stored user
     data are updated with the new data.
   > In both above cases, the submitted data is verified via a test connection to IMAP and SMTP servers 
     before being inserted in the database.

  -If state:existing and state.account = undefined -> state:new - welcome form
  -If state:existing and state.account != undefined -> load database
   > In the second case, if the stored account data is somehow wrong and not enough to authenticate with
     IMAP server, the user is considered 'new' -> welcome form
   > In the fist case, the submitted data is verified via a test connection to IMAP and SMTP servers 
     before being inserted in the database.
  
  -If state != new and != existing, the app basically reloads itself via intialization of the stateManager

  > In all the above cases, the login data is verified (again in the case of the new user - the first time is
    before the are saved in the DB) at the time that the real IMAP connection (mailpage.js) is attempted.
    If the data are wrong, the user is considered 'new' -> welcome form is loaded
*************************************************************************************************************
*/
StateManager.prototype.checkUserState = function () {
  switch (this.state.state) {
    case 'new':
      this.logger.debug(`This is a new user. Create their account via the welcome form and proceed to setup.`);
      this.router.navigate('/new');
      break;
    case 'existing':
      this.logger.debug(`This is an existing user. Load their account and proceed to setup.`);
      this.router.navigate('/existing');
      break;
    default:
      this.logger.warning(`Unknown state. This should never happen. The state was ${this.state.state}`);
      this.state = { state: 'new' };
      this.initialize();
      dispatchEvent(new Event('load'));
  }
}


/**
 * Sets and saves a state value to the state file.
 *
 * @param  {string} value
 * @param  {all} option
 * @return {undefined}
 */
StateManager.prototype.change = function (option, value) {
  if (option === 'state' && value === 'new'){
    this.state = {state : 'new'};
  }
  else{
    this.state[option] = value;
  }
  this.storeDir.write('state.json', this.state);
}


/**
 * This function enables an array of CSS files, 
 * whilst disabling the rest.
 *
 * @param  {array} titles
 * @return {undefined}
 */
StateManager.prototype.style = function (titles) {
  for (let i = 0; i < document.styleSheets.length; i++) {
    let shouldEnable = titles.includes(document.styleSheets[i].ownerNode.getAttribute('data-name')) || document.styleSheets[i].ownerNode.getAttribute('data-name').includes('all-');
    document.styleSheets[i].disabled = !shouldEnable;
    if (titles.includes(document.styleSheets[i].ownerNode.getAttribute('data-name'))) {
      titles.splice(titles.indexOf(document.styleSheets[i].ownerNode.getAttribute('data-name')), 1);
    }
  }
  if (titles.length) {
    this.logger.error(`Warning, ${titles} was /were not found within the list of stylesheets.`);
    this.logger.log(document.styleSheets);
  }
}


/**
 * Page handles all the application state switching by enabling
 * and disabling CSS, and loading the HTML into the body of the
 * application
 *
 * @param  {string} page
 * @param  {array} css
 * @return {undefined}
 */
StateManager.prototype.page = function (page, css) {
  this.logger.debug(`Switching page to ${page} ...`);
  document.querySelector('#content').innerHTML = this.appDir.read(`./app/html/${page}.html`);
  window.addEventListener('load', () => {
    this.style(css);
  });
}


// ** PROTOTYPE PROPERTY **
// ************************
// The constructor function Foobar() has its own prototype, which can be found by calling Object.getPrototypeOf(Foobar).
// (the __proto__ attribute is deprecated since ECMAScript 2015) 
// This differs from its prototype property, Foobar.prototype, which is the blueprint for instances of this constructor function.
// If we were to create a new instance — let fooInstance = new Foobar() — fooInstance would take its prototype from its 
// constructor function's prototype property. Thus Object.getPrototypeOf(fooInstance) === Foobar.prototype.
// Note: The prototype chain is traversed only while retrieving properties. If properties are set or deleted directly on the object, 
// the prototype chain is not traversed.

// ** MODIFYING PROTOTYPE PROPERTY OF A CONSTRUCTOR FUNCTION **
// ************************************************************
// Methods added to the prototype are then available on all object instances created from the constructor.
// Performing 'delete Person.prototype.farewell' would remove the farewell() method from all Person instances.
// In order to mitigate this issue, one could use Object.defineProperty() instead.

// **CONSTRUCTOR PROPERTY **
// *************************
// Every constructor function has a prototype property whose value is an object containing a constructor property. 
// This constructor property points to the original constructor function.
// Properties defined on the Person.prototype property (or in general on a constructor function's prototype property,
// which is an object, as mentioned in the above section) become available to all the instance objects created using the
// Person() constructor. Hence, the constructor property is also available to both person1 and person2 objects.


module.exports = StateManager;