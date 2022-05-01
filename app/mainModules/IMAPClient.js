const MailParser      = require('mailparser').MailParser;
const Promise         = require('bluebird');
const jetpack         = require('fs-jetpack');
const IMAP            = require('node-imap');
const base64          = require('base64-stream');
const Utils           = require('./Utils');
const Readable        = require('stream').Readable;

/**
 * Logs the user in to their email server.
 * @param  {object} app      [Mandatory application parameters for service choreography]
 * @param  {object} logger   
 * @param  {object} utils 
 * @param  {object} stateManager 
 * @param  {object} accountManager 
 * @param  {object} details  [An object which contains the server details and logon.]
 * @return {promise}         [This promise resolves when the client connection finishes.]
 */
function IMAPClient(app, logger, utils, stateManager, accountManager, details) {
  this.app = app;
  this.logger = logger;
  this.utils = utils;
  this.stateManager = stateManager;
  this.accountManager = accountManager;
  // Jetpack is used in order to write to the log files, which are organised by day (yyyy-mm-dd.log).
  this.jetpack = jetpack.cwd(this.app.getPath('userData'), 'logs');
  // Grabs the current day, for use in writing to the log files.
  this.currentDate = this.getDate();
  
  return new Promise((resolve, reject) => {
    const IMAPDetails = {
      user: details.user,
      password : details.password,
      host : details.imap.host,
      port : details.imap.port,
      tls : details.imap.tls,
      autotls: details.imap.tls === true ? 'always' : 'never',
      keepalive: {
        interval: 10000,
        idleInterval: 300000,
        forceNoop: true
      },
      debug : console.warn
    };

    // Connection - Creates and returns a new instance of Connection using the specified configuration object
    this.client = Promise.promisifyAll(new IMAP(IMAPDetails));

    // 'ready' : Emitted when a connection to the server has been made and authentication was successful.
    // which means that client.connect() is called before.
    this.client.once('ready', () => { 
      // If server supports IDLE extension , we dont use polling via NOOP command to keep the session alive.
      if (this.client.serverSupports('IDLE')){
        this.client._config.keepalive.forceNoop = false;
      }
      /* Since 'this' is bound to the IMAPClient (not the promise itself) via bind()
         the result of the Promise's resolve(result) function is 'this' (the IMAPClient)
         In other words we pass the 'this' keyword forward so we get it when we need it
         -> promise.then( (this) => do something with this)
      */
      resolve(this); 
    });
          
    this.client.on('error', (err) => {
      this.logger.error('Connection state is : ' + this.client.state); // Connected - Not authenticated (the other states are disconnected, authenticated)
      reject(err);
    });

    /* 
      Emitted when message metadata (e.g. flags) changes externally (eg. from another client).
      (only for the mailbox that is currently open)
    */
    this.client.on('update', (seqno, info) => {
      this.logger.info('CLIENT UPDATED')
      this.logger.info(seqno);
      this.logger.info(info);
    })

    // Emitted when the connection has ended.
    // Typically 'end' is only emitted if the connection was torn down "properly" 
    // 'Close' is always emitted, no matter the cause of disconnection.
    this.client.once('end', () => {
      this.client.end();
      this.client.state = 'disconnected';
      this.logger.log('Connection ended gracefully.');
    });

    // Emitted when the connection has completely closed.
    // Typically 'end' is only emitted if the connection was torn down "properly" 
    // 'Close' is always emitted, no matter the cause of disconnection.
    this.client.once('close', () => {
      this.client.end();
      this.client.state = 'disconnected';
      this.logger.log('Connection closed.');
    });

    this.client.connect();

  }).bind(this); // Sets the Promise() `this` to the object `this`.
}

/*
---------------------------------------- [RFC 2342] -------------------------------------------------
- Personal Namespace: A namespace that the server considers within the personal scope of the authenticated user 
   on a particular connection. Typically, only the authenticated user has access to mailboxes in their
   Personal Namespace. If an INBOX exists for a user, it MUST appear within the user's personal namespace.
- Other Users' Namespace: A namespace that consists of mailboxes from the Personal Namespaces of other users.  
   To access mailboxes in the Other Users' Namespace, the currently authenticated user MUST be explicitly 
   granted access rights.
- Shared Namespace: A namespace that consists of mailboxes that are
   intended to be shared amongst users and do not exist within a user's
   Personal Namespace.

Users are often required to manually enter the prefixes of various namespaces in order to view the mailboxes 
located there. The NAMESPACE command allows a client to automatically discover the namespaces that are available
on a server. A client could choose to initially display only personal mailboxes, or it may choose to display the
complete list of mailboxes available, and initially position the user at the root of their Personal Namespace.

   Example :
   ===========
      < A server that contains a Personal Namespace, Other Users'
      Namespace and multiple Shared Namespaces.  Note that the hierarchy
      delimiter used within each namespace can be different. >

      C: A001 NAMESPACE
      S: * NAMESPACE (("" "/")) (("~" "/")) (("#shared/" "/")
         ("#public/" "/")("#ftp/" "/")("#news." "."))
      S: A001 OK NAMESPACE command completed

   The prefix string allows a client to do things such as automatically
   creating personal mailboxes or LISTing all available mailboxes within
   a namespace.
--------------------------------------------------------------------------------------------------------
*/ 
IMAPClient.prototype.fetchNamespaces = async function() {
  // There should always be at least one namespace entry in the personal namespace list, 
  // with a blank namespace prefix.
  let personalNamespaces = this.client.namespaces.personal;
  let sharedNamespaces = this.client.namespaces.shared;
  let otherNamespaces = this.client.namespaces.other;
  let availableNamespaces = {'type' : [], 'prefix' : [], 'delimiter' : []};
  if (sharedNamespaces !== null){
    for (let i=0; i < sharedNamespaces.length; i++){
      availableNamespaces.type[i] = 'shared';
      availableNamespaces.prefix[i] = sharedNamespaces[i].prefix;
      availableNamespaces.delimiter[i] = sharedNamespaces[i].delimiter;
    }
  }
  if (otherNamespaces !== null){
    for (let i=0; i < otherNamespaces.length; i++){
      availableNamespaces.type[i] = 'other';
      availableNamespaces.prefix[i] = otherNamespaces[i].prefix;
      availableNamespaces.delimiter[i] = otherNamespaces[i].delimiter;
    }
  }
  if (personalNamespaces !== null) {
    for (let i=0; i < personalNamespaces.length; i++){
      availableNamespaces.type[i] = 'personal';
      availableNamespaces.prefix[i] = personalNamespaces[i].prefix;
      availableNamespaces.delimiter[i] = personalNamespaces[i].delimiter;
    }
  }
  return availableNamespaces;
}


