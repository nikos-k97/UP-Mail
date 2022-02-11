const nodemailer = require('nodemailer')

function SMTPClient (accounts , logger) {
  this.accounts = accounts;
  this.logger = logger;
  this.transporters = {};
}

SMTPClient.prototype.initialize = async function(message) {
  let accountDetails = (await this.accounts.findAsync({ _id: message.from }))[0];
  // Change the 'message.from' to contain the emailAddress and not the _id of the accounts database.
  message.from = accountDetails.user;
  this.createTransporterObject(accountDetails, message);
}

SMTPClient.prototype.createTransporterObject = async function (account, mail) {
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
      //account.tls
      secure: true,               /* - If true the connection will use TLS when connecting to server (port 465). 
                                      - If false then TLS is used if server supports the STARTTLS extension. 
                                        (STARTTLS: port 587 , PLAINTEXT : port 25)  */

      requireTLS : true,           /* Use STARTTLS even if the server does not advertise support for it. 
                                      If the connection can not be encrypted then message is not sent */
      tls: {
        rejectUnauthorized: true,  /* Fail on invalid certificates (self signed or invalid TLS cert). */
      },
      disableFileAccess : true,    /* Does not allow to use files as content. Use it when you want to use JSON data 
                                      from untrusted source as the email. If an attachment or message node tries
                                      to fetch something from a file the sending returns an error */
      disableUrlAccess : true      /* Does not allow to use Urls as content. */
    });
  }

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
  let mailOptions = {
    from: mail.from, // sender address (Firstname Lastname <Email Address>)
    to: mail.to, // list of receivers
    subject: mail.subject, // Subject line
    text: mail.message, // plain text body
    html: mail.message // html body
  };
  console.log(mailOptions);

// Verify connection configuration.
  this.transporters[account.user].verify(function (error, success) {
    if (error) {
      this.logger.error(error);
    } else {
      this.logger.log("Server is ready to take our messages");
      this.send(this.transporters[account.user], mailOptions);
    }
  }.bind(this));
}

SMTPClient.prototype.send = async function (transporter, mailMessage){
    // Send mail with defined transport object.
    transporter.sendMail(mailMessage, (error, info) => {
      if (error) {
        return this.logger.error(error);
      }
      this.logger.log(`Message ${info.messageId} sent: ${info.response}`);
    });
}

module.exports = SMTPClient;
