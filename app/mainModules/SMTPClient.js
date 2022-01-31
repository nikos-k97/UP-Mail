const nodemailer = require('nodemailer')

function SMTPClient (accounts , logger) {
  this.accounts = accounts;
  this.logger = logger;
  this.transporters = {};
}

SMTPClient.prototype.initialize = async function(message) {
  let accountDetails = (await this.accounts.findAsync({ _id: message.from }))[0];
  message.from = accountDetails.user;
  this.send(accountDetails, message);
}

SMTPClient.prototype.send = async function (account, mail) {
  // Create reusable transporter object using the default SMTP transport.

  if (typeof this.transporters[account.user] === 'undefined') {
    this.transporters[account.user] = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: false, //account.tls
      auth: {
        user: account.user,
        pass: account.password
      }
    });
  }

  // Setup email data with unicode symbols.
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
      // Send mail with defined transport object.
      this.transporters[account.user].sendMail(mailOptions, (error, info) => {
        if (error) {
          return this.logger.error(error);
        }
        this.logger.log(`Message ${info.messageId} sent: ${info.response}`);
      })
    }
  }.bind(this));
}


module.exports = SMTPClient;
