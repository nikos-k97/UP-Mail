const MailParser     = require('mailparser').MailParser;
const simpleParser   = require('mailparser').simpleParser;
const Promise        = require('bluebird');
const jetpack        = require('fs-jetpack');
const merge          = require('merge-deep');
const IMAP           = require('node-imap');
const _              = require('lodash');
const MailStore      = require('./MailStore');
const Threader       = require('./Threader');
const fs             = require('fs');
const base64 = require('base64-stream');



/**
 * Logs the user in to their email server.
 * @param  {object} app      [Mandatory application parameters for service choreography]
 * @param  {object} logger   
 * @param  {object} utils 
 * @param  {object} stateManager 
 * @param  {object} accountManager 
 * @param  {object} details  [An object which contains the server details and logon.]
 * @param  {boolean} debug   [Optional - A boolean to enable verbose logging to console.]
 * @return {promise}         [This promise resolves when the client connection finishes.]
 */
function IMAPClient(app, logger, utils, stateManager, accountManager, details, debug) {
  this.app = app;
  this.logger = logger;
  this.utils = utils;
  this.stateManager = stateManager;
  this.accountManager = accountManager;
  this.mailStore = new MailStore(this.app,this.utils, this); 
  // Jetpack is used in order to write to the log files, which are organised by day (yyyy-mm-dd.log).
  this.jetpack = jetpack.cwd(this.app.getPath('userData'), 'logs');
  // Grabs the current day, for use in writing to the log files.
  this.currentDate = this.getDate();
  // Set current account details.
  this.emailAddress = details.user; 

  return new Promise(
      (
        (resolve, reject) => {
          // Login to the mail server using the details given to us.
          this.client = Promise.promisifyAll(
            // Connection - Creates and returns a new instance of Connection using the specified configuration object
            // debug - function - If set, the function will be called with one argument, a string containing some 
            // debug info. Default: (no debug output)
            new IMAP(Object.assign(details) )//, { debug: this.logger() }))
          );

          // 'ready' : Emitted when a connection to the server has been made and authentication was successful.
          // which means that client.connect() is called before.
          this.client.once('ready', 
            () => { 
              // Since 'this' is bound to the IMAPClient (not the promise itself) via bind()
              // the result of the Promise's resolve(result) function is 'this' (the IMAPClient)
              // In other words we pass the 'this' keyword forward so we get it when we need it
              // -> promise.then( (this) => do something with this )
              resolve(this); 
            }
          );
          this.client.once('error', 
            (err) => {
              this.logger.error('Connection state is : '+this.client.state); // Connected - Not authenticated (the other states are disconnected, authenticated)
              reject(err);
            }
          );
          // this.client.on('mail' , () => {
          //   console.log('new mail arrived')
          // })

          this.client.once('end', () => {
            this.logger.log('Connection ended');
          });

          // Attempts to connect and authenticate with the IMAP server.
          this.client.connect();
        }
    ).bind(this) // Sets the Promise() `this` to the object `this`.
  ); 
}

IMAPClient.prototype.createEmailDatabase = async function (email){
  await this.mailStore.createEmailDB(email);
}

/**
 * Turns an array of path components into a single string.
 * @param  {array}  path An array of path components
 * @return {string}      A string representing the path to a box
 */
IMAPClient.prototype.compilePath = function (path) {
  let compiledPath = '';
  for (let i = 0; i < path.length - 1; i++) {
    compiledPath += path[i].name + path[i].delimiter;
  }
  compiledPath += path[path.length - 1].name;
  return compiledPath;
}

IMAPClient.compileObjectPath = function (path) {
  let location = [];
  for (let j = 0; j < path.length; j++) {
    location.push(path[j].name);
    if (j !== path.length - 1) location.push('children');
  }
  return location;
}

