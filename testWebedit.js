/*  Local tests for the webEdit endpoint's download half, webEdit.getFromServer.
	Builds an isolated trigger installation in the system temp folder (own
	config, fresh database with fixture objects), starts it, runs the checks,
	reports, stops it.

	node testWebedit.js

	by CC, 8/3/26 */

const {spawn, execSync} = require ("child_process");
const http = require ("http");
const fs = require ("fs");
const os = require ("os");
const pathTool = require ("path");

const folderTrigger = __dirname;
const folderModules = pathTool.join (folderTrigger, "node_modules");

//this process opens the database too (to install fixtures), so it needs trigger's modules on its own path
	process.env.NODE_PATH = folderModules + ((process.env.NODE_PATH !== undefined) ? ":" + process.env.NODE_PATH : "");
	require ("module")._initPaths ();
const folderTest = pathTool.join (os.tmpdir (), "triggerWebeditTest");
const thePort = 1681;
const theWebeditPassword = "webedittest";

//the characters whose bytes differ between unicode and MacRoman -- an independent copy, small on purpose, so a bug in the server's table can't hide
	const macRomanBytes = {
		"«": 0xC7, //left guillemot, the comment character
		"“": 0xD2, //left curly double quote
		"”": 0xD3 //right curly double quote
		};
	function expectedBytes (theText) {
		const theBytes = Buffer.alloc (theText.length);
		var ix = 0;
		theText.split ("").forEach (function (theChar) {
			const theCode = theChar.charCodeAt (0);
			if (theCode < 0x80) {
				theBytes [ix] = theCode;
				}
			else {
				theBytes [ix] = macRomanBytes [theChar];
				}
			ix++;
			});
		return (theBytes);
		}

//build the isolated installation
	var folderUsertalk = pathTool.resolve (folderTrigger, "../usertalk");
	try {
		const configReal = JSON.parse (fs.readFileSync (pathTool.join (folderTrigger, "config.json"), "utf8"));
		if (configReal.pathUsertalk !== undefined) {
			folderUsertalk = pathTool.resolve (folderTrigger, configReal.pathUsertalk);
			}
		}
	catch (err) {
		}
	fs.rmSync (folderTest, {recursive: true, force: true});
	fs.mkdirSync (pathTool.join (folderTest, "data"), {recursive: true});
	fs.copyFileSync (pathTool.join (folderTrigger, "trigger.js"), pathTool.join (folderTest, "trigger.js"));
	fs.copyFileSync (pathTool.join (folderTrigger, "frontierodb.js"), pathTool.join (folderTest, "frontierodb.js"));
	fs.writeFileSync (pathTool.join (folderTest, "config.json"), JSON.stringify ({
		port: thePort,
		password: "testonly",
		pathUsertalk: folderUsertalk,
		pathDatabase: "data/odb.db",
		webeditUsername: "dave",
		webeditPassword: theWebeditPassword,
		flLogRequests: true
		}, undefined, "\t"));

//install the fixtures -- comments, nesting, a quoted string, MacRoman characters, malformed shapes
	const chevron = "«"; //left guillemot, the comment character
	const trickyLine = "if 2 > 1 " + chevron + "a trailing comment with “curly quotes”"; //curly quotes: the MacRoman round trip must keep them
	const odbSql = require (pathTool.join (folderUsertalk, "code", "odbSql.js"));
	const theStore = odbSql.openDatabase (pathTool.join (folderTest, "data", "odb.db"));
	const fixtureLines = [
		{level: 0, text: "on downloadFixture ()", flExpanded: true, flComment: false, flBreakpoint: false},
		{level: 1, text: "Changes", flExpanded: true, flComment: true, flBreakpoint: false},
		{level: 2, text: "8/3/26 by CC", flExpanded: true, flComment: false, flBreakpoint: false},
		{level: 1, text: "local (greeting = \"hello\")", flExpanded: true, flComment: false, flBreakpoint: false},
		{level: 1, text: trickyLine, flExpanded: true, flComment: false, flBreakpoint: false},
		{level: 1, text: "return (greeting)", flExpanded: true, flComment: false, flBreakpoint: false}
		];
	theStore.odb.system = {temp: {
		downloadfixture: {flOdbScript: true, scriptType: "script", lines: fixtureLines},
		sometable: {a: 1},
		stringlines: {flOdbScript: true, scriptType: "script", lines: "abc"}, //lines that aren't an array must fault, not crash
		holeylines: {flOdbScript: true, scriptType: "script", lines: [null, {level: 0, text: "still here", flComment: false}]} //a malformed entry is skipped
		}};
	theStore.odb.user = {scripts: {elsewhere: {flOdbScript: true, scriptType: "script", lines: [{level: 0, text: "outside the old roots", flComment: false}]}}}; //no part of the database is untouchable -- DW, 8/3/26
	const expectedText = "on downloadFixture ()\r\t" + chevron + "Changes\r\t\t8/3/26 by CC\r\tlocal (greeting = \"hello\")\r\t" + trickyLine + "\r\treturn (greeting)\r";
	if (theStore.close !== undefined) {
		theStore.close ();
		}

