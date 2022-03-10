const Datastore   = require('@rmanibus/nedb'); // Use a NeDB fork since original NeDB is deprecated.
const Promise     = require('bluebird');
const jetpack     = require('fs-jetpack');
const Utils       = require('./Utils');

function MailStore (app, utils) {
  this.app = app;
  this.utils = utils;
}

/**
 * Attempts to transform an email address into a DB.
 * @param  {string}  emailAddress [An email address to create the DB instance of]
 * @return {undefined}
 */

 MailStore.prototype.createEmailDB = async function (emailAddress) {
  // Detect whether we need to hash it ourselves, or if it is already hashed.
  let hash = emailAddress.includes('@') ? this.utils.md5(emailAddress) : emailAddress;
  if (typeof this.db === 'undefined') {
    // Create (only if it doesnt exist) the database that stores the mail for the particular emailAddress.
    const mailDB = new Datastore(
      {
        filename: `${this.app.getPath('userData')}/db/${hash}.db`,
        autoload: false
      }
    );
    this.db = Promise.promisifyAll(mailDB);
    // Load the database
    await this.db.loadDatabaseAsync();
    // Since each message's UID is unique inside each mailbox, we specify that 'uid' field should be unique.
    this.db.ensureIndex({ fieldName: 'uid', unique: true });
  }
}


// Called inside 'onLoad' callback function of the getEmails() function defined in IMAPClient.js
// for each email inside a mailbox.
MailStore.prototype.saveEmail = async function (email, seqno, msg, attributes, folder) { // msg = parsedContent
  if (typeof this.db === 'undefined') await this.createEmailDB(email);
  /*
    We store the message's UID as 'folder+UID' (eg. 'Inbox24') because we use the same DB for every folder, and 
    different folders may contain messages with the same UIDs. The combination folder+UID is unique, unless
    UIDValidity changes, which is checked before the saveEmail() is called. 
  */
  // The properties are overwritten by other objects that have the same properties later in the parameters order.
  let mail = Object.assign( 
    msg, // target
    attributes,  //source1
    { seqno: seqno, folder : folder, user: email, uid: folder+attributes.uid, date: +new Date(attributes.date) } //source2
  )
  
  return this.db.insertAsync(mail).catch((reason) => {
    // if (~String(reason).indexOf('it violates the unique constraint'))  *is the same as*
    // if (String(reason).includes('it violates the unique constraint'))  *is the same as*
    if (String(reason).indexOf('it violates the unique constraint') >= 0) {
      console.log(reason) 
      console.log(`Updating email with UID '${folder+attributes.uid}'`);
      return this.db.updateAsync({ uid: folder+attributes.uid }, mail)
    }
  });
}



MailStore.prototype.loadEmail = async function (uid, email) {
  if (typeof this.db === 'undefined') await this.createEmailDB(email);
  return this.db.findOneAsync({ uid: uid });
}

MailStore.prototype.loadEmailsWithoutBody = async function () {
  return await new Promise((resolve, reject) => {
    this.db.find({
      'retrieved': { $exists: false } //check if the document has the property 'retrieved'
      }, { uid: 1 }).sort({ date: 0 }).exec((err, docs) => {
        if (err) return reject(err)
        resolve(docs);
      });
  });
}


MailStore.prototype.updateEmailByUid = async function (uid, changes) {
  /*
  db.update(query, update, options, callback)
  - 'update' specifies how the documents should be modified. It is either a new document or a set of modifiers.
     The modifiers create the fields they need to modify if they don't exist.
     $set modifier : change a field's value
  - 'options' : multi (defaults to false) which allows the modification of several documents if set to true
  */
  return await this.db.updateAsync({ uid: uid }, { $set: changes }, {});
}

MailStore.prototype.deleteEmails = async function (folder) {
  if (folder){
    return await new Promise((resolve) => {
      this.db.remove({folder : folder}, { multi: true },( err , numRemoved) => {
        console.log('['+folder+'] Deleted : '+numRemoved);
        resolve();
      });
    });
  }
  else{
    return await new Promise((resolve) => {
      this.db.remove({}, { multi: true },( err , numRemoved) => {
        console.log('['+folder+'] Deleted : '+numRemoved);
        resolve();
      });
    });
  }
}

MailStore.prototype.deleteEmailByUID = async function (folder, uid) {
  return await new Promise((resolve) => {
    this.db.remove({ '$and':[{folder:folder}, {uid:folder+uid}]}, { multi: true }, (err,numRemoved) => {
      console.log('['+folder+'] Deleted : '+numRemoved+' (UID '+uid+')');
      resolve();
    });
  })
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
    this.db.find(
      folder ? { folder: folder } : {}, // {key:value} or {}:all documents
      projections ? projections : {}                                      
    ).sort({ date: -1 }).skip(skip).limit(limit).exec((err, docs) => {
      resolve(docs);
    });
  });
}

MailStore.prototype.countEmails = async function (folder) {
  return await this.db.countAsync({ folder: folder })
}

// The following 3 methods, are about .json files that store the body of each retrieved email. They
// are stored at path: mail/emailHash/hashedEmailUid. They have nothing to with 'this.db'.
// ------------------------------------------------------------------------------------------------
MailStore.prototype.saveMailBody = async function (uid, data, email) {
  const hash = String(email).includes('@') ? this.utils.md5(email) : email;
  const hashuid = this.utils.md5(uid);
  let fs = jetpack.cwd(this.app.getPath('userData'), `mail`,`${hash}`);
  fs.dir(`${hashuid}`);
  fs = jetpack.cwd(this.app.getPath('userData'), `mail`,`${hash}`, `${hashuid}`);
  fs.write(`${hashuid}.json`, JSON.stringify(data));
}

MailStore.prototype.loadEmailBody = async function (uid, email) {
  const hashuid = this.utils.md5(uid);
  const hash = String(email).includes('@') ? this.utils.md5(email) : email;
  const fs = jetpack.cwd(this.app.getPath('userData'), `mail`,`${hash}`, `${hashuid}`);
  return fs.read(`${hashuid}.json`, 'json');
}

// Delete all the email bodies (.json files in mail/emailHash directory) that are not relevant anymore.
// (the emails we deleted from this.db need to have their bodies deleted too).
MailStore.prototype.deleteEmailBodies = async function (email, uidsNotToDelete, deleteFolder) {
  let usefulUids = [];
  uidsNotToDelete.forEach(uid => {
    uid['uid'] = this.utils.md5(uid['uid']);
    usefulUids.push(`${uid['uid']}`)
  });
  const hash = String(email).includes('@') ? this.utils.md5(email) : email;
  let fs = jetpack.cwd(this.app.getPath('userData'), `mail`,`${hash}`);
  try {
    let allUids = fs.find(`.`, {files : false, directories : true});
    let uidsToDelete = Utils.findMissing(allUids, usefulUids);
    uidsToDelete.forEach(uidFolder => {
      fs.remove(`${uidFolder}`);
      console.log(`Removed ${uidFolder} (and all possible attachments) from mail/${hash}.`);
    });
  } catch (error) {
    console.log(error);
  }
  // Also delete the folder that is named after the user's email hash (the folder that contains all the UID
  // subfolders).)
  if (deleteFolder){
    fs = jetpack.cwd(this.app.getPath('userData'), `mail`);
    let accountFolders = fs.find(`.`, {files : true, directories : true});
    accountFolders.forEach(folder => {
      fs.remove(`${folder}`);
    });
  }
}


module.exports = MailStore;