// Change the box structure and keep only the 'delimeter' and 'name' attributes of each mailbox.
IMAPClient.linearBoxes = function (folders, path) {
  let keys = folders ? Object.getOwnPropertyNames(folders) : [];
  let results = [];
  path = path || [];
  for (let i = 0; i < keys.length; i++) {
    results = results.concat(this.linearBoxes(folders[keys[i]].children, path.concat({
      delimiter: folders[keys[i]].delimiter,
      name: keys[i]
    })));
  }
  results.push(path);
  return results;
}

/**
 * Returns all boxes within a mail account.
 * @return {object} [An object containing all mailboxes]
 */
IMAPClient.prototype.getBoxes = async function () {
  await this.checkClient();
  return this.client.getBoxesAsync();
}

/**
 * Opens a box on the server, given it's path.
 * @param  {string}  path     [A string containing the path to the box]
 * @param  {boolean} readOnly [Whether the box is to be opened in read only mode or not]
 * @return {promise}          [A promise which resolves when the box has been opened]
 */
IMAPClient.prototype.openBox = async function (path, readOnly) {
  await this.checkClient();
  return new Promise((async (resolve, reject) => {
    // Box is an object representing the currently open mailbox. It gets passed to 'getEmails' function
    // when the promise resolves, where it becomes 'this.mailbox'.
    let box = await this.client.openBoxAsync(path, readOnly || false);
    this.currentPath = path; // Set this box as the currently open mailbox.
    if (box !== false) resolve(box);
    else reject("Cannot open mailbox.");
  }).bind(this))
}

/**
 * Retrieve some/ all of the emails from the server.
 * @param  {string}   path      [A path to a specific box]
 * @param  {boolean}  readOnly  [Whether to open the box in read only mode or not]
 * @param  {boolean}  grabNewer [Whether to retrieve items after the sequence number or not]
 * @param  {number}   seqno     [The specific sequence number to grab]
 * @param  {object}   options   [Which parts of the message to retrieve]
 * @param  {function} onLoad    [A function which is called with each individual message]
 * @return {promise}            [Resolved when all messages have been retrieved, or a fatal error occurred]
 */

// {
//   bodies: '',
//   struct: true,
//   envelope: true
// }


