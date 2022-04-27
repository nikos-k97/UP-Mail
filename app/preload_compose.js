// Secure way of importing node.js modules into the renderer process (compose.js) - 
// Renderer process has access only to the modules - instances of modules that are defined in the contextBridge.
const {contextBridge}              = require("electron");
const {app, BrowserWindow, dialog} = require('@electron/remote');
const Datastore                    = require('@seald-io/nedb'); // Use a NeDB fork since original NeDB is deprecated.
const Promise                      = require('bluebird');
const jetpack                      = require('fs-jetpack');
const materialize                  = require("./helperModules/materialize.min.js");
const Logger                       = require('./helperModules/logger'); 
const FormValidator                = require('./helperModules/formValidator');
const Header                       = require('./mainModules/Header');
const SMTPClient                   = require('./mainModules/SMTPClient');
const Clean                        = require('./mainModules/Clean');
const Utils                        = require('./mainModules/Utils');
const ContactsManager              = require('./mainModules/ContactsManager');
const Encrypt                      = require('./mainModules/Encrypt');
const easyMDE                      = require('easymde');
const {marked}                     = require('marked')


const appDir = jetpack.cwd(app.getAppPath());
const storeDir = jetpack.cwd(app.getPath('userData'));
const state = storeDir.read('./state.json', 'json') || { state: 'new' };
const accountsDB = new Datastore({
  filename: app.getPath('userData') + '/db/accounts.db',
  autoload: true
});
//const accounts = Promise.promisifyAll(accountsDB);
const accounts = accountsDB;


