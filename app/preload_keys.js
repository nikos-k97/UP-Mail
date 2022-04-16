// Secure way of importing node.js modules into the renderer process (keys.js) - 
// Renderer process has access only to the modules - instances of modules that are defined in the contextBridge.
const {contextBridge, ipcRenderer}  = require("electron");
const {app, BrowserWindow}          = require('@electron/remote');
const Datastore                     = require('@rmanibus/nedb'); // Use a NeDB fork since original NeDB is deprecated.
const Promise                       = require('bluebird');
const jetpack                       = require('fs-jetpack');
const materialize                   = require("./helperModules/materialize.min.js");
const Logger                        = require('./helperModules/logger'); 
const Header                        = require('./mainModules/Header');
const Clean                         = require('./mainModules/Clean');
const Utils                         = require('./mainModules/Utils');
const ContactsManager               = require('./mainModules/ContactsManager');
const Encrypt                       = require('./mainModules/Encrypt');
const FormValidator                 = require('./helperModules/formValidator');
const https                         = require('https');


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
const utils = new Utils(app, logger);
const contactsManager = new ContactsManager(app, utils);


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
            document.querySelector('#content').innerHTML = appDir.read(`./app/html/keys.html`);
        },
        createNewContactListener : async () => {
            // Create database for contacts.
            const account = await (async (email) => (await accounts.findAsync({user: email} ))[0] || {})(state.account.user);
            contactsManager.createContactsDB(account.user);
            showContacts();

            let addNewContactButton = document.querySelector('.contact-creator .new-contact-button-wrapper .add-new-contact');
            addNewContactButton.addEventListener('click', (e) => {
                e.currentTarget.parentNode.insertAdjacentHTML('afterend', ` 
                    <form class="subtitle" id="contact-form" action="">
                        <div class="row">
                            <div class="input-field form-field col s4">
                                <input id="email" name="email" type="email">
                                <label for="email">*Email</label>
                                <small></small>
                            </div>
                            <div class="input-field form-field col s3">
                                <input id="name" type="text" name="name">
                                <label for="name">Name</label>
                                <small></small>
                            </div>
                            <div class="input-field form-field col s3">
                                <input id = "key" type="button" value="Import Public Key" class = 'import-public-key btn waves-effect waves-light'></input>
                                <span id="key-inserted" hidden></span>
                                <small></small>
                            </div>
                            <div class = input-field form-field col s2">
                                <button class='cancel' title='Cancel'><i class="material-icons">cancel</i></button>
                                <button class='ok' title='Confirm'><i class="material-icons">check</i></button>
                            </div>
                        </div>
                        <small class="row">
                            <small class="col s12">(The email and the public fields are required for the contact to be saved.)</small>
                        </small>
                    </form>
                `);

                e.currentTarget.disabled = true;

                let form = document.querySelector('#contact-form');
                const email = form.elements['email'];
                form.addEventListener('input', FormValidator.debounce(function (e) {
                    switch (e.target.id) {
                        case 'email':
                            FormValidator.checkEmailAddress(email);
                            break;
                        default: 
                    }
                }));

                form.querySelector('#key').addEventListener('click', async (e) => {
                    // Choose file(key) to upload.
                    let publicKeyPath;
                    let dialogPromise = new Promise ((resolve,reject) => {
                        ipcRenderer.send('selectFile');
                        ipcRenderer.on('fileSelected', (event, data) => { 
                            if (!data) reject(new Error('Cancelled'));
                            else resolve(data[0]);
                        });
                    });
                
                    try {
                        publicKeyPath = await dialogPromise;
                        // Check if the public key file resembles a public PGP key.
                        let importedKey = Clean.cleanForm(jetpack.read(publicKeyPath));
                        if (importedKey.includes('PUBLIC')){
                            // Hide the import button after a successfull key import.
                            e.target.outerHTML = '';

                            // Show the imported key as a span instead of the import button.
                            let keyInsertedSpan = form.querySelector('#key-inserted');
                            keyInsertedSpan.textContent = publicKeyPath;
                            keyInsertedSpan.removeAttribute('hidden');
                        }
                        else {
                            materialize.toast({html: 'The file specified is not a PGP public key!', displayLength : 2000, classes: 'rounded'});
                        }
                    } catch (error) {
                        logger.error(error);
                    }
                });
                form.querySelector('.cancel').addEventListener('click', (e) => {
                    addNewContactButton.disabled = false;
                    document.querySelector('#contact-form').outerHTML = ''
                });
                form.querySelector('.ok').addEventListener('click', async (e) => {
                    // Perform validation and escaping to the input data. Email and public key must
                    // be present for the contact to be saved.
                    let form = document.querySelector('#contact-form');
                    const emailElement = form.elements['email'];
                    const email = Clean.cleanForm(emailElement.value);
                    const name = Clean.cleanForm(form.elements['name'].value);
                    let key = document.querySelector('#key-inserted').textContent;
                    let isEmailValid = FormValidator.checkEmailAddress(emailElement);
                    let isPublicKeyPresent = true;
                    if ( ! key || key === '')  isPublicKeyPresent = false;
                    
                    if (isEmailValid && isPublicKeyPresent){
                        let emailExistsInDB = await contactsManager.loadContact(email);
                        // If the email exists in DB then we dont add the contact again.
                        if (!emailExistsInDB){

                            // Test if the email specified inside the public key is indeed the contact's email.
                            key = Clean.cleanForm(key);
                            let importedKey = Clean.cleanForm(jetpack.read(key));
                            let keyBelongsToUser = await Encrypt.testPublicKey(importedKey, email);

                            if (keyBelongsToUser){
                                addNewContactButton.disabled = false;
                                form.outerHTML = '';
                                await contactsManager.saveContact(email,name,key);
                                showContacts(onlyAdd = {'email':email, 'name':name, 'key':key});
                            }
                            else {
                                materialize.toast({html: 'This public key does not belong to the email entered.', displayLength : 1200, classes: 'rounded'});
                            }
                        }
                        else {
                            materialize.toast({html: 'This email is already one of your contacts!', displayLength : 1200, classes: 'rounded'});
                        }
                    }
                    else {
                        materialize.toast({html: 'Email and Public Key are required!', displayLength : 1200, classes: 'rounded'});
                    }
                });
            });
        },
        createPersonalKeysListener : async () => {
            let keyPairAlreadyExists = await showPersonalKeyPair();
            // If a PGP keypair is found, then the createKeyPair and importKeyPair buttons are not
            // rendered so there is no point in continuing into the rest of the function.
            if (keyPairAlreadyExists) return;

            let keysButtonWrapper = document.querySelector('.collection-keys .create-new .new-keypair-button-wrapper');
            let generateKeysButton = keysButtonWrapper.querySelector('.create-keypair');
            let importKeysButton = keysButtonWrapper.querySelector('.import-keypair');

            // Generate our own public/private PGP key pair for the specific account.
            generateKeysButton.addEventListener('click', (e) => {
                // Disable generateKeyPair and importKeyPair buttons.
                e.currentTarget.disabled = true;
                importKeysButton.disabled = true;

                keysButtonWrapper.insertAdjacentHTML('afterend', `
                    <form class="subtitle" id="keys-form" action="">
                        <br>
                        <div class="row">
                            <div class="input-field form-field col s10">
                                <input id="passphrase" name="passphrase" type="password">
                                <label for="passphrase">Private Key Passphrase</label>
                                <small></small>
                            </div>
                            <div class = input-field form-field col s2">
                                <button class='cancel' title='Cancel'><i class="material-icons">cancel</i></button>
                                <button class='ok' title='Confirm'><i class="material-icons">check</i></button>
                            </div>
                        </div>
                    </form>
                `);

                let form = document.querySelector('#keys-form');
                const passphraseElement = form.elements['passphrase'];
                form.addEventListener('input', FormValidator.debounce(function (e) {
                    switch (e.target.id) {
                        case 'passphrase':
                            FormValidator.checkPassword(passphraseElement);
                            break;
                        default: 
                    }
                }));

                form.querySelector('.cancel').addEventListener('click', (e) => {
                    generateKeysButton.disabled = false;
                    importKeysButton.disabled = false;
                    form.outerHTML = '';
                });
                form.querySelector('.ok').addEventListener('click', async (e) => {
                    // Perform validation and escaping to the input data. Passphrase must exist,
                    // but we dont check it's strength.
                    let isPassphraseValid = FormValidator.checkPassword(passphraseElement);
                    if (isPassphraseValid){
                        let passphrase = passphraseElement.value;
                        const accountInfo = await (async (email) => (await accounts.findAsync({user: email} ))[0] || {})(state.account.user);
                        materialize.toast({html: 'Generating new PGP keypair...', displayLength : 1400, classes: 'rounded'});
                        try {
                            await Encrypt.createPGPKeyPair(passphrase, accountInfo, app.getPath('userData'));
                            materialize.toast({html: 'Key pair was generated successfully.', displayLength : 1400, classes: 'rounded'});
                            // Key creation was successfull so close form.
                            form.outerHTML = '';
                            generateKeysButton.disabled = false;
                            importKeysButton.disabled = false;
                            // Render the keypair instead of the creation buttons.
                            await showPersonalKeyPair();
                        } catch (error) {
                            materialize.toast({html: 'An error occurred while generating the PGP keypair.', displayLength : 1400, classes: 'rounded'});
                            // Key creation was noy successfull so keep form open and the createNewPair and
                            // importKeyPair buttons disabled.
                        }
                    }
                    else {
                        materialize.toast({html: 'Private key passphrase cannot be blank!', displayLength : 1200, classes: 'rounded'});
                    }
                });
            });

            importKeysButton.addEventListener('click', (e) => {
                // Disable generateKeyPair and importKeyPair buttons.
                e.currentTarget.disabled = true;
                generateKeysButton.disabled = true;

                keysButtonWrapper.insertAdjacentHTML('afterend', `
                    <form class="subtitle" id="keys-form" action="">
                        <br>
                        <div class="row">
                            <div class="input-field form-field col s3">
                                <input id="public-key" type="button" value="Choose Public Key" class='import-public-key btn waves-effect waves-light'></input>
                                <span id="public-key-inserted" class='overflow' hidden></span>
                                <small></small>
                            </div>
                            <div class="input-field form-field col s3">
                                <input id="private-key" type="button" value="Choose Private Key" class='import-private-key btn waves-effect waves-light'></input>
                                <span id="private-key-inserted" class='overflow' hidden></span>
                                <small></small>
                            </div>
                            <div class="input-field form-field col s4">
                                <input id="passphrase" name="passphrase" type="password">
                                <label for="passphrase">Private Key Passphrase</label>
                                <small></small>
                            </div>
                            <div class = input-field form-field col s2">
                                <button class='cancel' title='Cancel'><i class="material-icons">cancel</i></button>
                                <button class='ok' title='Confirm'><i class="material-icons">check</i></button>
                            </div>
                        </div>
                    </form>
                `);

                let form = document.querySelector('#keys-form');

                form.querySelector('#public-key').addEventListener('click', async (e) => {
                    // Choose file(key) to upload.
                    let publicKeyPath;
                    let dialogPromise = new Promise ((resolve,reject) => {
                        ipcRenderer.send('selectFile');
                        ipcRenderer.on('fileSelected', (event, data) => { 
                            if (!data) reject(new Error('Cancelled'));
                            else resolve(data[0]);
                        });
                    });
                
                    try {
                        publicKeyPath = await dialogPromise;
                        // Check if the public key file resembles a public PGP key.
                        let importedKey = Clean.cleanForm(jetpack.read(publicKeyPath));
                        if (importedKey.includes('PUBLIC')){
                            // Hide the import button after a successfull key import.
                            e.target.outerHTML = '';
                            // Show the imported key as a span instead of the import button.
                            let keyInsertedSpan = form.querySelector('#public-key-inserted');
                            keyInsertedSpan.textContent = publicKeyPath;
                            keyInsertedSpan.removeAttribute('hidden');
                        }
                        else {
                            materialize.toast({html: 'The file specified is not a PGP public key!', displayLength : 2000, classes: 'rounded'});
                        }
                    } catch (error) {
                        logger.error(error);
                    }
                });

                form.querySelector('#private-key').addEventListener('click', async (e) => {
                    // Choose file(key) to upload.
                    let privateKeyPath;
                    let dialogPromise = new Promise ((resolve,reject) => {
                        ipcRenderer.send('selectFile');
                        ipcRenderer.on('fileSelected', (event, data) => { 
                            if (!data) reject(new Error('Cancelled'));
                            else resolve(data[0]);
                        });
                    });
                
                    try {
                        privateKeyPath = await dialogPromise;
                        // Check if the public key file resembles a public PGP key.
                        let importedKey = Clean.cleanForm(jetpack.read(privateKeyPath));
                        if (importedKey.includes('PRIVATE')){
                            // Hide the import button after a successfull key import.
                            e.target.outerHTML = '';
                            // Show the imported key as a span instead of the import button.
                            let keyInsertedSpan = form.querySelector('#private-key-inserted');
                            keyInsertedSpan.textContent = privateKeyPath;
                            keyInsertedSpan.removeAttribute('hidden');
                        }
                        else {
                            materialize.toast({html: 'The file specified is not a PGP private key!', displayLength : 2000, classes: 'rounded'});
                        }
                    } catch (error) {
                        logger.error(error);
                    }
                });



                const passphraseElement = form.elements['passphrase'];
                form.addEventListener('input', FormValidator.debounce(function (e) {
                    switch (e.target.id) {
                        case 'passphrase':
                            FormValidator.checkPassword(passphraseElement);
                            break;
                        default: 
                    }
                }));

                form.querySelector('.cancel').addEventListener('click', (e) => {
                    generateKeysButton.disabled = false;
                    importKeysButton.disabled = false;
                    form.outerHTML = '';
                });

                form.querySelector('.ok').addEventListener('click', async (e) => {
                    // Perform validation and escaping to the input data. Passphrase must exist,
                    // but we dont check it's strength.
                    let publicKey = Clean.cleanForm(form.querySelector('#public-key-inserted').textContent);
                    let privateKey = Clean.cleanForm(form.querySelector('#private-key-inserted').textContent);
                    let isPublicKeyPresent = true;
                    let isPrivateKeyPresent = true;
                    if ( ! publicKey || publicKey === '')  isPublicKeyPresent = false;
                    if ( ! privateKey || privateKey === '')  isPrivateKeyPresent = false;
                    let isPassphraseValid = FormValidator.checkPassword(passphraseElement);

                    if (isPrivateKeyPresent && isPublicKeyPresent && isPassphraseValid){
                        let passphrase = passphraseElement.value;
                        const accountInfo = await (async (email) => (await accounts.findAsync({user: email} ))[0] || {})(state.account.user);
                        materialize.toast({html: 'Saving the imported PGP keypair...', displayLength : 1400, classes: 'rounded'});
                        try {
                            // Read and check the keys, check if the passphrase is correct, and save them in the keys directory.
                            let success = await Encrypt.importPGPKeyPair(passphrase, publicKey, privateKey, accountInfo, app.getPath('userData'));
                            if (success) {
                                materialize.toast({html: 'Key pair was imported successfully.', displayLength : 1400, classes: 'rounded'});
                                // Key creation was successfull so close form.
                                form.outerHTML = '';
                                generateKeysButton.disabled = false;
                                importKeysButton.disabled = false;
                                // Render the keypair instead of the creation buttons.
                                await showPersonalKeyPair();
                            }
                            else {
                                materialize.toast({html: 'Error: You are not either not the owner of one (or both) the keys, or the passphrase is wrong!', displayLength : 2400, classes: 'rounded'});
                            }
                        } catch (error) {
                            materialize.toast({html: 'An error occurred while generating the PGP keypair.', displayLength : 1400, classes: 'rounded'});
                            // Key creation was noy successfull so keep form open and the createNewPair and
                            // importKeyPair buttons disabled.
                        }
                    }
                    else {
                        materialize.toast({html: 'Some fields are empty!', displayLength : 1200, classes: 'rounded'});
                    }
                });
            });
        }
    }
);