function freePort (thePortToFree) {
	try {
		const theOutput = execSync ("lsof -ti tcp:" + thePortToFree, {encoding: "utf8"});
		theOutput.split ("\n").forEach (function (line) {
			const thePid = Number (line.trim ());
			if (thePid > 0) {
				try {
					process.kill (thePid, "SIGKILL");
					}
				catch (err) {
					}
				}
			});
		}
	catch (err) { //lsof exits non-zero when nothing holds the port
		}
	}

freePort (thePort);

const theServer = spawn ("node", [pathTool.join (folderTest, "trigger.js")], {
	cwd: folderTest,
	env: Object.assign ({}, process.env, {NODE_PATH: folderModules})
	});

var serverOutput = "";
theServer.stdout.on ("data", function (chunk) {
	serverOutput += chunk;
	});
theServer.stderr.on ("data", function (chunk) {
	serverOutput += chunk;
	});

function rpcCall (verb, theParams, callback) { //the same XML the UserTalk client builds
	var xmltext = "";
	function add (theString) {
		xmltext += theString + "\r";
		}
	function encode (theString) {
		var result = theString;
		result = result.split ("&").join ("&amp;");
		result = result.split ("<").join ("&lt;");
		result = result.split (">").join ("&gt;");
		return (result);
		}
	add ("<?xml version=\"1.0\"?>");
	add ("<methodCall>");
	add ("<methodName>" + verb + "</methodName>");
	add ("<params>");
	theParams.forEach (function (param) {
		add ("<param><value><string>" + encode (param) + "</string></value></param>");
		});
	add ("</params>");
	add ("</methodCall>");
	const theRequest = http.request ({hostname: "127.0.0.1", port: thePort, path: "/RPC2", method: "POST", headers: {"Content-Type": "text/xml"}}, function (theResponse) {
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
	theRequest.write (xmltext);
	theRequest.end ();
	}

function payloadFromResponse (theText) { //the first <string> in the response, the way the UserTalk client reads it
	const ixStart = theText.indexOf ("<string>");
	if (ixStart < 0) {
		return (undefined);
		}
	const ixEnd = theText.indexOf ("</string>", ixStart);
	if (ixEnd < 0) {
		return (undefined);
		}
	return (theText.substring (ixStart + 8, ixEnd));
	}

const theTests = [];
var ctOk = 0, ctFailed = 0;

function test (theName, verb, theParams, checkCallback) {
	theTests.push ({theName, verb, theParams, checkCallback});
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
		rpcCall (theTest.verb, theTest.theParams, function (theCode, theText) {
			const theProblem = theTest.checkCallback (theCode, theText);
			if (theProblem === undefined) {
				ctOk++;
				console.log ("ok    " + theTest.theName);
				}
			else {
				ctFailed++;
				console.log ("FAIL  " + theTest.theName + " -- " + theProblem);
				console.log ("      got " + theCode + ": " + theText.replace (/\n/g, " ").slice (0, 400));
				}
			runNextTest ();
			});
		}
	}

//1. the happy path -- the fixture comes back byte-for-byte in MacRoman
	test ("a script downloads and matches byte-for-byte, MacRoman intact", "webEdit.getFromServer", ["dave", theWebeditPassword, "system.temp.downloadfixture"], function (theCode, theText) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theText.indexOf ("<fault>") !== -1) {
			return ("expected a value, got a fault");
			}
		const theB64 = payloadFromResponse (theText);
		if (theB64 === undefined) {
			return ("no <string> payload in the response");
			}
		const theBytes = Buffer.from (theB64, "base64");
		const theExpected = expectedBytes (expectedText);
		if (!theBytes.equals (theExpected)) {
			return ("bytes don't match -- got " + JSON.stringify (theBytes.toString ("latin1")));
			}
		});

//2. address forms -- the leading @, and the database's case-blind names
	test ("an address with a leading @ works", "webEdit.getFromServer", ["dave", theWebeditPassword, "@system.temp.downloadfixture"], function (theCode, theText) {
		if ((theCode !== 200) || (theText.indexOf ("<fault>") !== -1)) {
			return ("expected the same success as the plain address");
			}
		});
	test ("a mixed-case address resolves, the way the database does", "webEdit.getFromServer", ["dave", theWebeditPassword, "System.Temp.downloadFixture"], function (theCode, theText) {
		if ((theCode !== 200) || (theText.indexOf ("<fault>") !== -1)) {
			return ("expected success -- the database resolves names case-blind");
			}
		});