// Avoid global variables by creating instances with parameters. For example nearly every module loaded by the preload
// script has the 'app' dependacy (accessible via' @electron/remote' only inside the preload script). Instead of making
// 'app' global and accessible in all the modules, app is passed as a parameter to the created instances.
// (Global variables defined inside the preload script are accessible by only the modules loaded by the preload script
// which means they are undefined at the 'browser' side - 'app.js' and undefined on the electron side - 'main.js' ).
const logger = new Logger ({}, app); 
const header = new Header (app, BrowserWindow);
const utils  = new Utils (app, logger);
const smtpClient = new SMTPClient (accounts, logger, app.getPath('userData'));
const contactsManager = new ContactsManager(app, utils);

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
            uploadImage: true,
            renderingConfig: {
                sanitizerFunction: (renderedHTML) => {
                    // Use non strict HTML sanitizer (the IMAP client of the receipient should do more filtering if needed)
                    return Clean.cleanHTMLNonStrict(renderedHTML);
                },
            },
          });
        },
        setSendHandler : async () => {
            const form = document.getElementById('send-mail-form');

            // Add autocomplete list from contacts to 'to' and 'cc' fields.
            let datalist = document.querySelector('datalist#contacts');
            let accountInfo = await (async (email) => (await accounts.findAsync({user: email} ))[0] || {})(state.account.user);
            await contactsManager.createContactsDB(accountInfo.user);
            let contactsFromDB = await contactsManager.loadAllContacts();
            for (let j = 0; j < contactsFromDB.length; j++){
                let option = document.createElement('option');
                option.value = contactsFromDB[j].email;
                datalist.appendChild(option);
            }

            const to = form.elements['to'];
            const cc = form.elements['cc'];
            const subject = form.elements['subject'];
            const encryptedCheckbox = form.elements['encrypted'];

            /*
                Decide whether to keep the encrypt switch disabled or not. If the public keys of the 
                recepients (To, CC etc) are known, and the user has created (or imported) a personal
                PGP keypair, then the checkbox can be enabled to give the user the option to send an
                encrypted and signed email with PGP.  Only the case of both encryption and signature
                is supported, since the need to have encrypted but not signed email is not significant, 
                and the case of signing emails but not encrypting them is also not used as commonly.
            */
            let personalPGPKeyPairFound = await necessaryPersonalPGPKeysFound();
        
            form.addEventListener('input', FormValidator.debounce(async function (e) {
                switch (e.target.id) {
                    case 'to':
                        let valid = FormValidator.checkEmailAddress(to);
                        /*
                            Form validator marks an email address as valid if it has the correct email format and
                            allows only the comma (',') character to separate multiple email addresses. This means
                            that if the user has specified multiple email addresses as the recipient, we need to 
                            split the string to get all the individual email addresses, and then check if we have
                            the neccessary PGP public key for each one.
                        */
                        if (valid){
                            if (personalPGPKeyPairFound){
                                // Split the 'to' string to all the individual email addresses.
                                let recipientsArray = to.value.split(',');
                                let validationArray = [];
                                for (let i = 0; i < recipientsArray.length; i++){
                                    // Remove possible whitespaces at the ends of the individual email address.
                                    recipientsArray[i] = recipientsArray[i].trim();
                                    let recipientPublicKeyFound = await necessaryTargetPGPKeyFound(recipientsArray[i]);
                                    if (recipientPublicKeyFound) validationArray.push('true');
                                    else validationArray.push('false');
                                
                                }
                                if (validationArray.includes('false')) {
                                    encryptedCheckbox.disabled = true;
                                    encryptedCheckbox.checked = false;
                                }
                                else {
                                    encryptedCheckbox.disabled = false;  
                                    document.querySelector('#encryption-switch').setAttribute('title', 'Email can be encrypted and signed.');
                                }  
                            }
                        }
                        else {
                            encryptedCheckbox.disabled = true;
                            encryptedCheckbox.checked = false;
                            document.querySelector('#encryption-switch').setAttribute('title', 'Necessary PGP Keys were not found.');
                        }
                        break;
                    case 'cc':
                        let ccValid = FormValidator.checkEmailAddressForCC(cc);
                        if (ccValid){
                            if (personalPGPKeyPairFound){
                                // Split the 'to' string to all the individual email addresses.
                                let recipientsArray = cc.value.split(',');
                                let validationArray = [];
                                for (let i = 0; i < recipientsArray.length; i++){
                                    // Remove possible whitespaces at the ends of the individual email address.
                                    recipientsArray[i] = recipientsArray[i].trim();
                                    let recipientPublicKeyFound = await necessaryTargetPGPKeyFound(recipientsArray[i]);
                                    if (recipientPublicKeyFound) validationArray.push('true');
                                    else validationArray.push('false');
                                
                                }
                                if (validationArray.includes('false')) {
                                    encryptedCheckbox.disabled = true;
                                    encryptedCheckbox.checked = false;
                                    document.querySelector('#encryption-switch').setAttribute('title', 'Necessary PGP Keys were not found.');
                                }
                                else{
                                    encryptedCheckbox.disabled = false;  
                                    document.querySelector('#encryption-switch').setAttribute('title', 'Email can be encrypted and signed.');
                                }
                              
                            }
                        }
                        else {
                            encryptedCheckbox.disabled = true;
                            encryptedCheckbox.checked = false;
                        }
                        break;
                    default: 
                }
            }));

            document.querySelector('#send').addEventListener('click', async (e) => {
                // Prevent form POST HTTP behaviour.
                e.preventDefault();
                
                let isEmailValid = FormValidator.checkEmailAddress(to);
                let isCcValid;
                if (cc) isCcValid = FormValidator.checkEmailAddressForCC(cc);
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
                    // Sanitize email Content before sending.
                    emailContent = Clean.cleanHTMLNonStrict(emailContent);
                    let isSubjectOK = FormValidator.checkEmailSubject(subject);
                    if (isSubjectOK){
                        let encrypted = encryptedCheckbox.disabled ? false : encryptedCheckbox.checked;
                        let recipientInfoArray = [];
                        let allPublicKeysFound = false;
                        // If the encrypted switch is turned on, find the necessary public keys.
                        if (encrypted) {
                            let toArray = (form.elements['to'].value).split(',');
                            let recipientArray = form.elements['cc'].value !== '' ? toArray.concat((form.elements['cc'].value).split()) : toArray;
                            for (let i = 0; i < recipientArray.length; i++){
                                let info = await getContactInfo(recipientArray[i]);
                                if (info) recipientInfoArray.push(info);
                            }
                            if (recipientInfoArray.length === recipientArray.length) allPublicKeysFound = true;
                        }
   
                        let message = {
                            from: form.elements['from'].value,
                            fromName : form.elements['from-name'].value,
                            to: form.elements['to'].value,
                            cc: form.elements['cc'].value,
                            subject: form.elements['subject'].value,
                            message: emailContent,
                            encrypted: encrypted,
                            recipientInfo : (encrypted && allPublicKeysFound) ? recipientInfoArray : null
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

                            let encrypted = encryptedCheckbox.disabled ? false : encryptedCheckbox.checked;
                            let recipientInfoArray = [];
                            let allPublicKeysFound = false;
                            // If the encrypted switch is turned on, find the necessary public keys.
                            if (encrypted) {
                                let toArray = (form.elements['to'].value).split(',');
                                let recipientArray = form.elements['cc'].value !== '' ? toArray.concat((form.elements['cc'].value).split()) : toArray;
                                for (let i = 0; i < recipientArray.length; i++){
                                    let info = await getContactInfo(recipientArray[i]);
                                    if (info) recipientInfoArray.push(info);
                                }
                                if (recipientInfoArray.length === recipientArray.length) allPublicKeysFound = true;
            
                            }
                           
                          
                            let message = {
                                from: form.elements['from'].value,
                                fromName : form.elements['from-name'].value,
                                to: form.elements['to'].value,
                                cc: form.elements['cc'].value,
                                subject: undefined,
                                message: emailContent,
                                encrypted: encrypted,
                                recipientInfo : (encrypted && allPublicKeysFound) ? recipientInfoArray : null
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

async function necessaryPersonalPGPKeysFound (){
    let accountInfo = await (async (email) => (await accounts.findAsync({user: email} ))[0] || {})(state.account.user);

    // If no keypair is found in the 'keys' directory, then no decryption is possible.
    let keysDirectory = jetpack.cwd(app.getPath('userData'), `keys`, `${Utils.md5(accountInfo.user)}`);
    const privateKeyArmored = keysDirectory.inspect(`${accountInfo.user}-private.asc`);
    const publicKeyArmored = keysDirectory.inspect(`${accountInfo.user}-public.asc`);
    const passphrase = keysDirectory.inspect(`getPass.txt`);

    if (!privateKeyArmored || !publicKeyArmored || !passphrase) return false;
    else return true;
}

async function necessaryTargetPGPKeyFound (recipientEmail){
    let accountInfo = await (async (email) => (await accounts.findAsync({user: email} ))[0] || {})(state.account.user);
    await contactsManager.createContactsDB(accountInfo.user);

    let recipientInfo = await contactsManager.loadContact(recipientEmail);
    let recipientPublicKey ;
    if (recipientInfo){
        recipientPublicKey = await jetpack.readAsync(recipientInfo.publicKey);
    }
    // Check public key to make sure that the registered email is indeed the recipient's.
    if (recipientPublicKey) {
      let publicKeyOK = Encrypt.testPublicKey(recipientPublicKey, recipientEmail);
      if (publicKeyOK){
       return true;
      }
    }
    return false;
}


async function getContactInfo (recipientEmail){
    try {
        let accountInfo = await (async (email) => (await accounts.findAsync({user: email} ))[0] || {})(state.account.user);
        await contactsManager.createContactsDB(accountInfo.user);
        let recipientInfo = await contactsManager.loadContact(recipientEmail);
        return recipientInfo;
    } catch (error) {
        console.error(error);
    }
}

