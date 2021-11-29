// Secure way of importing ipcRenderer (and other node.js modules) into the renderer process is with IPC 
// (inter-process-communication), which is Electron's way of allowing interaction between main and renderer processes.

const {app,contextBridge, ipcRenderer} = require("electron");
const Navigo = require("navigo");
//require('./app/helperModules/logger'); //Adds global logging.

// Expose protected methods that allow the renderer process to use the ipcRenderer without exposing the entire object.
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
        router : 5,
        app : app
    }
);