IMAPClient.prototype.getEmails = async function (path, readOnly, grabNewer, seqno, options, onLoad) {
  //await this.client.checkClient();

  // Ensure we have the right box open. Otherwise call 'openBox' to set currentPath (currentBox).
  if (this.currentPath !== path) {  
    this.mailbox = await this.openBox(path, readOnly);
  }
    /*
    -------------------------------------------------------------------------------------------------------
    'this.mailbox' is an object representing the currently open mailbox, and has the following properties:
      -name (string) :            The name of this mailbox.
      -readOnly (boolean) :       True if this mailbox was opened in read-only mode. 
                                  (Only available if specified in the openBox() call)
      -newKeywords (boolean) :    True if new keywords can be added to messages in this mailbox.
      -uidvalidity (integer) :    A 32-bit number that can be used to determine if UIDs in this mailbox have changed 
                                  since the last time this mailbox was opened.
      -uidnext (integer) :        The uid that will be assigned to the next message that arrives at this mailbox.
      -flags (array) :            A list of system-defined flags applicable for this mailbox. Flags in this list 
                                  but not in permFlags may be stored for the current session only. 
                                  Additional server implementation-specific flags may also be available.
      -permFlags (array) :        A list of flags that can be permanently added/removed to/from messages in this mailbox.
      -persistentUIDs (boolean) : Whether or not this mailbox has persistent UIDs. This should almost always be true 
                                  for modern mailboxes and should only be false for legacy mail stores where 
                                  supporting persistent UIDs was not technically feasible.
      -messages (object) :        Contains various message counts for this mailbox:
          total (integer) :       Total number of messages in this mailbox.
          new (integer) :         Number of messages in this mailbox having the Recent flag (this IMAP session is 
                                  the first to see these messages).
          unseen (integer) :      (Only available with status() calls) Number of messages in this mailbox not having 
                                  the Seen flag (marked as not having been read).

  -----------------------------------------------------------------------------------------------------------------
  */
  let parser = new MailParser();

  return new Promise(function (resolve, reject) {
    this.logger.log("Total: " + this.mailbox.messages.total);
    this.logger.log("Seqno: " + seqno);
    this.logger.log("grabNewer: " + grabNewer);
    this.logger.log("Grabbing: " + `${seqno}${grabNewer ? `:*` : ``}`);
    if (!this.mailbox.messages.total) return resolve();

    /*
     Fetches message(s) in the currently open mailbox. 
     ------------------------------------------------------------------------------------------------------
     fetch(source, options). For options we use the 'options' object which contains the 'bodies' and 'envelope' options.
        (We use the 'seq' namespace of the imap connection's instance 
         -> conn.seq.fetch() fetches by sequence number(s) instead of UIDs.)
     - source : 'seqno:*' or 'seqno'  (seqno is the 'highest').
     - options: 
        {
          bodies: 'HEADER.FIELDS (TO FROM SUBJECT)', : A string or Array of strings containing the body part section to fetch
                                                       We want 'Specific header fields only'.
          envelope: true                             : Fetch the message envelope
        } 

        Other options include: 
         **markSeen** - _boolean_    - Mark message(s) as read when fetched. **Default:** false
         **struct** - _boolean_      - Fetch the message structure. **Default:** false
         **envelope** - _boolean_    - Fetch the message envelope. **Default:** false
         **size** - _boolean_        - Fetch the RFC822 size. **Default:** false
         **modifiers** - _object_    - Fetch modifiers defined by IMAP extensions. **Default:** (none)
         **extensions** - _array_    - Fetch custom fields defined by IMAP extensions, 
                                       e.g. ['X-MAILBOX', 'X-REAL-UID']. **Default:** (none)
         **bodies** - _mixed_        - A string or Array of strings containing the body part section to fetch.
           |                           **Default:** (none) 
           |
           |
           --> Valid options for 'bodies' are:
                'HEADER'                              - The message header
                'HEADER.FIELDS (TO FROM SUBJECT)'     - Specific header fields only
                'HEADER.FIELDS.NOT (TO FROM SUBJECT)' - Header fields only that do not match the fields given
                'TEXT'                                - The message body
                ''                                    - The entire message (header + body)
                'MIME'                                - MIME-related header fields only (e.g. 'Content-Type')

                **Note:** You can also prefix `bodies` strings (i.e. 'TEXT', 'HEADER', 'HEADER.FIELDS', 
                          and 'HEADER.FIELDS.NOT' for `message/rfc822` messages and 'MIME' for any kind of message) 
                          with part ids. For example: '1.TEXT', '1.2.HEADER', '2.MIME', etc.

        There are two ways we're going to want to fetch emails, either:
          'lowest:*'
          'seqno'
        If we want the former, we expect the `grabNewer` boolean to be true.
          > This function (getEmails()) runs two times. The first one is run when we render the emails of the 
            each mailbox where we fetch only some header fields. The second time is when we render an email 
            so we fetch emails via the second ('seqno') method and we use the '' options to fetch everything.
    ---------------------------------------------------------------------------------------------------------    
    */

    let fetchObject = this.client.seq.fetch(`${seqno}${grabNewer ? `:*` : ``}`, options); 

    /*
      fetchObject (typeof : ImapFetch) -> 'message' event.
        message(<ImapMessage> msg, <integer> seqno) - Event emitted for each message resulting from a fetch request. 
        seqno is the message's sequence number.
    */
    fetchObject.on('message', (msg, seqno) => {
      let parsePromise, parsedHeaders, parsedData, parsedAttachments = [], attributes;

      /*
        msg (typeof : ImapMessage) -> 'body' event
          body(<ReadableStream> stream, <object> info) - Event emitted for each requested body. 
            Example info properties:
            which (string) :  The specifier for this body (e.g. 'TEXT', 'HEADER.FIELDS (TO FROM SUBJECT)', etc).
            size (integer) :  The size of this body in bytes.
      */
      msg.on('body', (stream, info) => {
        let attachmentNo = 0;
        parsePromise = new Promise(
          (resolve, reject) => {
            stream.pipe(parser)
            .on('headers', (headers) => parsedHeaders = headers)
            .on('data', (data) => {
              /*
                If a message has both an attachment and two forms of the message body (plain text and HTML) then
                each message part is identified by a partID which is used when we want to fetch the content of 
                that part.
                                              (see fetch())
                                              -------------
                You can prefix `bodies` strings (i.e. 'TEXT', 'HEADER', 'HEADER.FIELDS', 
                and 'HEADER.FIELDS.NOT' for `message/rfc822` messages and 'MIME' for any kind of message) 
                with part ids. For example: '1.TEXT', '1.2.HEADER', '2.MIME', etc.    
              */          
              if (data.type === 'attachment'){
                // Get necessary data and then remove the circular structure 'content'.
                if (data.content.algo) data.algo = data.content.algo;
                if (data.content.allowHalfOpen) data.allowHalfOpen = data.content.allowHalfOpen;
                if (data.content.byteCount) data.byteCount = data.content.byteCount;
                delete data.content; 

                // let storeDir = this.app.getPath('userData');
                // console.log(storeDir+`\\${data.filename}`)
                // fs.writeFile(storeDir+`\\${data.filename}`, Buffer.from(data.filename,'base64'), err => {
                //   if (err) {
                //     console.error(err)
                //   }
                //   //file written successfully
                // })
               
                parsedAttachments[attachmentNo] = data;
                data.release();
                attachmentNo++;
              }
              if (data.type === 'text') parsedData = data;
            })
            .on('error', reject)
            .once('end', resolve)
          }
        );
      });
      
      /*
      msg (typeof : ImapMessage) -> 'attributes' event
        attributes(<object> attrs) - Event emitted when all message attributes have been collected. 
        Example attrs properties: 
          uid (integer) :   A 32-bit ID that uniquely identifies this message within its mailbox.
          flags (array) :   A list of flags currently set on this message.
          date (Date) :     The internal server date for the message.
          struct (array) :  The message's body structure (only set if requested with fetch() inside the options param).
          size (integer) :  The RFC822 message size (only set if requested with fetch() inside the options param).
      */
      msg.once('attributes', (attrs) => {
        attributes = attrs;
      });

      /*   
      msg (typeof : ImapMessage) -> 'end' event
        end() - Event emitted when all attributes and bodies have been parsed. 
      */
      msg.once('end', async () => {
        /*
        -------------------------------------------------------------------------------------------------------
        Parsed mail object has the following properties:
          headers     : a Map object with lowercase header keys
          envelope    : envelope object (properties : from,to,replyTo,inReplyTo,date,subject,sender,messageId)
          date        : The internal server date for the message - example: Wed Mar 31 2021 16:09:23 GMT+0300 (Eastern European Summer Time) {}  
          flags       : array of flags currently set on this message. (example: ['\Seen', '\Recent'])
          headers     : map object containing all the parsed SMTP / MIME headers
                        (contains size - The RFC822 message size)
          seqno       : message sequence number
          uid         : int - A 32-bit ID that uniquely identifies this message within its mailbox.
          text        : the plaintext body of the message
          textAsHtml  : the plaintext body of the message formatted as HTML
          html        : the HTML body of the message. If the message included embedded images as cid: urls then 
                        these are all replaced with base64 formatted data
          struct      : array - The message's body structure 
                        **example**: **A message structure with multiple parts**
                        struct: Array(3)
                          0: { disposition: null , language: null, params: {boundary: "=-HmnnJaB8e7HlNCOozAwDgg=="},
                               type: "alternative" }
                          1: Array(1)
                            0: { description: null, disposition: null, encoding: "8bit", id: null, language: null,
                                 lines: 9, location: null, md5: null, params: {charset: 'windows-1253'}, partID: "1",
                                 size: 1013, subtype: "plain", type: "text"}
                          2: Array(1)
                            0: { description: null, disposition: null, encoding: "8bit", id: null, language: null,
                                 lines: 26, location: null, md5: null, params: {charset: 'windows-1253'}, partID: "2",
                                 size: 3266, subtype: "html", type: "text"}
          attachments : an array of attachment objects
                        **example**:**Attachments object**
                        attachments: Array(11)
                          0: { algo: "md5", checksum: "826792a9b5d81c45c3ae7f3a9050cd8f", allowHalfOpen: true,
                               cid: "colors", contentDisposition: "inline", contentId: "<colors>", 
                               contentType: "image/png", filename: "colors.png" ,
                               headers: Map(5) { 
                                'content-type' => {…}, 'content-description' => 'colors.png', 
                                'content-disposition' => {…}, 'content-id' => '<colors>', 
                                'content-transfer-encoding' => 'base64'},
                               partId: "2" , related: true, release: null, size: 5306, type: "attachment" }
                          1 : { ... }
          type        : text, application etc...     
          ------------------------------------------------------------------------------------------------------
        */
        parsePromise.then(
          () => {
            const parsedContent = {};
            parsedContent.headers = parsedHeaders;

            // Handle possible attachments.
            if (parsedAttachments.length) { 
              parsedContent.attachments = parsedAttachments;
              // Fetch attachments via fetch().
              for (let i = 0; i < parsedAttachments.length; i++) {
                let attachment = parsedAttachments[i];
                this.logger.log('Fetching attachment "%s" ...', attachment.filename);
                let fetchAttachmentObject = this.client.fetch(`${attributes.uid}`, { //do not use imap.seq.fetch here
                  bodies: [attachment.partId]
                }); 
                // The buildAttMessageFunction returns a function.
                fetchAttachmentObject.on('message', this.buildAttMessageFunction(attachment));
              }
            }
            Object.assign(parsedContent, parsedData);
            // Run the callback function 'onLoad' for each parsedMessage.
            if (typeof onLoad === 'function') onLoad(seqno, parsedContent, attributes);
          }
        );

        parsePromise.catch( 
          () => {
            this.logger.error('Mail parsing encountered a problem.');
            return undefined;
          }
        )
      });
    });

    fetchObject.once('error', (err) => {
      this.logger.error(`Fetch error: ${err}`);
      reject(err);
    })

    /*
    fetchObject (typeof : ImapFetch) -> 'end' event.
      end() - Emitted when all messages have been parsed.
    */
    fetchObject.once('end', () => {
      //this.client.end()
      resolve();
    })
  }.bind(this)) // Bind 'this' to point to the function not the promise.
}

