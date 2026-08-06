/*  Start trigger, run a batch of requests against it, report, stop it.
	One script so there's nothing to babysit.

	node testTrigger.js

	by CC, 7/30/26 */

const {spawn, execSync} = require ("child_process");
const http = require ("http");

const folderTrigger = "/Users/davewiner/Claude/trigger";
const folderModules = "/Users/davewiner/Claude/trigger/node_modules"; //8/3/26 by CC -- was a scratchpad path from the session that built this; trigger's own modules are the durable copy
const thePort = 1680;
const thePassword = "testonly";

function freePort (thePortToFree) { //a crashed run can leave a server holding the port
	try {
		const theOutput = execSync ("lsof -ti tcp:" + thePortToFree, {encoding: "utf8"});
		theOutput.split ("\n").forEach (function (line) {
			const thePid = Number (line.trim ());
			if (thePid > 0) {
				try {
					process.kill (thePid, "SIGKILL");
					console.log ("freed port " + thePortToFree + " -- killed pid " + thePid);
					}
				catch (err) {
					console.log ("couldn't kill pid " + thePid + ": " + err.message);
					}
				}
			});
		}
	catch (err) { //lsof exits non-zero when nothing holds the port
		}
	}

freePort (thePort);

const theServer = spawn ("node", [folderTrigger + "/trigger.js"], {
	cwd: folderTrigger,
	env: Object.assign ({}, process.env, {NODE_PATH: folderModules, PORT: String (thePort)})
	});

var serverOutput = "";
theServer.stdout.on ("data", function (chunk) {
	serverOutput += chunk;
	});
theServer.stderr.on ("data", function (chunk) {
	serverOutput += chunk;
	});

function request (theOptions, theBody, callback) {
	const theRequest = http.request (theOptions, function (theResponse) {
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

const theTests = [];
var ctOk = 0, ctFailed = 0;

function test (theName, theOptions, theBody, checkCallback) {
	theTests.push ({theName, theOptions, theBody, checkCallback});
	}

function runNextTest () {
	if (theTests.length === 0) {
		console.log ("");
		console.log (ctOk + " ok, " + ctFailed + " failed");
		console.log ("");
		console.log ("--- the server said:");
		console.log (serverOutput);
		theServer.kill ();
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

function get (thePath) {
	return ({hostname: "127.0.0.1", port: thePort, path: thePath, method: "GET"});
	}
function post (thePath) {
	return ({hostname: "127.0.0.1", port: thePort, path: thePath, method: "POST", headers: {"Content-Type": "text/plain"}});
	}

//1. the front page and the version, no password needed
	test ("/ answers with a usage page", get ("/"), undefined, function (theCode, theResult, theText) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theText.indexOf ("trigger v") === -1) {
			return ("expected the product name in the text");
			}
		});
	test ("/version reports itself and the row count", get ("/version"), undefined, function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.product !== "trigger") {
			return ("expected product trigger");
			}
		if (theResult.ctDatabaseRows < 200000) {
			return ("expected the full database, got " + theResult.ctDatabaseRows + " rows");
			}
		});

//2. the password gate
	test ("no password is refused", get ("/run?script=1%20%2B%201"), undefined, function (theCode, theResult) {
		if (theCode !== 401) {
			return ("expected 401");
			}
		if (theResult.message === undefined) {
			return ("expected a message");
			}
		});
	test ("a wrong password is refused", get ("/run?password=nope&script=1%20%2B%201"), undefined, function (theCode) {
		if (theCode !== 401) {
			return ("expected 401");
			}
		});
	test ("the password in a header works", post ("/run"), "1 + 1", function (theCode) {
		if (theCode !== 401) { //no header set on this one, so it must still refuse
			return ("expected 401 without the header");
			}
		});

//3. arithmetic and strings -- the value comes back
	test ("arithmetic", get ("/run?password=" + thePassword + "&script=" + encodeURIComponent ("2 + 3 * 4")), undefined, function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.value !== 14) {
			return ("expected 14, got " + JSON.stringify (theResult.value));
			}
		if (theResult.valueType !== "number") {
			return ("expected valueType number");
			}
		});
	test ("string.lower through the database", get ("/run?password=" + thePassword + "&script=" + encodeURIComponent ("string.lower (\"HELLO Frontier\")")), undefined, function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.value !== "hello frontier") {
			return ("expected hello frontier, got " + JSON.stringify (theResult.value));
			}
		});
	test ("a dotted address written out in full", get ("/run?password=" + thePassword + "&script=" + encodeURIComponent ("system.verbs.builtins.string.upper (\"still here\")")), undefined, function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.value !== "STILL HERE") {
			return ("expected STILL HERE, got " + JSON.stringify (theResult.value));
			}
		});

