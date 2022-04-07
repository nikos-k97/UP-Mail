const Datastore   = require('@rmanibus/nedb'); // Use a NeDB fork since original NeDB is deprecated.
const Promise     = require('bluebird');
const jetpack     = require('fs-jetpack');


function ContactsManager (app, utils) {
  this.app = app;
  this.utils = utils;
}

/**
 * Attempts to create a persistent contacts database for the specified email address.
 * @param  {string}  emailAddress [An email address to create the DB instance of]
 * @return {undefined}
 */

 ContactsManager.prototype.createContactsDB = async function (emailAddress) {
  // Detect whether we need to hash it ourselves, or if it is already hashed.
  let hash = emailAddress.includes('@') ? this.utils.md5(emailAddress) : emailAddress;
  if (typeof this.db === 'undefined') {
    // Create (only if it doesnt exist) the database that stores the mail for the particular emailAddress.
    const contactsDB = new Datastore(
      {
        filename: `${this.app.getPath('userData')}/contacts/${hash}.db`,
        autoload: false
      }
    );
    this.db = Promise.promisifyAll(contactsDB);
    // Load the database
    await this.db.loadDatabaseAsync();
    // Since each message's UID is unique inside each mailbox, we specify that 'uid' field should be unique.
    this.db.ensureIndex({ fieldName: 'email', unique: true });
  }
}


ContactsManager.prototype.saveContact = async function (email, name, publicKey) {
  if (typeof this.db === 'undefined') await this.createContactsDB(email);

  let newContact = {'email': email, 'name' : name, 'publicKey' : publicKey};
  
  return this.db.insertAsync(newContact).catch((reason) => {
    // if (~String(reason).indexOf('it violates the unique constraint'))  *is the same as*
    // if (String(reason).includes('it violates the unique constraint'))  *is the same as*
    if (String(reason).indexOf('it violates the unique constraint') >= 0) {
      console.log(`Updating contact with email '${email}'...`);
      return this.db.updateAsync({ 'email': email }, newContact);
    }
  });
}


ContactsManager.prototype.loadContact = async function (email) {
  if (typeof this.db === 'undefined') await this.createContactsDB(email);
  return this.db.findOneAsync({ 'email' : email });
}


ContactsManager.prototype.loadAllContacts = async function () {
  return await new Promise((resolve) => {
    this.db.find(
      {},
      {}                                      
    ).sort({ name: -1 }).exec((err, docs) => {
      resolve(docs);
    });
  });
}


ContactsManager.prototype.countContacts = async function () {
  return await this.db.countAsync({ 'email' : email })
}


ContactsManager.prototype.deleteContact = async function (email) {
  return await new Promise((resolve) => {
    this.db.remove({ email: email}, { multi: true }, (err,numRemoved) => {
      console.log('Deleted : '+numRemoved+' (email :'+email+')');
      resolve();
    });
  })
}


ContactsManager.prototype.deleteAllContacts = async function () {
  return await new Promise((resolve) => {
    this.db.remove({}, { multi: true },( err , numRemoved) => {
      console.log('Deleted : '+numRemoved);
      resolve();
    });
  });
}

ContactsManager.prototype.deleteDB = function () {
  let fs = jetpack.cwd(this.app.getPath('userData'), `contacts`);
  let allContent = fs.find(`.`, {files : true, directories : true});
  allContent.forEach(fileOrFolder => {
    fs.remove(`${fileOrFolder}`);
    console.log(`Removed ${fileOrFolder} from contactsDB.`);
  });
}



module.exports = ContactsManager;