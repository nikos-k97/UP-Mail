//--- Main (Electron) Process / runs in a complete Node.js environment / has access to Node API ---

// Creates and manages instances of the BrowserWindow class.
// Each BrowserWindow instance creates an application window/Renderer Process that loads a web page.
// Main Process can interact with each Renderer Processes web page via the BrowserWindows's 'webContents' object.

'use strict'
const path                                               = require("path");
const electron                                           = require('electron');
const {app, BrowserWindow, Menu, ipcMain, shell, dialog} = electron;
const createWindow                                       = require('./app/helperModules/window');
const Logger                                             = require('./app/helperModules/logger'); 
const logger                                             = new Logger({}, app);
const URL                                                = require('url').URL;
const remoteMain                                         = require("@electron/remote/main");
remoteMain.initialize();

//Global object in Node.js is the 'module.exports' object
global.logger = logger; //logger is now visible into all modules that main.js uses (not in renderer processes/ preload)

//Sets node environment variable
process.env.NODE_ENV = 'development'; //or production

//If in development mode enables dotenv and adds debug features like HotKeys for triggering Dev Tools and reload.
if (process.env.NODE_ENV === 'development') {
    //require('dotenv').config();
    //const { port } = require('./app/config');
    //console.log(port);
   require('electron-debug')({ showDevTools: true }); //not necessery since we display the menu in development mode
};

// Keep a global reference of the window object, otherwise the window will
// be closed automatically when the JavaScript object is garbage collected.
let appWindows = []; 

//Listening to the 'ready' event of the application.
//This event is fired only once when Electron has done initializing the application and app windows can be safely created.
//Wait for the event and then call openWindow() when app's whenReady() method resolves its promise
app.whenReady().then(() => {
    openWindow('appWindow');
}).catch((error) => {
    logger.error(error);
})


//The 'window-all-closed' event is emitted when the last opened window of the application is closed.
//On Windows and Linux when all app windows are closed then the whole app is closed.
//Quits the application except on macOS since it contradicts the default behavior of macOS.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit(); 
    }
});

//'activate' event -> macOS specific / fired when the application icon from the dock is clicked.
//Closing all windows in macOS doesn’t close the application (main process).
//So opens a window (if none are already opened) when the application is activated again.
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) { 
        openWindow('appWindow'); 
    }
});


/*
    -> Disable or limit navigation (in the current window)
    Navigation is a common attack vector. If an attacker can convince your app to navigate away from its 
    current page, they can possibly force your app to open web sites on the Internet. Even if your webContents 
    are configured to be more secure (like having nodeIntegration disabled or contextIsolation enabled), getting
    your app to open a random web site will make the work of exploiting your app a lot easier.
*/
app.on('web-contents-created', (event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
        const parsedUrl = new URL(navigationUrl);
        //if (parsedUrl.origin !== 'https://my-own-server.com') {
        event.preventDefault()
    })
})
      

/*
    -> Disable or limit creation of new windows (instead open these links on the browser)
    Much like navigation, the creation of new webContents is a common attack vector. 
    Attackers attempt to convince your app to create new windows, frames, or other renderer processes 
    with more privileges than they had before; or with pages opened that they couldn't open before.
*/ 
app.on('web-contents-created', (event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
        // Ask the operating system to open this event's url in the default browser.
        // 'isSafeForExternalOpen' is a custom function that simply checks if the url contains 'https://'.
        // A trusted URL will be opened in the default browser. Since emails usually have links inside,
        // we assign the user with the risk of opening the links. From our part, we only allow HTTPS protocol,
        // and we redirect to the browser, since Javascript inside browsers doesnt have access to OS.
        if (isSafeForExternalOpen(url)) {
            setImmediate(() => {
                shell.openExternal(url);
            })
        }
        return { action: 'deny' };
    })
})


function isSafeForExternalOpen(url){
    if (url.includes('https://')) return true;
    else return false;
}