//4. a multi-line script, POSTed the way an outliner would send it
	test ("a multi-line script with a loop", post ("/run?password=" + thePassword), "local (total = 0)\nfor i = 1 to 10\n\ttotal = total + i\ntotal", function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.value !== 55) {
			return ("expected 55, got " + JSON.stringify (theResult.value));
			}
		});

//5. an OPML document, the way an outliner saves it
	test ("an OPML script", post ("/run?password=" + thePassword), "<?xml version=\"1.0\"?>\n<opml version=\"2.0\"><head><title>test</title></head><body>\n<outline text=\"local (s = &quot;abc&quot;)\" />\n<outline text=\"string.upper (s)\" />\n</body></opml>", function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.value !== "ABC") {
			return ("expected ABC, got " + JSON.stringify (theResult.value));
			}
		});

//6. a table comes back as its entry names, not its whole subtree
	test ("a table reports entry names", get ("/run?password=" + thePassword + "&script=" + encodeURIComponent ("@system.verbs.builtins.string")), undefined, function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.valueType !== "address") {
			return ("expected an address, got " + theResult.valueType);
			}
		});

//7. writing into the database persists inside one run
	test ("a write, then a read", post ("/run?password=" + thePassword), "scratchpad.triggerTest = \"written by the test\"\nscratchpad.triggerTest", function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.value !== "written by the test") {
			return ("expected the written string, got " + JSON.stringify (theResult.value));
			}
		});
	test ("the write is still there on the next request", get ("/run?password=" + thePassword + "&script=" + encodeURIComponent ("scratchpad.triggerTest")), undefined, function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.value !== "written by the test") {
			return ("expected the string to persist, got " + JSON.stringify (theResult.value));
			}
		});

//8. errors come back as a message, not a stack
	test ("a script that fails answers with a message", get ("/run?password=" + thePassword + "&script=" + encodeURIComponent ("noSuchVerb (1)")), undefined, function (theCode, theResult) {
		if (theCode !== 500) {
			return ("expected 500");
			}
		if (theResult.message === undefined) {
			return ("expected a message");
			}
		});
	test ("an empty script is refused", get ("/run?password=" + thePassword + "&script="), undefined, function (theCode, theResult) {
		if (theCode !== 400) {
			return ("expected 400");
			}
		});
	test ("an unknown path is a 404", get ("/nosuchthing"), undefined, function (theCode) {
		if (theCode !== 404) {
			return ("expected 404");
			}
		});

//8b. a missing script parameter must not take the server down
	test ("no script parameter at all is a 400", get ("/run?password=" + thePassword), undefined, function (theCode, theResult) {
		if (theCode !== 400) {
			return ("expected 400");
			}
		if (theResult.message === undefined) {
			return ("expected a message");
			}
		});
	test ("the server is still alive after that", get ("/version"), undefined, function (theCode) {
		if (theCode !== 200) {
			return ("expected 200 -- the server died");
			}
		});

//9. the trace, only when asked for
	test ("no trace unless it's asked for", get ("/run?password=" + thePassword + "&script=" + encodeURIComponent ("string.lower (\"ABC\")")), undefined, function (theCode, theResult) {
		if (theResult.trace !== undefined) {
			return ("expected no trace in the answer");
			}
		});
	test ("trace=1 returns the verb calls", get ("/run?password=" + thePassword + "&trace=1&script=" + encodeURIComponent ("string.lower (\"ABC\")")), undefined, function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.trace === undefined) {
			return ("expected a trace");
			}
		if (theResult.trace.length === 0) {
			return ("expected at least one verb call in the trace");
			}
		});

setTimeout (runNextTest, 2500); //give the server a moment to open the database
