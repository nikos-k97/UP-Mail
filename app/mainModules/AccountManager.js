const Datastore = require('@rmanibus/nedb'); // Use a NeDB fork since original NeDB is deprecated.
const Promise = require('bluebird');

// BlueBird is used to make the NeDB module run asynchronously.
// It's useful feature is that it allows us to “promisify” other Node modules in order to use them asynchronously. 
// Promisify is a concept (applied to callback functions) that ensures that every callback function (in a node 
// module), when called, returns some value.

function AccountManager (app, logger, utils) {
  this.app = app;
  this.logger = logger;
  this.utils = utils;
  const db = new Datastore(
    {
      // Persistent datastore (stored on disk at 'filename' not in-memory). 
      filename: this.app.getPath('userData') + '/db/accounts.db', 
      // The database will automatically be loaded from the datafile upon creation (no 'loadDatabase' needed).
      autoload: true                                              
    }
  );
	this.accounts = Promise.promisifyAll(db);

  // Use database indexing for 'user' field - mostly used to enforce uniqueness to the 'user' field
  this.accounts.ensureIndex({ fieldName: 'user', unique: true });
}

// Async functions always return a promise. Other values are wrapped in a resolved promise automatically.
// Also enables the use of 'await', which is another way to wait for a promise to be resolved insted of
// promise.then(). The 'await' keyword blocks the code under it from executing until the promise resolves.
AccountManager.prototype.addAccount = async function (details) {
  /*----------  OVERLAY PROCESSING MODAL  ----------*/
  document.querySelector('.wrapper').innerHTML = `
    <span id="doing"></span> 
    <span id="number"></span><br>
    <span id="mailboxes"></span>
  `;

  //$('.wrapper').html(`
  //  <span id="doing"></span> <span id="number"></span><br>
  ///  <span id="mailboxes"></span>
  //`)

  /*----------  LOG USER IN  ----------*/
  document.querySelector('#doing').innerText = 'Logging you in ...'; // innerText != textContent
  //let client = await (new IMAPClient(details));
  this.logger.log(`Successfully logged in to user ${details.user}.`);

  /*----------  CREATE ACCCOUNT DATABASE  ----------*/
  document.querySelector('#doing').innerText = 'Creating a database for your email ...';
  //await MailStore.createEmailDB(details.user);
  this.logger.log(`Successfully created a database account for ${details.user}.`);

  /*----------  REFORMAT DETAILS OBJECT  ----------*/
  let user = {
    imap: { 
      host: details.host,
      port: details.port
    },
    smtp: {
      host: details.host_outgoing,
      port: details.port_outgoing
    },
    user: details.user, 
    password: details.password, 
    tls: details.tls,
    hash: this.utils.md5(details.user),
    date: + new Date()
  };

  /*----------  SAVE ACCOUNT TO ACCOUNTS DB  ----------*/
  try {
    document.querySelector('#doing').innerText = 'Saving your account for the future ...';
  	//await this.accounts.insertAsync(user)
    this.logger.log(`Added ${details.user} to the accounts database.`)
  } catch(e) {
    this.logger.warning(`Huh, ${details.user} appeared to already be in the database?`)
  }

  /*----------  UPDATE MAIL ITEMS FOR ACCOUNT  ----------*/
  //await client.updateAccount()

  /*----------  SWITCH TO THAT USER  ----------*/
  //StateManager.change('account', { hash: user.hash, email: user.user })
  //StateManager.change('state', 'mail')
  //StateManager.update()
}

AccountManager.prototype.listAccounts = async function () {
  return this.accounts.findAsync({})
}

AccountManager.prototype.findAccount = async function (email) {
  return (await this.accounts.findAsync({ user: email }))[0] || {}
}

AccountManager.prototype.editAccount = async function (email, changes) {
  return this.accounts.updateAsync({ user: email }, { $set: changes })
}

AccountManager.prototype.removeAccount = async function (email) {
	return this.accounts.removeAsync({ user: email })
}

AccountManager.prototype.getIMAP = async function (email) {
  let account = await this.findAccount(email)
  return await new IMAPClient({
    user: account.user,
    password: account.password,
    host: account.imap.host,
    port: account.imap.port,
    tls: account.tls
  })
}

module.exports = AccountManager;