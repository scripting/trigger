/*  Windows follow databases -- 8/8/26 by CC, DW's model. One SQL file
	holds everything, but a window never shows the merged root: it opens on
	ONE logical database (?database=nodeEditor.root, resolved through
	/getdatabases into a mount address or a list of top-level names), or
	rooted at a table address (?address=config, how the edit verb opens a
	table). With neither param the page shows the merged root -- a storage
	artifact, kept reachable for plumbing work but never the default.  */

var theScope; //assigned at startup: {title, address, names} -- what this window shows

function scopeStateKey () { //each window remembers its own expansions and scroll
	var theKey = "odbBrowserState";
	if (theScope.title !== "the odb") {
		theKey += ":" + theScope.title;
		}
	return (theKey);
	}

function resolveScope (callback) {
	const theParams = new URLSearchParams (window.location.search);
	const theDatabase = theParams.get ("database");
	const theAddress = theParams.get ("address");
	const theTitle = theParams.get ("title");
	if ((theDatabase !== null) && (theDatabase.length > 0)) {
		serverCall ("/getdatabases", {}, "GET", function (err, data) {
			if (err !== undefined) {
				callback (err);
				return;
				}
			var found;
			data.databases.forEach (function (theRecord) {
				if (theRecord.name === theDatabase) {
					found = theRecord;
					}
				});
			if (found === undefined) {
				callback ({message: "Can't open " + theDatabase + " because it isn't in the list of databases."});
				return;
				}
			const theNames = ((found.names !== undefined) && (found.names.length > 0)) ? found.names : undefined; //an empty list means the address IS the scope
			callback (undefined, {title: theDatabase, address: found.address, names: theNames});
			});
		return;
		}
	if ((theAddress !== null) && (theAddress.length > 0)) {
		callback (undefined, {title: ((theTitle !== null) && (theTitle.length > 0)) ? theTitle : theAddress, address: theAddress});
		return;
		}
	callback (undefined, {title: "the odb", address: ""}); //the merged root, the artifact view
	}

$(document).ready (function () {
	if (!getPassword ()) { //the password form is on screen -- the page starts over after Connect
		return;
		}
	resolveScope (function (err, scope) {
		if (err !== undefined) {
			$(".divWindowTitle").text (err.message);
			return;
			}
		theScope = scope;
		document.title = theScope.title;
		$(".divWindowTitle").text (theScope.title);
		theState = readState ();
		startOutliner ();
		});
	});

function startOutliner () {
	$("#divOutliner").concord ({
		prefs: {
			outlineFont: "Lucida Grande",
			outlineFontSize: 14,
			outlineLineHeight: 24,
			renderMode: false,
			readonly: true
			},
		callbacks: {
			opExpand: expandCallback,
			opCollapse: collapseCallback
			}
		});
	$(".divOutlinerContainer").scroll (function () {
		clearTimeout (theScrollTimer);
		theScrollTimer = setTimeout (function () {
			theState.scrollTop = $(".divOutlinerContainer").scrollTop ();
			writeState ();
			}, 400);
		});
	/*  The open-a-script double-click listens in the capture phase, because
		Concord's own read-only handler stops double-clicks on the name text
		before they bubble -- so a bubble-phase handler only ever heard
		clicks that landed beside the name, not on it.  */

	document.getElementById ("divOutliner").addEventListener ("dblclick", function (event) {
		const theNode = $(event.target).closest (".concord-node");
		if (theNode.length === 0) {
			return;
			}
		const attributes = theNode.data ("attributes");
		if ((attributes !== undefined) && ((attributes.kind === "script") || (attributes.kind === "outline"))) {
			event.preventDefault ();
			event.stopPropagation ();
			const theUrl = "script.html?address=" + encodeURIComponent (addressForNode (theNode));
			if (window.open (theUrl, "_blank") === null) { //a popup blocker said no -- open it right here instead
				window.location.href = theUrl;
				}
			}
		}, true);
	loadTopLevel ();
	}

function getTableEntries (theId, callback) { //theId undefined means this window's top level
	if (theId !== undefined) {
		serverCall ("/listtable", {id: theId}, "GET", callback);
		return;
		}
	serverCall ("/listtable", {address: theScope.address}, "GET", function (err, data) {
		if (err !== undefined) {
			callback (err);
			return;
			}
		if (theScope.names !== undefined) { //a database that owns some of the root's names, not all of them
			const entries = [];
			data.entries.forEach (function (theEntry) {
				if (theScope.names.indexOf (theEntry.name) !== -1) {
					entries.push (theEntry);
					}
				});
			data.entries = entries;
			data.ctEntries = entries.length;
			}
		callback (undefined, data);
		});
	}

