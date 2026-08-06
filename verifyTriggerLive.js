/*  Run the same checks against the live server over https.

	node verifyTriggerLive.js

	by CC, 7/30/26 */

const https = require ("https");
const fs = require ("fs");

/*  8/4/26 by CC -- the password was hardcoded here, and it went stale the day
	/run's password was rotated. It comes from the credentials file now, the
	same one every other script reads. The webedit password is the one to use:
	/run has accepted it since 0.4.0, and it's the one DW holds.  */

const pathCredentials = process.env.HOME + "/.claude/projects/-Users-davewiner-Claude-rssNetwork/memory/triggerCredentials.json";

const theHost = "trigger.usertalk.org";
const thePassword = JSON.parse (fs.readFileSync (pathCredentials, "utf8")).webedit.password;

var ctOk = 0, ctFailed = 0;
const theTests = [];

function request (theOptions, theBody, callback) {
	const theRequest = https.request (theOptions, function (theResponse) {
		var theText = "";
		theResponse.on ("data", function (chunk) {
			theText += chunk;
			});
		theResponse.on ("end", function () {
			callback (theResponse.statusCode, theText);
			});
		});
	theRequest.on ("error", function (err) {
		callback (0, err.message);
		});
	if (theBody !== undefined) {
		theRequest.write (theBody);
		}
	theRequest.end ();
	}

function test (theName, theOptions, theBody, checkCallback) {
	theTests.push ({theName, theOptions, theBody, checkCallback});
	}
function get (thePath) {
	return ({hostname: theHost, port: 443, path: thePath, method: "GET"});
	}
function post (thePath, theHeaders) {
	return ({hostname: theHost, port: 443, path: thePath, method: "POST", headers: theHeaders});
	}
function runScript (theScript) {
	return (get ("/run?password=" + thePassword + "&script=" + encodeURIComponent (theScript)));
	}

function runNextTest () {
	if (theTests.length === 0) {
		console.log ("");
		console.log (ctOk + " ok, " + ctFailed + " failed");
		process.exit (ctFailed === 0 ? 0 : 1);
		}
	else {
		const theTest = theTests.shift ();
		request (theTest.theOptions, theTest.theBody, function (theCode, theText) {
			var theResult;
			try {
				theResult = JSON.parse (theText);
				}
			catch (err) {
				theResult = {rawText: theText};
				}
			const theProblem = theTest.checkCallback (theCode, theResult, theText);
			if (theProblem === undefined) {
				ctOk++;
				console.log ("ok    " + theTest.theName);
				}
			else {
				ctFailed++;
				console.log ("FAIL  " + theTest.theName + " -- " + theProblem);
				console.log ("      got " + theCode + ": " + theText.replace (/\n/g, " ").slice (0, 300));
				}
			runNextTest ();
			});
		}
	}

test ("https works and /version answers", get ("/version"), undefined, function (theCode, theResult) {
	if (theCode !== 200) {
		return ("expected 200");
		}
	if (theResult.ctDatabaseRows < 212591) { //a test that writes adds a row, so this only ever goes up
		return ("expected at least 212591 rows, got " + theResult.ctDatabaseRows);
		}
	});
test ("no password is refused", get ("/run?script=1"), undefined, function (theCode) {
	if (theCode !== 401) {
		return ("expected 401");
		}
	});
test ("a wrong password is refused", get ("/run?password=nope&script=1"), undefined, function (theCode) {
	if (theCode !== 401) {
		return ("expected 401");
		}
	});
test ("the password in a header works", post ("/run", {"Content-Type": "text/plain", "x-trigger-password": thePassword}), "2 + 2", function (theCode, theResult) {
	if (theCode !== 200) {
		return ("expected 200");
		}
	if (theResult.value !== 4) {
		return ("expected 4, got " + JSON.stringify (theResult.value));
		}
	});
test ("arithmetic", runScript ("2 + 3 * 4"), undefined, function (theCode, theResult) {
	if (theResult.value !== 14) {
		return ("expected 14, got " + JSON.stringify (theResult.value));
		}
	});
