var thePassword; //assigned by getPassword, at startup

function getPassword () { //true if we have one; false means an entry form is on screen and the page should wait

	/*  Not prompt () -- Electron doesn't support it, and neither do some
		embedded browsers. A small form in the page works everywhere.  */

	thePassword = localStorage.getItem ("odbBrowserPassword");
	if ((thePassword !== null) && (thePassword.length > 0)) {
		return (true);
		}
	const divEntry = $("<div class=\"divPasswordEntry\"></div>");
	const inputPassword = $("<input type=\"password\" class=\"inputPassword\" placeholder=\"Password for the odb server\">");
	const buttonConnect = $("<button class=\"buttonConnect\">Connect</button>");
	function connect () {
		const theValue = inputPassword.val ();
		if (theValue.length > 0) {
			localStorage.setItem ("odbBrowserPassword", theValue);
			window.location.reload ();
			}
		}
	buttonConnect.click (connect);
	inputPassword.keydown (function (event) {
		if (event.which === 13) { //return key
			connect ();
			}
		});
	divEntry.append (inputPassword).append (buttonConnect);
	$("body").prepend (divEntry);
	inputPassword.focus ();
	return (false);
	}

function serverCall (path, params, method, callback) { //the one transport primitive -- JSON comes back
	var theUrl = path;
	var theQuery = "";
	var theBody;
	Object.keys (params).forEach (function (name) {
		if (name === "opmltext") { //the one param that travels as the body of a POST
			theBody = params [name];
			return;
			}
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
		type: method,
		data: theBody,
		contentType: (theBody === undefined) ? undefined : "text/xml",
		processData: false,
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

/*  Running a script from here, dialogs included -- 8/8/26 by CC. The
	machinery below used to live in script.js, for the Run button. It moved
	here so a menu command can run in whatever window is frontmost: the app
	calls runMenuScript with the script's text, and any dialogs the script
	puts up appear in this window, over whatever the person was looking at.
	showStatus is page-supplied when the page has a status line; the
	fallback is a strip that appears at the bottom and fades.  */

function showRunStatus (theText) {
	if (typeof showStatus === "function") {
		showStatus (theText);
		return;
		}
	var divStrip = $(".divRunStatusStrip");
	if (divStrip.length === 0) {
		divStrip = $("<div class=\"divRunStatusStrip\"></div>");
		$("body").append (divStrip);
		}
	divStrip.stop (true).text (theText).css ("opacity", 1);
	divStrip.delay (5000).animate ({opacity: 0}, 1000);
	}

function runMenuScript (theScriptText) { //runs a menu command's script; dialogs appear right here
	showRunStatus ("Running…"); //horizontal ellipsis
	serverCall ("/run", {interactive: "1", opmltext: theScriptText}, "POST", handleRunAnswer);
	}

function showLocalAlert (theText) { //an error big enough to actually see; no server round trip, OK just closes it
	const divMask = $("<div class=\"divDialogMask\"></div>");
	const divDialog = $("<div class=\"divDialog\"></div>");
	divDialog.append ($("<div class=\"divDialogPrompt\"></div>").text (theText));
	const divButtons = $("<div class=\"divDialogButtons\"></div>");
	const buttonOk = $("<button class=\"buttonBar buttonDefault\">OK</button>").click (function () {
		divMask.remove ();
		});
	divButtons.append (buttonOk);
	divDialog.append (divButtons);
	divMask.append (divDialog);
	$("body").append (divMask);
	buttonOk.focus ();
	}

function executeEditorVerb (theVerb, theParams) {

	/*  8/8/26 by CC -- the window's side of an op verb call: a script
		running on the server asked to operate on THIS window's outline.
		The verbs map onto Concord's op.  */

	const theOp = $("#divOutliner").concord ().op;
	switch (theVerb) {
		case "op.fullcollapse":
			theOp.fullCollapse ();
			return (true);
		case "op.fullexpand":
			theOp.fullExpand ();
			return (true);
		case "op.expand":
			theOp.expand ();
			return (true);
		case "op.collapse":
			theOp.collapse ();
			return (true);
		case "op.firstsummit": {
			const summits = $("#divOutliner .concord-node").filter (function () {
				return ($(this).parents (".concord-node").length === 0);
				});
			if (summits.length > 0) {
				theOp.setCursor (summits.first ());
				}
			return (true);
			}
		case "op.go":
			return (theOp.go (theParams [0], (theParams [1] === undefined) ? 1 : Number (theParams [1])) !== false);
		case "op.getlinetext":
			return (theOp.getLineText ());
		case "op.setlinetext":
			theOp.setLineText (String (theParams [0]));
			return (true);
		case "op.attributes.getall": {
			const theNode = theOp.getCursor ();
			const attributes = theNode.data ("attributes");
			return ((attributes === undefined) ? {} : attributes);
			}
		case "window.frontmost":
			if ((typeof theAddress !== "undefined") && (theAddress !== null) && (theAddress.length > 0)) { //a script or project window knows its address
				return (theAddress);
				}
			if ((typeof theScope !== "undefined") && (theScope !== undefined)) { //a browse window is rooted somewhere
				return (theScope.address);
				}
			return ("");
		case "speaker.beep": {
			try {
				const theContext = new (window.AudioContext || window.webkitAudioContext) ();
				const theOscillator = theContext.createOscillator ();
				theOscillator.frequency.value = 880;
				theOscillator.connect (theContext.destination);
				theOscillator.start ();
				setTimeout (function () {
					theOscillator.stop ();
					theContext.close ();
					}, 150);
				}
			catch (err) {
				}
			return (true);
			}
		default: {
			const message = "the window doesn't know that verb.";
			throw new Error (message);
			}
		}
	}

function openEditWindow (theDialog) { //a script called edit -- a real window opens on the object it named

	/*  In the desktop app window.open makes a real window, tracked and
		restored like the others; in a plain browser it's a tab. The url
		carries everything the window needs, so it comes back whole when
		the app restores its windows at launch.  */

	var theUrl = (theDialog.objectType === "table") ? "./?address=" : "script.html?address="; //a table opens a table window, everything else the editor
	theUrl += encodeURIComponent (theDialog.address);
	if (theDialog.title !== undefined) {
		theUrl += "&title=" + encodeURIComponent (theDialog.title);
		}
	if (theDialog.buttonsAddress !== undefined) {
		theUrl += "&buttons=" + encodeURIComponent (theDialog.buttonsAddress);
		}
	if (theDialog.flReadonly === true) {
		theUrl += "&readonly=1";
		}
	if (window.open (theUrl, "_blank") === null) { //a popup blocker said no -- open it right here instead
		window.location.href = theUrl;
		}
	}

function handleRunAnswer (err, data) { //every exchange with a running script lands here, until it finishes
	if (err !== undefined) {
		showRunStatus (err.message);
		showLocalAlert (err.message); //8/8/26 by CC -- a failure has to be SEEN; the status line alone wasn't (DW's Zoom report)
		return;
		}
	if (data.finished === false) {
		if (data.dialog.kind === "edit") { //8/8/26 by CC -- the script asked for a window, not an answer
			openEditWindow (data.dialog);
			serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify ({button: "ok"})}, "POST", handleRunAnswer);
			return;
			}
		if (data.dialog.kind === "editorverb") { //8/8/26 by CC -- the script is operating on THIS window's outline
			var theAnswer;
			try {
				theAnswer = {value: executeEditorVerb (data.dialog.verb, data.dialog.params)};
				}
			catch (editorErr) {
				theAnswer = {message: "Can't do " + data.dialog.verb + " in this window because " + editorErr.message};
				}
			serverCall ("/dialoganswer", {runid: data.runId, opmltext: JSON.stringify (theAnswer)}, "POST", handleRunAnswer);
			return;
			}
		showDialog (data.dialog, data.runId);
		return;
		}
	if (data.message !== undefined) { //the script failed, or the dialog timed out
		showRunStatus (data.message);
		showLocalAlert (data.message);
		return;
		}
	var theValueText = JSON.stringify (data.value);
	if (theValueText === undefined) { //a script with no value
		theValueText = "(no value)";
		}
	showRunStatus (theValueText + " -- " + data.ctVerbCalls + " verb calls, " + data.ctMilliseconds + "ms");
	}

function showDialog (theDialog, runId) { //the script is standing still until one of these buttons is clicked
	const divMask = $("<div class=\"divDialogMask\"></div>");
	const divDialog = $("<div class=\"divDialog\"></div>");
	const divPrompt = $("<div class=\"divDialogPrompt\"></div>").text (theDialog.prompt);
	divDialog.append (divPrompt);
	var inputAnswer;
	if (theDialog.kind === "ask") {
		inputAnswer = $("<input type=\"text\" class=\"inputDialogAnswer\">").val (theDialog.startValue);
		divDialog.append (inputAnswer);
		}
	const divButtons = $("<div class=\"divDialogButtons\"></div>");
	function answer (theButton) {
		divMask.remove ();
		showRunStatus ("Running…"); //horizontal ellipsis
		const theAnswer = {button: theButton};
		if (inputAnswer !== undefined) {
			theAnswer.text = inputAnswer.val ();
			}
		serverCall ("/dialoganswer", {runid: runId, opmltext: JSON.stringify (theAnswer)}, "POST", handleRunAnswer);
		}
	if ((theDialog.kind === "confirm") || (theDialog.kind === "ask")) {
		const buttonCancel = $("<button class=\"buttonBar\">Cancel</button>").click (function () {
			answer ("cancel");
			});
		divButtons.append (buttonCancel);
		}
	const buttonOk = $("<button class=\"buttonBar buttonDefault\">OK</button>").click (function () {
		answer ("ok");
		});
	divButtons.append (buttonOk);
	divDialog.append (divButtons);
	divMask.append (divDialog);
	$("body").append (divMask);
	function returnKeyAnswers (event) {
		if (event.which === 13) { //return key
			answer ("ok");
			}
		}
	if (inputAnswer !== undefined) {
		inputAnswer.focus ().keydown (returnKeyAnswers);
		}
	else {
		buttonOk.focus ();
		}
	}

function xmlEscape (theText) {
	return (String (theText)
		.split ("&").join ("&amp;")
		.split ("<").join ("&lt;")
		.split (">").join ("&gt;")
		.split ("\"").join ("&quot;"));
	}
