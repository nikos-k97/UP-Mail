// This helper remembers the size and position of the windows (and restores them in that place after app relaunch).
// Can be used for more than one window, just construct many instances of it and give each different name.

module.exports = function (name, options) {
  const {app, BrowserWindow, screen} = require('electron');
  const jetpack = require('fs-jetpack');
  
  // Set cwd for jetpack module to app.getPath('userData') instead of the directory that the project is saved.
  // cwd: current working directory
  // app.getPath('userData'):    C:\Users\xxx\AppData\Roaming\project-xxx
  let userDataDir = jetpack.cwd(app.getPath('userData'));                                                  
  let stateStoreFile = 'window-state-' + name + '.json'; //name: name of the window
  let defaultSize = {
    width: options.width,
    height: options.height,
    maximized: true
  };
  let state = {};
  let win;

  let restore = function () {
    let restoredState = {};
    try {
      restoredState = userDataDir.read(stateStoreFile, 'json');
    } catch (err) {
      //For some reason json can't be read (might be corrupted). No worries, we have defaults (the options parameters).
    }
    //Return the cloned object that is made from merging 'defaultSize' and 'restoredState' objects.
    //'restoredState' is second in the 'Object.assign()' call so it overrides the 'defaultSize' properties (if the .json is successfully read).
    return Object.assign({}, defaultSize, restoredState);
  }


  let getCurrentPosition = function () {
    let position = win.getPosition();
    let size = win.getSize();
    return {
      x: position[0],
      y: position[1],
      width: size[0],
      height: size[1]
    };
  };


  let windowWithinBounds = function (windowState, bounds) {
    return windowState.x >= bounds.x &&
      windowState.y >= bounds.y &&
      windowState.x + windowState.width <= bounds.x + bounds.width &&
      windowState.y + windowState.height <= bounds.y + bounds.height
  };


  let resetToDefaults = function (windowState) {
    let bounds = screen.getPrimaryDisplay().bounds;
    return Object.assign({}, defaultSize, {
      x: (bounds.width - defaultSize.width) / 2,
      y: (bounds.height - defaultSize.height) / 2
    });
  };


  let ensureVisibleOnSomeDisplay = function (windowState) {
    let visible = screen.getAllDisplays().some(function (display) {
      return windowWithinBounds(windowState, display.bounds);
    });
    if (!visible) {
      // Window is partially or fully not visible now -> Reset it to safe defaults.
      return resetToDefaults(windowState);
    };
    return windowState;
  }


  let saveState = function () {
    if (!win.isMinimized() && !win.isMaximized()) {
      Object.assign(state, getCurrentPosition());
    };
    Object.assign(state, { maximized: win.isMaximized() });
    userDataDir.write(stateStoreFile, state, { atomic: true });
  };


  let previous = restore();
  if (!previous.maximize) {
    state = ensureVisibleOnSomeDisplay(previous);
  };


  state = Object.assign({}, options, state); //clone the merged <options,state> objects into the new state object (second arguement overrides first-default-options)
  logger.log(`Loading ${name} with the following state:`);
  logger.log(state);
  win = new BrowserWindow(state);
  win.on('close', saveState);
  if (state.maximized) {
    win.maximize();
  }
  return win;
}