/**
 * Returns all boxes within a mail account.
 * @return {object} [An object containing all mailboxes]
 */
 IMAPClient.prototype.getBoxes = async function (nsPrefix) {
  /*
  Obtains the full list of mailboxes. If nsPrefix is not specified, the main personal namespace is used.
  Returns : the following format (with example values):
  { 
    INBOX: {            // mailbox name
      attribs: [],      // mailbox attributes. An attribute of 'NOSELECT' indicates the mailbox cannot be opened
      delimiter: '/',   // hierarchy delimiter for accessing this mailbox's direct children.
      children: null,   // an object containing another structure similar in format to this top level, otherwise null if no children
      parent: null      // pointer to parent mailbox, null if at the top level
    },
    '[Gmail]': {
      attribs: [ '\\NOSELECT' ],
      delimiter: '/',
      children:  { 
         'All Mail': { 
           attribs: [ '\\All' ],
           delimiter: '/',
           children: null,
           parent: [Circular]
         },
         Drafts: { 
           attribs: [ '\\Drafts' ],
           delimiter: '/',
           children: null,
           parent: [Circular]
         },
     },
     parent: null
   }
  }
  */
  return this.client.getBoxesAsync(nsPrefix);
}


/**
 * Opens a box on the server, given it's path.
 * @param  {string}  path     [A string containing the path to the box]
 * @param  {boolean} readOnly [Whether the box is to be opened in read only mode or not]
 * @return {promise}          [A promise which resolves when the box has been opened]
 */
 IMAPClient.prototype.openBox = async function (path, readOnly) {
  return new Promise((async (resolve, reject) => {
    // Box is an object representing the currently open mailbox. It gets passed to 'getEmails' function
    // when the promise resolves, where it becomes 'this.mailbox'.
    try {
      let box = await this.client.openBoxAsync(path, readOnly || false);
      this.currentPath = path; // Set this box as the currently open mailbox.
      resolve(box);
    } catch (error) {
      this.logger.error(error);
      reject(error);
    }
  }).bind(this))
}


