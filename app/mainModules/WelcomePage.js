const domainList = require('../generatedData/email_format_general')
//const $          = require('jquery')

function WelcomePage (logger,stateManager,utils) {
  this.logger = logger;
  this.stateManager = stateManager;
  this.utils = utils;
}

WelcomePage.prototype.load = function () {
	if (!testLoaded('welcome')) return

	this.logger.log('Loading up the welcome page...')
	this.stateManager.page('welcome', ['basic', 'welcome'])

  if (process.env.NODE_ENV !== 'production') fillFields();

  let loginForm = document.querySelector('#login-form');
  let utils = this.utils; // Store 'utils' in a new variable since 'this' inside the event function is changed.
  loginForm.addEventListener('submit', 
    async function onLogin (e) {
      e.preventDefault();
      let details = utils.getItemsFromForm(loginForm);
      console.log(details)
      //AccountManager.addAccount(details)
    }
  );
  //$('#login-form').on('submit', async function onLogin (e) {
     //e.preventDefault()
     //let details = Utils.getItemsFromForm('login-form')
   	 //AccountManager.addAccount(details)
  //})

  // $('#email').on('blur', function onBlur (e) {
  //   let domain = $('#email').val().split('@')[1]
  //   if (!domain) return
  //   if (domain in domainList) {
  //     if ('imap' in domainList[domain]) {
  //       if ('ssl' in domainList[domain].imap) {
  //         if (!$('#host').val()) $('#host').val(domainList[domain].imap.ssl.host)
  //         if (!$('#port').val()) $('#port').val(domainList[domain].imap.ssl.port)
  //         $('#secure').prop('checked', true)
  //       } else if ('unencrypted' in domainList[domain].imap) {
  //         if (!$('#host').val()) $('#host').val(domainList[domain].imap.unencrypted.host)
  //         if (!$('#port').val()) $('#port').val(domainList[domain].imap.unencrypted.port)
  //       }
  //     }
  //     if ('smtp' in domainList[domain]) {
  //       if ('ssl' in domainList[domain].imap) {
  //         if (!$('#host_outgoing').val()) $('#host_outgoing').val(domainList[domain].smtp.ssl.host)
  //         if (!$('#port_outgoing').val()) $('#port_outgoing').val(domainList[domain].smtp.ssl.port)
  //         $('#secure').prop('checked', true)
  //       } else if ('unencrypted' in domainList[domain].smtp) {
  //         if (!$('#host_outgoing').val()) $('#host_outgoing').val(domainList[domain].smtp.unencrypted.host)
  //         if (!$('#port_outgoing').val()) $('#port_outgoing').val(domainList[domain].smtp.unencrypted.port)
  //       }
  //     }
  //     Materialize.updateTextFields();
  //   }
  // })

  // $('#email').focus()
}

/**
 * When in production, user information can be kept
 * .env file so that we don't have to enter it every time.
 * @return {undefined}
 */
function fillFields () {
  document.querySelector('#host_outgoing').value = process.env.HOST_OUTGOING;
  document.querySelector('#port_outgoing').value = process.env.PORT_OUTGOING;
  document.querySelector('#host').value = process.env.HOST;
  document.querySelector('#port').value = process.env.PORT;
  document.querySelector('#email').value = process.env.EMAIL;
  document.querySelector('#password').value = process.env.PASSWORD;
  if (process.env.SECURE) document.querySelector('#secure').setAttribute('checked',true);
}

module.exports = WelcomePage;