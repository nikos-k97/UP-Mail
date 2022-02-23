const materialize   = require("../helperModules/materialize.min.js");
const FormValidator = require('../helperModules/formValidator');
const domainList    = require('../generatedData/email_format_general');
const Header        = require('./Header');

function WelcomePage (logger, stateManager, utils, accountManager) {
  this.logger = logger;
  this.stateManager = stateManager;
  this.utils = utils;
  this.accountManager = accountManager;
}

WelcomePage.prototype.load = function () { // No arrow functions. 'this' is bound via bind() in the preload script.
	this.stateManager.page('welcome', ['basic','welcome']);
	this.logger.debug('Loading up the welcome page ...');

  Header.setLoc('Login');
  materialize.CharacterCounter.init(document.querySelector('#outgoing_name'));
  materialize.FormSelect.init(document.querySelectorAll('select'));
  
  let utils = this.utils; // Store 'utils' in a new variable since 'this' inside the event listener is changed.
  let accountManager = this.accountManager; // Store 'accountManager' in a new variable since 'this' inside the event listener is changed.
  let checkLoginInfo = this.checkLoginInfo; // function reference
  let logger = this.logger;
  let loginForm = document.querySelector('#login-form');

  loginForm.addEventListener('submit', 
    async function onLogin (e) {
      e.preventDefault();
      // Disable login button temporarily.
      document.querySelector('button.login').disabled = true;
      // Check if the submitted form information have valid syntax.
      let formOK = checkLoginInfo(loginForm);
      if (formOK){
        document.querySelector('#error').innerHTML = '';
        // Fetch and sanitize the form information.
        let details = utils.getItemsFromForm(loginForm);
        // Check if connection can be established to the IMAP and SMTP servers.
        materialize.toast({html: 'Establishing connections to IMAP and SMTP servers...', displayLength : 3000 ,classes: 'rounded'});
        let verified = await accountManager.testProvidedDetails(details);
        if (verified){
          logger.log('Credentials for the IMAP and SMTP servers validated successfully.');
          logger.log('Proceeding to log user in.')
          materialize.toast({html: 'Connections were established successfully.', displayLength : 3000 ,classes: 'rounded'});
          accountManager.newAccount(details);
        }
        else {
          document.querySelector('#error').innerHTML = "<span><strong>Could not connect to the IMAP and/or the SMTP server. Please check the provided details.</strong></span>"
          materialize.toast({html: 'Connection was not possible. Check provided data.', displayLength : 3000 ,classes: 'rounded'});
          // Re - enable login button since the connection was not possible.
          document.querySelector('button.login').disabled = false;
        }
      }
      else {
        document.querySelector('#error').innerHTML = "<span><strong>Some fields are either missing or have the wrong format.</strong></span>";
        // Re - enable login button since the connection was not possible.
        document.querySelector('button.login').disabled = false;
      }
    }
  );
  
  loginForm.addEventListener('change', FormValidator.debounce(function (e) {
    switch (e.target.id) {
      case 'email':
        FormValidator.checkEmailAddress(loginForm.elements['email']);
        break;
      case 'password':
        FormValidator.checkPassword(loginForm.elements['password']);
        break;
      case 'host_incoming':
        FormValidator.checkIncomingHost(loginForm.elements['host_incoming']);
        break;
      case 'port_incoming':
        FormValidator.checkPort(loginForm.elements['port_incoming']);
        break;
      case 'host_outgoing':
        FormValidator.checkOutgoingHost(loginForm.elements['host_outgoing']);
        break;
      case 'port_outgoing':
        FormValidator.checkPort(loginForm.elements['port_outgoing']);
        break;
      case 'outgoing_name':
        FormValidator.checkUsername(loginForm.elements['outgoing_name']);
      default: 
    }
  }));

  let emailField = document.querySelector('#email');
  emailField.addEventListener('blur',      // 'onBlur' event: when user leaves input field
    function onBlur(e) { 
      // Get user's email domain (the part after the @) from the 'email' text field.
      // Attempt to automatically fill the user's email details from their email's domain (using domainList).
      // (generatedData/email_format_general.json)
      let domain = document.querySelector('#email').value.split('@')[1];
      if (!domain) return;
      if (domain in domainList){
        if ('imap' in domainList[domain]) {
          if ('tls' in domainList[domain].imap) {
            let hostField = document.querySelector('#host_incoming');
            if (!hostField.value) hostField.value = domainList[domain].imap.tls.host;
            FormValidator.checkIncomingHost(loginForm.elements['host_incoming']);
            let portField = document.querySelector('#port_incoming');
            if (!portField.value) portField.value = domainList[domain].imap.tls.port;
            FormValidator.checkPort(loginForm.elements['port_incoming']);
            let tlsField = document.querySelector('#tls_incoming');
            tlsField.value = 'tls';
            materialize.FormSelect.init(tlsField);
          }
          else if ('unencrypted' in domainList[domain].imap) {
            let hostField = document.querySelector('#host_incoming');
            if (!hostField.value) hostField.value = domainList[domain].imap.unencrypted.host;
            FormValidator.checkIncomingHost(loginForm.elements['host_incoming']);
            let portField = document.querySelector('#port_incoming');
            if (!portField.value) portField.value = domainList[domain].imap.unencrypted.port;
            FormValidator.checkPort(loginForm.elements['port_incoming']);
            let tlsField = document.querySelector('#tls_incoming');
            tlsField.value = 'unencrypted';
            materialize.FormSelect.init(tlsField);
          }
        }

        if ('smtp' in domainList[domain]){
          if ('tls' in domainList[domain].smtp) {
            let outgoingHostField = document.querySelector('#host_outgoing');
            if (!outgoingHostField.value) outgoingHostField.value = domainList[domain].smtp.tls.host;
            FormValidator.checkOutgoingHost(loginForm.elements['host_outgoing']);
            let outgoingPortField = document.querySelector('#port_outgoing');
            if (!outgoingPortField.value) outgoingPortField.value = domainList[domain].smtp.tls.port;
            FormValidator.checkPort(loginForm.elements['port_outgoing']);
            let tlsField = document.querySelector('#tls_outgoing');
            tlsField.value = 'tls';
            materialize.FormSelect.init(tlsField);
          }
          else if ('starttls' in domainList[domain].smtp){
            let outgoingHostField = document.querySelector('#host_outgoing');
            if (!outgoingHostField.value) outgoingHostField.value = domainList[domain].smtp.starttls.host;
            FormValidator.checkOutgoingHost(loginForm.elements['host_outgoing']);
            let outgoingPortField = document.querySelector('#port_outgoing');
            if (!outgoingPortField.value) outgoingPortField.value = domainList[domain].smtp.starttls.port;
            FormValidator.checkPort(loginForm.elements['port_outgoing']);
            let tlsField = document.querySelector('#tls_outgoing');
            tlsField.value = 'starttls';
            materialize.FormSelect.init(tlsField);
          }
          else if ('unencrypted' in domainList[domain].smtp){
            let outgoingHostField = document.querySelector('#host_outgoing');
            if (!outgoingHostField.value) outgoingHostField.value = domainList[domain].smtp.unencrypted.host;
            FormValidator.checkOutgoingHost(loginForm.elements['host_outgoing']);
            let outgoingPortField = document.querySelector('#port_outgoing');
            if (!outgoingPortField.value) outgoingPortField.value = domainList[domain].smtp.unencrypted.port;
            FormValidator.checkPort(loginForm.elements['port_outgoing']);
            let tlsField = document.querySelector('#tls_outgoing');
            tlsField.value = 'unencrypted';
            materialize.FormSelect.init(tlsField);
          }
        
        }
        materialize.updateTextFields();
      }
    }
  );
  emailField.focus();
}

WelcomePage.prototype.checkLoginInfo = function (loginForm){
  let emailOK = FormValidator.checkEmailAddress(loginForm.elements['email']);
  let passwordOK = FormValidator.checkPassword(loginForm.elements['password']);
  let incHostOK = FormValidator.checkIncomingHost(loginForm.elements['host_incoming']);
  let incPortOK = FormValidator.checkPort(loginForm.elements['port_incoming']);
  let outHostOK = FormValidator.checkOutgoingHost(loginForm.elements['host_outgoing']);
  let outPortOK = FormValidator.checkPort(loginForm.elements['port_outgoing']);
  let nameOK = FormValidator.checkUsername(loginForm.elements['outgoing_name']);
  if (emailOK && passwordOK && incHostOK && incPortOK && outHostOK && outPortOK && nameOK) return true;
  else return false;
}

module.exports = WelcomePage;