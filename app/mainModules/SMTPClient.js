const nodemailer     = require('nodemailer');
const openpgpEncrypt = require('nodemailer-openpgp').openpgpEncrypt;
const Encrypt        = require('./Encrypt');
const jetpack        = require('fs-jetpack');

function SMTPClient (account, logger, appPath) {
  this.account = account;
  this.logger = logger;
  this.appPath = appPath;
  this.transporters = {};
}

SMTPClient.prototype.queueMailForSend = async function(message) {
  let accountDetails = (await this.account.findAsync({ _id: message.from }))[0];
  // Change the 'message.from' to contain the emailAddress and not the _id of the accounts database.
  message.from = accountDetails.user;

  // Decrypt the password in order to be used in the SMTP transporter.
  const key = (await Encrypt.keyDerivationFunction(accountDetails)).toString(); 
  accountDetails.password =  Encrypt.decryptAES256CBC(key, accountDetails.password);
  
  this.createTransporterObject(accountDetails);
  let canSend = await this.verifyServerConnection(accountDetails);
  if (canSend){
    /* SMTP envelope is auto generated from 'from', 'to', 'cc' and 'bcc' fields in the 'mailOptions' object 
       Custom envelopes can be made with the 'envelope' property of the 'mailOptions' object.
       envelope – is an object with the following address params that behave just like with regular mail options.
         from – the first address gets used as MAIL FROM address in SMTP
         to – addresses from this value get added to RCPT TO list
         cc – addresses from this value get added to RCPT TO list
         bcc – addresses from this value get added to RCPT TO list
       The envelope object returned by sendMail() includes just from (address string) and to 
       (an array of address strings) fields as all addresses from to, cc and bcc get merged into to when sending.
    */

    // If 'message.encrypted' is true, then we will attemp to encrypt & sign the message using the neccessary PGP keys.
    let personalKeyFetched = false;
    if (message.encrypted){
      // Get the stored PGP private key and the passphrase.
      try {
        let personalPrivateKeyArmored = await Encrypt.getOwnPrivateKeyEncryptedWithArmor(accountDetails, this.appPath);
        let decryptedPassphrase = await Encrypt.getDecryptedStoredPassphrase(accountDetails, this.appPath);

        let privateKeyOk = await Encrypt.testPrivateKey(personalPrivateKeyArmored, decryptedPassphrase, accountDetails.user);
        if (personalPrivateKeyArmored && decryptedPassphrase && privateKeyOk){
          let options = {
            'signingKey' : personalPrivateKeyArmored,
            'passphrase' : decryptedPassphrase
          }
          this.transporters[accountDetails.user].use('stream', openpgpEncrypt(options));
          personalKeyFetched = true;
        }
      } catch (error) {
        console.error(error);
      }
    }

    let mailOptions;
    // Do not use PGP - PGP is also not used if replying to a message.
    if (!message.encrypted || !personalKeyFetched || !message.recipientInfo || message.messageId){
      // Replying to a message.
      if (message.messageId){
        mailOptions = {
          from: {
            name: message.fromName,
            address: message.from
          },
          to: message.to, // list of receivers
          cc: message.cc,
          subject: message.subject, // Subject line
          replyTo: message.from,
          inReplyTo: message.messageId,
          references: [message.messageId],
          text: message.message, // plain text body
          html: message.message, // html body
        };
      }
      // Sending a new message.
      else {
        mailOptions = {
          from: {
            name: message.fromName,
            address: message.from
          },
          to: message.to, // List of receivers
          cc: message.cc, 
          subject: message.subject, // Subject line
          replyTo: message.from,  // The email to which replies will be sent = Our email address
          // headers : {
          //   'disposition-notification-to' : 'nick-test3@outlook.com', // Τhe notification that the message was read
          //                                                             // by the receiving clientw ill be send to the 
          //                                                             // specified email.
          //   'return-receipt-to' : 'nick-test3@outlook.com'             
          // },
          text: message.message, // Plain text body
          html: message.message, // HTML body
        };
      }
    }
    // Use PGP.
    else{
      let publicKeys = [];
      // Get PGP public keys of the recipients from the 'message.recipientInfo'.
      for (let i = 0; i < message.recipientInfo.length; i++){
        let recipientPublicKey = await jetpack.readAsync(message.recipientInfo[i].publicKey);
        if (recipientPublicKey) {
          let publicKeyOK = Encrypt.testPublicKey(recipientPublicKey, message.recipientInfo[i].email);
          if (publicKeyOK){
           publicKeys.push(recipientPublicKey);
          }
        }
      }
  
      mailOptions = {
        from: {
          name: message.fromName,
          address: message.from
        },
        to: message.to, // list of receivers
        cc: message.cc,
        subject: message.subject, // Subject line
        text: message.message, // plain text body
        html: message.message, // html body
        encryptionKeys : publicKeys,
        shouldSign: true
      };
    }
 

    try {
      await this.send(accountDetails, mailOptions);
      return true;
    } catch (error) {
      this.logger.error(error);
      return false;
    }
  }
  else return false;
};

