// Renderer process for composeWindow. 
// Has access only to the modules and functions exposed by contextBridge (via 'window.api.xxxxx').


window.api.loadHeader();
window.api.setLoc('Compose');
window.api.loadContent();
window.api.formatFormSelectElement();
// On form submit (user presses 'send') setSendHandler is executed.
window.api.setSendHandler();