IMAPClient.prototype.checkUID = async function (path, readOnly, oldUidValidity, oldUidNext, highestlocalSeqNo, localMessageCount, localUIDsequence) {
 // Ensure we have the right box open. Otherwise call 'openBox' to set currentPath (currentBox).
 if (this.currentPath !== path) {  
  if (this.mailbox) await this.client.closeBoxAsync(autoExpunge = false);
    try {
      this.mailbox = await this.openBox(path, readOnly);
    } catch (error) {
      this.logger.error(error);
      return new Promise((resolve,reject) => {
        reject(error);
      });
    }
  }

  // If the mailbox doesn't support persistent UIDs then each time we fetch emails from this mailbox,
  // we delete the local cache first, make highestSeqNo = 1 and then grab all the emails from the server.
  if (!this.mailbox.persistentUIDs) {
    this.logger.info(`Mailbox '${path}' does not support persistent UIDs. All emails will be fetched from the server.`);
    return new Promise((resolve) => {
      resolve('UpdateFirstTime');
    });
  }

  this.logger.info(`Total emails in the '${path}' mailbox (data from server): ${this.mailbox.messages.total}`);
  let highestServerSeqNo = this.mailbox.messages.total;
  this.logger.info(`[Mailbox '${path}'] - Highest seqNo (server) is : ${highestServerSeqNo}`);
  this.logger.info(`[Mailbox '${path}'] - Highest seqNo (local) is : ${highestlocalSeqNo} `);

  // Mailbox has no messages according to server. If the local copy of the mailbox has messages (that maybe
  // were deleted and this is the reason why server detects 0 messages)) the client needs to be safe and 
  // delete the all messages in the mailbox, revert the highestLocalSeqNo back to 1 and then fetch all the messages
  // from the IMAP server.
  if (highestServerSeqNo === 0) {
    this.logger.log(`Mailbox has no messages according to server.`)
    return new Promise((resolve) => {
      resolve('SyncDelete');
    })
  }

  let serverUidValidity = this.mailbox.uidvalidity;
  let serverUidNext = this.mailbox.uidnext;
  let search = new Promise((resolve,reject) => {
    this.client.search( [['UID','1:*']] , (error, UIDs) => {
      if (error) reject(error);
      this.mailbox.serverUidSequence = UIDs;
      resolve(UIDs);
    });
  })

  let serverUidSequence;
  try {
    serverUidSequence = await search;
  } catch (error) {
    this.logger.error(error);
    return new Promise((resolve) => {
      resolve('UpdateFirstTime');
    });
  }
 
  
  this.logger.info('Folder: '+path);
  this.logger.info('Server UIDValidity: '+serverUidValidity);
  this.logger.info('Client UIDValidity: '+oldUidValidity);
  this.logger.info('Server UIDNext: '+serverUidNext);
  this.logger.info('Client UIDNext: '+oldUidNext);
  this.logger.info('Server messageCount: '+this.mailbox.messages.total);
  this.logger.info('Client messageCount: '+localMessageCount);




  // 'New' user with mailbox.messages.total != 0 (otherwise the previous 'if' is relevant). In this case
  // we are sure that the highestLocalSeqNo = 1, however, for safety we force highestSeqNo = 1, delete
  // all the locally stored emails (if any) and then fetch every email from the IMAP server.
  if (oldUidNext === undefined || oldUidValidity === undefined || localMessageCount === undefined || localUIDsequence === undefined){
    this.logger.log(`Mailbox '${path}' does not have any new emails since last login.`);
    return new Promise((resolve) => {
      resolve('UpdateFirstTime');
    });
  }



  // Compare UIDvalidity and UIDnext value for the current folder. If the UIDValidity is different we need
  // to delete all locally cached emails. If not, then we check the UIDNext value of the specific mailbox,
  // to see if new messages have arrived.
  if (serverUidValidity === oldUidValidity){
    if (serverUidNext === oldUidNext){
      // Since the UIDValidity is not changed, and UIDNext value is not changed, there are no more
      // emails in the server since our last session with this client. However we need to check if
      // there are any deleted messages. If the Server's message count is the same as our locally saved
      // message count is the same, there is a very high chance that no messages were deleted.
      if (this.mailbox.messages.total === localMessageCount){
        let same = Utils.compareArrays(localUIDsequence, serverUidSequence);
        if (same) {
          this.logger.log(`Mailbox '${path}' does not have any new emails since last login.`);
          return new Promise((resolve) => {
            resolve('Sync');
          });
        }
        else {
          this.logger.log(`Mailbox '${path}' does not have any new emails since last login.`);
          return new Promise((resolve) => {
            resolve('UpdateFirstTime');
          });
        }
      }
      // Since UIDnext is the same (server and client) no new message were added to the mailbox.
      // However because server's messageCount < localMessageCount, some messages were deleted.
      // In other words, the local cache contains some messages that are not present in the server.
      // Delete the required mails from the local cache and dont fetch anything. Update the highestSeqNo    
      // to the new value.
      else if (this.mailbox.messages.total < localMessageCount) {
        return new Promise((resolve) => {
          resolve('DeleteSelected');
        });
      }
      // If the UIDNext is same, but the localMessageCount < serverMessageCount, something is not right.
      // Make highestSeqNo = 1, delete all local cache and fetch all messages.
      else {
        this.logger.log(`Mailbox '${path}' does not have any new emails since last login.`);
        return new Promise((resolve) => {
          resolve('UpdateFirstTime');
        }); 
      }
    }
    // Server's UIDNext > local UIDNext. There are new messages in the mailbox. 
    else if (serverUidNext > oldUidNext) {
      this.logger.log(`Mailbox '${path}' has new emails since last login.`);
      return new Promise((resolve) => {
        resolve('Update');
      });
    }
    // Server's UIDNext < Local UID next so something is not right. Make highestSeqNo = 1, delete local
    // cache and fetch all the messages from the IMAP server.
    else {
      this.logger.log(`Mailbox '${path}' does not have any new emails since last login.`);
        return new Promise((resolve) => {
          resolve('UpdateFirstTime');
        }); 
    }
  }
  else{
    // Server's UIDValidity value for this particular mailbox has changed, so we cant trust the locally cached
    // UIDs, and we are forced to delete all local cache. First we revert HighestSeqNo = 1, we delete all local
    // cache and then fetch all emails from the server.
    return new Promise((resolve) => {
      this.logger.log(`UIDValidity values are different.`);
      resolve('UpdateFirstTime');
    })
  }
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
 IMAPClient.prototype.getEmails = async function (path, readOnly, grabNewer, seqno, options, onLoad) {
  // Ensure we have the right box open. Otherwise call 'openBox' to set currentPath (currentBox).
  if (this.currentPath !== path) {  
    if (this.mailbox) await this.client.closeBoxAsync(autoExpunge = false);
    try {
      this.mailbox = await this.openBox(path, readOnly);
    } catch (error) {
      this.logger.error(error);
      return new Promise((resolve,reject) => {
        reject(error);
      })
    }
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
  return new Promise(function (resolve, reject) {
    this.logger.log("Seqno: " + seqno);
    this.logger.log("grabNewer: " + grabNewer);
    this.logger.log("Grabbing: " + `${seqno}${grabNewer ? `:*` : ``}`);
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
      // This 'seqno' is the one stored in the server. Not the one we pass as arguement in the function.
      let parsePromise, parsedHeaders, parsedData, parsedAttachments = [], attributes, pureMessageBody;
      /*
        msg (typeof : ImapMessage) -> 'body' event
          body(<ReadableStream> stream, <object> info) - Event emitted for each requested body. 
            Example info properties:
            which (string) :  The specifier for this body (e.g. 'TEXT', 'HEADER.FIELDS (TO FROM SUBJECT)', etc).
            size (integer) :  The size of this body in bytes.
      */
      msg.on('body', (stream, info) => {
        let parser = new MailParser();
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
        parser = null;
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
      msg.on('attributes', (attrs) => {
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
          async () => {
            const parsedContent = {};
            parsedContent.headers = parsedHeaders;
            // Include possible attachments.
            if (parsedAttachments.length) { 
              parsedContent.attachments = parsedAttachments;
              // Attachments will be fetched on demand.
            }
            Object.assign(parsedContent, parsedData);
            // Run the callback function 'onLoad' for each parsedMessage.
            if (typeof onLoad === 'function') onLoad(seqno, parsedContent, attributes);
          }
        );
        parsePromise.catch( 
          (error) => {
            this.logger.error('Mail parsing encountered a problem.');
            reject(error);
          }
        );
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


IMAPClient.prototype.getRawEmail = async function(path, readOnly, seqno, options){
  // Ensure we have the right box open. Otherwise call 'openBox' to set currentPath (currentBox).
  if (this.currentPath !== path) {  
    if (this.mailbox) await this.client.closeBoxAsync(autoExpunge = false);
    try {
      this.mailbox = await this.openBox(path, readOnly);
    } catch (error) {
      this.logger.error(error);
      return new Promise((resolve,reject) => {
        reject(error);
      })
    }
  }

  return new Promise(function (resolve, reject) {
    this.logger.log("Grabbing raw content of: " + `${seqno}.`);
    
    let fetchObject = this.client.seq.fetch(`${seqno}`, options); 
    let rawMessageBody;
   
    fetchObject.on('message', (msg, seqno) => {
      // This 'seqno' is the one stored in the server. Not the one we pass as arguement in the function.
      msg.on('body', (stream, info) => {
        rawMessageBody = stream;
      });
    });

    fetchObject.once('error', (err) => {
      this.logger.error(`Fetch error: ${err}`);
      reject(err);
    })

   
    fetchObject.once('end', () => {
      resolve(rawMessageBody);
    });

  }.bind(this)) // Bind 'this' to point to the function not the promise.
}


IMAPClient.prototype.parsePGPMIMEMessage = async function (message){
  let parsePromise, parsedHeaders, parsedData, parsedAttachments = [];

  const stream = new Readable();
  stream.push(message);
  stream.push(null);

  let parser = new MailParser();
  let attachmentNo = 0;

  parsePromise = new Promise(
    (resolve, reject) => {
      stream.pipe(parser)
      .on('headers', (headers) => parsedHeaders = headers)
      .on('data', (data) => {        
        if (data.type === 'attachment'){
          // Get necessary data and then remove the circular structure 'content'.
          
          if (data.content.algo) data.algo = data.content.algo;
          if (data.content.allowHalfOpen) data.allowHalfOpen = data.content.allowHalfOpen;
          if (data.content.byteCount) data.byteCount = data.content.byteCount;
          delete data.content; 

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
  parser = null;

  try {
    await parsePromise;
    return {'data': parsedData, 'headers' : parsedHeaders, 'attachments' : parsedAttachments};
  } catch (error) {
    this.logger.error(error);
  }
 
}


IMAPClient.prototype.fetchInlineAttachments = async function (content, uid, path){
  let parsedAttachments = content.attachments;
  let attachmentHeaders = content.attachmentHeaders;
  let user = this.client._config.user;
  let hash = user.includes('@') ? this.utils.md5(user) : user;
  let appPath = this.app.getPath('userData');
  let md5 = this.utils.md5;

  for (let i = 0; i < parsedAttachments.length; i++) {
    let attachment = parsedAttachments[i];
    // We fetch only the attachments that are supposed to be inline (inside the HTML body).
    if (attachment['contentDisposition'] !== 'inline'){
      continue;
    }

    /*
      Fetch only inline attachments with types:
      image/png, image/jpeg, image/gif, image/bmp, image/avif
    */
    if ( (attachment['contentType'] !== 'image/png' ) && (attachment['contentType'] !== 'image/jpeg' ) &&
         (attachment['contentType'] !== 'image/gif' ) && (attachment['contentType'] !== 'image/bmp' ) &&
         (attachment['contentType'] !== 'image/avif') &&
         (attachment['contentType'] !== 'application/octet-stream'))
    {
      continue;
    }
    this.logger.log(`Fetching attachment: ${attachment.filename}`);
    let fetchAttachmentObject = this.client.fetch(`${uid}`, { // We do not use imap.seq.fetch here.
      bodies: [attachment.partId]
    }); 
    let fetchPromise = new Promise((resolve,reject) => {
      // The buildAttMessageFunction returns a function.
      fetchAttachmentObject.on('message', async (msg) => {
    
        let encoding;
        let filename = attachment.filename;
        let attachmentNoI = attachmentHeaders[i];
        for (let j=0 ; j < attachmentNoI.length; j++){
          if (attachmentNoI[j].name === 'content-transfer-encoding' ){
            encoding = attachmentNoI[j].value;
            console.log(encoding)
          }
        }
        
        msg.on('body', function(stream, info) {
          //Create a write stream so that we can stream the attachment to file;
          console.log('Streaming this attachment to file', filename, info);
              
          // The uid used here is the uid from the server, so since we locally use a combination
          // of folder and uid, we need to store it with the folderUid format.
          let hashuid = md5(`${path}${uid}`);

          const fs = jetpack.cwd(appPath, `mail`,`${hash}`);
          fs.dir(`${hashuid}`);
          let writeStream = fs.createWriteStream(`${appPath}\\mail\\${hash}\\${hashuid}\\${filename}`);

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
          resolve();
        });
      });
    });
    await fetchPromise;
  }
}


IMAPClient.prototype.fetchAttachments = async function (content, uid, ipcRenderer){
  let parsedAttachments = content.attachments;
  let attachmentHeaders = content.attachmentHeaders;

  for (let i = 0; i < parsedAttachments.length; i++) {
    let attachment = parsedAttachments[i];
    // We fetch only the attachments that are supposed to be inline (inside the HTML body).
    if (attachment['contentDisposition'] !== 'attachment'){
      continue;
    }

    // Choose folder to save.
    let saveFolder;
    let dialogPromise = new Promise ((resolve,reject) => {
      ipcRenderer.send('saveAttachment', `${attachment.filename}`);
      ipcRenderer.on('saveFolder', (event, data) => { 
        saveFolder = data;
        if (!saveFolder) reject(new Error('Cancelled'));
        else resolve(data);
      })
    })
   
    try {
      saveFolder = await dialogPromise;
      saveFolder = String(saveFolder).toString()+'/';
    } catch (error) {
      this.logger.error(error);
      if (i === parsedAttachments.length - 1) return false;
      else continue;
    }

    this.logger.log(`Fetching attachment: ${attachment.filename}`);
    let fetchAttachmentObject = this.client.fetch(`${uid}`, { // We do not use imap.seq.fetch here.
      bodies: [attachment.partId]
    }); 

    let fetchPromise = new Promise((resolve) => {

      fetchAttachmentObject.on('message', async (msg) => {
        let encoding;
        let filename = attachment.filename;
        let attachmentNoI = attachmentHeaders[i];
        for (let j=0 ; j < attachmentNoI.length; j++){
          if (attachmentNoI[j].name === 'content-transfer-encoding' ){
            encoding = attachmentNoI[j].value;
          }
        }
 
        msg.on('body', function(stream, info) {
          //Create a write stream so that we can stream the attachment to file;
          console.log('Streaming this attachment to file', filename, info);
              
          const fs = jetpack.cwd(`${saveFolder}`);
          let writeStream = fs.createWriteStream(`${saveFolder}\\${filename}`);

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
          resolve();
        });
      });
    });
    await fetchPromise;
  }
  return true;
}


IMAPClient.prototype.fetchPGPSignatureForDecryptedMessage = async function (attachments, sourceMIMENode, uid, path){
  let parsedAttachments = attachments;

  let user = this.client._config.user;
  let hash = user.includes('@') ? this.utils.md5(user) : user;
  let appPath = this.app.getPath('userData');
  let md5 = this.utils.md5;

  for (let i = 0; i < parsedAttachments.length; i++) {
    let attachment = parsedAttachments[i];

    // We fetch only the attachments that are supposed to be inline (inside the HTML body of the MIME Node).
    if (attachment['contentDisposition'] !== 'attachment'){
      continue;
    }

    if (attachment['contentType'] === "application/pgp-signature"){
      // Filename to create.
      let filename = attachment.filename;
      this.logger.log(`Fetching attachment: ${attachment.filename}`);

      // The uid used here is the uid from the server, so since we locally use a combination
      // of folder and uid, we need to store it with the folderUid format.
      let hashuid = md5(`${path}${uid}`);

      const fs = jetpack.cwd(appPath, `mail`,`${hash}`);
      fs.dir(`${hashuid}`);
      let writeStream = fs.createWriteStream(`${appPath}\\mail\\${hash}\\${hashuid}\\${filename}`);
      console.log('Streaming this attachment to file', filename);

      // Create stream from the MIMEsource.
      const mimeStream = new Readable();
      mimeStream.push(sourceMIMENode);
      mimeStream.push(null);

      let parser = new MailParser();
      let parsePromise = new Promise(
        (resolve, reject) => {
          mimeStream.pipe(parser)
          .on('data', (data) => {        
            if (data.type === 'attachment'){
              // The mimeStream will find all attachments, we only want to fetch the one specified in this iteration.
              if (data.filename === filename){
                data.content.pipe(writeStream);
                delete data.content; 
                data.release();
              }
              else {
                delete data.content; 
                data.release();
              }
            }
          })
          .on('error', reject)
          .once('end', resolve)
        }
      );

      writeStream.once('finish', function() {
        console.log('Done writing to file %s', filename);
        writeStream.destroy();
      });

      parser = null;
    
      try {
        await parsePromise;
        return await fs.readAsync(`${appPath}\\mail\\${hash}\\${hashuid}\\${filename}`);
      } catch (error) {
        this.logger.error(error);
        return null;
      }
    }
  } 
  return null;  
}


IMAPClient.prototype.fetchPGPSignatureForCleartextMessage = async function (attachments, uid, path){
  let parsedAttachments = attachments;

  let user = this.client._config.user;
  let hash = user.includes('@') ? this.utils.md5(user) : user;
  let appPath = this.app.getPath('userData');
  let md5 = this.utils.md5;

  let signatureToReturn; 

    for (let i = 0; i < parsedAttachments.length; i++) {
      let attachment = parsedAttachments[i];
      let filename = attachment.filename;
  
      // We fetch only the attachments that are supposed to be inline (inside the HTML body).
      if (attachment['contentDisposition'] !== 'attachment'){
        continue;
      }
  
      if (attachment['contentType'] === "application/pgp-signature"){
        this.logger.log(`Fetching attachment: ${attachment.filename}`);
  
        let fetchAttachmentObject = this.client.fetch(`${uid}`, { // We do not use imap.seq.fetch here.
          bodies: [attachment.partId]
        }); 
  
        // The uid used here is the uid from the server, so since we locally use a combination
        // of folder and uid, we need to store it with the folderUid format.
        let hashuid = md5(`${path}${uid}`);
        const fs = jetpack.cwd(appPath, `mail`,`${hash}`);
        fs.dir(`${hashuid}`);
        let writeStream = fs.createWriteStream(`${appPath}\\mail\\${hash}\\${hashuid}\\${filename}`);
  

        let fetchAndWritePromise = new Promise ((resolve, reject) => {
          fetchAttachmentObject.on('message', async (msg) => {
            msg.on('body', function(stream, info) {
              //Create a write stream so that we can stream the attachment to file;
              console.log('Streaming this attachment to file', filename, info);
              stream.pipe(writeStream);
            });
    
            msg.once('end', function() {
              console.log('Finished receiving attachment :', filename);
              writeStream.once('finish', function() {
                console.log('Done writing to file %s', filename);
                writeStream.destroy(); 
                try {
                  let signature =  jetpack.read(`${appPath}\\mail\\${hash}\\${hashuid}\\${filename}`);
                  resolve(signature);
                } catch (error) {
                  this.logger.error(error);
                  reject(error);
                }
              });
            });
          });
        });

        signatureToReturn = await fetchAndWritePromise;
      }
    }

    return signatureToReturn;

}




IMAPClient.prototype.fetchPGPMIMEAttachments = async function (emailContent, sourceMIMENode, ipcRenderer){
  let parsedAttachments = emailContent.attachments;
  let attachmentHeaders = emailContent.attachmentHeaders;

  for (let i = 0; i < parsedAttachments.length; i++) {
    let attachment = parsedAttachments[i];
    // We fetch only the attachments that are supposed to be inline (inside the HTML body).
    if (attachment['contentDisposition'] !== 'attachment'){
      continue;
    }

    // Choose folder to save.
    let saveFolder;
    let dialogPromise = new Promise ((resolve,reject) => {
      ipcRenderer.send('saveAttachment', `${attachment.filename}`);
      ipcRenderer.on('saveFolder', (event, data) => { 
        saveFolder = data;
        if (!saveFolder) reject(new Error('Cancelled'));
        else resolve(data);
      })
    })
   
    try {
      saveFolder = await dialogPromise;
      saveFolder = String(saveFolder).toString()+'/';
    } catch (error) {
      this.logger.error(error);
      if (i === parsedAttachments.length - 1) return false;
      else continue;
    }

    this.logger.log(`Fetching attachment: ${attachment.filename}`);

    // Filename to create.
    let filename = attachment.filename;

    // Find encoding of the attachment, so that it can be decoded before saving to disk.
    let encoding;
    let attachmentNoI = attachmentHeaders[i];
    for (let j = 0 ; j < attachmentNoI.length; j++){
      if (attachmentNoI[j].name === 'content-transfer-encoding'){
        encoding = attachmentNoI[j].value;
      }
    }

    //Create a write stream so that we can stream the attachment to file;     
    const fs = jetpack.cwd(`${saveFolder}`);
    let writeStream = fs.createWriteStream(`${saveFolder}\\${filename}`);
    console.log('Streaming this attachment to file', filename);

    // Create stream from the MIMEsource.
    const mimeStream = new Readable();
    mimeStream.push(sourceMIMENode);
    mimeStream.push(null);

    let parser = new MailParser();
    let parsePromise = new Promise(
      (resolve, reject) => {
        mimeStream.pipe(parser)
        .on('data', (data) => {    
          if (data.type === 'attachment'){
            // The mimeStream will find all attachments, we only want to fetch the one specified in this iteration.
            if (data.filename === filename) {
              // stream.pipe(writeStream); this would write base64 data to the file, so we decode during streaming using 
              if (encoding === 'base64') {
                data.content.pipe(writeStream);
              } else  {
                //here we have none or some other decoding streamed directly to the file which renders it useless probably
                data.content.pipe(writeStream);
              } 
              delete data.content; 
              data.release();
            }
            else {
              delete data.content; 
              data.release();
            }
          }
        })
        .on('error', reject)
        .once('end', resolve)
      }
    );

    writeStream.once('finish', function() {
      console.log('Done writing to file %s', filename);
      writeStream.destroy();
    });

    parser = null;
  
    try {
      await parsePromise;
      return true;
    } catch (error) {
      this.logger.error(error);
      return false;
    }
  }
}


IMAPClient.prototype.fetchPGPMIMEInlineAttachments = async function (emailContent, sourceMIMENode, uid, path){
  let parsedAttachments = emailContent.attachments;
  let attachmentHeaders = emailContent.attachmentHeaders;

  let user = this.client._config.user;
  let hash = user.includes('@') ? this.utils.md5(user) : user;
  let appPath = this.app.getPath('userData');
  let md5 = this.utils.md5;

  for (let i = 0; i < parsedAttachments.length; i++) {
    let attachment = parsedAttachments[i];

    // We fetch only the attachments that are supposed to be inline (inside the HTML body of the MIME Node).
    if (attachment['contentDisposition'] !== 'inline'){
      continue;
    }

    /*
      Fetch only inline attachments with types:
      image/png, image/jpeg, image/gif, image/bmp, image/avif
    */
    if ( (attachment['contentType'] !== 'image/png' ) && (attachment['contentType'] !== 'image/jpeg' ) &&
         (attachment['contentType'] !== 'image/gif' ) && (attachment['contentType'] !== 'image/bmp' ) &&
         (attachment['contentType'] !== 'image/avif'))
    {
      continue;
    }
 
    // Filename to create.
    let filename = attachment.filename;
    this.logger.log(`Fetching attachment: ${attachment.filename}`);

    // Find encoding of the attachment, so that it can be decoded before saving to disk.
    let encoding;
    let attachmentNoI = attachmentHeaders[i];
    for (let j = 0 ; j < attachmentNoI.length; j++){
      if (attachmentNoI[j].name === 'content-transfer-encoding'){
        encoding = attachmentNoI[j].value;
      }
    }

    // The uid used here is the uid from the server, so since we locally use a combination
    // of folder and uid, we need to store it with the folderUid format.
    let hashuid = md5(`${path}${uid}`);

    const fs = jetpack.cwd(appPath, `mail`,`${hash}`);
    fs.dir(`${hashuid}`);
    let writeStream = fs.createWriteStream(`${appPath}\\mail\\${hash}\\${hashuid}\\${filename}`);
    console.log('Streaming this attachment to file', filename);

    // Create stream from the MIMEsource.
    const mimeStream = new Readable();
    mimeStream.push(sourceMIMENode);
    mimeStream.push(null);

    let parser = new MailParser();
    let parsePromise = new Promise(
      (resolve, reject) => {
        mimeStream.pipe(parser)
        .on('data', (data) => {        
          if (data.type === 'attachment'){
            // The mimeStream will find all attachments, we only want to fetch the one specified in this iteration.
            if (data.filename === filename){
              // stream.pipe(writeStream); this would write base64 data to the file, so we decode during streaming using 
              if (encoding === 'base64') {
                data.content.pipe(writeStream);
              } else  {
                //here we have none or some other decoding streamed directly to the file which renders it useless probably
                data.content.pipe(writeStream);
              }  
              delete data.content; 
              data.release();
            }
            else {
              delete data.content; 
              data.release();
            }
          }
        })
        .on('error', reject)
        .once('end', resolve)
      }
    );

    writeStream.once('finish', function() {
      console.log('Done writing to file %s', filename);
      writeStream.destroy();
    });

    parser = null;
  
    try {
      await parsePromise;
    } catch (error) {
      this.logger.error(error);
    }
  }
}


IMAPClient.prototype.checkFlags = async function (path, readOnly){
  // Ensure we have the right box open. Otherwise call 'openBox' to set currentPath (currentBox).
 if (this.currentPath !== path) {  
  if (this.mailbox) await this.client.closeBoxAsync(autoExpunge = false);
    try {
      this.mailbox = await this.openBox(path, readOnly);
    } catch (error) {
      this.logger.error(error);
      return new Promise((resolve,reject) => {
        reject(error);
      });
    }
  }

  let searchSeen = new Promise((resolve,reject) => {
    this.client.search( ['SEEN'] , (error, UIDs) => {
      if (error) reject(error);
      resolve(UIDs);
    });
  });
  let searchFlagged = new Promise((resolve,reject) => {
    this.client.search( ['FLAGGED'] , (error, UIDs) => {
      if (error) reject(error);
      resolve(UIDs);
    });
  });
  let searchDeleted = new Promise((resolve,reject) => {
    this.client.search( ['DELETED'] , (error, UIDs) => {
      if (error) reject(error);
      resolve(UIDs);
    });
  });

  let seenMessages;
  let flaggedMessages;
  let deletedMessages;
  let flagsResult = {};
  try {
    seenMessages = await searchSeen;
    flaggedMessages = await searchFlagged;
    deletedMessages = await searchDeleted;
    flagsResult['seenMessages'] = seenMessages;
    flagsResult['flaggedMessages'] = flaggedMessages;
    flagsResult['deletedMessages'] = deletedMessages;
    return new Promise((resolve) => {
      resolve(flagsResult);
    });
  } catch (error) {
    this.logger.error(error);
    return new Promise((resolve) => {
      reject(error);
    });
  }
}

IMAPClient.prototype.updateFlag = async function (path, readOnly, uid, oldFlags, newFlag){
  console.log(readOnly)
  // Ensure we have the right box open. Otherwise call 'openBox' to set currentPath (currentBox).
  // Also ensure that the box is not opened in 'readOnly' mode since we are attempting to change flags.
  if (this.currentPath !== path || (this.currentPath === path && this.mailbox.readOnly === true)) {  
    if (this.mailbox) await this.client.closeBoxAsync(autoExpunge = false);
      try {
        this.mailbox = await this.openBox(path, readOnly);
        console.log(this.mailbox)
      } catch (error) {
        this.logger.error(error);
        return new Promise((resolve,reject) => {
          reject(error);
      });
    }
  }

  if (! oldFlags.includes(newFlag)){
    try {
      await this.client.addFlagsAsync(this.utils.stripStringOfNonNumericValues(uid), newFlag);
      oldFlags.push(newFlag);
    } catch (error) {
      this.logger.error(error);
    }
  }
  return oldFlags;
}

IMAPClient.prototype.reloadBox = async function(path,readOnly){
  if (this.mailbox) await this.client.closeBoxAsync(autoExpunge = false);
    try {
      this.mailbox = await this.openBox(path, readOnly);
    } catch (error) {
      this.logger.error(error);
      return new Promise((resolve,reject) => {
        reject(error);
    });
  }
}


/*
  STORE : This command alters data associated with a message in the mailbox.  Normally, STORE will return the 
          updated value of the data with an untagged FETCH response. Used to change flags to the mailbox messages.
          ---------------------------------------------------------------
          Example:    C: A003 STORE 2:4 +FLAGS (\Deleted)
                      S: * 2 FETCH (FLAGS (\Deleted \Seen))
                      S: * 3 FETCH (FLAGS (\Deleted))
                      S: * 4 FETCH (FLAGS (\Deleted \Flagged \Seen))
                      S: A003 OK STORE completed
          ---------------------------------------------------------------
  EXPUNGE : This command instructs the server to permanently delete messages that have the \Deleted flag set 
            on them from the currently selected folder. Note: This does not mean “move to trash”. 
            It means to really, properly, and finally delete.
          ---------------------------------------------------------------
            Example:    C: A202 EXPUNGE
                        S: * 3 EXPUNGE
                        S: * 3 EXPUNGE
                        S: * 5 EXPUNGE
                        S: * 8 EXPUNGE
                        S: A202 OK EXPUNGE completed
          -------------------------------------------------------------
  (*************** UID PLUS EXTENSION - RFC 4315 - NEEDS SUPPORT FROM SERVER *************************)
  UID EXPUNGE : This command permanently removes all messages that both have the \Deleted flag set and have a UID 
                that is included in the specified sequence set from the currently selected mailbox.  If a
                message either does not have the \Deleted flag set or has a UID that is not included in the 
                specified sequence set, it is not affected. 
                
                This command is particularly useful for disconnected clients. By using UID EXPUNGE instead
                of EXPUNGE when resynchronizing with the server, the client can ensure that it does not 
                inadvertantly remove any messages that have been marked as \Deleted by other clients between 
                the time that the client was last connected anD the time the client resynchronizes.

                If the server does not support the UIDPLUS capability, the clienT should fall back to using 
                the STORE command to temporarily remove the \Deleted flag from messages it does not want to
                remove, then issuing the EXPUNGE command.  Finally, the client should use thE STORE command to 
                restore the \Deleted flag on the messages in which it was temporarily removed.
                Alternatively, the client may fall back to using just the EXPUNGE command, risking the 
                unintended removal of some messages.
                ------------------------------------------------
                Example:    C: A003 UID EXPUNGE 3000:3002
                            S: * 3 EXPUNGE
                            S: * 3 EXPUNGE
                            S: * 3 EXPUNGE
                            S: A003 OK UID EXPUNGE completed
                ------------------------------------------------
*/
IMAPClient.prototype.expungeEmails = async function (path, readOnly, uids){
  console.log(readOnly)
  // Ensure we have the right box open. Otherwise call 'openBox' to set currentPath (currentBox).
  // Also ensure that the box is not opened in 'readOnly' mode since we are attempting to delete.
  if (this.currentPath !== path || (this.currentPath === path && this.mailbox.readOnly === true) || !this.mailbox) {  
    if (this.mailbox) await this.client.closeBoxAsync(autoExpunge = false);
    try {
      this.mailbox = await this.openBox(path, readOnly);
    } catch (error) {
      this.logger.error(error);
      return new Promise((resolve,reject) => {
        reject(error);
      });
    }
  }

  if (this.client.serverSupports('UIDPLUS')){
    // Permanently removes all messages flagged as 'Deleted' in the currently open mailbox. 
    // If the server supports the 'UIDPLUS' capability, uids can be supplied to only remove messages that both 
    // have their uid in uids and have the \Deleted flag set.
    this.logger.debug('Server supports "UIDPLUS" extension.');
    this.client.expunge(uids, (error) => {
    });
  }
  else {
    this.logger.debug('Server does not support "UIDPLUS" extension.');
    // Permanently removes all messages flagged as 'Deleted' in the currently open mailbox since UIDPLUS is not supported.. 
    this.client.expunge((error) => {
    });
  }
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



module.exports = IMAPClient;