SMTPClient.prototype.createTransporterObject = async function (account) {
  // Create reusable transporter object using the default SMTP transport.
  if (typeof this.transporters[account.user] === 'undefined') {
    this.transporters[account.user] = nodemailer.createTransport({
      // name: 'Mail Client',      /* Optional hostname of the client, used for identifying to the server, defaults to hostname of the machine. */
      host: account.smtp.host,     /* Hostnames for the host field are resolved using dns.resolve() */
      port: account.smtp.port,
      auth: {
        type: 'login',             /* Other option is ‘oauth2’. */
        user: account.user,
        pass: account.password
      },
      // If 'account.smtp.tls = tls' -> 'secure : true', 
      // If 'account.smtp.tls = starttls' or 'unencrypted' -> 'secure : false'
      // Since 'starttls' -> 'secure : false' and 'unencrypted' -> 'secure : false',
      // we use the 'requireTLS' option to distinguish between the two.
      // If 'account.smtp.tls = unencrypted' -> secure : false , requireTLS : false
      // If 'account.smtp.tls = starttls'    -> secure : false , requireTLS : true
      secure: account.smtp.tls === 'tls' ? true : false,              
                                      /* - If true the connection will use TLS when connecting to server (port 465). 
                                         - If false then TLS is used if server supports the STARTTLS extension. 
                                           (STARTTLS: port 587 , PLAINTEXT : port 25)  */

      requireTLS : account.smtp.tls === 'starttls' ? true : false,           
                                      /* Use STARTTLS even if the server does not advertise support for it. 
                                      If the connection can not be encrypted then message is not sent */
      tls: {
        rejectUnauthorized: account.smtp.tls === 'starttls' ? true : false,  
                                      /* Fail on invalid certificates (self signed or invalid TLS cert). */
      },
      disableFileAccess : true,    /* Does not allow to use files as content. Use it when you want to use JSON data 
                                      from untrusted source as the email. If an attachment or message node tries
                                      to fetch something from a file the sending returns an error */
      disableUrlAccess : true,     /* Does not allow to use Urls as content. */
    });
  }
};

SMTPClient.prototype.verifyServerConnection = async function (account){
  return new Promise((resolve,reject) => {
    this.transporters[account.user].verify(function (error, success) {
      if (error) {
        this.logger.error(error);
        reject(error);
      } else {
        this.logger.log("SMTP server is ready to take our messages");
        resolve(success);
      }
    }.bind(this));
  });
};


SMTPClient.prototype.send = async function (account, mailMessage){
    // Send mail with the reusable transport object.
    return new Promise((resolve,reject) => {
      this.transporters[account.user].sendMail(mailMessage, (error, info) => {
        if (error) {
          this.logger.error(error);
          reject(error);
        }
        this.logger.log(`Message ${info.messageId} sent: ${info.response}`);
        resolve(info.response);
      });
    })

};

module.exports = SMTPClient;
