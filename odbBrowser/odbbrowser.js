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
	});

function getTableEntries (theId, callback) { //theId undefined means the top level
	serverCall ("/listtable", {id: theId}, "GET", callback);
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
