var theAddress, theScriptType; //assigned at startup, from the url and the download
var theSavedBody; //the outline body as saved in the database, in this page's own rendering; undefined means unknown
var theLastSeenBody; //the body at the last autosave check

function opmlBody (theOpml) { //just the outline -- the head carries a timestamp that changes on every render, so comparing whole documents always says "changed"
	const ixStart = theOpml.indexOf ("<body>");
	const ixEnd = theOpml.lastIndexOf ("</body>");
	if ((ixStart === -1) || (ixEnd === -1)) {
		return (theOpml);
		}
	return (theOpml.substring (ixStart, ixEnd));
	}

$(document).ready (function () {
	if (!getPassword ()) { //the password form is on screen -- the page starts over after Connect
		return;
		}
	theAddress = new URLSearchParams (window.location.search).get ("address");
	if ((theAddress === null) || (theAddress.length === 0)) {
		showStatus ("Can't open anything because the url carried no address.");
		return;
		}
	document.title = theAddress;
	$(".divWindowTitle").text (theAddress);
	$("#divOutliner").concord ({
		prefs: {
			outlineFont: "Lucida Grande",
			outlineFontSize: 14,
			outlineLineHeight: 24,
			renderMode: false,
			readonly: false
			}
		});
	serverCall ("/downloadobject", {address: theAddress}, "GET", function (err, data) {
		if (err !== undefined) {
			showStatus (err.message);
			}
		else {
			theScriptType = data.scriptType;
			const theDraft = localStorage.getItem (draftKey ());
			if (theDraft !== null) { //edits from last time that never made it to the database
				$("#divOutliner").concord ().op.xmlToOutline (theDraft, false);
				showDirty (true); //theSavedBody stays undefined -- the window is dirty until the next Save
				showStatus ("Restored unsaved changes from last time.");
				}
			else {
				$("#divOutliner").concord ().op.xmlToOutline (data.opmltext, false);
				theSavedBody = opmlBody (currentOpml ()); //this page's own rendering, so later compares are apples to apples
				showStatus (data.ctLines + ((data.ctLines === 1) ? " line." : " lines."));
				}
			theLastSeenBody = opmlBody (currentOpml ());
			setInterval (autosaveCheck, 1500);
			}
		});
	$("#buttonSave").click (saveScript);
	$("#buttonRun").click (runScript);
	$("#buttonZoom").click (zoomOutline);
	});

function draftKey () {
	return ("odbDraft:" + theAddress);
	}

function currentOpml () {
	return ($("#divOutliner").concord ().op.outlineToXml ());
	}

function showStatus (theText) {
	$("#spanStatus").text (theText);
	}

function showDirty (flDirty) {
	$("#spanDirty").text (flDirty ? "unsaved changes" : "");
	}

function autosaveCheck () { //edits are kept locally as they happen -- the database changes only on Save
	const theOpml = currentOpml ();
	const theBody = opmlBody (theOpml);
	if (theBody !== theLastSeenBody) {
		theLastSeenBody = theBody;
		if (theBody === theSavedBody) { //edited back to what the database has
			localStorage.removeItem (draftKey ());
			showDirty (false);
			}
		else {
			localStorage.setItem (draftKey (), theOpml);
			showDirty (true);
			}
		}
	}

function saveScript () {
	const opmltext = currentOpml ();
	showStatus ("Saving…"); //horizontal ellipsis
	serverCall ("/uploadobject", {address: theAddress, type: theScriptType, opmltext}, "POST", function (err, data) {
		if (err !== undefined) {
			showStatus (err.message);
			}
		else {
			theSavedBody = opmlBody (opmltext);
			localStorage.removeItem (draftKey ());
			showDirty (false);
			showStatus ("Saved at " + new Date ().toLocaleTimeString () + ", " + data.ctLines + ((data.ctLines === 1) ? " line." : " lines."));
			}
		});
	}

function runScript () { //runs what's in the window, saved or not
	showStatus ("Running…"); //horizontal ellipsis
	serverCall ("/run", {opmltext: currentOpml ()}, "POST", function (err, data) {
		if (err !== undefined) {
			showStatus (err.message);
			}
		else {
			var theValueText = JSON.stringify (data.value);
			if (theValueText === undefined) { //a script with no value
				theValueText = "(no value)";
				}
			showStatus (theValueText + " -- " + data.ctVerbCalls + " verb calls, " + data.ctMilliseconds + "ms");
			}
		});
	}

function zoomOutline () { //collapse everything, cursor to the first summit, top level showing
	const theOp = $("#divOutliner").concord ().op;
	theOp.fullCollapse ();
	const summits = $("#divOutliner .concord-node").filter (function () {
		return ($(this).parents (".concord-node").length === 0);
		});
	summits.removeClass ("collapsed");
	if (summits.length > 0) {
		theOp.setCursor (summits.first ());
		}
	}
