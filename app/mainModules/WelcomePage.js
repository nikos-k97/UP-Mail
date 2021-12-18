const domainList = require('../generatedData/email_format_general');

function WelcomePage (logger,stateManager,utils) {
  this.logger = logger;
  this.stateManager = stateManager;
  this.utils = utils;
}

WelcomePage.prototype.load = function () {
	if (!this.utils.testLoaded('welcome')) return;

	this.logger.log('Loading up the welcome page...');
	this.stateManager.page('welcome', ['basic', 'welcome']);
  
  let loginForm = document.querySelector('#login-form');
  let utils = this.utils; // Store 'utils' in a new variable since 'this' inside the event function is changed.
  loginForm.addEventListener('submit', 
    async function onLogin (e) {
      e.preventDefault();
      let details = utils.getItemsFromForm(loginForm);
      //AccountManager.addAccount(details);
    }
  );

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
          if ('ssl' in domainList[domain].imap) {
            let hostField = document.querySelector('#host');
            if (!hostField.value) hostField.value = domainList[domain].imap.ssl.host;
            let portField = document.querySelector('#port');
            if (!portField.value) portField.value = domainList[domain].imap.ssl.port;
            let tlsField = document.querySelector('#secure');
            tlsField.setAttribute('checked', true);
          }
          else if ('unencrypted' in domainList[domain].imap) {
            let hostField = document.querySelector('#host');
            if (!hostField.value) hostField.value = domainList[domain].imap.unencrypted.host;
            let portField = document.querySelector('#port');
            if (!portField.value) portField.value = domainList[domain].imap.unencrypted.port;
            // Leave checkbox unchecked.
          }
        }

        if ('smtp' in domainList[domain]){
          if ('ssl' in domainList[domain].smtp){
            let outgoingHostField = document.querySelector('#host_outgoing');
            if (!outgoingHostField.value) outgoingHostField.value = domainList[domain].smtp.ssl.host;
            let outgoingPortField = document.querySelector('#port_outgoing');
            if (!outgoingPortField.value) outgoingPortField.value = domainList[domain].smtp.ssl.port;
            let tlsField = document.querySelector('#secure');
            tlsField.setAttribute('checked', true);
          }
          else if ('unencrypted' in domainList[domain].smtp) {
            let outgoingHostField = document.querySelector('#host_outgoing');
            if (!outgoingHostField.value) outgoingHostField.value = domainList[domain].smtp.unencrypted.host;
            let outgoingPortField = document.querySelector('#port_outgoing');
            if (!outgoingPortField.value) outgoingPortField.value = domainList[domain].smtp.unencrypted.port;
            // Leave checkbox unchecked.
          }
        }
        //Materialize.updateTextFields();
      }
    }
  );
  emailField.focus();
}

module.exports = WelcomePage;