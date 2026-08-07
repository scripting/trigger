var theAddress, theScriptType; //assigned at startup, from the url and the download

$(document).ready (function () {
	getPassword ();
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
			$("#divOutliner").concord ().op.xmlToOutline (data.opmltext, false);
			showStatus (data.ctLines + ((data.ctLines === 1) ? " line." : " lines."));
			}
		});
	$("#buttonSave").click (saveScript);
	});

function showStatus (theText) {
	$("#spanStatus").text (theText);
	}

function saveScript () {
	const opmltext = $("#divOutliner").concord ().op.outlineToXml ();
	showStatus ("Saving…"); //horizontal ellipsis
	serverCall ("/uploadobject", {address: theAddress, type: theScriptType, opmltext}, "POST", function (err, data) {
		if (err !== undefined) {
			showStatus (err.message);
			}
		else {
			showStatus ("Saved at " + new Date ().toLocaleTimeString () + ", " + data.ctLines + ((data.ctLines === 1) ? " line." : " lines."));
			}
		});
	}