IMAPClient.prototype.buildAttMessageFunction = function(attachment) {
  let filename = attachment.filename;
  let encoding = attachment.headers.get('content-transfer-encoding');
  
  return function (msg) {
    msg.on('body', function(stream, info) {
      //Create a write stream so that we can stream the attachment to file;
      console.log('Streaming this attachment to file', filename, info);
    
      let writeStream = fs.createWriteStream(`MailAttachments\\${filename}`);
     

      writeStream.once('finish', function() {
        console.log('Done writing to file %s', filename);
        writeStream.destroy();
      });
   
      //stream.pipe(writeStream); this would write base64 data to the file.
      //so we decode during streaming using 
      if (encoding === 'base64') {
        //the stream is base64 encoded, so here the stream is decode on the fly and piped to the write stream (file)
        stream.pipe(new base64.Base64Decode()).pipe(writeStream);
      } else  {
        //here we have none or some other decoding streamed directly to the file which renders it useless probably
        stream.pipe(writeStream);
      }
    });
    msg.once('end', function() {
      console.log('Finished receiving attachment :', filename);
    });
  };
  
}


IMAPClient.prototype.getEmailBody = async function (uid) {
  //await this.client.checkClient();
  return new Promise(async function (resolve, reject) {
    let email = this.client._config.user;
    let message = await this.mailStore.loadEmail(uid, email);
    await this.getEmails(message.folder, true, false, message.seqno, {
      bodies: '', struct: true, envelope: true
    }, async function (seqno, content, attributes) {
          let compiledContent = Object.assign({ seqno: seqno }, content, attributes);
          console.log(compiledContent)
          await this.mailStore.saveMailBody(uid, compiledContent, email);
          await this.mailStore.updateEmailByUid(uid, { retrieved: true });
          this.logger.log(`Added ${email}:${uid} to the file system.`);
          resolve(compiledContent);
    }.bind(this)) //we need this to point to ImapClient (inside the callback)
  }.bind(this))
}

