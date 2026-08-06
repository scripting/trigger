/*  Local tests for the three calls Electric Drummer makes: /run, /downloadobject
	and /uploadobject. Objects move as OPML. Builds an isolated trigger
	installation in the system temp folder, starts it, runs the checks, stops it.

	node testObjects.js

	by CC, 8/4/26 */

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

const folderTest = pathTool.join (os.tmpdir (), "triggerObjectsTest");
const thePort = 1682;
const theRunPassword = "runtestonly";
const theWebeditPassword = "webedittest";
const chevron = "«"; //left guillemot, Frontier's comment character

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
		password: theRunPassword,
		pathUsertalk: folderUsertalk,
		pathDatabase: "data/odb.db",
		webeditUsername: "dave",
		webeditPassword: theWebeditPassword,
		flLogRequests: true
		}, undefined, "\t"));

//the fixture -- nesting, a comment block, quotes and an ampersand, all the things OPML has to survive
	const odbSql = require (pathTool.join (folderUsertalk, "code", "odbSql.js"));
	const theStore = odbSql.openDatabase (pathTool.join (folderTest, "data", "odb.db"));
	const fixtureLines = [
		{level: 0, text: "on downloadFixture ()", flExpanded: true, flComment: false, flBreakpoint: false},
		{level: 1, text: "Changes", flExpanded: true, flComment: true, flBreakpoint: false},
		{level: 2, text: "8/4/26 by CC", flExpanded: true, flComment: false, flBreakpoint: false},
		{level: 1, text: "local (greeting = \"hello & goodbye\")", flExpanded: true, flComment: false, flBreakpoint: false},
		{level: 1, text: "if 2 > 1", flExpanded: true, flComment: false, flBreakpoint: false},
		{level: 2, text: "return (greeting)", flExpanded: true, flComment: false, flBreakpoint: false}
		];
	theStore.odb.system = {temp: {
		downloadfixture: {flOdbScript: true, scriptType: "script", lines: fixtureLines},
		sometable: {a: 1}
		}};
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

function request (theMethod, thePath, theBody, callback) {
	const theOptions = {hostname: "127.0.0.1", port: thePort, path: thePath, method: theMethod, headers: {}};
	if (theBody !== undefined) {
		theOptions.headers ["Content-Type"] = "text/plain; charset=utf-8";
		}
	const theRequest = http.request (theOptions, function (theResponse) {
		var theText = "";
		theResponse.on ("data", function (chunk) {
			theText += chunk;
			});
		theResponse.on ("end", function () {
			var theResult;
			try {
				theResult = JSON.parse (theText);
				}
			catch (err) {
				theResult = {rawText: theText};
				}
			callback (theResponse.statusCode, theResult, theResponse.headers);
			});
		});
	theRequest.on ("error", function (err) {
		callback (0, {message: err.message}, {});
		});
	if (theBody !== undefined) {
		theRequest.write (theBody);
		}
	theRequest.end ();
	}

const theTests = [];
var ctOk = 0, ctFailed = 0;
var opmlFromServer; //carried from the download check to the upload check

function test (theName, theMethod, thePath, theBody, checkCallback) {
	theTests.push ({theName, theMethod, thePath, theBody, checkCallback});
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
		const thePath = (typeof theTest.thePath === "function") ? theTest.thePath () : theTest.thePath;
		const theBody = (typeof theTest.theBody === "function") ? theTest.theBody () : theTest.theBody;
		request (theTest.theMethod, thePath, theBody, function (theCode, theResult, theHeaders) {
			const theProblem = theTest.checkCallback (theCode, theResult, theHeaders);
			if (theProblem === undefined) {
				ctOk++;
				console.log ("ok    " + theTest.theName);
				}
			else {
				ctFailed++;
				console.log ("FAIL  " + theTest.theName + " -- " + theProblem);
				console.log ("      got " + theCode + ": " + JSON.stringify (theResult).slice (0, 400));
				}
			runNextTest ();
			});
		}
	}

//1. downloadObject -- the object comes back as OPML
	test ("downloadobject returns OPML", "GET", "/downloadobject?password=" + theWebeditPassword + "&address=system.temp.downloadfixture", undefined, function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.opmltext === undefined) {
			return ("expected opmltext");
			}
		opmlFromServer = theResult.opmltext;
		if (theResult.ctLines !== 6) {
			return ("expected 6 lines, got " + theResult.ctLines);
			}
		if (theResult.opmltext.indexOf ("isComment=\"true\"") === -1) {
			return ("the comment line lost its isComment attribute");
			}
		if (theResult.opmltext.indexOf ("hello &amp; goodbye") === -1) {
			return ("the ampersand isn't escaped in the OPML");
			}
		if (theResult.opmltext.indexOf ("2 &gt; 1") === -1) {
			return ("the greater-than isn't escaped in the OPML");
			}
		});

//2. the round trip -- upload what came down, download it again, everything survives
	test ("uploadobject installs the OPML", "POST", function () {
		return ("/uploadobject?password=" + theWebeditPassword + "&address=system.temp.roundtrip&type=script");
		}, function () {
		return (opmlFromServer);
		}, function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.ctLines !== 6) {
			return ("expected 6 lines installed, got " + theResult.ctLines);
			}
		});
	test ("the round trip is byte-for-byte", "GET", "/downloadobject?password=" + theWebeditPassword + "&address=system.temp.roundtrip", undefined, function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		const expected = opmlFromServer.split ("<title>downloadfixture</title>").join ("<title>roundtrip</title>");
		if (theResult.opmltext !== expected) {
			return ("the OPML changed on the round trip:\n--- sent:\n" + expected + "\n--- got back:\n" + theResult.opmltext);
			}
		});
	test ("the installed script still runs", "GET", function () {
		return ("/run?password=" + theWebeditPassword + "&script=" + encodeURIComponent ("system.temp.roundtrip ()"));
		}, undefined, function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.value !== "hello & goodbye") {
			return ("expected the greeting, got " + JSON.stringify (theResult.value));
			}
		});

