const Datastore = require('@rmanibus/nedb'); // Use a NeDB fork since original NeDB is deprecated.
const Promise  = require('bluebird');
const jetpack   = require('fs-jetpack');

function MailStore (app, utils, imapClient) {
  this.app = app;
  this.utils = utils;
  this.imapClient = imapClient;
}

// Called inside 'onLoad' callback function of the getEmails() function defined in IMAPClient.js
// for each email inside a mailbox.
MailStore.prototype.saveEmail = async function (email, seqno, msg, attributes, folder) { // msg = parsedContent
  // For example when the reload button is pressed, a new IMAP client is created and this.hash is undefined
  if (typeof this.hash === 'undefined') await this.createEmailDB(email);

  // The properties are overwritten by other objects that have the same properties later in the parameters order. 
  let mail = Object.assign( 
    msg, // target
    attributes,  //source1
    { seqno, folder, user: email, uid: folder + seqno, date: +new Date(attributes.date) } //source2
  )
  
  // `folder + seqno` are guarenteed to be unique unless UIDValidity changes, which we
  // currently are unable to detect.

  // 'this.hash' is defined MailStore.prototype.createMailDB(). It is the promisified NeDB Database object.
  return this.hash.insertAsync(mail).catch((reason) => {
    // if (~String(reason).indexOf('it violates the unique constraint'))  *is the same as*
    // if (String(reason).includes('it violates the unique constraint'))  *is the same as*
    if (String(reason).indexOf('it violates the unique constraint') >= 0) { 
      return this.hash.updateAsync({ uid: folder + seqno }, mail)
    }
  });
}

MailStore.prototype.saveMailBody = async function (uid, data, email) {
  const hash = String(email).includes('@') ? this.utils.md5(email) : email;
  const hashuid = this.utils.md5(uid);
  const fs = jetpack.cwd(this.app.getPath('userData'), `mail`,`${hash}`);
  fs.write(`${hashuid}.json`, JSON.stringify(data));
}

MailStore.prototype.loadEmail = async function (uid, email) {
  if (typeof this.hash === 'undefined') await this.createEmailDB(email);
  return this.hash.findOneAsync({ uid: uid });
}

MailStore.prototype.loadEmailsWithoutBody = async function () {
  return await new Promise((resolve, reject) => {
    this.hash.find({
      'retrieved': { $exists: false } //check if the document has the property 'retrieved'
      }, { uid: 1 }).sort({ date: 0 }).exec((err, docs) => {
        if (err) return reject(err)
        resolve(docs);
      });
  });
}

MailStore.prototype.loadEmailBody = async function (uid, email) {
  const hashuid = this.utils.md5(uid);
  const hash = String(email).includes('@') ? this.utils.md5(email) : email;
  const fs = jetpack.cwd(this.app.getPath('userData'), `mail`,`${hash}`);
  return fs.read(`${hashuid}.json`, 'json');
}

/**
 * Attempts to transform an email address into a DB.
 * @param  {string}    emailAddress [An email address to create the DB instance of]
 * @return {undefined}
 */
MailStore.prototype.createEmailDB = async function (emailAddress) {
  // Detect whether we need to hash it ourselves, or if it is already hashed.
  let hash = emailAddress.includes('@') ? this.utils.md5(emailAddress) : emailAddress;
  if (typeof this.hash === 'undefined') {
    // Create (only if it doesnt exist) the database that stores the mail for the particular emailAddress.
    const mailDB = new Datastore(
      {
        filename: `${this.app.getPath('userData')}/db/${hash}.db`,
        autoload: false
      }
    );
    this.hash = Promise.promisifyAll(mailDB);
    // Load the database
    // !!!!!!!!!!!!!! MAYBE LOADDATABASEASYNC IS NOT REQUIRED HERE!!!!!!!!!!!!!!!!!!!!!!!!!!
    await this.hash.loadDatabaseAsync();
    // Since each message's UID is unique inside each mailbox, we specify that 'uid' field should be unique.
    this.hash.ensureIndex({ fieldName: 'uid', unique: true });
  }
}

MailStore.updateEmailById = async function (email, id, changes) {
  // Detect whether we need to hash it ourselves, or if it is
  // already hashed.
  let hash = ~email.indexOf('@') ? Utils.md5(email) : email
  return await this[hash].updateAsync({ _id: id }, { $set: changes }, {})
}

MailStore.prototype.updateEmailByUid = async function (uid, changes) {
  /*
  db.update(query, update, options, callback)
  - 'update' specifies how the documents should be modified. It is either a new document or a set of modifiers.
     The modifiers create the fields they need to modify if they don't exist.
     $set modifier : change a field's value
  - 'options' : multi (defaults to false) which allows the modification of several documents if set to true
  */
  return await this.hash.updateAsync({ uid: uid }, { $set: changes }, {});
}

MailStore.prototype.findEmails = async function (folder, projections, skip, limit) {
  return await new Promise((resolve) => {
    /*
    hash.find( {key:'value'}, function (err, docs) {
      //Do something
    });
     
    - 'docs' is an array containing documents with field {key:value}. If no document is found, 'docs' is equal to [].
    - {} returns all documents in the collection.
    - If we don't specify a callback, a Cursor object is returned. 
      We can modify the cursor with sort, skip and limit and then execute it with exec(callback).
    - We can give 'find' an optional second argument: 'projections'.
      The syntax is the same as MongoDB: { a: 1, b: 1 } to return only the a and b fields, 
      { a: 0, b: 0 } to omit these two fields. We cannot use both modes at the time, except for _id which 
      is by default always returned and which we can choose to omit.
    */
    this.hash.find(
      folder ? { folder: this.imapClient.compilePath(folder) } : {}, // {key:value} or {}:all documents
      projections ? projections : {}                                      
    ).sort({ date: -1 }).skip(skip).limit(limit).exec((err, docs) => {
      resolve(docs);
    });
  });
}

MailStore.prototype.countEmails = async function (folder) {
  return await this.hash.countAsync({ folder: this.imapClient.compilePath(folder) })
}

module.exports = MailStore;