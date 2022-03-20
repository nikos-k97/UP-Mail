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
const nonStrictHTMLAllowed = {
  /*Allowing either script or style leaves us open to XSS attacks. */
  allowedTags: ["address", "article", "aside", "footer", "header", "h1", "h2", "h3", "h4",
    "h5", "h6", "hgroup", "main", "nav", "section", "blockquote", "dd", "div",
    "dl", "dt", "figcaption", "figure", "hr", "li", "main", "ol", "p", "pre",
    "ul", "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn",
    "em", "i", "kbd", "mark", "q", "rb", "rp", "rt", "rtc", "s", "samp",
    "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "caption",
    "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "center",
    "img", "style"],
  allowedAttributes: {
    /*
      According to OWASP (https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html#rule-4-css-encode-and-strictly-validate-before-inserting-untrusted-data-into-html-style-property-values)
      the safe HTML attributes are : 
    */
    '*': [ 'data-*', 'align', 'alink', 'alt', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'class', 'color',
    'cols', 'colspan', 'coords', 'dir', 'face', 'height', 'hspace', 'ismap', 'lang', 'marginheight', 'marginwidth', 
    'multiple', 'nohref', 'noresize', 'noshade', 'nowrap', 'ref', 'rel', 'rev', 'rows', 'rowspan', 'scrolling', 
    'shape', 'span', 'summary', 'tabindex', 'title', 'usemap', 'valign', 'value', 'vlink', 'vspace', 'width',
    'style','src'],
    a: [ 'href', 'name', 'target', 'title'],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height']
  },
  selfClosing: ['br', 'hr', 'area', 'base', 'basefont', 'input', 'link'],
  // data is for inline images
  allowedSchemes: ['https', 'file'],
  allowedSchemesByTag: {
    // The file: URL scheme refers to a file on the client machine
    img: [ 'file']
  },
  allowProtocolRelative: true,
  // Discard all characters outside of html tag boundaries -- before <html> and after </html> tags.
  enforceHtmlBoundary: true,
  // If a tag that belong to the following list is not allowed, all of the text within it is not preserved, neither do any allowed tags within it.
  nonTextTags: ['script', 'textarea', 'option'],
  disallowedTagsMode: 'discard'
}



const strictHTMLAllowed = {
  /*Allowing either script or style leaves us open to XSS attacks. */
  allowedTags: ["address", "article", "aside", "footer", "header", "h1", "h2", "h3", "h4",
    "h5", "h6", "hgroup", "main", "nav", "section", "blockquote", "dd", "div",
    "dl", "dt", "figcaption", "figure", "hr", "li", "main", "ol", "p", "pre",
    "ul", "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn",
    "em", "i", "kbd", "mark", "q", "rb", "rp", "rt", "rtc", "s", "samp",
    "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "caption",
    "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "center"],
  allowedAttributes: {
    /*
      According to OWASP (https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html#rule-4-css-encode-and-strictly-validate-before-inserting-untrusted-data-into-html-style-property-values)
      the safe HTML attributes are : 
    */
    '*': [ 'data-*', 'align', 'alink', 'alt', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'class', 'color',
    'cols', 'colspan', 'coords', 'dir', 'face', 'height', 'hspace', 'ismap', 'lang', 'marginheight', 'marginwidth', 
    'multiple', 'nohref', 'noresize', 'noshade', 'nowrap', 'ref', 'rel', 'rev', 'rows', 'rowspan', 'scrolling', 
    'shape', 'span', 'summary', 'tabindex', 'title', 'usemap', 'valign', 'value', 'vlink', 'vspace', 'width'],
    a: [ 'href', 'name', 'target', 'title'],
  },
  selfClosing: ['br', 'hr', 'area', 'base', 'basefont', 'input', 'link', 'meta' ],
  allowedSchemes: ['https'],
  allowedSchemesByTag: {},
  allowProtocolRelative: true,
  // Discard all characters outside of html tag boundaries -- before <html> and after </html> tags.
  enforceHtmlBoundary: true,
  // If a tag that belong to the following list is not allowed, all of the text within it is not preserved, neither do any allowed tags within it.
  nonTextTags: [ 'style', 'script', 'textarea', 'option', 'noscript' ],
  disallowedTagsMode: 'discard'
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

Clean.cleanHTMLStrict = (dirty) => {
  return sanitizeHTML(dirty, strictHTMLAllowed);
}

Clean.cleanHTMLNonStrict = (dirty) => {
  return sanitizeHTML(dirty, nonStrictHTMLAllowed);
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