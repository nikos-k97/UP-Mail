const sanitizeHTML = require('sanitize-html');

function Clean () {}

const htmlAllowed = {
  allowedTags: [ 'html', 'meta', 'body', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'p',
    'nl', 'li', 'b', 'i', 'strong', 'em', 'strike', 'code', 'hr', 'br', 'div',
    'table', 'thead', 'caption', 'tbody', 'tr', 'th', 'td', 'pre', 'style',
    'a', 'ul', 'ol', 'span', 'center', ],
  allowedAttributes: {
    // We're tentatively allowing inline-css for now.
    '*': [ 'data-*', 'style', 'align', 'bgcolor', 'class', 'height', 'width', 'alt' ],
    a: [ 'href', 'name', 'target' ],
    img: [ 'src' ]
  },
  selfClosing: [ 'img', 'br', 'hr', 'area', 'base', 'basefont', 'input', 'link', 'meta' ],
  allowedSchemes: [ 'http', 'https', 'ftp', 'mailto' ],
  allowedSchemesByTag: {},
  allowProtocolRelative: true
};

Clean.escape = function (string) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };

  if (string) {
    return string.replace(/[&<>"']/g, function (m) { return map[m] });
  } 
  else {
    return undefined;
  }
}

Clean.cleanHTML = (dirty) => {
  return sanitizeHTML(dirty, htmlAllowed);
}

Clean.cleanForm = (dirty) => {
  const htmlAllowedInForm = {
    allowedTags : [],
    allowedAttributes : [],
    allowedClasses: [],
    allowedSchemes : [],
    allowedScriptDomains: [],
    allowedScriptHostnames : [],
    allowedIframeHostnames : [],
    allowedIframeDomains: [],
    allowProtocolRelative: false
  };
  return sanitizeHTML(dirty, htmlAllowedInForm);
}

module.exports = Clean;