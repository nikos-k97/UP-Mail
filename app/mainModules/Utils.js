const { DateTime } = require("luxon"); //Wrapper for JavaScript dates and times - Replacement of 'moment.js'
const crypto = require('crypto');
const util = require('util');
const Clean = require("./Clean");
const _ = require('lodash');

function Utils(app, logger) {
  this.app = app;
  this.logger = logger;
}

/* @arr array you want to listen to
   @callback function that will be called on any change inside array
 */
Utils.listenPushinArray = function(arr,callback){
  //splice
  ['push'].forEach((m)=>{
    arr[m] = function(){
      let res = Array.prototype[m].apply(arr, arguments);  // call normal behaviour
      callback.apply(arr, arguments);  // finally call the callback supplied
      return res;
    }
  });
}
Utils.listenSpliceinArray = function(arr,callback){
  //splice
  ['splice'].forEach((m)=>{
    arr[m] = function(){
      let res = Array.prototype[m].apply(arr, arguments);  // call normal behaviour
      callback.apply(arr, arguments);  // finally call the callback supplied
      return res;
    }
  });
}

/**
 * Convert a template string into HTML DOM nodes
 * @param  {String} str The template string
 * @return {Node}       The template HTML
 */
Utils.prototype.stringToHTML = function (str) {
  var parser = new DOMParser();
  var doc = parser.parseFromString(str, 'text/html');
  return doc.body;
};


Utils.prototype.stripStringOfNonNumericValues = function (str) {
  return str.replace(/\D/g, '');
}

/**
 * Tests whether the setup has been completed.
 *
 * @param  {string} page
 * @return {undefined}
 */
Utils.prototype.testLoaded = function (page) {
  // setupComplete is a global variable defined in 'SetupPage.js' - it's set to true after a successful setup page load
  if (typeof setupComplete === 'undefined' || !setupComplete) {
    this.logger.warning(`Tried to load ${page}, but setup hasn't been completed yet, likely caused by the user refreshing the page.`);
    return false;
  }
  return true;
}

/**
 * Simple object check.
 * 
 * @param item
 * @returns {boolean}
 */
