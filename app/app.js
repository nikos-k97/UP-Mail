
window.api.send('toMain', 'Test data from renderer process',2);

window.api.receive('fromMain', (...data) => {
    console.log(`Received ${data} from main process`);
});

console.log(window.api.router);
console.log(window.api.app)