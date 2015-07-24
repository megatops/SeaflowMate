// Seaflow Mate by Ding Zhaojie (zhading@cisco.com)
//
// ==UserScript==
// @name           Seaflow Mate
// @namespace      http://www.cisco.com
// @include        http://wwwin-sea.cisco.com/*
// @description    Some enhancements to Seaflow
// @version        1.5
// @grant          GM_xmlhttpRequest
// @grant          GM_addStyle
// ==/UserScript==

/**
 * I'm too lazy to implement a GUI so just add your branch fallback pairs here
 * manually.
 *
 * This feature is normally used to set the BinOS branch for IOS. When a symbol
 * search failed in current branch, the Seaflow Mate will try a fallback search
 * in the other branch. So the symbols which defined in BinOS could be previewed
 * seamlessly in IOS.
 */
function initFallbackTbl() {
    //              IOS               BinOS
    fallbackTbl.put("mcp_dev",        "main");
    fallbackTbl.put("mcp_cable_ios",  "main");
    fallbackTbl.put("cylons_p1a_ios", "main");
    fallbackTbl.put("cylons_p1b_ios", "main");
}

/**
 * Eclispe preview style:
 * Show function previewer when mouse over the symbol.
 *
 * Default preview style:
 * Show function previewer when mouse over with Shift/Ctrl key pressed.
 */
var eclipse_preview_style = false;

////////////////////////////////////////////////////////////////////////////////
// Add double click to select all in function input textbox
////////////////////////////////////////////////////////////////////////////////

var funcinput = document.getElementById("funcin");

if (funcinput != null) {
    if (funcinput.value == "nf_search_ext") {
        funcinput.value = "";
    }

    funcinput.addEventListener("dblclick", function (event) {
        funcinput.select();
    }, true);
}

////////////////////////////////////////////////////////////////////////////////
// Add inline previewer to symbol links
////////////////////////////////////////////////////////////////////////////////

var onPreview = false;
var onLink = false;
var previewShown = false;

function setOnLink() {
    onPreview = false;
    onLink = true;
}

function setOnPreview() {
    onPreview = true;
    onLink = false;
}

// Seems the DOMParser in Chrome cannot parse html directly.
(function (DOMParser) {
    "use strict";
    var DOMParser_proto = DOMParser.prototype,
        real_parseFromString = DOMParser_proto.parseFromString;

    // Firefox/Opera/IE throw errors on unsupported types
    try {
        // WebKit returns null on unsupported types
        if ((new DOMParser).parseFromString("", "text/html")) {
            // text/html parsing is natively supported
            return;
        }
    } catch (ex) {}

    DOMParser_proto.parseFromString = function (markup, type) {
        if (/^\s*text\/html\s*(?:;|$)/i.test(type)) {
            var doc = document.implementation.createHTMLDocument(""),
                doc_elt = doc.documentElement,
                first_elt;

            doc_elt.innerHTML = markup;
            first_elt = doc_elt.firstElementChild;

            if (doc_elt.childElementCount == 1
                && first_elt.localName.toLowerCase() == "html") {
                doc.replaceChild(first_elt, doc_elt);
            }
            return (doc);
        } else {
            return (real_parseFromString.apply(this, arguments));
        }
    };
} (DOMParser));

// Common map container to store result cache
function Map() {
    this.map = new Object();
    this.length = 0;

    this.size = function () {
       return (this.length);
    }

    this.put = function (key, value) {
        if (!this.map[key]) {
            this.length++;
        }
        this.map[key] = value;
    }

    this.remove = function (key) {
        if (this.map[key]) {
            this.length--;
            return (delete this.map[key]);
        } else {
            return (false);
        }
    }

    this.get = function (key) {
        return (this.map[key] ? this.map[key] : null);
    }
}

// Common regex parse function
function getRegexResult(regex, text, num, unesc) {
    var result = regex.exec(text);
    if (result != null) {
        if (unesc) {
            return (unescape(result[num]));
        } else {
            return (result[num]);
        }
    }
    return (null);
}

