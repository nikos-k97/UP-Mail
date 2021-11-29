const jetpack = require('fs-jetpack');
//const $       = require('jquery');

const app = window.app;

//Constructor function
function StateManager () {
  // Set cwd for jetpack module to app.getPath('userData') instead of the directory that the project is saved.
  // cwd: current working directory
  // app.getPath('userData'):    C:\Users\xxx\AppData\Roaming\project-xxx (OS: Windows)
  this.storeDir = jetpack.cwd(app.getPath('userData'));
  this.state = this.storeDir.read('./state.json', 'json') || { state: 'new' };
/*
{
  "state": "mail",
  "account": {
    "hash": "9c6ab7112801d9d3eadf36f0d6c19477",
    "email": "nick-test1@outlook.com",
    "folder": [
      {
        "name": "Inbox",
        "delimiter": "/"
      }
    ]
  }
}
*/
}


// ** PROTOTYPE PROPERTY **
// ************************
// The constructor function Foobar() has its own prototype, which can be found by calling Object.getPrototypeOf(Foobar).
// (the __proto__ attribute is deprecated since ECMAScript 2015) 
// This differs from its prototype property, Foobar.prototype, which is the blueprint for instances of this constructor function.
// If we were to create a new instance — let fooInstance = new Foobar() — fooInstance would take its prototype from its 
// constructor function's prototype property. Thus Object.getPrototypeOf(fooInstance) === Foobar.prototype.
// Note: The prototype chain is traversed only while retrieving properties. If properties are set or deleted directly on the object, 
// the prototype chain is not traversed.

// ** MODIFYING PROTOTYPE PROPERTY OF A CONSTRUCTOR FUNCTION **
// ************************************************************
// Methods added to the prototype are then available on all object instances created from the constructor.
// Performing 'delete Person.prototype.farewell' would remove the farewell() method from all Person instances.
// In order to mitigate this issue, one could use Object.defineProperty() instead.

// **CONSTRUCTOR PROPERTY **
// *************************
// Every constructor function has a prototype property whose value is an object containing a constructor property. 
// This constructor property points to the original constructor function.
// Properties defined on the Person.prototype property (or in general on a constructor function's prototype property,
// which is an object, as mentioned in the above section) become available to all the instance objects created using the
// Person() constructor. Hence, the constructor property is also available to both person1 and person2 objects.

/**
 * Sets and saves a state value to the state file.
 *
 * @param  {string} value
 * @param  {all} option
 * @return {undefined}
 */
StateManager.prototype.change = function (option, value) {
  this.state[option] = value;
  this.storeDir.write('state.json', this.state);
}

/**
 * State check is called when the current state changes, and handles switching
 * between the states.
 *
 * @return {undefined}
 */
StateManager.prototype.update = function () {
  switch (this.state.state) {
    case 'new':
      logger.debug(`This is a new user. Welcome them to the application.`);
      router.navigate('/welcome');
      break;
    case 'mail':
      logger.debug(`This user has logged in. Show them their email.`);
      router.navigate('/mail');
      break;
    default:
      logger.warning(`Unknown state?  This should never happen.  The state was ${state.state}`);
  }
}

/**
 * This function enables an array of CSS files, 
 * whilst disabling the rest.
 *
 * @param  {array} titles
 * @return {undefined}
 */

/*
StateManager.prototype.style = function (titles) {
  for (let i = 0; i < document.styleSheets.length; i++) {
    let shouldEnable = titles.includes(document.styleSheets[i].ownerNode.getAttribute('data-name')) || document.styleSheets[i].ownerNode.getAttribute('data-name').includes('all-')

    document.styleSheets[i].disabled = !shouldEnable

    if (titles.includes(document.styleSheets[i].ownerNode.getAttribute('data-name'))) {
      titles.splice(titles.indexOf(document.styleSheets[i].ownerNode.getAttribute('data-name')), 1)
    }
  }
  if (titles.length) {
    logger.error(`Warning, ${titles} was/were not found within the list of stylesheets.`)
    logger.log(document.styleSheets)
  }
}
*/
/**
 * Page handles all our application state switching by enabling
 * and disabling CSS, and loading the HTML into the body of the
 * application
 *
 * @param  {string} page
 * @param  {array} css
 * @return {undefined}
 */
/*
StateManager.prototype.page = function (page, css) {
  logger.debug(`Switching page to ${page}`)
  $('#content').html(appDir.read(`./app/${page}.html`))
  this.style(css)
}
*/

module.exports = new StateManager()