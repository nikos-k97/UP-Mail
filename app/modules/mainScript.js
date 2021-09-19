    //renderer process
    const electron = require('electron');
    const {ipcRenderer} = electron;
    const ul = document.querySelector('ul');
    console.log(window);
    //Catch add item from main.js (webcontents.send)
    ipcRenderer.on('item:add',(e,item)=>{
        const li = document.createElement('li');
        const liText = document.createTextNode(item);
        li.appendChild(liText);
        ul.appendChild(li);
    });

    //Catch clear items
    ipcRenderer.on('item:clear',()=>{
        ul.innerHTML='';
    });

    //Remove individual item - no need to send anything
    ul.addEventListener('dblclick',(e)=>{
        e.target.remove();
    })
