function Threader () {}
  
/**
 * Removes extraneous information from a message array and passes this information to
 * Threader.generateReplyMap, which retrieves all threads from it.
 * @param  {array}  messages [An array of message objects (with envelopes)]
 * @return {array}           [An array of threads found within the messages array]
 */
Threader.applyThreads = (messages) => {
  console.log(messages)
  let messageThreads = {};
  for (let i = 0; i < messages.length; i++) {
    /*
    An envelope includes the following fields (a value is only included in the response if it is set).
      -date :         is a date (string) of the message
      -subject :      is the subject of the message
      -from :         is an array of addresses from the from header
      -sender :       is an array of addresses from the sender header
      -reply-to :     is an array of addresses from the reply-to header
      -to :           is an array of addresses from the to header
      -cc :           is an array of addresses from the cc header
      -bcc :          is an array of addresses from the bcc header
      -in-reply-to :  is the message-id of the message is message is replying to
      -message-id :   is the message-id of the message
    */
    if (messages[i].envelope.messageId) {
      messageThreads[messages[i].uid] = {
        messageId: messages[i].envelope.messageId, // Is the message-id of the message
        inReplyTo: messages[i].envelope.inReplyTo || undefined // Is the message-id of the message this message is replying to
      };
    }

  }
  console.log(messageThreads)
  return Threader.generateReplyMap(messageThreads);
}

/**
 * Retrieves all threads from an array of customised messages objects (Threader.applyThreads)
 * @param  {array}  messages [An array of specialised message objects]
 * @return {array}           [An array of threads within that array of message objects]
 */
Threader.generateReplyMap = (messages) => {
  let uids = {};
  // For each email present in the database:
  // 1. Fill the 'uids' object -> For each message's 'messageId' (envelope field) store the message's 'UID'
  //    We end up with an object like this:
  //    >>>  uids[CURRENT_MESSAGE_ID] = CURRENT_MESSAGE_UID
  for (let [uid, message] of Object.entries(messages)) {
    uids[message.messageId] = uid;
  }
 
  // For each email present in the database:
  // 2. Fill the children object -> If message.inReplyTo exists (message.inReplyTo != undefined)
  //    then we are looking in the 'uids' object above to find a message that has 'messageId' = 'message.inReplyTo'.
  //    The message we find is the parent of the current message, so the current message is the child.
  //    We end up with an object like this:
  //    >>>  children[undefined[], PARENT_UID[]] .  
  //         It has an array with name 'undefined' which contains all the CHILD_UID without a parent (CHILD_UID is the current message)
  //          >>> undefined[0] = FIRST_CHILD_UID_WITHOUT_PARENT
  //          >>> ...
  //         And it contains several other arrays with name PARENT_UID which contain the CHILD_UIDs with that parent
  //          >>> FIRST_PARENT_UID[] : 
  //                FIRST_PARENT_UID[0] = FIRST_CHILD_UID_OF_THE_FIRST_PARENT
  //                FIRST_PARENT_UID[1] = SECOND_CHILD_UID_OF_THE_FIRST_PARENT
  //          >>> SECOND_PARENT_UID[] :
  //                SECOND_PARENT_UID[0] = FIRST_CHILD_UID_OF_THE_SECOND_PARENT
  //                SECOND_PARENT_UID[1] = SECOND_CHILD_UID_OF_THE_SECOND_PARENT
  let children = {};
  for (let [uid, message] of Object.entries(messages)) {
    let parentId = uids[message.inReplyTo];
    // 'parentId' is undefined if 'message.inReplyTo = undefined'. So the [] is picked in this case so that
    //  push() doesnt throw an error. The uid is pushed to the 'undefined' array described above.
    children[parentId] = children[parentId] || []; 
    children[parentId].push(uid);
  }
  
  // Try to find the whole parent-child hierarchy. Each parent has all the childs that originated from it
  // inside the array named after the parent.
  let result = {};
  for (let child of children[undefined]) {
    result[child] = Threader.findAllChildren(child, children);
  }

  // Delete possible empty object properties.
  return Threader.cleanObject(result);
}

/**
 * Find all children within an array
 * @param  {array}  root     [ID of element we're searching for]
 * @param  {object} children [An object of children objects]
 * @return {array}           [A result of found children]
 */
Threader.findAllChildren = (root, children) => {
  // Parent messages are children without parents.
  // So start with a child with no parents (from the undefined array). See if it has children
  // (if it is a parent itself - the other arrays). Find its child (uid).
  let result = children[root] || [];

  // If childs were found, add it to its parents array of childs. Recursion with the child.
  // If we find a child for the child, then its also a child for the parent.
  for (let child of result) {
    result = result.concat(Threader.findAllChildren(child, children));
  }
  return result;
}

/**
 * Clean an object of all null items
 * @param  {object} obj [Dirty object with null values]
 * @return {object}     [Clean object without]
 */
Threader.cleanObject = (obj) => {
  for (let propName in obj) {
    if (typeof obj[propName] === 'object' && obj[propName].length === 0) {
      delete obj[propName];
    }
  }
  return obj;
}

module.exports = Threader;