const jetpack    = require('fs-jetpack');
const Datastore  = require('@rmanibus/nedb'); // Use a NeDB fork since original NeDB is deprecated.
const Promise    = require('bluebird');
const IMAPClient = require('./IMAPClient');
const SMTPClient = require('./SMTPClient');
const Encrypt    = require('./Encrypt');


// 'BlueBird' is used to make the NeDB module run asynchronously.
// It's useful feature is that it allows us to “promisify” other Node modules in order to use them asynchronously. 
// Promisify is a concept (applied to callback functions) that ensures that every callback function (in a node 
// module), when called, returns some value.

function AccountManager (app, logger, stateManager, utils, ipcRenderer) {
  this.app = app;
  this.logger = logger;
  this.stateManager = stateManager;
  this.utils = utils;
  this.ipcRenderer = ipcRenderer;

  // Load the database that stores the user accounts (Creates it if doesn't exist).
  const db = new Datastore(
    {
      // Persistent datastore (stored on disk at 'filename' not in-memory). 
      filename: this.app.getPath('userData') + '/db/accounts.db', 
      // The database will automatically be loaded from the datafile upon creation (no 'loadDatabase' needed).
      autoload: true                   
    }
  );
	this.accounts = Promise.promisifyAll(db);
  // Use database indexing for 'user' field - mostly used to enforce uniqueness to the 'user' field.
  this.accounts.ensureIndex({ fieldName: 'user', unique: true });
}


// Check if we can procceed to log the user in.
// Used by 'Welcome.js' for the case of a new user.
AccountManager.prototype.testProvidedDetails = async function (loginDetails) {
  let imapClient = new IMAPClient(this.app, this.logger, this.utils, this.stateManager, this, loginDetails);
  let smtpClient = new SMTPClient(loginDetails, this.logger);
  try {
    let client = await imapClient;
    smtpClient.createTransporterObject(loginDetails);
    await smtpClient.verifyServerConnection(loginDetails);
    client.client.end();
    client = null;
    imapClient = null;
    smtpClient = null;
    return true; // Connection to both server was established successfully.
  } catch (error) {
    this.logger.error(error);
    imapClient = null;
    smtpClient = null;
    return false; // Could not establish connection to one of (or both) the servers.
  }
}


// ('existingAccount' is called for an existing user that did not perform a 'logout' in the previous session.)
AccountManager.prototype.existingAccount = async function () {
  // Retrieve this particular account's info to accounts.db (the accounts.db was created when the instance of
  // AccountManager.js was created - in the constructor).
  // If 'state === existing' but account is unknown, treat it as a new user (Welcome.js etc...).
  if (typeof this.stateManager.state.account === 'undefined') {
    this.stateManager.change('state', 'new');
    this.stateManager.checkUserState();
    // Re-emit window.load event so that the StateManager.style function can work properly.
    // (it is waiting for the window.load event to apply style)
    dispatchEvent(new Event('load'));
  }
  else {
    // If 'state === existing' and account is known, get the loginDetails from the database.
    // Because this is an existing account, the account also have folder information (account.folders)
    // in addition to the login information.
    let account = await this.findAccount(this.stateManager.state.account.user);
    if (account.user === undefined){
      // Account info can't be retrieved.
      this.stateManager.change('state', 'new');
      this.stateManager.checkUserState();
      // Re-emit window.load event so that the StateManager.style function can work properly.
      // (it is waiting for the window.load event to apply style)
      dispatchEvent(new Event('load'));
    }
    else{
    // Account info were retrieved, redirect to stateManager.
    const key = (await Encrypt.keyDerivationFunction(account)).toString(); 
    account.password =  Encrypt.decryptAES256CBC(key, account.password) 
    await this.stateManager.setup(account);
    }

  }
}


// ('newAccount' can be called for an existing user after a logout.)
// Inserts this particular account's info to accounts.db (the accounts.db was created when the instance of
// AccountManager.js was created - in the constructor). If the user already exists, it updated only the required
// information. 
AccountManager.prototype.newAccount = async function(loginInfo) {
  let user = loginInfo.user;
  let hash = user.includes('@') ? this.utils.md5(user) : user;
  let dataExistedBeforeInsertion = false;
  let existingData = this.findAccount(user);
  if (existingData !== undefined && existingData !== {}) dataExistedBeforeInsertion = true;
    
  // Search the OS's Credential Manager / Keychain for the app key. 
  // If there is not one present, create a key from the loginInfo.password using 'Scrypt'.
  // Use this key to encrypt the user password before storing it in the DB.
  const key = (await Encrypt.keyDerivationFunction(loginInfo)).toString(); 
  let encryptedLoginInfo = loginInfo;
  encryptedLoginInfo.password = Encrypt.encryptAES256CBC(key, loginInfo.password);
  
  try {
    // Await for the promisified NeDB's 'insert' function to resolve.
    // NeDB automatically adds an '_id' field for each document.
  	await this.accounts.insertAsync(encryptedLoginInfo);
    this.logger.log(`Added user: '${loginInfo.user}' to the accounts database.`)
  } catch(e) {
    // Throw error if 'user' field already exists (due to the indexing - unique = true).
    // The user is not saved again.
    this.logger.warning(`User '${loginInfo.user}' was already found in the database. Updating info...`);
    await this.editAccount(loginInfo.user, encryptedLoginInfo);
    this.logger.log(`Info for user '${loginInfo.user}' updated.`)
  }

  // Change state to 'existing' and add the 'user' and 'hash' fields to state.json.
  this.stateManager.change('state', 'existing');
  this.stateManager.change('account', {hash, user});

  // Create the folders where the mail bodies for this specific user will be stored.
  // (If they dont already exist)
  let fs = jetpack.cwd(this.app.getPath('userData'));
  fs.dir(`mail`).dir(`${hash}`);
  fs = jetpack.cwd(this.app.getPath('userData'), `mail`,`${hash}`);

  // If the account was an existing one (after logout), then we fetch all the stored info from the previous 
  // session, after the potential update to the login info we just did.
  // Account was updated, redirect to stateManager.
  if (dataExistedBeforeInsertion) {
    existingData = await this.findAccount(user);
    existingData.password = Encrypt.decryptAES256CBC(key, existingData.password);
    await this.stateManager.setup(existingData);
  }
  else {
    // Since its a new user (not an existing one after logout) we delete all mail bodies stored.
    let allUids = fs.find(`.`);
    allUids.forEach(jsonFile => {
      fs.remove(`${jsonFile}`);
      console.log(`Removed ${jsonFile} from mail/${hash}.`);
    });

    // Account was inserted, redirect to stateManager.
    await this.stateManager.setup(encryptedLoginInfo);
  }
}


AccountManager.prototype.listAccounts = async function () {
  return this.accounts.findAsync({});
}


AccountManager.prototype.findAccount = async function (email) {
  // FindAsync returns an array of 1 element , so we use the [0] to get inside the array.
  return (await this.accounts.findAsync({ user: email }))[0] || {};
}


AccountManager.prototype.editAccount = async function (email, changes) {
  return this.accounts.updateAsync({ user: email }, { $set: changes });
}


AccountManager.prototype.removeAccount = async function (email) {
	return this.accounts.removeAsync({ user: email });
}


module.exports = AccountManager;