async function showContacts (onlyAdd){
    let collectionHeader = document.querySelector('.collection .collection-header');
    let newHtml = '';
    // Show only the newly added contact, as the others are already shown.
    if (onlyAdd){
        let html = `
            <li class="collection-item collection-item-new avatar">
                <i class="material-icons circle">person</i>
                <span class="email"><strong>${onlyAdd.email}</strong></span>
                <p class="name">
                    <small class="name">${onlyAdd.name || ''}</small>
                </p>
                <div class='key-wrapper'>
                    <small class="key">${onlyAdd.key && jetpack.inspect(onlyAdd.key) ? onlyAdd.key : '(Public key was not found on the path specified.)'}</small>
                </div>
                <a class="secondary-content">
                    <button class = 'delete-contact btn waves-effect waves-light'>Delete</button>
                </a>
            </li>
        `;
        newHtml = newHtml + html;
    }
    // Show all contacts
    else {
        let details = await contactsManager.loadAllContacts();
        for (let i=0; i < details.length; i++){
            let html = `
                <li class="collection-item avatar">
                    <i class="material-icons circle">person</i>
                    <span class="email"><strong>${details[i].email}</strong></span>
                    <p class="name">
                        <small class="name">${details[i].name || ''}</small>
                    </p>
                    <div class='key-wrapper'>
                        <small class="key">${details[i].publicKey && jetpack.inspect(details[i].publicKey) ? details[i].publicKey : '(Public key was not found on the path specified.)'}</small>
                    </div>
                    <a class="secondary-content">
                        <button class = 'delete-contact btn waves-effect waves-light'>Delete</button>
                    </a>
                </li>
            `;
            newHtml = newHtml + html;
        }
    }
    collectionHeader.insertAdjacentHTML('afterend', newHtml);

    // Add event listener to the new contact's delete button.
    if (onlyAdd){
        document.querySelector('.collection-item-new .secondary-content .delete-contact').addEventListener('click', (e)=>{
            contactsManager.deleteContact(e.target.parentNode.parentNode.querySelector('.email strong').textContent);
            e.target.parentNode.parentNode.outerHTML = '';
        });
    }
    else {
        let deleteButtons = document.querySelectorAll('.collection-item .secondary-content .delete-contact');
        for (let j=0; j<deleteButtons.length; j++){
            // For safety - if it the newly added element dont add event listener again.
            if (deleteButtons[j].parentNode.parentNode.classList.contains('collection-item-new')) continue;
            deleteButtons[j].addEventListener('click', (e) => {
                contactsManager.deleteContact(e.target.parentNode.parentNode.querySelector('.email strong').textContent);
                e.target.parentNode.parentNode.outerHTML = '';
            });
        }
    }
}