/**
 * Update all emails for a specific account, also used for the first
 * grab of emails.
 * @return {undefined}
 */
IMAPClient.prototype.updateAccount = async function () {
  let emailAddress = this.client._config.user;
  let hash = this.utils.md5(emailAddress);
  /*----------  GRAB USER MAILBOXES  ----------*/
  document.querySelector('#doing').innerText = 'Grabbing your mailboxes ...';
  await this.checkClient();
  let boxes = await this.getBoxes();
  // Get the boxes with a different structure and keep only the 'delimeter' and 'name' fields.
  let boxesLinear = IMAPClient.linearBoxes(boxes);
  boxesLinear.reverse();
  // Keep only the fields that are not empty after the restructuring.
  boxesLinear = boxesLinear.filter((n) => { return n != undefined && JSON.stringify(n) != '[]' });


  /*----------  MERGE NEW FOLDERS WITH OLD  ----------*/
  let updateObject = (await this.accountManager.findAccount(emailAddress)).folders || {};
  updateObject = merge(updateObject, this.utils.removeCircular(boxes));
  this.logger.log(`Retrieved all mailboxes from ${emailAddress}.`);


  /*----------  GRAB USER EMAILS  ----------*/
  document.querySelector('#doing').innerText = 'Grabbing your emails ...';
  let totalEmails = 0;
 
  for (let i = 0; i < boxesLinear.length; i++) {
    let path = this.compilePath(boxesLinear[i]);
    this.logger.debug("Path:", path);
    this.logger.debug("Linear Box Path:", boxesLinear[i]);
    let objectPath = IMAPClient.compileObjectPath(boxesLinear[i]);
    this.logger.debug("Object Path:", objectPath);
    let highest = _.get(updateObject, objectPath.concat(['highest']), 1);
    this.logger.debug("Highest: " + highest);

    // During the first grab of emails 'state' is 'new' (there is no 'stateManager.state.account' yet -> only when 
    // state = 'mail') so 'isCurrentPath' is false.
    // 'currentPath' is set in 'openBox' function of 'IMAPClient.js'
    let isCurrentPath = this.stateManager.state && this.stateManager.state.account && this.compilePath(this.stateManager.state.account.folder) == path;
    
    // Database Insert / Update promises from the saveEmail() function in 'MailStore.js' waiting to be resolved.
    let promises = []; // For each mailbox's message.

    document.querySelector('#doing').innerText = `Grabbing ${boxesLinear[i][boxesLinear[i].length - 1].name} ...`;
    await this.getEmails(path, true, true, highest, 
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
      function onLoad(seqno, msg, attributes) {  // msg = parsedContent (mailparser)
        promises.push(this.mailStore.saveEmail(emailAddress, seqno, msg, attributes, path));
        if (isCurrentPath) this.viewChanged = true;
        if (seqno > highest) highest = seqno;
        document.querySelector('#number').innerText = `Total emails: ${++totalEmails}`;
      }.bind(this)
    );

    // Wait for all the database inserts/ updated to be resolved.
    await Promise.all(promises);

    _.set(updateObject, objectPath.concat(['highest']), highest);

    // 'this.mailbox' is an object representing the currently open mailbox, defined in getEmails() method.
    let boxKeys = Object.keys(this.mailbox);
    for (let j = 0; j < boxKeys.length; j++) {
      _.set(updateObject, objectPath.concat([boxKeys[j]]), this.mailbox[boxKeys[j]]);
    }
  }

  /*----------  THREADING EMAILS  ----------*/
  document.querySelector('#number').innerText = '';
  document.querySelector('#doing').innerText = 'Looking for threads ...';
  // threads : object containing arrays with parent messages. 
  // These arrays contain all the children that originated for each of the parents.
  let threads = Threader.applyThreads(await this.mailStore.findEmails());
 
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

  /*----------  RENDER, SAVE & CLOSE  ----------*/

  //Add a 'folders' field in the accounts database for the specific emailAddress. For example:
  /*
  "folders":{"Archive":{"attribs":["\\HasNoChildren"],"delimiter":"/","children":null,"parent":null,"highest":1,
  "name":"Archive","flags":["\\Seen","\\Answered","\\Flagged","\\Deleted","\\Draft","$MDNSent"],"readOnly":true,
  "uidvalidity":163,"uidnext":1,"permFlags":[],"keywords":[],"newKeywords":false,"persistentUIDs":true,
  "nomodseq":false,"messages":{"total":0,"new":0}}, ... }
  */
  this.accountManager.editAccount(emailAddress, { folders: this.utils.removeCircular(updateObject) });

  // Connection : end() - Emitted when the connection has ended.
  this.client.end();
  document.querySelector('#doing').innerText = 'Getting your inbox setup ...';
  
  this.stateManager.change('state', 'mail');
  this.stateManager.change('account', { hash, emailAddress });
  /*
  {
    "state": "mail",
    "account": {
      "hash": "9c6abxxxxxxxxxxxxxx19477",
      "email": "test-mail@test.com",
    }
  }
  */
  this.stateManager.update();
}

