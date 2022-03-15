//--- Main (Electron) Process / runs in a complete Node.js environment / has access to Node API ---

// Creates and manages instances of the BrowserWindow class.
// Each BrowserWindow instance creates an application window/Renderer Process that loads a web page.
// Main Process can interact with each Renderer Processes web page via the BrowserWindows's 'webContents' object.

'use strict'
const path = require("path");
const electron = require('electron');
const {app, BrowserWindow, Menu, ipcMain, shell} = electron;
const remoteMain = require("@electron/remote/main");
remoteMain.initialize();
const createWindow = require('./app/helperModules/window');
const Logger = require('./app/helperModules/logger'); 
const logger = new Logger({}, app);

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
            minWidth: 320,
            minHeight: 480,
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
            minHeight: 450,
            maximized: false,
            maximizable : false,
            fullscreenable : false,
            maxWidth: 950,
            maxHeight: 900,
            frame: false,
            show:false, //false until all content is loaded -> becomes true -> window is visible without loading times
            webPreferences: {
                preload: path.join(__dirname, "/app/preload_compose.js"), // use a preload script - safely get and set file system and 
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

    remoteMain.enable(appWindows[index].webContents);

    //  Force external links (URLs) to be opened in the OS default browser insted of beeing opened inside electon.
    // 'new-window' is fired when external links are clicked. 
    appWindows[index].webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
      });
      
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
    if (file === 'compose'){
        appWindows[index].setMenu(null);
    }
    
    appWindows[index].once('did-finish-load', () => { //or dome-ready
        // Send Message
     });
    appWindows[index].webContents.on('did-finish-load', () => {
        //appWindows[index].webContents.send('message', 'hello world');
    });

    // ipcMain.on('toMain', (event, ...args) => {
    //     console.log('[Main Process] event: '+event.sender+' args: '+args);
    //     // Send result back to renderer process
    //     let responseObj = 1;
    //     appWindows[index].webContents.send('fromMain', responseObj, 3, JSON.stringify({sti:3}), 'hi');
    // });
}


ipcMain.on('open', (event, arg) => {
    openWindow(arg.file);
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