function getMousePos(event) {
    var x, y;
    var evt = event || window.event;
    return {
        x: evt.clientX + document.body.scrollLeft + document.documentElement.scrollLeft,
        y: evt.clientY + document.body.scrollTop + document.documentElement.scrollTop
    };
}

var protocol = "http://";
function getURL(href) {
    if (href.indexOf(protocol) != 0) {
        return (protocol + document.domain + "/" + href);
    }
    return (href);
}

var loadingStr = "<b>Loading...</b>";
var lastURL = "";
var digHistory = [];
var digBackID = "smBACK";

var digBackLink = document.createElement("a");
digBackLink.innerHTML = "&laquo; Back to caller";
digBackLink.setAttribute("id", digBackID);
digBackLink.setAttribute("href", "#");
digBackLink.setAttribute("style", "text-decoration: none;");

var digBackBar = document.createElement("div");
digBackBar.appendChild(digBackLink);

var digBackCSS = "display: none;"
               + "overflow: visible;";
digBackBar.setAttribute("style", digBackCSS);

var previewMain = document.createElement("div");
var preview = document.createElement("div");
var symCache = new Map();

preview.setAttribute("style", "position: fixed;             \
                               z-index: 9999;               \
                               display: none;               \
                               background: #ffffee;         \
                               border: 1px #d0d0d0 solid;   \
                               margin: 0;                   \
                               padding: 5px;                \
                               overflow: auto;");
preview.appendChild(digBackBar);
preview.appendChild(previewMain);


preview.onmouseover = function () {
    killTimers();
    setOnPreview();
};

preview.onmouseout = function (event) {
    killTimers();
    var cur = getMousePos(event);
    if ((cur.x < preview.offsetLeft)
        || (cur.x > preview.offsetLeft + preview.offsetWidth)
        || (cur.y < preview.offsetTop)
        || (cur.y > preview.offsetTop + preview.offsetHeight)) {
        onPreview = false;
        closePreview();
        return;
    }
    setOnPreview();
};

document.body.appendChild(preview);

function setPreviewPos(x, y) {
    if ((x + preview.offsetWidth) > window.innerWidth) {
        x = window.innerWidth - preview.offsetWidth;
    }
    if ((y + preview.offsetHeight) > window.innerHeight) {
        y = window.innerHeight - preview.offsetHeight;
    }
    preview.style.left = x + "px";
    preview.style.top = y + "px";
}

var SIZE_AUTO = 1;
var SIZE_BIG  = 2;
var SIZE_KEEP = 3;

function updatePreview(size, content, x, y) {
    var style = preview.style;

    style.maxWidth = (window.innerWidth * 2 / 3) + "px";
    style.maxHeight = (window.innerHeight * 2 / 3) + "px";

    if (size == SIZE_KEEP) {
        style.width = preview.offsetWidth - 12 + "px";
        style.height = preview.offsetHeight - 12 + "px";
    } else {
        style.width = "auto";
        style.height = "auto";

        if (size == SIZE_AUTO) {
            style.minWidth = "0px";
            style.minHeight = "0px";
        } else if (size == SIZE_BIG) {
            style.minWidth = (window.innerWidth * 1 / 3) + "px";
            style.minHeight = (window.innerHeight * 1 / 3) + "px";
        }
    }

    previewMain.innerHTML = content;
    style.display = "block";
    previewShown = true;
    if (size != SIZE_KEEP) {
        setPreviewPos(x, y);
    }
}

var fallbackTbl = new Map();
initFallbackTbl();

