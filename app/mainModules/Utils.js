const {DateTime} = require("luxon"); //Wrapper for JavaScript dates and times - Replacement of 'moment.js'
const crypto = require('crypto');
const util   = require('util');


function Utils (app,logger) {
  this.app = app;
  this.logger = logger;
}

/**
 * Tests whether the setup has been completed.
 *
 * @param  {string} page
 * @return {undefined}
 */
Utils.prototype.testLoaded = function(page) {
  //setupComplete is a global variable defined in 'SetupPage.js' - it's set to true after a successful setup page load
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
 * Grab all the values from a form and returns them as an object.
 *
 * @param  {string} id
 * @return {object}
 */
Utils.prototype.getItemsFromForm = (form) => {
  let values = {};

  for (let i = 0; i < form.elements.length; i++) {
    let e = form.elements[i];
    if (!['login'].includes(e.name)) {
      // If it's a checkbox, work out if it's checked, else get it's value.
      values[e.name] = e.type && e.type === 'checkbox' ? e.checked : e.value;
    }
  }
  return values;
}

function isToday (momentDate) {
  return momentDate.isSame(moment().clone().startOf('day'), 'd');
}

function isYesterday (momentDate) {
  return momentDate.isSame(moment().clone().subtract(1, 'days').startOf('day'), 'd');
}

function isWithinAWeek (momentDate) {
  // return momentDate.isAfter(moment().clone().startOf('week'))
  return momentDate.isAfter(moment().clone().subtract(7, 'days').startOf('day'));
}

function isWithinAYear (momentDate) {
  return momentDate.isAfter(moment().clone().startOf('year'));
}

Utils.prototype.alterDate = function (date) {
  let messageTime = moment(new Date(date).toISOString())
  if (isToday(messageTime)) return messageTime.format('hh:mmA');
  if (isYesterday(messageTime)) return 'Yesterday';
  if (isWithinAWeek(messageTime)) return messageTime.format('dddd');
  if (isWithinAYear(messageTime)) return messageTime.format('Do MMM');
  return messageTime.format('Do MMM YYYY');
}

module.exports = Utils;