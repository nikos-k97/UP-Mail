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

// Used in MailPage.prototype.render() and in compose.js renderer process.
Header.setLoc = function (parts) {
  parts = ['Mail Client'].concat(parts);

  let html = '';
  for (let i = 0; i < parts.length; i++) {
    html += `<a href="#!" class="breadcrumb">${parts[i]}</a>`;
  }

  document.querySelector('#title').innerHTML = html;
}


Header.showTLSBar = function (tls, serverName){
  let tlsContainer = document.querySelector('.TLS-bar-container');
  let tlsBar = document.querySelector('#TLS-bar');
  tlsBar.classList.remove('hidden');
  tlsContainer.classList.remove('hidden');
  if (tls){
    if (tlsBar.classList.contains("red")) tlsBar.classList.remove("red");
    if (!tlsBar.classList.contains("yellow")) tlsBar.classList.add("yellow");
    tlsBar.innerHTML = `Connected to server :&nbsp; <strong>${serverName}</strong>. Session is encrypted with TLS.`;
  }
  else {
    if (tlsBar.classList.contains("yellow")) tlsBar.classList.remove("yellow");
    if (!tlsBar.classList.contains("red")) tlsBar.classList.add("red");
    tlsBar.innerHTML = `Connected to server :&nbsp; <strong>${serverName}</strong>. Session is not encrypted with TLS. `;
  }
}

Header.hideTLSBar = function(){
  let tlsBar = document.querySelector('#TLS-bar');
  let tlsContainer = document.querySelector('.TLS-bar-container');
  tlsBar.classList.add('hidden')
  tlsContainer.classList.add('hidden')
}

module.exports = Header;