test ("string.lower resolved through the database", runScript ("string.lower (\"HELLO Frontier\")"), undefined, function (theCode, theResult) {
	if (theResult.value !== "hello frontier") {
		return ("expected hello frontier, got " + JSON.stringify (theResult.value));
		}
	});
test ("a five-level dotted address", runScript ("system.verbs.builtins.string.upper (\"still here\")"), undefined, function (theCode, theResult) {
	if (theResult.value !== "STILL HERE") {
		return ("expected STILL HERE, got " + JSON.stringify (theResult.value));
		}
	});
test ("a multi-line script POSTed as text", post ("/run?password=" + thePassword, {"Content-Type": "text/plain"}), "local (total = 0)\nfor i = 1 to 10\n\ttotal = total + i\ntotal", function (theCode, theResult) {
	if (theResult.value !== 55) {
		return ("expected 55, got " + JSON.stringify (theResult.value));
		}
	});
test ("an OPML script from an outliner", post ("/run?password=" + thePassword, {"Content-Type": "text/xml"}), "<?xml version=\"1.0\"?>\n<opml version=\"2.0\"><head><title>test</title></head><body>\n<outline text=\"local (s = &quot;abc&quot;)\" />\n<outline text=\"string.upper (s)\" />\n</body></opml>", function (theCode, theResult) {
	if (theResult.value !== "ABC") {
		return ("expected ABC, got " + JSON.stringify (theResult.value));
		}
	});
test ("a table answers with entry names only", runScript ("config.nodeEditor"), undefined, function (theCode, theResult) {
	if (theResult.valueType !== "table") {
		return ("expected a table, got " + theResult.valueType);
		}
	if (theResult.value.length === 0) {
		return ("expected some entry names");
		}
	});
test ("a write persists into the database", post ("/run?password=" + thePassword, {"Content-Type": "text/plain"}), "scratchpad.liveCheck = \"trigger is up\"\nscratchpad.liveCheck", function (theCode, theResult) {
	if (theResult.value !== "trigger is up") {
		return ("expected the written string, got " + JSON.stringify (theResult.value));
		}
	});
test ("and the next request can read it", runScript ("scratchpad.liveCheck"), undefined, function (theCode, theResult) {
	if (theResult.value !== "trigger is up") {
		return ("expected the string to persist, got " + JSON.stringify (theResult.value));
		}
	});
test ("a failing script answers with a message", runScript ("noSuchVerb (1)"), undefined, function (theCode, theResult) {
	if (theCode !== 500) {
		return ("expected 500");
		}
	if (theResult.message === undefined) {
		return ("expected a message");
		}
	});
test ("an unknown path is a 404", get ("/nosuchthing"), undefined, function (theCode) {
	if (theCode !== 404) {
		return ("expected 404");
		}
	});
test ("no script parameter at all is a 400", get ("/run?password=" + thePassword), undefined, function (theCode, theResult) {
	if (theCode !== 400) {
		return ("expected 400");
		}
	});
test ("the server survived that", get ("/version"), undefined, function (theCode) {
	if (theCode !== 200) {
		return ("expected 200 -- the server died");
		}
	});
test ("no trace unless asked for", runScript ("string.lower (\"ABC\")"), undefined, function (theCode, theResult) {
	if (theResult.trace !== undefined) {
		return ("expected no trace");
		}
	});
test ("trace=1 lists the verb calls", get ("/run?password=" + thePassword + "&trace=1&script=" + encodeURIComponent ("string.lower (\"ABC\")")), undefined, function (theCode, theResult) {
	if (theResult.trace === undefined) {
		return ("expected a trace");
		}
	});
test ("nodeEditorSuite.init runs against the database", runScript ("nodeEditorSuite.init ()"), undefined, function (theCode, theResult) {
	if (theCode !== 200) {
		return ("expected 200");
		}
	if (theResult.valueType !== "address") {
		return ("expected an address, got " + theResult.valueType);
		}
	});

runNextTest ();