//3. an outline uploads as an outline, and comes back as one
	test ("an outline uploads with type=outline", "POST", function () {
		return ("/uploadobject?password=" + theWebeditPassword + "&address=system.temp.anoutline&type=outline");
		}, "<?xml version=\"1.0\"?>\n<opml version=\"2.0\"><head><title>t</title></head><body>\n<outline text=\"parent\"><outline text=\"child\" /></outline>\n</body></opml>", function (theCode, theResult) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		if (theResult.scriptType !== "outline") {
			return ("expected scriptType outline, got " + theResult.scriptType);
			}
		if (theResult.ctLines !== 2) {
			return ("expected 2 lines, got " + theResult.ctLines);
			}
		});
	test ("the outline comes back with its nesting", "GET", "/downloadobject?password=" + theWebeditPassword + "&address=system.temp.anoutline", undefined, function (theCode, theResult) {
		if (theResult.scriptType !== "outline") {
			return ("expected scriptType outline");
			}
		if (theResult.opmltext.indexOf ("<outline text=\"parent\">") === -1) {
			return ("expected the parent to open an element");
			}
		if (theResult.opmltext.indexOf ("<outline text=\"child\">") === -1) {
			return ("expected the child inside it");
			}
		});

//4. both passwords open these calls -- DW has the webedit one
	test ("the run password works too", "GET", "/downloadobject?password=" + theRunPassword + "&address=system.temp.downloadfixture", undefined, function (theCode) {
		if (theCode !== 200) {
			return ("expected 200");
			}
		});
	test ("the webedit password runs a script", "GET", function () {
		return ("/run?password=" + theWebeditPassword + "&script=" + encodeURIComponent ("2 + 2"));
		}, undefined, function (theCode, theResult) {
		if (theResult.value !== 4) {
			return ("expected 4, got " + JSON.stringify (theResult.value));
			}
		});
	test ("a wrong password is refused on download", "GET", "/downloadobject?password=nope&address=system.temp.downloadfixture", undefined, function (theCode) {
		if (theCode !== 401) {
			return ("expected 401");
			}
		});
	test ("a wrong password is refused on upload", "POST", "/uploadobject?password=nope&address=system.temp.x", "<opml><body><outline text=\"x\"/></body></opml>", function (theCode) {
		if (theCode !== 401) {
			return ("expected 401");
			}
		});

//5. the gates
	test ("a missing address is reported", "GET", "/downloadobject?password=" + theWebeditPassword, undefined, function (theCode, theResult) {
		if (theCode !== 400) {
			return ("expected 400");
			}
		});
	test ("a missing object is reported", "GET", "/downloadobject?password=" + theWebeditPassword + "&address=system.temp.nosuchthing", undefined, function (theCode) {
		if (theCode !== 404) {
			return ("expected 404");
			}
		});
	test ("a table is refused", "GET", "/downloadobject?password=" + theWebeditPassword + "&address=system.temp.sometable", undefined, function (theCode, theResult) {
		if (theCode !== 400) {
			return ("expected 400");
			}
		if (String (theResult.message).indexOf ("script or an outline") === -1) {
			return ("expected the script-or-outline message");
			}
		});
	test ("a proto-polluting address is refused", "GET", "/downloadobject?password=" + theWebeditPassword + "&address=system.temp.__proto__", undefined, function (theCode) {
		if (theCode !== 400) {
			return ("expected 400");
			}
		});
	test ("empty OPML is refused", "POST", "/uploadobject?password=" + theWebeditPassword + "&address=system.temp.empty", "   ", function (theCode) {
		if (theCode !== 400) {
			return ("expected 400");
			}
		});
	test ("OPML with no outline elements is refused", "POST", "/uploadobject?password=" + theWebeditPassword + "&address=system.temp.empty", "<opml><body></body></opml>", function (theCode, theResult) {
		if (theCode !== 400) {
			return ("expected 400");
			}
		if (String (theResult.message).indexOf ("no outline elements") === -1) {
			return ("expected the no-outline-elements message");
			}
		});
	test ("a bad type is refused", "POST", "/uploadobject?password=" + theWebeditPassword + "&address=system.temp.x&type=table", "<opml><body><outline text=\"x\"/></body></opml>", function (theCode) {
		if (theCode !== 400) {
			return ("expected 400");
			}
		});
	test ("GET on uploadobject is refused", "GET", "/uploadobject?password=" + theWebeditPassword + "&address=system.temp.x", undefined, function (theCode) {
		if (theCode !== 405) {
			return ("expected 405");
			}
		});

//6. the browser's preflight, so Drummer can call without a proxy
	test ("OPTIONS answers the preflight", "OPTIONS", "/uploadobject", undefined, function (theCode, theResult, theHeaders) {
		if (theCode !== 204) {
			return ("expected 204");
			}
		if (theHeaders ["access-control-allow-origin"] !== "*") {
			return ("expected the allow-origin header");
			}
		});
	test ("answers carry the CORS header", "GET", "/version", undefined, function (theCode, theResult, theHeaders) {
		if (theHeaders ["access-control-allow-origin"] !== "*") {
			return ("expected the allow-origin header on a normal answer");
			}
		if (theResult.version === undefined) {
			return ("expected a version");
			}
		});

//7. the server is still standing
	test ("the server is still alive", "GET", "/version", undefined, function (theCode) {
		if (theCode !== 200) {
			return ("expected 200 -- the server died");
			}
		});

setTimeout (runNextTest, 1500); //give the server a moment to open the database