function openWindow (file) {
    let index = file === 'appWindow' ? 0 : appWindows.length; //mainWindow is always at index 0 of the appWindows array
    const {width, height} = electron.screen.getPrimaryDisplay().workAreaSize;


    if (file === 'appWindow'){
        //Use window.js helper script to create and open the electron.js BrowserWindow
        appWindows[index] = createWindow(file, {
            width,
            height,
            icon: './icons/email-icon.png',
            title:'Mail Client', //overriden by the loaded html's <title/> tag (!!)
            minWidth: 1050,
            minHeight: 600,
            maximized: true,
            frame: false,
            show:false, //false until all content is loaded -> becomes true -> window is visible without loading times
            webPreferences: {
                preload: path.join(__dirname, "/app/preload_app.js"), // use a preload script - safely get and set file system and 
                                                                      // operating system values on behalf of the browser window.
                sandbox: false, // extreme protection - deny access to Node.js API and extremely limits access to electron API.
                                // (only in conjunction with preload script - otherwise only IPC messages are permitted)
                contextIsolation: true, // force the creation of a separate JavaScript world for each browser window /
                                        // prevent prototype pollution attacks - manipulating prototype chain in an untrusted
                                        // browser window, in order to surreptitiously gain control over trusted code in a sibling browser window.
                nodeIntegration: false, // deny the renderer process access to the node.js API
                enableRemoteModule: false //turn off remote (redundant, since Remote module was removed at electron.js v14)
            }
        });
    }
    else if (file === 'composeWindow'){
        //Use window.js helper script to create and open the electron.js BrowserWindow
        appWindows[index] = createWindow(file, {
            width: 950,
            height: 900,
            icon: './icons/email-icon.png',
            title:'Compose', //overriden by the loaded html's <title/> tag (!!)
            minWidth: 500,
            minHeight: 490,
            maximized: false,
            maximizable : false,
            fullscreenable : false,
            maxWidth: 950,
            maxHeight: 1000,
            frame: false,
            show:false, //false until all content is loaded -> becomes true -> window is visible without loading times
            webPreferences: {
                preload: path.join(__dirname, "/app/preload_compose.js"), // Preload is a mechanism to execute code before renderer scripts are loaded.
                                                                          // safely get and set file system and 
                                                                          // operating system values on behalf of the browser window.
                sandbox: false, // extreme protection - deny access to Node.js API and extremely limits access to electron API.
                                // (only in conjunction with preload script - otherwise only IPC messages are permitted)
                contextIsolation: true, // force the creation of a separate JavaScript world for each browser window /
                                        // prevent prototype pollution attacks - manipulating prototype chain in an untrusted
                                        // browser window, in order to surreptitiously gain control over trusted code in a sibling browser window.
                nodeIntegration: false, // deny the renderer process access to the node.js API
                enableRemoteModule: false //turn off remote (redundant, since Remote module was removed at electron.js v14)
            }
        });
    }
    else if (file === 'keysWindow'){
        //Use window.js helper script to create and open the electron.js BrowserWindow
        appWindows[index] = createWindow(file, {
            width: 950,
            height: 900,
            icon: './icons/email-icon.png',
            title:'Contacts & Keys', //overriden by the loaded html's <title/> tag (!!)
            minWidth: 720,
            minHeight: 720,
            maximized: false,
            maximizable : false,
            fullscreenable : false,
            maxWidth: 1050,
            maxHeight: 1000,
            frame: false,
            show:false, //false until all content is loaded -> becomes true -> window is visible without loading times
            webPreferences: {
                preload: path.join(__dirname, "/app/preload_keys.js"), // Preload is a mechanism to execute code before renderer scripts are loaded.
                                                                          // safely get and set file system and 
                                                                          // operating system values on behalf of the browser window.
                sandbox: false, // extreme protection - deny access to Node.js API and extremely limits access to electron API.
                                // (only in conjunction with preload script - otherwise only IPC messages are permitted)
                contextIsolation: true, // force the creation of a separate JavaScript world for each browser window /
                                        // prevent prototype pollution attacks - manipulating prototype chain in an untrusted
                                        // browser window, in order to surreptitiously gain control over trusted code in a sibling browser window.
                nodeIntegration: false, // deny the renderer process access to the node.js API
                enableRemoteModule: false //turn off remote (redundant, since Remote module was removed at electron.js v14)
            }
        });
    }
  
    appWindows[index].once('ready-to-show', () => {
        appWindows[index].show(); //all content is loaded -> window can be shown
    });

    // For @electron.remote.
    remoteMain.enable(appWindows[index].webContents);

    
    //Load .html content from html folder.
    //The file:// protocol is used to load a file from the local filesystem.
    //loadURL method can also use 'http' protocol to load a webpage etc.
    appWindows[index].loadURL(`file://${__dirname}/app/html/${file}.html`);


    //Passing an arguement to the event listener is tricky since it invokes the function rather than declaring it.
    //without arguements - function is not invoked: appWindows[index].on('closed', testFunction);
    //with arguements - function is invoked: appWindows[index].on('closed', testFunction(arg1,arg2) );
    
    //Solution 1: Using 'bind' method. Downside (for browser js) is that event listener cannot be removed. 
    appWindows[index].on('closed', onQuit.bind(null, index) );

    //Solution 2: appWindows[index].on('closed', wrapperFunction(index));
    //   or       
    //            appWindows[index].on('closed', ( (i) => () => {onQuit(i)} ) (index) );
    //
    //Invokes the first outer function so the console.log(i) is printed. Returns the reference
    //to the inner function for it to be used when the 'closed' event is emmited. 
    //This way uses function currying to pass an arguement to the event listener
        // function wrapperFunction(i){
        //     console.log(i);
        //     return function(){
        //         onQuit(i)
        //     }
        // };

    //Solution 3: appWindows[index].on('closed', function() { onQuit(index) });
    //Wrap the function in another function. The outer function is not invoked. Downside of this way is that
    //the scope is constantly changed.
   
    //Build menu from the template
    const appMenu = Menu.buildFromTemplate(appMenuTemplate);
    //Insert menu to the app
    Menu.setApplicationMenu(appMenu);
    if (file === 'composeWindow' || file === 'keysWindow'){
        appWindows[index].setMenu(null);
    }
    
    // appWindows[index].once('did-finish-load', () => { //or dome-ready
    //     // Send Message
    //  });
    // appWindows[index].webContents.on('did-finish-load', () => {
    //     //appWindows[index].webContents.send('message', 'hello world');
    // });

    // ipcMain.on('toMain', (event, ...args) => {
    //     console.log('[Main Process] event: '+event.sender+' args: '+args);
    //     // Send result back to renderer process
    //     let responseObj = 1;
    //     appWindows[index].webContents.send('fromMain', responseObj, 3, JSON.stringify({sti:3}), 'hi');
    // });
}