//3. the gates, each one by name
	test ("a wrong password is refused", "webEdit.getFromServer", ["dave", "nope", "system.temp.downloadfixture"], function (theCode, theText) {
		if (theText.indexOf ("invalid username or password") === -1) {
			return ("expected the auth fault");
			}
		});
	test ("a wrong username is refused", "webEdit.getFromServer", ["mallory", theWebeditPassword, "system.temp.downloadfixture"], function (theCode, theText) {
		if (theText.indexOf ("invalid username or password") === -1) {
			return ("expected the auth fault");
			}
		});
	test ("an address anywhere in the database is reachable", "webEdit.getFromServer", ["dave", theWebeditPassword, "user.scripts.elsewhere"], function (theCode, theText) {
		const theB64 = payloadFromResponse (theText);
		if (theB64 === undefined) {
			return ("expected a payload -- no roots gate any more, DW 8/3/26");
			}
		const decoded = Buffer.from (theB64, "base64").toString ("latin1");
		if (decoded !== "outside the old roots\r") {
			return ("expected the script outside the old roots, got " + JSON.stringify (decoded));
			}
		});
	test ("a dirty address is refused", "webEdit.getFromServer", ["dave", theWebeditPassword, "system.temp..downloadfixture"], function (theCode, theText) {
		if (theText.indexOf ("clean dotted address") === -1) {
			return ("expected the clean-address fault");
			}
		});
	test ("a proto-polluting address is refused", "webEdit.getFromServer", ["dave", theWebeditPassword, "system.temp.__proto__"], function (theCode, theText) {
		if (theText.indexOf ("clean dotted address") === -1) {
			return ("expected the clean-address fault");
			}
		});
	test ("a missing object is reported", "webEdit.getFromServer", ["dave", theWebeditPassword, "system.temp.nosuchthing"], function (theCode, theText) {
		if (theText.indexOf ("no object at that address") === -1) {
			return ("expected the missing-object fault");
			}
		});
	test ("a table is refused, scripts only", "webEdit.getFromServer", ["dave", theWebeditPassword, "system.temp.sometable"], function (theCode, theText) {
		if (theText.indexOf ("only downloads scripts") === -1) {
			return ("expected the scripts-only fault");
			}
		});
	test ("too few parameters is reported", "webEdit.getFromServer", ["dave", theWebeditPassword], function (theCode, theText) {
		if (theText.indexOf ("takes 3 parameters") === -1) {
			return ("expected the parameter-count fault");
			}
		});

//4. malformed stored shapes fault or heal -- the server must never die
	test ("a script whose lines aren't an array faults, no crash", "webEdit.getFromServer", ["dave", theWebeditPassword, "system.temp.stringlines"], function (theCode, theText) {
		if (theText.indexOf ("only downloads scripts") === -1) {
			return ("expected the scripts-only fault");
			}
		});
	test ("a malformed line entry is skipped, the rest arrives", "webEdit.getFromServer", ["dave", theWebeditPassword, "system.temp.holeylines"], function (theCode, theText) {
		const theB64 = payloadFromResponse (theText);
		if (theB64 === undefined) {
			return ("expected a payload");
			}
		const decoded = Buffer.from (theB64, "base64").toString ("latin1");
		if (decoded !== "still here\r") {
			return ("expected just the good line, got " + JSON.stringify (decoded));
			}
		});
	test ("the server is still alive after all that", "webEdit.getFromServer", ["dave", theWebeditPassword, "system.temp.downloadfixture"], function (theCode, theText) {
		if (theCode !== 200) {
			return ("expected 200 -- the server died");
			}
		});

//5. the old verb still gates the same way -- the endpoint didn't regress
	test ("an unknown verb still answers the not-implemented fault", "webEdit.somethingElse", ["a", "b", "c"], function (theCode, theText) {
		if (theText.indexOf ("isn't a procedure this server implements") === -1) {
			return ("expected the not-implemented fault");
			}
		});
	test ("sendToServer still answers (parameter-count fault, not a crash)", "webEdit.sendToServer", ["dave", theWebeditPassword], function (theCode, theText) {
		if (theText.indexOf ("takes at least 5 parameters") === -1) {
			return ("expected the sendToServer parameter-count fault");
			}
		});

setTimeout (runNextTest, 1500); //give the server a moment to open the database
