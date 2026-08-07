var thePassword; //assigned by getPassword, at startup

$(document).ready (function () {
	getPassword ();
	$("#divOutliner").concord ({
		prefs: {
			outlineFont: "Lucida Grande",
			outlineFontSize: 14,
			outlineLineHeight: 24,
			renderMode: false,
			readonly: true
			},
		callbacks: {
			opExpand: expandCallback
			}
		});
	loadTopLevel ();
	});

function getPassword () {
	thePassword = localStorage.getItem ("odbBrowserPassword");
	if ((thePassword === null) || (thePassword.length === 0)) {
		thePassword = prompt ("What's the password for the odb server?");
		if (thePassword === null) {
			thePassword = "";
			}
		else {
			localStorage.setItem ("odbBrowserPassword", thePassword);
			}
		}
	}

function serverCall (path, params, callback) { //the one transport primitive -- GET, JSON comes back
	var theUrl = path;
	var theQuery = "";
	Object.keys (params).forEach (function (name) {
		if (params [name] !== undefined) {
			if (theQuery.length > 0) {
				theQuery += "&";
				}
			theQuery += name + "=" + encodeURIComponent (params [name]);
			}
		});
	if (theQuery.length > 0) {
		theUrl += "?" + theQuery;
		}
	$.ajax ({
		url: theUrl,
		headers: {"x-trigger-password": thePassword},
		dataType: "json",
		success: function (data) {
			callback (undefined, data);
			},
		error: function (xhr) {
			var err;
			try {
				err = JSON.parse (xhr.responseText);
				}
			catch (parseError) {
				err = {message: "Can't reach the odb server. The status was " + xhr.status + "."};
				}
			if (xhr.status === 401) { //a wrong saved password would lock the page forever -- forget it so the next visit asks again
				localStorage.removeItem ("odbBrowserPassword");
				}
			callback (err);
			}
		});
	}

function getTableEntries (theId, callback) { //theId undefined means the top level
	serverCall ("/listtable", {id: theId}, callback);
	}

function xmlEscape (theText) {
	return (String (theText)
		.split ("&").join ("&amp;")
		.split ("<").join ("&lt;")
		.split (">").join ("&gt;")
		.split ("\"").join ("&quot;"));
	}

function opmlForEntries (entries) { //each entry becomes one line; a table gets a placeholder child so it shows a wedge
	var theBody = "";
	entries.forEach (function (entry) {
		var attributes = "text=\"" + xmlEscape (entry.name) + "\" value=\"" + xmlEscape (entry.value) + "\" kind=\"" + xmlEscape (entry.kind) + "\"";
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

const leftValueColumn = 422, leftKindColumn = 732; //where the columns sit, measured from the left edge of the outline

function decorateRows () { //the value and kind columns -- each row gets two spans, from the attributes its OPML carried

	/*  The spans live inside each row's wrapper, which moves right as the
		outline indents -- so each one gets an inline left that subtracts its
		own row's indent, keeping the columns straight at any depth.  */

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
				const indent = theWrapper.offset ().left - leftOutliner;
				const spanValue = $("<span class=\"spanValue\"></span>").text (attributes.value).css ("left", (leftValueColumn - indent) + "px");
				const spanKind = $("<span class=\"spanKind\"></span>").text (attributes.kind).css ("left", (leftKindColumn - indent) + "px");
				theWrapper.append (spanValue).append (spanKind);
				}
			}
		});
	alignColumnHeads ();
	}

function alignColumnHeads () { //the header labels line up over wherever the columns actually landed
	const firstValue = $("#divOutliner .spanValue:first");
	if (firstValue.length > 0) {
		const leftHeads = $(".divColumnHeads").offset ().left;
		$(".spanHeadValue").css ("left", (firstValue.offset ().left - leftHeads) + "px");
		$(".spanHeadKind").css ("left", ($("#divOutliner .spanKind:first").offset ().left - leftHeads) + "px");
		}
	}

function showError (err) {
	alert (err.message);
	}

function loadTopLevel () {
	getTableEntries (undefined, function (err, data) {
		if (err !== undefined) {
			showError (err);
			}
		else {
			concordOp ().xmlToOutline (opmlForEntries (data.entries), false);
			decorateRows ();
			}
		});
	}

function expandCallback (op) { //the first expand of a table fetches its entries and swaps out the placeholder
	const theNode = op.getCursor ();
	const attributes = theNode.data ("attributes");
	if ((attributes === undefined) || (attributes.kind !== "table") || (attributes.loaded === "true")) {
		return;
		}
	attributes.loaded = "true";
	getTableEntries (attributes.tableid, function (err, data) {
		const theOp = concordOp ();
		theOp.setCursor (theNode);
		theOp.deleteSubs ();
		if (err !== undefined) {
			attributes.loaded = "false"; //so the next expand tries again
			showError (err);
			}
		else {
			if (data.entries.length > 0) {
				theOp.insertXml (opmlForEntries (data.entries), "right");
				theNode.removeClass ("collapsed");
				decorateRows ();
				}
			}
		});
	}
