const sanitizeHTML = require('sanitize-html');

function Clean () {}

/*
  According to OWASP (https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html#rule-4-css-encode-and-strictly-validate-before-inserting-untrusted-data-into-html-style-property-values)
  the safe HTML attributes are : 
    align, alink, alt, bgcolor, border, cellpadding, cellspacing, class, color, cols, colspan, coords, dir, 
    face, height, hspace, ismap, lang, marginheight, marginwidth, multiple, nohref, noresize, noshade, nowrap,
    ref, rel, rev, rows, rowspan, scrolling, shape, span, summary, tabindex, title, usemap, valign, value, vlink, 
    vspace, width
*/
const htmlAllowed = {
  allowedTags: [ 'html', 'meta', 'body', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'p',
    'nl', 'li', 'b', 'i', 'strong', 'em', 'strike', 'hr', 'br', 'div',
    'table', 'thead', 'caption', 'tbody', 'tr', 'th', 'td', 'pre', 'style',
    'a', 'ul', 'ol', 'span', 'center'],
  allowedAttributes: {
    // We're tentatively allowing inline-css for now.
    '*': [ 'data-*', 'style', 'align', 'bgcolor', 'class', 'height', 'width', 'alt' ],
    a: [ 'href', 'name', 'target', 'title'],
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