// Renderer process for mainWindow. 
// Has access only to the modules and functions exposed by contextBridge (via 'window.api.xxxxx').

window.api.loadHeader();
window.api.navigate('/initialize');


// Autonomous custom element <e-mail>.
customElements.define('e-mail', class extends HTMLElement {
  constructor () {
    super();

    const shadowRoot = this.attachShadow({ mode: 'open' });
    // <e-mail> element's content is updated dynamically via 'MailPage.js' render() method.

  }


});
  

// window.api.send('toMain', 'Test data from renderer process',2);

// window.api.receive('fromMain', (...data) => {
//     console.log(`Received ${data} from main process`);
// });