function addressForNode (theNode) { //walk up the outline collecting names -- the dotted address of the row
	const segments = [];
	var current = theNode;
	while (current.length > 0) {
		const attributes = current.data ("attributes");
		if ((attributes === undefined) || (attributes.name === undefined)) {
			break;
			}
		segments.unshift (attributes.name);
		current = current.parent ().closest (".concord-node");
		}
	if (theScope.address.length > 0) { //rows in a mounted window live under the mount address
		segments.unshift (theScope.address);
		}
	return (segments.join ("."));
	}

function opmlForEntries (entries) { //each entry becomes one line; a table gets a placeholder child so it shows a wedge
	var theBody = "";
	entries.forEach (function (entry) {
		var attributes = "text=\"" + xmlEscape (entry.name) + "\" name=\"" + xmlEscape (entry.name) + "\" value=\"" + xmlEscape (entry.value) + "\" kind=\"" + xmlEscape (entry.kind) + "\"";
		if (entry.flTable === true) {
			attributes += " tableid=\"" + entry.id + "\" loaded=\"false\"";
			theBody += "<outline " + attributes + "><outline text=\"loading…\"/></outline>"; //horizontal ellipsis
			}
		else {
			theBody += "<outline " + attributes + "/>";
			}
		});
	return ("<?xml version=\"1.0\"?><opml version=\"2.0\"><head><title>odb</title></head><body>" + theBody + "</body></opml>");
	}

function concordOp () {
	return ($("#divOutliner").concord ().op);
	}

function columnGeometry () { //where the columns sit, as a share of however wide the window is right now
	const widthOutliner = $("#divOutliner").width ();
	return ({
		leftValue: Math.round (widthOutliner * 0.44),
		leftKind: Math.round (widthOutliner * 0.76),
		widthOutliner
		});
	}

function decorateRows () { //the value and kind columns -- each row gets two spans, from the attributes its OPML carried

	/*  The spans live inside each row's wrapper, which moves right as the
		outline indents -- so each one remembers its own row's indent, and
		applyColumnGeometry subtracts it, keeping the columns straight at
		any depth and any window width.  */

	const leftOutliner = $("#divOutliner").offset ().left;
	$("#divOutliner .concord-node").each (function () {
		const theNode = $(this);
		const theWrapper = theNode.children (".concord-wrapper");
		if (theWrapper.find (".spanValue").length === 0) {
			if (theNode.offsetParent === null) { //a hidden row can't be measured -- it gets decorated when its table is expanded
				return;
				}
			const attributes = theNode.data ("attributes");
			if ((attributes !== undefined) && (attributes.kind !== undefined)) {
				theNode.data ("colIndent", theWrapper.offset ().left - leftOutliner);
				theWrapper.append ($("<span class=\"spanValue\"></span>").text (attributes.value));
				theWrapper.append ($("<span class=\"spanKind\"></span>").text (attributes.kind));
				}
			}
		});
	applyColumnGeometry ();
	}

function applyColumnGeometry () { //position every row's spans for the current window width
	const geometry = columnGeometry ();
	$("#divOutliner .concord-node").each (function () {
		const theNode = $(this);
		const indent = theNode.data ("colIndent");
		if (indent !== undefined) {
			const theWrapper = theNode.children (".concord-wrapper");
			theWrapper.children (".spanValue").css ({
				left: (geometry.leftValue - indent) + "px",
				width: (geometry.leftKind - geometry.leftValue - 24) + "px"
				});
			theWrapper.children (".spanKind").css ({
				left: (geometry.leftKind - indent) + "px",
				width: (geometry.widthOutliner - geometry.leftKind - 20) + "px"
				});
			}
		});
	$("#styleColumns").text ("#divOutliner .concord-text { max-width: " + (geometry.leftValue - 60) + "px; }");
	alignColumnHeads ();
	}

$(window).resize (function () {
	applyColumnGeometry ();
	});