Utils.prototype.isObject = function (item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

Utils.prototype.getCircularReplacer = () => {
  const seen = new WeakSet();
  return (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    return value;
  };
};


/**
 * Removes any circular elements from an object, replacing them with "Circular".
 *
 * @param  {object} object
 * @return {object}
 */
Utils.prototype.removeCircular = function (object) {
  // Get string representation of object 
  // depth : null to recurse up to the maximum (nested object depth)
  var str = util.inspect(object, { depth: null });
  str = str
    .replace(/<Buffer[ \w\.]+>/ig, '"buffer"')
    .replace(/\[Function]/ig, 'function(){}')
    .replace(/\[Circular]/ig, '"Circular"')
    .replace(/\{ \[Function: ([\w]+)]/ig, '{ $1: function $1 () {},')
    .replace(/\[Function: ([\w]+)]/ig, 'function $1(){}')
    .replace(/(\w+): ([\w :]+GMT\+[\w \(\)]+),/ig, '$1: new Date("$2"),')
    .replace(/(\S+): ,/ig, '$1: null,');
  return JSON.parse(JSON.stringify((new Function('return ' + str + ';'))()));
}

Utils.prototype.md5 = (string) => {
  return crypto.createHash('md5').update(string).digest('hex');
}

/**
 * Time the runtime of a function, waits for a promise to end if it is a promise.
 *
 * @param {function} func
 * @return {undefined}
 */
Utils.prototype.time = async function (func) {
  let start = performance.now();
  let promise = func();
  if (promise instanceof Promise) {
    await promise;
  }
  let end = performance.now();
  let run = end - start;
  if (run < 1000) {
    this.logger.log(`The ${func.name}() function took ${parseFloat(run.toFixed(4))} milliseconds to run.`);
  } else {
    this.logger.warning(`Alert, running ${func.name}() took a long time, ${parseFloat(run.toFixed(4))} milliseconds.`);
  }
  if (promise instanceof Promise) {
    return await promise;
  }
  return promise;
}


/**
 * Compare arrays.
 *
 * @param {Array} a  First array
 * @param {Array} b  Second array
 * @return {boolean}   
 */
Utils.compareArrays = function (a, b) {
  return _.isEqual(a, b);
}

/**
 * Find elements which are there in a[] but not in b[].
 *
 * @param {Array} a  The array that contains the values
 * @param {Array} b  The array that doesnt contain the values
 * @return {Array}   Array with the values that are present in the first array but not in the second
 */
Utils.findMissing = function (a, b) {
  let result = (a.filter(x => !b.includes(x)));
  return result || [];
}


/**
 * Grab all the values from a form and returns them as an object.
 *
 * @param  {string} id
 * @return {object}
 */
Utils.prototype.getItemsFromForm = function (form) {
  let values = {};

  for (let i = 0; i < form.elements.length; i++) {
    let e = form.elements[i];
    if (!['login'].includes(e.name) && e.name !== '') {
      // If it's a checkbox, work out if it's checked, else get it's value.
      values[e.name] = Clean.cleanForm(e.type) && Clean.cleanForm(e.type) === 'checkbox' ? e.checked : Clean.cleanForm(e.value);
    }
  }

  // Reformat data received from form.
  let loginInfo = {
    imap: {
      host: values.host_incoming,
      port: values.port_incoming,
      tls: values.tls_incoming === 'tls' ? true : false
    },
    smtp: {
      host: values.host_outgoing,
      port: values.port_outgoing,
      tls: values.tls_outgoing, //'starttls'-'tls'-'unencrypted' not true-false like IMAP
      name: values.outgoing_name
    },
    user: values.user,
    password: values.password,
    hash: this.md5(values.user),
    date: + new Date()
  };

  return loginInfo;
}

function isToday(date) {
  let now = DateTime.now();
  return date.hasSame(now, 'day');
}

function isWithinAWeek(date) {
  let now = DateTime.now();
  return date.hasSame(now, 'week');
}

function isWithinAMonth(date) {
  let now = DateTime.now();
  return date.hasSame(now, 'month');
}

function isWithinAYear(date) {
  let now = DateTime.now();
  return date.hasSame(now, 'year');
}

Utils.prototype.alterDate = function (date) {
  let messageTime = DateTime.fromISO(new Date(date).toISOString()).setLocale('en-us');
  if (isToday(messageTime)) return messageTime.toFormat('hh:mm a');
  if (isWithinAWeek(messageTime)) return messageTime.toFormat('ccc hh:mm a');
  if (isWithinAMonth(messageTime)) return messageTime.toFormat('ccc dd/LL');
  if (isWithinAYear(messageTime)) return messageTime.toFormat('dd/LL/yy');
  return messageTime.toFormat('dd/LL/yy');
}

Utils.prototype.createNewMailElement = function (mail) {
  let html = `
        <div class="mail-item">
        <div class="text ${mail.flags.includes('\\Seen') ? `read` : `unread`}">
          <div class="sender">
            <div class="sender-text left-align">${Clean.escape(
    (mail.envelope.from === undefined || mail.envelope.from === null) ? 'Unknown Sender' :
      `${mail.envelope.from[0].mailbox}@${mail.envelope.from[0].host} (${mail.envelope.from[0].name})`)}
            </div>
          </div>
          <div class="subject">
            <div class="subject-text center-align">${mail.threadMsg && mail.threadMsg.length ? `(${mail.threadMsg.length + 1})` : ``} ${Clean.escape(mail.envelope.subject)}
            </div>
          </div>
          <div class="date teal-text right-align">${this.alterDate(mail.date)}
          </div>
        </div>
        <div id="message-holder"></div>
      </div>
  

      <style>

  
        .read {
          color: rgb(117, 117, 117);
        }

        .unread {
          font-weight: bolder;
        }

        .mail-item {
          cursor: pointer;
          padding: 2px 18px 2px 18px;
          background-color: #FFF;
          max-width: 100%;
          min-width: 100%;
          width: 100%;
          height: fit-content;
          border-radius : 3px;
          border: 0.5px solid rgb(224, 224, 224);
        }


        .mail-item:hover {
          filter: brightness(90%);
        }

        .mail-item .text {
          cursor: pointer;
          display: flex;
          align-items: center;
          max-width: 100%;
          min-width: 100%;
          width: 100%;
          height: 100%;
          min-height: 32px;
        }

        .mail-item .text .sender {
          display: block;
          align-items: center;
          width: 40%;
          height: 100%;
        }

        .mail-item .text .sender .sender-text {
          display: block;
          width: 90%;
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
        }


        .mail-item .text .subject {
          display: block;
          align-items: center;
          width: 50%;
          height: 100%;
        }
        .mail-item .text .subject .subject-text {
          display: block;
          width: 90%;
          text-overflow: ellipsis ;
          white-space: nowrap;
          overflow: hidden;
          padding-left : 3px;
        }

        .mail-item .text .date {
          width: 10%;
          display: block;
          padding-left : 3px;
          white-space: nowrap;
          overflow : hidden;
          text-overflow: ellipsis;
        }

        .selected-mail-item {
          cursor: inherit;
          filter: brightness(100%) !important;
          align-items: center;
          padding: 2px 18px 2px 18px;
          max-width: 100%;
          min-width: 100%;
          width: 100%;
          border-radius : 3px;
          border: 1.5px solid rgb(255, 193, 7);
          background-color: rgb(250, 250, 250)
        }


        .selected-mail-item .text {
          cursor: pointer;
          align-items: center;
          font-weight: bolder;
          max-width: 100%;
          min-width: 100%;
          width: 100%;
          border-radius : 3px;
        }

        .padding {

          padding: 10px 10px 10px 10px;
        }
        
      </style>
  `;
  return html;
}

Utils.prototype.createDescriptionItem = function () {
  let html = `

    <div class="description-item">

      <div class="text">
        <div class="sender">
          <div class="sender-text left-align">From</div>
        </div>
        <div class="subject">
          <div class="subject-text center-align">Subject</div>
        </div>
        <div class="date right-align">Date</div>
      </div>
    </div>

    <style>
          .description-item {
            display: flex;
            align-items: center ;
            padding: 2px 18px 2px 18px;
            background-color: rgb(97,97,97) ; 
            color : rgb(224, 224, 224) ;
            max-width: 100% ;
            min-width: 100% ;
            min-height: 35px;
            width: 100% ;
            height : 100% ;
            border-radius : 5px ;
            border: 0.5px solid rgb(97,97,97) ;
          }
          
    

          .description-item .text {
            display: flex ;
            align-items: center ;
            max-width: 100% ;
            min-width: 100% ;
            width: 100% ;
            height: 100% ;
          }
          .description-item .text .sender {
            display: flex ;
            align-items: center;
            width: 40% ;
            height: 100% ;
          }
          .description-item .text .sender .sender-text {
            display: flex ;
            width: 90% ;
          }
          .description-item .text .subject {
            display: flex ;
            align-items: center ;
            width: 50% ;
            height: 100% ;
          }
          .description-item .text .subject .subject-text {
            display: flex ;
            width: 90% ;
            padding-left : 3px ;
          }
          .description-item .text .date {
            width: 10% ;
            display: flex ;
            padding-left : 3px ;
          }

         
    </style>
  `;
  return html;
}

module.exports = Utils;