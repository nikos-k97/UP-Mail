//Renderer process 
//Has access only to the modules and functions exposed by contextBridge

//window.api.logger('warning','Hello!')
window.api.loadHeader();


window.api.navigate('/setup');

  
// window.api.send('toMain', 'Test data from renderer process',2);

// window.api.receive('fromMain', (...data) => {
//     console.log(`Received ${data} from main process`);
// });