// Open compose window, but limit the capability of the user to create new Windows indefinetely.
ipcMain.on('open', (event, arg) => {
    // When we close a window, it still remains in the appWindows array, but with null data (e.g. appWindows[2] = null).
    // So we need to calculate the number of 'useful' windows (windows with non null content) before
    // we decide to disallow the creation of a new window.
    let usefulAppWindowsNo = 0;
    for (let i=0; i < appWindows.length; i++){
        if (appWindows[i]) usefulAppWindowsNo ++;
    }
    
    if (usefulAppWindowsNo < 4){
        openWindow(arg.file);
    }
});


// Choose folder to save attachment.
ipcMain.on('saveAttachment', (event, file) => {
    let options = {
        title: `Choose directory to save file : ${file} `,
        buttonLabel: 'Choose',
        defaultPath : app.getPath('downloads'),
        properties: ['openDirectory']
    }
    // The browserWindow argument allows the dialog to attach itself to a parent window, making it modal.
    let filepath = dialog.showOpenDialogSync(appWindows[event.frameId], options);
    event.sender.send('saveFolder', filepath);
})

// Choose file and send its path to the renderer.
ipcMain.on('selectFile', (event) => {
    let options = {
        title: `Choose the file to import:`,
        buttonLabel: 'Choose',
        defaultPath : app.getPath('downloads'),
        properties: ['openFile']
    }
    // The browserWindow argument allows the dialog to attach itself to a parent window, making it modal.
    let filepath = dialog.showOpenDialogSync(appWindows[event.frameId], options);
    event.sender.send('fileSelected', filepath);
})



function onQuit (index) { //index = windowNumber
    //If not on MacOS then when the last window closes the app terminates and all the windows are garbage collected.
    //The if statement is true only if 'windowNumber'== 0 (when main application window / process is closed).
    //If on MacOS or if it's not the mainWindow, then only the current window closes and is garbage collected.
    if (process.platform !== 'darwin' && !index) {
        appWindows.map( windowNum => {return null} );
        app.quit()
    }
   
    appWindows[index] = null;
    logger.log(`Window number ${index} closed.`); // logger.error prints the text in red etc...
};


//Create menu template
const appMenuTemplate = [
    {
        label:'File',
        submenu:[
            {
                label:'Add Item',
                click(){
                    //openWindow('addWindow');
                }
            },
            {
                label:'Clear Items',
                click(){
                    mainWindow.webContents.send('item:clear');
                }
            },
            {
                label:'Quit',
                accelerator: process.platform==='darwin' ? 'Command+Q' : 'Ctrl+Q',
                click(){
                    app.quit();
                }
            }
        ]
    }
];

//If macOS add empty object to menu to get rid of 'Electron' tab
if (process.platform === 'darwin'){
    appMenuTemplate.unshift({});
}

//Add developer tools tabs if not in production
if (process.env.NODE_ENV !== 'production'){
    appMenuTemplate.push({
        label:'Developer Tools',
        submenu:[
            {
                label:'Toggle dev tools',
                accelerator: process.platform === 'darwin' ? 'Command+I' : 'Ctrl+I',
                click(item,focusedWindow){
                    focusedWindow.toggleDevTools();
                }
            },
            {
                role:'reload'
            }
        ]
    });
}
