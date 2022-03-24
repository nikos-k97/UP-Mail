// Secure way of importing node.js modules into the renderer process (compose.js) - 
// Renderer process has access only to the modules - instances of modules that are defined in the contextBridge.
const {contextBridge}              = require("electron");
const {app, BrowserWindow, dialog} = require('@electron/remote');
const Datastore                    = require('@rmanibus/nedb'); // Use a NeDB fork since original NeDB is deprecated.
const Promise                      = require('bluebird');
const jetpack                      = require('fs-jetpack');
const materialize                  = require("./helperModules/materialize.min.js");
const Logger                       = require('./helperModules/logger'); 
const FormValidator                = require('./helperModules/formValidator');
const Header                       = require('./mainModules/Header');
const SMTPClient                   = require('./mainModules/SMTPClient');
const easyMDE                      = require('easymde');
const {marked}                     = require('marked')


const appDir = jetpack.cwd(app.getAppPath());
const storeDir = jetpack.cwd(app.getPath('userData'));
const state = storeDir.read('./state.json', 'json') || { state: 'new' };
const accountsDB = new Datastore({
  filename: app.getPath('userData') + '/db/accounts.db',
  autoload: true
});
const accounts = Promise.promisifyAll(accountsDB);


// Avoid global variables by creating instances with parameters. For example nearly every module loaded by the preload
// script has the 'app' dependacy (accessible via' @electron/remote' only inside the preload script). Instead of making
// 'app' global and accessible in all the modules, app is passed as a parameter to the created instances.
// (Global variables defined inside the preload script are accessible by only the modules loaded by the preload script
// which means they are undefined at the 'browser' side - 'app.js' and undefined on the electron side - 'main.js' ).
const logger = new Logger ({}, app); 
const header = new Header (app, BrowserWindow);
const smtpClient = new SMTPClient (accounts, logger);

let easymde;
// Expose protected methods that allow the renderer process to use the ipcRenderer without exposing the entire object.
// Proxy-like API -> instead of assigning values straight to window object - functions can be ovverriden in javascript. 
// A determined attacker could modify the function definition and then the backend (ie. main.js code) would not be safe.
// As long as the proxy only passes through simple values, and not Node.js objects, the preload script can safely get 
// and set file system and operating system values on behalf of the browser window.
contextBridge.exposeInMainWorld(
    'api', {
        loadHeader : () => {
            header.load();
        },
        setLoc : (part) => {
            Header.setLoc(part);
        },
        loadContent : () => {
            document.querySelector('#content').innerHTML = appDir.read(`./app/html/mailForm.html`);
        },
        formatFormSelectElement : async () => {
            let account = await (async (email) => (await accounts.findAsync({user: email} ))[0] || {})(state.account.user);
            let option = document.createElement('option');
            option.setAttribute('value', account._id);
            option.setAttribute('selected', true); //Don't allow user to specify a fake name.
            document.querySelector('#from').appendChild(option);
            option.textContent = account.user;
            materialize.FormSelect.init(document.querySelector('#from'));

            // Also set the outgoing name from the database as the default value in the textbox.
            document.querySelector('#from-name').value = account.smtp.name;
        },
        formatTextArea : () => {
          materialize.Tabs.init(document.querySelector('.tabs'));
          easymde = new easyMDE({
            element: document.getElementById('message-html'),
            autoDownloadFontAwesome: false,
            minHeight: "300px",
            maxHeight: "300px",
            unorderedListStyle : '*',
            spellChecker : false,
            scrollbarStyle : 'native',
            //sanitizerFunction: Custom function for sanitizing the HTML output of markdown renderer.
          });
        },
        setSendHandler : () => {
            const form = document.getElementById('send-mail-form');

            const to = form.elements['to'];
            const cc = form.elements['cc'];
            const subject = form.elements['subject'];

            form.addEventListener('input', FormValidator.debounce(function (e) {
                switch (e.target.id) {
                    case 'to':
                        FormValidator.checkEmailAddress(to);
                        break;
                    case 'cc':
                        FormValidator.checkEmailAddress(cc);
                        break;
                    default: 
                }
            }));

            document.querySelector('#send').addEventListener('click', async (e) => {
                // Prevent form POST HTTP behaviour.
                e.preventDefault();
                
                let isEmailValid = FormValidator.checkEmailAddress(to);
                let isCcValid;
                if (cc) isCcValid = FormValidator.checkEmailAddress(to);
                else isCcValid = true;
                if (isEmailValid && isCcValid) {
                    let emailContent;
                    let activeEditor = document.querySelector('div.active').getAttribute('id');
                    if (activeEditor === 'text'){
                      emailContent = document.querySelector('div.active textarea').value;
      
                    }
                    else if (activeEditor === 'html'){
                      emailContent = easymde.value();
                      emailContent = marked.parse(emailContent);
                    }
                    let isSubjectOK = FormValidator.checkEmailSubject(subject);
                    if (isSubjectOK){
                        let message = {
                            from: form.elements['from'].value, //_id
                            fromName : form.elements['from-name'].value,
                            to: form.elements['to'].value,
                            cc: form.elements['cc'].value,
                            subject: form.elements['subject'].value,
                            message: emailContent
                        }

                        logger.log('Required fields completed. Preparing to send message ...');
                        materialize.toast({html: 'Sending message ...', displayLength : 3000 ,classes: 'rounded'});
                        // Disable the button again after pressing send.
                        document.querySelector('#send').disabled = true;
                        let sent = await smtpClient.queueMailForSend(message);
                        if (!sent) {
                            // Reenable the send button since message was not sent.
                            materialize.toast({html: 'Message was not sent, a problem occured.', displayLength : 3000 ,classes: 'rounded'});
                            document.querySelector('#send').disabled = false;
                        }
                        else materialize.toast({html: 'Message sent!', displayLength : 3000 ,classes: 'rounded'});
                    }
                    else {
                        document.querySelector('.toast-no-subject').addEventListener('click' , async (e) => {
                            materialize.Toast.getInstance(document.querySelector('.toast')).dismiss();
                            let message = {
                                from: form.elements['from'].value,
                                fromName : form.elements['from-name'].value,
                                to: form.elements['to'].value,
                                cc: form.elements['cc'].value,
                                subject: undefined,
                                message: emailContent
                            }
                            logger.log('Required fields completed. Preparing to send message ...');
                            materialize.toast({html: 'Sending message ...', displayLength : 3000 ,classes: 'rounded'});
                            // Disable the button again after pressing send.
                             document.querySelector('#send').disabled = true;
                            let sent = await smtpClient.queueMailForSend(message);
                            if (!sent) {
                                materialize.toast({html: 'Message was not sent, a problem occured.', displayLength : 3000 ,classes: 'rounded'});
                                // Reenable the send button since message was not sent.
                                document.querySelector('#send').disabled = false;
                            }
                            else materialize.toast({html: 'Message sent!', displayLength : 3000 ,classes: 'rounded'});
                        })

                        document.querySelector('.toast-give-subject').addEventListener('click' , (e) => {
                            materialize.Toast.getInstance(document.querySelector('.toast')).dismiss();
                            document.querySelector('#send').disabled = false;
                        })
                    }
                }
                else{ 
                    materialize.toast({html: 'Email format is not correct!', displayLength : 1200, classes: 'rounded'});
                }
            });
        }
    }   
);
