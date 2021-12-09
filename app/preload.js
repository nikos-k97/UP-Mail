// Secure way of importing node.js modules into the renderer process 
const {contextBridge, ipcRenderer} = require("electron");
const {app} = require('@electron/remote');
const Navigo = require("navigo");
const Logger = require('./helperModules/logger'); 


const logger = new Logger({}, app); //!!!!!! ALLAGH TOU APP ME TO APP.PATH


// Expose protected methods that allow the renderer process to use the ipcRenderer without exposing the entire object.
// Proxy-like API
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
        logger : (mode,data) => {
            if (mode === 'success') logger.success(data);
            else if (mode === 'error') logger.error(data);
            else if (mode === 'warning') logger.warning(data);
            else if (mode === 'log') logger.log(data);
            else if (mode === 'info') logger.info(data);
            else if (mode === 'debug') logger.debug(data);
        },
        router : 5,
        app:app,

    }
);



