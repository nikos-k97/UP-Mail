//--- Main (Electron) Process / runs in a complete Node.js environment / has access to Node API ---

// Creates and manages instances of the BrowserWindow class.
// Each BrowserWindow instance creates an application window/Renderer Process that loads a web page.
// Main Process can interact with each Renderer Processes web page via the BrowserWindows's 'webContents' object.

'use strict'
const electron = require('electron');
const {app, BrowserWindow, Menu, ipcMain, shell} = electron;
const createWindow = require('./app/helpers/window');
// Allows app to be accessible globally -> adds 'electron.app' to the global scope.
// app API/module controls application's lifecycle
global.app = app;
require('./app/helpers/logger'); //Adds global logging.


let appWindows = []; //Prevents being garbage collected -> manual garbage collection


//Sets environment variables
process.env.NODE_ENV = 'development'; //or production

//If in development mode adds debug features like HotKeys for triggering Dev Tools and reload.
if (process.env.NODE_ENV === 'development') {
    require('dotenv').config();
    require('electron-debug')({ showDevTools: true }); //not necessery since we display the menu in development mode
};


//Listening to the 'ready' event of the application.
//This event is fired only once when Electron has done initializing the application and app windows can be safely created.
//Wait for the event and then call openWindow() when app's whenReady() method resolves its promise
app.whenReady().then(() => {
    openWindow('mainWindow');
    //electron.globalShortcut.register('CmdOrCtrl+Shift+C', () => {
    //    openWindow('compose')
    //})
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
        openWindow('mainWindow'); 
    }
});


function openWindow (file) {
    let index = file === 'mainWindow' ? 0 : appWindows.length; //mainWindow is always at index 0 of the appWindows array
    const {width, height} = electron.screen.getPrimaryDisplay().workAreaSize;
    
    //Use window.js helper script to create and open the BrowserWindow
    appWindows[index] = createWindow(file, {
        width,
        height,
        icon: 'build/email-icon.png',
        title:'Mail Client', //overriden by the loaded html's <title/> tag
        minWidth: 320,
        minHeight: 480,
        maximized: true,
        frame: true,
        show:false,
        webPreferences: {
            contextIsolation: false, //security
            nodeIntegration: true //allows renderer process access to the node.js API
        }
    });

    appWindows[index].once('ready-to-show', () => {
        appWindows[index].show();
    });

    //Load .html content from html folder.
    //The file:// protocol is used to load a file from the local filesystem.
    //loadURL method can also use http protocol to load a webpage etc.
    appWindows[index].loadURL(`file://${__dirname}/app/html/${file}.html`);
 

    //Event handlers on 'close' events.
    appWindows[index].on('close',() => {
        //Do something
    });

  
    appWindows[index].on('closed', 
    (   (i) => ()  =>  {onQuit(i)}     )(index) 
    );


    //Build menu from the template
    const mainMenu = Menu.buildFromTemplate(mainMenuTemplate);
    //Insert menu to the app
    Menu.setApplicationMenu(mainMenu);



    //windows[index].webContents.on('new-window', handleURL);
    //windows[index].webContents.on('will-navigate', handleURL);
}

function onQuit (windowNumber) {
    //If not on MacOS then when the last window closes the app terminates and all the windows are garbage collected.
    //The if statement is true only if 'windowNumber'== 0 (when main application window / process is closed).
    //If on MacOS or if it's not the mainWindow, then only the current window closes and is garbage collected.
    if (process.platform !== 'darwin' && !windowNumber) {
        appWindows.map( (windowNum) => {return null} );
        app.quit()
    }
    appWindows[windowNumber] = null;
    logger.log(`Window number ${windowNumber} closed.`);
};



//Handle create add window
function createAddWindow(){
    addWindow = new BrowserWindow({
        width:200,
        height:200,
        title:'Add item',
        webPreferences: {
            contextIsolation: true, //security
            nodeIntegration: false
        }
    });
    //Load html file into the window
    addWindow.loadURL(url.format(
        {
            pathname:path.join(__dirname,'app/html/addWindow.html'),
            protocol:'file:',
            slashes: true
        } 
    ));
    //Garbage collection handle
    addWindow.on('close',()=>{
        addWindow=null;
    });
    addWindow.setMenu(null);
}


//Catch item:add with ipcMain (sent from addWindow.html with ipcRenderer)
ipcMain.on('item:add',(e,item)=>{
    //Send it to the main window (mainWindow.html)
    mainWindow.webContents.send('item:add',item);
    addWindow.close();
});



//Create menu template
const mainMenuTemplate = [
    {
        label:'File',
        submenu:[
            {
                label:'Add Item',
                click(){
                    openWindow('addWindow');
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
    mainMenuTemplate.unshift({});
}

//Add developer tools tabs if not in production
if (process.env.NODE_ENV !== 'production'){
    mainMenuTemplate.push({
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