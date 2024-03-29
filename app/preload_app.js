// Secure way of importing node.js modules into the renderer process (app.js) - 
// Renderer process has access only to the modules - instances of modules that are defined in the contextBridge.
const {contextBridge, ipcRenderer}  = require("electron");
const {app, BrowserWindow}          = require('@electron/remote');
const Navigo                        = require("navigo");
const Logger                        = require('./helperModules/logger'); 
const StateManager                  = require('./mainModules/StateManager'); //Contains the current state
const Utils                         = require('./mainModules/Utils'); //Contains many utility functions
const Header                        = require('./mainModules/Header');


// Avoid global variables by creating instances with parameters. For example nearly every module loaded by the preload
// script has the 'app' dependacy (accessible via' @electron/remote' only inside the preload script). Instead of making
// 'app' global and accessible in all the modules, app is passed as a parameter to the created instances.
// (Global variables defined inside the preload script are accessible by only the modules loaded by the preload script
// which means they are undefined at the 'browser' side - 'app.js' and undefined on the electron side - 'main.js' ).
const router = new Navigo('/');
const logger = new Logger({}, app); 
const utils = new Utils(app, logger);
const header = new Header(app, BrowserWindow);
const stateManager = new StateManager(app, ipcRenderer, logger, utils, router);


router.on(
    {
        // When the reference of a method is used, it's no longer attached to the object. 
        // It's just a reference to a plain function. The 'this' keyword inside 'setupPage.load' method (SetupPage.js)
        // is therefore 'global' (in this particular occasion) and not equal to the parent object/ "class". 
        // So 'bind' method is neccesary in order to set the correct context for 'this' keyword.
        '/initialize': () => { utils.time(stateManager.initialize.bind(stateManager)) },
        '/new': () => { utils.time(stateManager.welcomePage.load.bind(stateManager.welcomePage)) },
        '/existing': () => { utils.time(stateManager.accountManager.existingAccount.bind(stateManager.accountManager)) } 
    }
).resolve();

router.notFound(() => {
    logger.error('Route not found!');
});

// Add an 'already' hook to the each route. When the router is already at the given path, it is redirected again.
router.addAlreadyHook('/initialize', () => {
    utils.time(stateManager.initialize.bind(stateManager));
});
router.addAlreadyHook('/new', () => {
    utils.time(stateManager.welcomePage.load.bind(stateManager.welcomePage));
});
router.addAlreadyHook('/existing', () => {
    utils.time(stateManager.accountManager.existingAccount.bind(stateManager.accountManager));
});


// Expose protected methods that allow the renderer process to use the ipcRenderer without exposing the entire object.
// Proxy-like API -> instead of assigning values straight to window object - functions can be ovverriden in javascript. 
// A determined attacker could modify the function definition and then the backend (ie. main.js code) would not be safe.
// As long as the proxy only passes through simple values, and not Node.js objects, the preload script can safely get 
// and set file system and operating system values on behalf of the browser window.
contextBridge.exposeInMainWorld(
    'api', {
        send: (channel, ...data) => {
            const whiteListChannels = ['toMain'];
            if (whiteListChannels.includes(channel)) {
                ipcRenderer.send(channel, ...data);
            }
        },
        receive: (channel, func) => {
            const whiteListChannels = ['fromMain'];
            if (whiteListChannels.includes(channel)) {
                // Deliberately strip event as it includes `sender` 
                ipcRenderer.on(channel, (event,...args) => {return func(...args)});
            }
        },
        logger : (mode, data) => {
            if (mode === 'success') logger.success(data);
            else if (mode === 'error') logger.error(data);
            else if (mode === 'warning') logger.warning(data);
            else if (mode === 'log') logger.log(data);
            else if (mode === 'info') logger.info(data);
            else if (mode === 'debug') logger.debug(data);
        },
        loadHeader : () => {
            header.load();
        },

        navigate : (endpoint) => {
            router.navigate(endpoint);
        }
    }
);



