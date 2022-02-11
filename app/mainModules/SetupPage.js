const jetpack = require('fs-jetpack');

/**
 * Setup is called when the application is run, it retrieves required
 * databases and files, and works out the current state.
 */
function SetupPage (app,logger,stateManager) {
  this.app = app;
  this.logger = logger;
  this.stateManager = stateManager;
}

SetupPage.prototype.load = function() {
  const appDir = jetpack.cwd(this.app.getAppPath());
  const storeDir = jetpack.cwd(this.app.getPath('userData'));


  this.logger.log(`Application Paths Found:
    App Dir   - ${this.app.getAppPath()}
    Store Dir - ${this.app.getPath('userData')}
    Temp Dir  - ${this.app.getPath('temp')}`)
  this.logger.debug(`Other Paths Found:
    Exe Path  - ${this.app.getPath('exe')}
    Desktop   - ${this.app.getPath('desktop')}
    Documents - ${this.app.getPath('documents')}`)

  // refreshAllAccounts()
  // setInterval(refreshAllAccounts, 300000)

  global.setupComplete = true;
  this.logger.debug(`Setup complete, the configuration file has been read and the databases have been loaded.`)

  this.stateManager.update();
}

module.exports = SetupPage;