async function showPersonalKeyPair(){
    let keyPairFound = false;

    // Check if a PGP keypair already exists inside the 'keys' directory.
    const accountInfo = await (async (email) => (await accounts.findAsync({user: email} ))[0] || {})(state.account.user);
    let fs = jetpack.cwd(app.getPath('userData'));
    fs.dir(`keys`);
    fs = jetpack.cwd(app.getPath('userData'), `keys`);
    fs.dir(`${Utils.md5(accountInfo.user)}`);
    fs = jetpack.cwd(app.getPath('userData'), `keys`, `${Utils.md5(accountInfo.user)}`);
    let filesFound = fs.find(`.`, {files : true, directories : false});
    let publicKeyName, privateKeyName; // will stay undefined if no keys are found
    if (filesFound){
        let filteredFiles = filesFound.filter(element => {
            if (element !== `getPass.txt`) return element;
        });
        if (filteredFiles.length === 2){
            // Inside the keys directory there must always be 3 files (getPass.txt + a PGP key pair)
            keyPairFound = true;
    
            // Read the files and decide which is the private and which is the public key.
            if (!publicKeyName && !privateKeyName){
                let file1 = Clean.cleanForm(fs.read(filteredFiles[0]));
                let file2 = Clean.cleanForm(fs.read(filteredFiles[1]));
              
                if (file1.includes('PUBLIC')) {
                    publicKeyName = filteredFiles[0];
                    if (file2.includes('PRIVATE')){
                        privateKeyName = filteredFiles[1];
                    }
                    else {
                        keyPairFound = false;
                        materialize.toast({html: 'Could not decide which key is the public and which is the private.', displayLength : 1400, classes: 'rounded'});
                    }
                }
                else if (file1.includes('PRIVATE')){
                    privateKeyName = filteredFiles[0];
                    if (file2.includes('PUBLIC')){
                        publicKeyName = filteredFiles[1];
                    }
                    else {
                        keyPairFound = false;
                        materialize.toast({html: 'Could not decide which key is the public and which is the private.', displayLength : 1400, classes: 'rounded'});
                    }
                } 
                else keyPairFound = false;
            }
        }
    }

    // If key pair was found then the 'generateKeyPair' and 'importKeyPair' buttons are not rendered, and 
    // createPersonalKeysListener()' is not run.
    if (keyPairFound){
        let listElementToDelete = document.querySelector('.collection-keys .create-new');
        listElementToDelete.setAttribute('hidden', true);
        let keysCollectionHeader = document.querySelector('.collection-keys .collection-header');
        let html = `
            <li class="collection-item current-key-pair avatar">
                <i class="material-icons circle">vpn_key</i>
                <span class="public"><strong>Public Key: ${publicKeyName}</strong></span>
                <p class="private">Private Key: ${privateKeyName}</p>
                <a class="secondary-content">
                    <button class = 'export-key-pair btn waves-effect waves-light'>Export Key Pair</button>
                    <button class = 'delete-key-pair btn waves-effect waves-light'>Delete Key Pair</button>
                </a>
            </li>
        `;
        keysCollectionHeader.insertAdjacentHTML('afterend', html);

        // Add event listeners to the 'ExportKeyPair' and 'DeleteKeyPair' buttons.
        let insertedItem = document.querySelector('.collection-keys').querySelector('.current-key-pair');
        let exportKeyPairButton = insertedItem.querySelector('a .export-key-pair');
        let deleteKeyPairButton = insertedItem.querySelector('a .delete-key-pair');

        deleteKeyPairButton.addEventListener('click', async (e) => {
            await Encrypt.deleteKeyFolder(app.getPath('userData'));
            e.target.parentNode.parentNode.outerHTML = '';
            listElementToDelete.removeAttribute('hidden');
            materialize.toast({html: 'Removed previous PGP keypair from the app.', displayLength : 2000, classes: 'rounded'});
        });

        exportKeyPairButton.addEventListener('click', async (e) => {
            materialize.toast({html: 'Exporting PGP keypair ...', displayLength : 1000, classes: 'rounded'});
            let exportedPublicKey = fs.read(publicKeyName);
            let exportedPrivateKey = fs.read(privateKeyName);
            
             // Choose folder to save.
            let saveFolder;
            let dialogPromise = new Promise ((resolve,reject) => {
                ipcRenderer.send('saveAttachment', `PGP Keypair`);
                ipcRenderer.on('saveFolder', (event, data) => { 
                    saveFolder = data;
                    if (!saveFolder) reject(new Error('Cancelled'));
                    else resolve(data);
                });
            });
        
            try {
                saveFolder = await dialogPromise;
                saveFolder = String(saveFolder).toString() + '/';

                let publicKeyPath = saveFolder + '/' + publicKeyName;
                let privateKeyPath = saveFolder + '/' + privateKeyName;
                jetpack.write(publicKeyPath, exportedPublicKey);
                jetpack.write(privateKeyPath, exportedPrivateKey);
                materialize.toast({html: 'PGP Keypair was exported to the selected path.', displayLength : 1400, classes: 'rounded'});
            } catch (error) {
                logger.error(error);
            }
        });
    }
    else {
        // Since no keypair was found, we delete everything from the keys directory for safety.
        logger.debug('Deleting all account key leftovers (if they exist) for safety.');
        Encrypt.deleteKeyFolder(app.getPath('userData'));

        // This means that the createNewKeypair and importKeyPair buttons will be rendered and 
        // the 'createPersonalKeysListener()' function inside the ContextBridge will create all the
        // appropriate event listeners.
        return false; 
    }
}

