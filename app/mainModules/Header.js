const jetpack   = require('fs-jetpack');

function Header (app, BrowserWindow) {
  this.app = app;
  this.BrowserWindow = BrowserWindow;
}

//'Header.prototype.load' instead of 'Header.load' since an instance of 'Header' is created in preload.js
Header.prototype.load = function () {
  let appDir = jetpack.cwd(this.app.getAppPath());

  // **Select 'header' id from 'mainWindow.html'**
  // 'app.js' is loaded from 'mainWindow.html' (which is loaded from electron). Then 'app.js' calls header.load 
  // (where header is an instance of Header - thats why prototype is used) which performs a querySelector to find
  // the '#header' id
  document.querySelector('#header').innerHTML = appDir.read(`./app/html/header.html`); //innerHTML : forces us to use 'unsafe inline' for style in CSP
    
  document.getElementById('min-btn').addEventListener('click', 
    (e) => { 
      this.BrowserWindow.getFocusedWindow().minimize();
    }
  );
  document.getElementById('max-btn').addEventListener('click', 
    (e) => {
      let remoteWindow = this.BrowserWindow.getFocusedWindow();
      remoteWindow.isMaximized() ? remoteWindow.unmaximize() : remoteWindow.maximize();
    }
  );
  document.getElementById('close-btn').addEventListener('click', 
    (e) => { 
      this.BrowserWindow.getFocusedWindow().close() ;
    }
  );

}

Header.setLoc = function (parts) {
  parts = ['Femto'].concat(parts);

  let html = '';
  for (let i = 0; i < parts.length; i++) {
    html += `<a href="#!" class="breadcrumb">${parts[i]}</a>`;
  }

  $('#title').html(html);
}

module.exports = Header;