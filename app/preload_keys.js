// Secure way of importing node.js modules into the renderer process (compose.js) - 
// Renderer process has access only to the modules - instances of modules that are defined in the contextBridge.
const {contextBridge}              = require("electron");
const {app, BrowserWindow, dialog} = require('@electron/remote');
const Datastore                    = require('@rmanibus/nedb'); // Use a NeDB fork since original NeDB is deprecated.
const Promise                      = require('bluebird');
const jetpack                      = require('fs-jetpack');
const materialize                  = require("./helperModules/materialize.min.js");
const Logger                       = require('./helperModules/logger'); 
const Header                       = require('./mainModules/Header');
const Clean                        = require('./mainModules/Clean');
const Utils                        = require('./mainModules/Utils');
const ContactsManager              = require('./mainModules/ContactsManager');


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
        }
    }
);