/**
 * A function which logs the specified string to the disk (and also to console
 * if debugging is enabled)
 * @param {string} string [The string that should be logged]
 */
IMAPClient.prototype.logger = function () {
  return function(string) {
    // Obfuscate passwords.
    if (string.includes('=> \'A1 LOGIN')) {
      let array = string.split('"')
      for (let i = 1; i < array.length; i += 2) {
        array[i] = array[i].replace(/./g, '*')
      }
      string = array.join('"')
    }

    //this.jetpack.append(`./IMAP-${this.currentDate}.log`, this.logger.format(string) + '\n')
  }//.bind(this)
}

/**
 * Retrieves the current date in the format of year-month-day.
 * @return {string} [A string containing the current date (yyyy-mm-dd)]
 */
IMAPClient.prototype.getDate = function () {
  const today = new Date();
  let day = today.getDate();
  let month = today.getMonth() + 1;
  let year = today.getFullYear();
  return `${year}-${month}-${day}`;
};

IMAPClient.prototype.checkClient = async function () {
  // Possible client/ connection states are: 'connected', 'authenticated', 'disconnected'. 
  if (this.client.state === 'disconnected') {
    this.logger.log('Client disconnected. Reconnecting...');

    document.querySelector('.wrapper').innerHTML = `
    <span id="doing"></span> 
    <span id="number"></span><br>
    <span id="mailboxes"></span>
  `;
  let client = (await this.accountManager.getIMAP(this.stateManager.state.account.emailAddress));
  this.logger.log('Reloading mail messages...');
  await client.updateAccount();
  this.client = client;
  }
}

module.exports = IMAPClient;
