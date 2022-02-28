const {DateTime}    = require("luxon"); //Wrapper for JavaScript dates and times - Replacement of 'moment.js'
const crypto        = require('crypto');
const util          = require('util');
const Clean         = require("./Clean");
const _             = require('lodash');

function Utils (app,logger) {
  this.app = app;
  this.logger = logger;
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
  return str.replace(/\D/g,'');
}

/**
 * Tests whether the setup has been completed.
 *
 * @param  {string} page
 * @return {undefined}
 */
Utils.prototype.testLoaded = function(page) {
  // setupComplete is a global variable defined in 'SetupPage.js' - it's set to true after a successful setup page load
  if (typeof setupComplete === 'undefined' || ! setupComplete) {
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
 Utils.compareArrays = function(a,b) {
  return _.isEqual(a, b);
 }

/**
 * Find elements which are there in a[] but not in b[].
 *
 * @param {Array} a  The array that contains the values
 * @param {Array} b  The array that doesnt contain the values
 * @return {Array}   Array with the values that are present in the first array but not in the second
 */
Utils.findMissing = function(a,b) {
  let result = ( a.filter(x => !b.includes(x)) );
  return result || [];
}


/**
 * Grab all the values from a form and returns them as an object.
 *
 * @param  {string} id
 * @return {object}
 */
Utils.prototype.getItemsFromForm = function(form){
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
      host : values.host_incoming,
      port : values.port_incoming,
      tls : values.tls_incoming === 'tls' ? true : false
    },
    smtp: {
      host : values.host_outgoing,
      port : values.port_outgoing,
      tls : values.tls_outgoing, //'starttls'-'tls'-'unencrypted' not true-false like IMAP
      name: values.outgoing_name 
    },
    user: values.user,
    password : values.password,
    hash: this.md5(values.user),
    date: + new Date()
  };

  return loginInfo;
}

function isToday (date) {
  let now = DateTime.now();
  return date.hasSame(now, 'day');
}

function isWithinAWeek (date) {
  let now = DateTime.now();
  return date.hasSame(now, 'week');
}

function isWithinAMonth (date) {
  let now = DateTime.now();
  return date.hasSame(now, 'month');
}

function isWithinAYear (date) {
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

module.exports = Utils;