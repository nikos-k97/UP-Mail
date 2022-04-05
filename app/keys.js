// Renderer process for keysWindow. 
// Has access only to the modules and functions exposed by contextBridge (via 'window.api.xxxxx').

window.api.loadHeader();
window.api.setLoc('Contacts & Keys');
window.api.loadContent();
window.api.createNewContactListener();
window.api.createPersonalKeysListener();

