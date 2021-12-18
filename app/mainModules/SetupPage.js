const jetpack = require('fs-jetpack');

/**
 * Tests whether the setup has been completed.
 *
 * @param  {string} page
 * @return {undefined}
 */
global.testLoaded = (page) => {
  if (typeof setupComplete === 'undefined' || !setupComplete) {
    logger.warning(`We tried to load ${page}, but setup hadn't completed yet, likely caused by the user refreshing the page.`)
    return false
  }
  return true
}

/**
 * Setup is called when the application is run, it retrieves required
 * databases and files, and works out the current state.
 *
 * @return {undefined}
 */
function SetupPage (app,logger,stateManager) {
  this.app = app;
  this.logger = logger;
  this.stateManager = stateManager;
}

SetupPage.prototype.load = function() {
  //global.appDir = jetpack.cwd(app.getAppPath())
  //global.storeDir = jetpack.cwd(app.getPath('userData'))

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
  this.logger.debug(`Setup complete, we've read the config file and loaded the databases.`)

  this.stateManager.update();
}

module.exports = SetupPage;