function getBranch(href) {
    return (getRegexResult(/[?&]b=(.*?)(&|$|#)/, href, 1, false));
}

function getFallback(branch) {
    return (fallbackTbl.get(branch));
}

function querySuccess(content) {
    return (content.indexOf('<span class="error big">') < 0);
}

function queryDone(content) {
    return ((content.indexOf('<td class="rightmain">') >= 0) || !querySuccess(content));
}

function cacheDone(url) {
    var cache = symCache.get(url);
    return ((cache != null) && (cache != loadingStr));
}

function responseSuccess(response) {
    return ((response.readyState == 4) && (response.status == 200));
}

function changeUrlBranch(url, oldBranch, newBranch) {
    return (url.replace("b=" + oldBranch, "b=" + newBranch));
}

var branch = getBranch(window.location.href);
var fallBack = getFallback(branch);
console.log(branch + " -> " + fallBack);

function showPreview(event, symUrl, isDigIn) {
    lastURL = symUrl;
    var cur = getMousePos(event);

    // Check the cache first, if hits, no need to send new request
    var cached = symCache.get(symUrl);
    if (cached != null) {
        updatePreview(isDigIn ? SIZE_KEEP : ((cached == loadingStr) ? SIZE_AUTO : SIZE_BIG),
                      cached, cur.x, cur.y);
        return;
    }

    // Send request to Seaflow
    updatePreview(isDigIn ? SIZE_KEEP : SIZE_AUTO, loadingStr, cur.x, cur.y);

    // Before do it, set the cache as loading to prevent duplicated requests
    symCache.put(symUrl, loadingStr);

    console.log("Ask Seaflow for " + symUrl);
    GM_xmlhttpRequest({
        method: "GET",
        url: symUrl,

        onreadystatechange: function (response) {
            if ((response.readyState < 3)
                || cacheDone(symUrl)
                || (!responseSuccess(response) && !queryDone(response.responseText))) {
                return;
            }

            var parser = new DOMParser();
            var dom = parser.parseFromString(response.responseText, "text/html");

            // get the function definition content
            var main = dom.getElementsByClassName("main");
            for (var i in main) {
                var content = main[i];
                if (content.tagName != "TD") {
                    continue;
                }

                /*
                 * Check if we need a fallback query:
                 * - Search failed in current branch, and
                 * - Current branch has fallback branch, and
                 * - We have not digged into a symbol from fallback branch.
                 */
                if (!querySuccess(content.innerHTML)
                    && (fallBack != null) && (getBranch(symUrl) == branch)) {
                    fallbackQuery(changeUrlBranch(symUrl, branch, fallBack),
                                  isDigIn, cur);
                    return;
                }

                // Add navigator in preview
                addNav(content, "smPOP");

                // Update the result in cache
                symCache.put(symUrl, content.innerHTML);

                // only display the matching request
                if (previewShown && (symUrl == lastURL)) {
                    updatePreview(isDigIn ? SIZE_KEEP : SIZE_BIG,
                                  content.innerHTML, cur.x, cur.y);
                }
                break;
            }
        },

        onerror: function (response) {
            // invalidate the cache item
            console.log("Drop cache " + symUrl);
            symCache.remove(symUrl);
        }
    });
}

function fallbackQuery(symUrl, isDigIn, cur) {
    console.log("[Fallback] Ask Seaflow for " + symUrl);
    GM_xmlhttpRequest({
        method: "GET",
        url: symUrl,

        onreadystatechange: function (response) {
            if ((response.readyState < 3)
                || cacheDone(symUrl)
                || (!responseSuccess(response) && !queryDone(response.responseText))) {
                return;
            }

            var parser = new DOMParser();
            var dom = parser.parseFromString(response.responseText, "text/html");

            // get the function definition content
            var main = dom.getElementsByClassName("main");
            for (var i in main) {
                var content = main[i];
                if (content.tagName != "TD") {
                    continue;
                }

                // Add navigator in preview
                addNav(content, "smPOP");

                // Update the result in cache
                var origURL = changeUrlBranch(symUrl, fallBack, branch);
                symCache.put(origURL, content.innerHTML);

                // only display the matching request
                if (previewShown && (origURL == lastURL)) {
                    updatePreview(isDigIn ? SIZE_KEEP : SIZE_BIG,
                                  content.innerHTML, cur.x, cur.y);
                }
                break;
            }
        },

        onerror: function (response) {
            // invalidate the cache item
            var origURL = changeUrlBranch(symUrl, fallBack, branch);
            console.log("Drop cache " + origURL);
            symCache.remove(origURL);
        }
    });
}

function hideAll() {
    preview.style.display = "none";
    previewShown = false;
    digBackBar.style.display = "none";
    digHistory = [];
}

function closePreview() {
    if (preview.innerHTML == loadingStr) {
        // close at once
        if (!onPreview && !onLink) {
            hideAll();
        }
        return;
    }
    closeTimer = window.setTimeout(function () {
        closeTimer = 0;
        if (!onPreview && !onLink) {
            hideAll();
        }
    }, 500);
}

var showTimer = 0;  // timer for delayed function preview
var closeTimer = 0; // timer for delayed preview close

function killTimers() {
    if (showTimer != 0) {
        window.clearTimeout(showTimer);
        showTimer = 0;
    }
    if (closeTimer != 0) {
        window.clearTimeout(closeTimer);
        closeTimer = 0;
    }
}

// Check if the event is occurred on the symbol url
function eventOnSymbolLink(event) {
    if (event.target.tagName.toUpperCase() != "A") {
        return (false);
    }

    var href = event.target.getAttribute("href");
    if ((href == null) || (href.indexOf("seaflow.pl?q=") < 0)) {
        return (false);
    }

    return (true);
}

// Simulate mouseover in mousemove
var mouseOver = false;

/**
 * Only show previewer with Shift/Ctrl pressed in default style, or
 * just show when mouseover in Eclipse style.
 *
 * Use mousemove instead of mouseover to show the
 * previewer more smooth. Or the user must hold Shift/Ctrl
 * key and move mouse out then back to trigger the Previewer.
 */
document.addEventListener("mousemove", function (event) {
    if (mouseOver
        || !(eclipse_preview_style || event.shiftKey || event.ctrlKey)
        || onPreview || !eventOnSymbolLink(event)) {
        return;
    }

    mouseOver = true;

    killTimers();
    setOnLink();

    var symUrl = getURL(event.target.getAttribute("href"));
    showTimer = window.setTimeout(function () {
        showTimer = 0;
        showPreview(event, symUrl, false);
    }, (eclipse_preview_style ? 500 : 200));
}, false);

// Hide symbol previewer when mouse out
document.addEventListener("mouseout", function (event) {
    mouseOver = false;

    if (onPreview || !eventOnSymbolLink(event)) {
        return;
    }

    killTimers();
    onLink = false;
    closePreview();
}, false);

// Show next function preview, and save the history
function digSymbol(event, symUrl) {
    if (event.target.id == digBackID) {
        // "<< Back to caller" clicked
        digHistory.pop();
    } else {
        digHistory.push(lastURL);
    }
    digBackLink.setAttribute("href",
                             (digHistory.length == 0) ? "#" : digHistory[digHistory.length - 1]);

    showPreview(event, symUrl, true);

    /*
     * We must show preview first, then handle the back div. Or the preview
     * div size might be changed due to we have not locked the size yet
     */
    digBackBar.style.display = (digHistory.length == 0) ? "none" : "block";

    event.stopPropagation();
    event.preventDefault();
}

// Capture the symbol click event in previewer
document.addEventListener("click", function (event) {
    if ((event.button != 0) || event.shiftKey || event.ctrlKey || !onPreview) {
        return; // if click with shift key pressed or not left click, do not hook it
    }

    if (!eventOnSymbolLink(event)) {
        return;
    }

    digSymbol(event, getURL(event.target.getAttribute("href")));
}, false);

////////////////////////////////////////////////////////////////////////////////
// Add navigator in results from multiple files
////////////////////////////////////////////////////////////////////////////////

function newNavLink(href, inner) {
    var link = document.createElement("a");
    link.setAttribute("href", href);
    link.innerHTML = inner;
    link.setAttribute("style", "text-decoration: none;  \
                                color: black;           \
                                background: #eeeeee;    \
                                text-align: left;");
    return (link);
}

/**
 * Add Navigation bar into DOM node.
 *
 * @param node      The DOM node to be processed
 * @param prefix    Namespace for inner anchors, used to avoid nameing conflict
 *                  in main page and symbol previewer
 */
function addNav(node, prefix) {
    var fileLinks = node.getElementsByClassName("biglink");
    var counter = fileLinks.length;

    if (fileLinks.length <= 1) {
        return;
    }

    // create top navigation bar
    var defaultItem = document.createElement("option");
    defaultItem.setAttribute("value", "#" + prefix + "TOP");
    defaultItem.setAttribute("selected", "selected");
    defaultItem.appendChild(document.createTextNode("< Jump to ... >"));

    var title = document.createElement("span");
    title.innerHTML = "<a name=" + prefix + "TOP></a><b>File List:&nbsp;</b>";

    var list = document.createElement("select");
    list.setAttribute("onchange", "location.href = this.options[this.selectedIndex].value;");
    list.appendChild(defaultItem);

    var bar = document.createElement("div");
    bar.setAttribute("style", "padding: 2px; background: #eeeeee; text-align: left;");
    bar.appendChild(list);
    bar.insertBefore(title, list);

    // we will insert new <a> into dom, so we must do it in reverse order
    for (var i = fileLinks.length - 1; i >= 0; i--) {
        var fileLink = fileLinks[i];

        // Add anchor and select item
        fileLink.setAttribute("name", prefix + counter);
        var item = document.createElement("option");
        item.setAttribute("value", "#" + prefix + counter);
        item.appendChild(document.createTextNode(fileLink.textContent));
        list.insertBefore(item, list.firstChild);

        // Add Prev/Next/Tops links before each title
        var parent = fileLink.parentNode;
        parent.insertBefore(newNavLink("#" + prefix + (counter - 1), "&nbsp;&laquo;&nbsp;"), fileLink);
        parent.insertBefore(newNavLink("#" + prefix + (counter + 1), "&nbsp;&raquo;&nbsp;"), fileLink);
        parent.insertBefore(newNavLink("#" + prefix + "TOP", "&nbsp;&uArr;&nbsp;"), fileLink);
        parent.insertBefore(document.createTextNode(" "), fileLink);

        counter--;
    }

    // Insert the navigation bar before the first item, and place the default item to first
    list.removeChild(defaultItem);
    list.insertBefore(defaultItem, list.firstChild);
    fileLinks[0].parentNode.insertBefore(bar, fileLinks[0].parentNode.firstChild);
}

addNav(document, "smDOC");

////////////////////////////////////////////////////////////////////////////////
// Change the document title to filename/function
////////////////////////////////////////////////////////////////////////////////

function getQueryName(href) {
    return (getRegexResult(/[?&]q=([^&]*)(&|$)/, href, 1, true));
}

function getQueryType(title) {
    return (getRegexResult(/.* - (Function|File|Symbols|Flow)/, title, 1, false));
}

function getFileName(path) {
    return (getRegexResult(/^.*\/([^\/]*)$/, path, 1, false));
}

var qName = getQueryName(window.location.href);
if (qName != null) {
    switch (getQueryType(document.title)) {
    case "File":
        var fName = getFileName(qName);
        if (fName != null) {
            qName = fName;
        }
        break;

    case "Function":
        qName += "()";
        break;

    default:
        break;
    }
    document.title = qName;
}

////////////////////////////////////////////////////////////////////////////////
// Modify main area font and width
////////////////////////////////////////////////////////////////////////////////

GM_addStyle("                             \
    .main {                               \
        width: 100% !important;           \
        min-width: 700px !important;      \
    }                                     \
    .rightmain {                          \
        min-width: 450px !important;      \
    }                                     \
    .tabindex {                           \
        left: auto !important;            \
        width: 420px !important;          \
    }                                     \
    pre {                                 \
        font-family: monospace !important;\
    }                                     \
");