function alignColumnHeads () { //every title lines up over where its column actually landed, Name included
	const leftHeads = $(".divColumnHeads").offset ().left;
	const firstText = $("#divOutliner .concord-text:first");
	if (firstText.length > 0) {
		$(".spanHeadName").css ("left", (firstText.offset ().left - leftHeads) + "px");
		}
	const firstValue = $("#divOutliner .spanValue:first");
	if (firstValue.length > 0) {
		$(".spanHeadValue").css ("left", (firstValue.offset ().left - leftHeads + 10) + "px"); //past the column's dotted rule
		$(".spanHeadKind").css ("left", ($("#divOutliner .spanKind:first").offset ().left - leftHeads + 10) + "px");
		}
	}

function showError (err) {
	alert (err.message);
	}

//window state -- what was expanded and where the scroll was, so the window comes back the way it was left
	var theScrollTimer; //assigned by the scroll handler
	var theState; //assigned at startup, once the scope is known -- each window keeps its own
	function readState () {
		try {
			const jstruct = JSON.parse (localStorage.getItem (scopeStateKey ()));
			if ((jstruct !== null) && (Array.isArray (jstruct.expandedIds))) {
				return (jstruct);
				}
			}
		catch (err) {
			}
		return ({expandedIds: [], scrollTop: 0});
		}
	function writeState () {
		localStorage.setItem (scopeStateKey (), JSON.stringify (theState));
		}
	function recordExpanded (theId) {
		if (theState.expandedIds.indexOf (theId) === -1) {
			theState.expandedIds.push (theId);
			writeState ();
			}
		}
	function recordCollapsed (theId) {
		const ix = theState.expandedIds.indexOf (theId);
		if (ix !== -1) {
			theState.expandedIds.splice (ix, 1);
			writeState ();
			}
		}
	function findNodeByTableId (theId) {
		const theNodes = $("#divOutliner .concord-node").filter (function () {
			const attributes = $(this).data ("attributes");
			return ((attributes !== undefined) && (attributes.tableid === theId));
			});
		return ((theNodes.length > 0) ? theNodes.first () : undefined);
		}
	function restoreExpansions (ix, missingIds) {
		if (ix >= theState.expandedIds.length) {
			missingIds.forEach (recordCollapsed); //tables that no longer exist fall out of the state
			$(".divOutlinerContainer").scrollTop (theState.scrollTop);
			return;
			}
		const theId = theState.expandedIds [ix];
		const theNode = findNodeByTableId (theId);
		if (theNode === undefined) {
			missingIds.push (theId);
			restoreExpansions (ix + 1, missingIds);
			}
		else {
			if (theNode.data ("attributes").loaded === "true") {
				theNode.removeClass ("collapsed");
				restoreExpansions (ix + 1, missingIds);
				}
			else {
				loadTableChildren (theNode, function () {
					restoreExpansions (ix + 1, missingIds);
					});
				}
			}
		}

function loadTopLevel () {
	getTableEntries (undefined, function (err, data) {
		if (err !== undefined) {
			showError (err);
			}
		else {
			concordOp ().xmlToOutline (opmlForEntries (data.entries), false);
			decorateRows ();
			restoreExpansions (0, []);
			}
		});
	}

function loadTableChildren (theNode, callback) { //fetch a table's entries and swap out the placeholder
	const attributes = theNode.data ("attributes");
	attributes.loaded = "true";
	getTableEntries (attributes.tableid, function (err, data) {
		const theOp = concordOp ();
		theOp.setCursor (theNode);
		theOp.deleteSubs ();
		if (err !== undefined) {
			attributes.loaded = "false"; //so the next expand tries again
			if (callback === undefined) {
				showError (err);
				}
			}
		else {
			if (data.entries.length > 0) {
				theOp.insertXml (opmlForEntries (data.entries), "right");
				theNode.removeClass ("collapsed");
				decorateRows ();
				}
			}
		if (callback !== undefined) {
			callback (err);
			}
		});
	}

function expandCallback (op) {
	const theNode = op.getCursor ();
	const attributes = theNode.data ("attributes");
	if ((attributes === undefined) || (attributes.kind !== "table")) {
		return;
		}
	recordExpanded (attributes.tableid);
	if (attributes.loaded !== "true") {
		loadTableChildren (theNode);
		}
	}

function collapseCallback (op) {
	const theNode = op.getCursor ();
	const attributes = theNode.data ("attributes");
	if ((attributes !== undefined) && (attributes.kind === "table")) {
		recordCollapsed (attributes.tableid);
		}
	}
