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
	const theParams = new URLSearchParams (window.location.search);
	theAddress = theParams.get ("address");
	if ((theAddress === null) || (theAddress.length === 0)) {
		showStatus ("Can't open anything because the url carried no address.");
		return;
		}
	var theTitle = theParams.get ("title"); //8/8/26 by CC -- a window opened by the edit verb carries its own title
	if ((theTitle === null) || (theTitle.length === 0)) {
		theTitle = theAddress;
		}
	const flReadonly = theParams.get ("readonly") === "1";
	document.title = theTitle;
	$(".divWindowTitle").text (theTitle);
	const theButtonsAddress = theParams.get ("buttons"); //8/8/26 by CC -- the edit verb points at a table of scripts, one per button
	if ((theButtonsAddress !== null) && (theButtonsAddress.length > 0)) {
		buildOdbButtons (theButtonsAddress);
		}
	$("#divOutliner").concord ({ //13/21 -- the OPML Editor's text, measured off DW's screenshot (8/9)
		prefs: {
			outlineFont: "Lucida Grande",
			outlineFontSize: 13,
			outlineLineHeight: 21,
			renderMode: false,
			readonly: flReadonly
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

function buildOdbButtons (theButtonsAddress) {

	/*  8/8/26 by CC -- the buttons come from the database: a table of
		scripts, one per button, named "00001000<tab>Save" -- the number
		sorts them, the label follows the tab. Clicking a button fetches
		its script fresh and runs it -- the table is user-editable data,
		so the click always runs what's there NOW. These replace the
		built-in Save/Run/Zoom, which belong to plain script windows.  */

	$("#buttonSave").remove ();
	$("#buttonRun").remove ();
	$("#buttonZoom").remove ();

	serverCall ("/listtable", {address: theButtonsAddress}, "GET", function (err, data) {
		if (err !== undefined) {
			showStatus ("Can't get the buttons because " + err.message);
			return;
			}
		data.entries.forEach (function (theEntry) {
			if (theEntry.kind !== "script") {
				return;
				}
			const ixTab = theEntry.name.indexOf ("\t");
			const theLabel = (ixTab === -1) ? theEntry.name : theEntry.name.slice (ixTab + 1);
			const buttonOdb = $("<button class=\"buttonBar\"></button>").text (theLabel);
			buttonOdb.click (function () {
				serverCall ("/downloadobject", {address: theButtonsAddress + "." + theEntry.name}, "GET", function (downloadErr, downloadData) {
					if (downloadErr !== undefined) {
						showStatus ("Can't run " + theLabel + " because " + downloadErr.message);
						return;
						}
					runMenuScript (downloadData.opmltext);
					});
				});
			$("#spanDirty").before (buttonOdb);
			});
		});
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

function runScript () { //runs what's in the window, saved or not -- dialogs appear right here as the script asks
	runMenuScript (currentOpml ()); //8/8/26 by CC -- the run-with-dialogs machinery lives in common.js now, shared with menu commands
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
