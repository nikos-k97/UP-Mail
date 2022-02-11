const Datastore  = require('@rmanibus/nedb'); // Use a NeDB fork since original NeDB is deprecated.
const Promise    = require('bluebird');
const IMAPClient = require('./IMAPClient');

// BlueBird is used to make the NeDB module run asynchronously.
// It's useful feature is that it allows us to “promisify” other Node modules in order to use them asynchronously. 
// Promisify is a concept (applied to callback functions) that ensures that every callback function (in a node 
// module), when called, returns some value.

function AccountManager (app, logger, stateManager, utils) {
  this.app = app;
  this.logger = logger;
  this.stateManager = stateManager;
  this.utils = utils;

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

// Async functions always return a promise. Other values are wrapped in a resolved promise automatically.
// Also enables the use of 'await', which is another way to wait for a promise to be resolved insted of
// promise.then(). The 'await' keyword blocks the code under it from executing until the promise resolves.
AccountManager.prototype.addAccount = async function (details) {
  /*----------  OVERLAY PROCESSING MODAL  ----------*/
  // The first time addAccount this run .mainarea class is refering to welcome.html
  document.querySelector('.mainarea').innerHTML = `
    <span id="doing"></span> 
    <span id="number"></span><br>
    <span id="mailboxes"></span>
  `;

  /*----------  REFORMAT DETAILS OBJECT (details -> user) TO STORE IN DATABASE  ----------*/
  let user = {
    imap: { 
      host : details.host_incoming,
      port : details.port_incoming,
      tls : details.tls_incoming === 'tls' ? true : false
    },
    smtp: {
      host : details.host_outgoing,
      port : details.port_outgoing,
      tls : details.tls_outgoing, //'starttls'-'tls'-'unencrypted' not true-false like IMAP
      name: details.outgoing_name 
    },
    user: details.user,
    password : details.password,
    hash: this.utils.md5(details.user),
    date: + new Date()
  };

  // Used for authenticating to IMAPClient.
  const IMAPDetails = {
    user: details.user,
    password : details.password,
    host : details.host_incoming,
    port : details.port_incoming,
    tls : details.tls_incoming === 'tls' ? true : false
  };

  // Used for authenticating to SMTPClient.
  const SMTPDetails = {
    user: details.user,
    password : details.password,
    host : details.host_outgoing,
    port : details.port_outgoing,
    tls : details.tls_outgoing,
    name: details.outgoing_name 
  };

  /*----------  LOG USER IN  ----------*/
  document.querySelector('#doing').innerText = 'Logging you in ...'; // innerText != textContent
  let client = await (new IMAPClient(this.app, this.logger, this.utils, this.stateManager, this, IMAPDetails));
  this.logger.log(`Successfully logged in to user ${user.user}.`);


  /*----------  CREATE EMAIL DATABASE  ----------*/
  // Stores the emails for this particular account.
  document.querySelector('#doing').innerText = 'Initializing the database for your email ...';
  // Create a database for the emails (only of it doesn't already exist).
  client.createEmailDatabase(user.user);
  this.logger.log(`Initialization for ${user.user} account was successfull.`);
 

  /*----------  SAVE ACCOUNT TO ACCOUNTS DB  ----------*/
  // Inserts this particular account to accounts.db.
  try {
    document.querySelector('#doing').innerText = 'Saving your account for the future ...';
    // Await for the promisified NeDB's 'insert' function to resolve.
    // NeDB automatically adds an '_id' field for each document.
  	await this.accounts.insertAsync(user);
    this.logger.log(`Added ${user.user} to the accounts database.`)
  } catch(e) {
    // Throw error if 'user' field already exists (due to the indexing - unique = true).
    // The user is not saved again.
    this.logger.warning(`User ${user.user} was already found in the database. `)
  }

  /*----------  UPDATE MAIL ITEMS FOR ACCOUNT  ----------*/
  await client.updateAccount()

  /*----------  SWITCH TO THAT USER  ----------*/
  //StateManager.change('account', { hash: user.hash, email: user.user })
  //StateManager.change('state', 'mail')
  //StateManager.update()
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

AccountManager.prototype.getIMAP = async function (email) {
  let account = await this.findAccount(email);
  let IMAPDetails = {
    user: account.user,
    password: account.password,
    host: account.imap.host,
    port: account.imap.port,
    tls: account.imap.tls
  }
  let client = await (new IMAPClient(this.app, this.logger, this.utils, this.stateManager, this, IMAPDetails));
  console.log(client)
  return client;
}

module.exports = AccountManager;