const myProductName = "trigger", myVersion = "0.5.1"; //7/29/26 by CC -- ship a UserTalk script to a server, run it there, get the value back; named by DW

const http = require ("http");
const fs = require ("fs");
const pathTool = require ("path");
const xmlrpc = require ("davexmlrpc"); //8/1/26 by CC -- the webEdit endpoint speaks XML-RPC, using DW's implementation
const xml2jsTool = require ("xml2js"); //8/1/26 by CC -- gates /rpc2 bodies: davexmlrpc throws on malformed XML, so nothing malformed may reach it

var frontierodb; //assigned by requireFrontierOdb, on the first upload -- an installed package wins, else the copy beside this file

const pathConfig = pathTool.join (__dirname, "config.json");

const config = { //defaults -- config.json wins, and PORT from the environment wins over both
	port: 1680,
	password: "",
	pathUsertalk: "usertalk",
	pathDatabase: "data/odb.db",
	maxVerbCalls: 1000000,
	flLogRequests: true,
	webeditUsername: "dave", //8/1/26 by CC -- the webEdit upload endpoint; empty webeditPassword locks it
	webeditPassword: "",
	maxWebeditBytes: 10000000, //a guard the security review required; the biggest object in the suite is far under 1MB
	folderWebeditReceived: "webeditReceived",
	maxSavedBlobs: 100,
	pathConcord: "concord" //8/7/26 by CC -- the odb browser page loads the Concord outliner from this folder
	};

if (fs.existsSync (pathConfig)) {
	const configFromFile = JSON.parse (fs.readFileSync (pathConfig, "utf8"));
	Object.keys (configFromFile).forEach (function (name) {
		config [name] = configFromFile [name];
		});
	}

if (process.env.PORT !== undefined) { //PagePark hands the port to the app this way
	config.port = Number (process.env.PORT);
	}

const folderUsertalk = pathTool.resolve (__dirname, config.pathUsertalk);
const pathDatabase = pathTool.resolve (__dirname, config.pathDatabase);
const folderConcord = pathTool.resolve (__dirname, config.pathConcord);
const folderOdbBrowser = pathTool.join (__dirname, "odbBrowser");

const parse = require (folderUsertalk + "/code/parse.js");
const evaluate = require (folderUsertalk + "/code/evaluate.js");
const verbsMaker = require (folderUsertalk + "/code/verbs.js");
const odbSql = require (folderUsertalk + "/code/odbSql.js");

/*  usertalk.js isn't required here on purpose -- it pulls in odbLoader,
	which reads roots off the local disk. Trigger only wants the version,
	so it reads it out of the package.  */
const versionUsertalk = JSON.parse (fs.readFileSync (folderUsertalk + "/package.json", "utf8")).version;

var theStore; //assigned by startup, holds the open database
var selectListerChildren, selectListerRow, countListerChildren; //assigned by startup -- read-only statements for the odb browser's listing endpoint

//the script that came in
	function unescapeXml (theString) {
		return (theString
			.replace (/&lt;/g, "<")
			.replace (/&gt;/g, ">")
			.replace (/&quot;/g, "\"")
			.replace (/&apos;/g, "'")
			.replace (/&amp;/g, "&"));
		}
	function opmlToTree (theXml) { //copied from usertalk's run.js -- the outline an editor saved becomes statements
		const root = {text: "", subs: []};
		const stack = [root];
		var depthSkip = -1;
		var depth = 0;
		const tagPattern = /<outline\b([^>]*?)(\/?)>|<\/outline>/g;
		var match;
		while ((match = tagPattern.exec (theXml)) !== null) {
			if (match [0] === "</outline>") {
				depth--;
				if ((depthSkip >= 0) && (depth <= depthSkip)) {
					depthSkip = -1;
					}
				stack.length = depth + 1;
				}
			else {
				const attributes = match [1];
				const flSelfClosing = match [2] === "/";
				const flComment = /isComment="true"/.test (attributes);
				const textMatch = attributes.match (/text="([^"]*)"/);
				var text = "";
				if (textMatch !== null) {
					text = unescapeXml (textMatch [1]);
					}
				if (depthSkip === -1) {
					if (flComment) {
						if (!flSelfClosing) {
							depthSkip = depth;
							}
						}
					else {
						const node = {text, subs: []};
						stack [depth].subs.push (node);
						if (!flSelfClosing) {
							stack [depth + 1] = node;
							}
						}
					}
				if (!flSelfClosing) {
					depth++;
					}
				}
			}
		return (root.subs);
		}
	function textToTree (theText) { //tab-indented lines, the way a script looks pasted out of an outliner
		const theLines = [];
		theText.split ("\n").forEach (function (line) {
			const withoutTabs = line.replace (/^\t+/, "");
			if (withoutTabs.trim ().length > 0) {
				theLines.push ({level: line.length - withoutTabs.length, text: withoutTabs, flComment: false});
				}
			});
		return (parse.linesToTree (theLines));
		}
	function scriptToStatements (theScript) {
		if (theScript.trim ().startsWith ("<")) { //an OPML document, from an outliner
			return (parse.parseOutline (opmlToTree (theScript)));
			}
		return (parse.parseOutline (textToTree (theScript)));
		}

//the value that comes back
	function serializeValue (theValue, level) {

		/*  A value the way the caller can read it over HTTP. Tables report
			their entry NAMES and nothing more -- Reflect.ownKeys asks the
			database for names only, where Object.keys would materialize
			every value under it.  */

		if (level === undefined) {
			level = 0;
			}
		if ((theValue === undefined) || (theValue === null)) {
			return ({valueType: "nothing", value: undefined});
			}
		if (typeof theValue === "string") {
			return ({valueType: "string", value: theValue});
			}
		if (typeof theValue === "number") {
			return ({valueType: "number", value: theValue});
			}
		if (typeof theValue === "boolean") {
			return ({valueType: "boolean", value: theValue});
			}
		if (theValue instanceof Date) {
			return ({valueType: "date", value: theValue.toISOString ()});
			}
		if (theValue.flAddress === true) {
			return ({valueType: "address", value: theValue.pathText});
			}
		if (Array.isArray (theValue)) {
			const items = [];
			if (level < 3) {
				theValue.forEach (function (item) {
					items.push (serializeValue (item, level + 1).value);
					});
				}
			return ({valueType: "list", value: items, ctItems: theValue.length});
			}
		if (typeof theValue === "object") {
			const names = [];
			Reflect.ownKeys (theValue).forEach (function (name) {
				if (typeof name === "string") {
					if ((name !== "flOdbSqlTable") && (name !== "odbId")) {
						names.push (name);
						}
					}
				});
			return ({valueType: "table", value: names, ctEntries: names.length});
			}
		return ({valueType: typeof theValue, value: String (theValue)});
		}

//running one script
	function runScript (theScript) {

		/*  String in, value out. A fresh environment every time, so one
			request's locals can't reach the next one -- anything a script
			means to keep it writes into the database.  */

		const whenStart = new Date ();
		const theStatements = scriptToStatements (theScript);

		const theTrace = [];
		theTrace.push = function (entry) { //a loop with no bottom must not take the server down with it
			Array.prototype.push.call (this, entry);
			if (this.length >= config.maxVerbCalls) {
				const message = "Can't finish the script because it hit the cap of " + config.maxVerbCalls + " verb calls -- probably a loop that never ends.";
				throw new Error (message);
				}
			};

		const thePathMap = {helpers: {}, prefs: {}, prefixes: {}}; //8/4/26 by CC -- config.json supplies the map that lets file verbs reach real folders
		if (config.pathMap !== undefined) {
			Object.keys (thePathMap).forEach (function (name) {
				if (config.pathMap [name] !== undefined) {
					thePathMap [name] = config.pathMap [name];
					}
				});
			}
		const made = verbsMaker.makeVerbs (thePathMap, theTrace);
		const environment = evaluate.makeEnvironment (theStore.odb, made.verbs, theTrace);
		environment.parseScript = function (theLines) { //scripts stored in the database parse on first call
			return (parse.parseOutline (parse.linesToTree (theLines)));
			};
		environment.frames.push ({vars: {}});

		const theValue = evaluate.evaluate (theStatements, environment);

		const theResult = serializeValue (theValue);
		theResult.ctVerbCalls = theTrace.length;
		theResult.ctMilliseconds = new Date () - whenStart;
		theResult.theTrace = theTrace;
		return (theResult);
		}
	function traceText (theTrace) { //one line per verb call, the way run.js prints it
		const theLines = [];
		theTrace.forEach (function (entry) {
			var argsText = "";
			entry.args.forEach (function (arg) {
				if (argsText.length > 0) {
					argsText += ", ";
					}
				if (typeof arg === "string") {
					argsText += "\"" + arg + "\"";
					}
				else {
					argsText += String (arg);
					}
				});
			theLines.push (entry.verb + " (" + argsText + ")");
			});
		return (theLines);
		}

//the webEdit endpoint

	/*  POST /rpc2 answers two XML-RPC procedures. webEdit.sendToServer is the
		same call Frontier's webEdit suite has made since 1999 -- so a script
		on DW's desktop can upload an object and it lands in the database
		here. The wire format: the data param is a string holding base64 of
		pack() of the value, the identical bytes a fat page stores in its
		#pageData directive, which is how frontierodb decodes it.

		webEdit.getFromServer (8/3/26) flows the other way -- it answers with
		the script's source text, base64-encoded: tabs for structure, the
		chevron prefix for comment lines, the same rendering string (@adr^)
		produces in Frontier -- so script.newScriptObject can rebuild it on
		DW's desktop.

		Both procedures reach any address in the database -- DW, 8/3/26:
		"i don't know any part that can be untouchable." The password is the
		boundary. Scripts only, for now, in both directions. Installs write
		through the SQL-backed store, so they persist; every received blob is
		also saved to disk before decoding.  */

	const scriptType = "scpt"; //from system.compiler.language.constants, same as UserTalk's global

	function requireFrontierOdb () {
		if (frontierodb === undefined) {
			try {
				frontierodb = require ("frontierodb");
				}
			catch (err) {
				frontierodb = require (pathTool.join (__dirname, "frontierodb.js"));
				}
			}
		}
	function parseAddressString (theAddressString) { //"@system.tmp.examplescript" -> segments, or undefined if it's not a clean address
		var theText = String (theAddressString);
		if (theText.startsWith ("@")) {
			theText = theText.slice (1);
			}
		const segments = theText.split (".");
		var flGood = segments.length > 0;
		segments.forEach (function (segment) {
			if (segment.length === 0) {
				flGood = false;
				}
			if ((segment === "__proto__") || (segment === "constructor") || (segment === "prototype")) {
				flGood = false;
				}
			});
		if (flGood) {
			return (segments);
			}
		return (undefined);
		}
	function saveReceivedBlob (theBuffer, segments) { //every upload is saved before decoding -- nothing is ever lost
		const folderReceived = pathTool.join (__dirname, config.folderWebeditReceived);
		if (!fs.existsSync (folderReceived)) {
			fs.mkdirSync (folderReceived);
			}
		const fname = new Date ().toISOString ().replace (/[:.]/g, "-") + "-" + segments.join (".") + ".bin";
		fs.writeFileSync (pathTool.join (folderReceived, fname), theBuffer);

		const theFiles = fs.readdirSync (folderReceived).filter (function (name) {
			return (name.endsWith (".bin"));
			}).sort ();
		while (theFiles.length > config.maxSavedBlobs) {
			const oldest = theFiles.shift ();
			fs.unlinkSync (pathTool.join (folderReceived, oldest));
			console.log (nowText () + " webedit: pruned saved blob " + oldest);
			}
		return (fname);
		}
	function decodePageData (theBase64) { //hand the blob to frontierodb through a one-directive fat page file
		requireFrontierOdb ();
		const pathTemp = pathTool.join (__dirname, config.folderWebeditReceived, "decoding.ftsc");
		fs.writeFileSync (pathTemp, "#pageData " + theBase64 + "\r", "latin1");
		try {
			const thePage = frontierodb.readFatPage (pathTemp);
			return (thePage.value);
			}
		finally {
			fs.unlinkSync (pathTemp);
			}
		}
	function getValueAtAddress (segments) { //walk the database, undefined if anything on the way is missing
		var current = theStore.odb;
		segments.forEach (function (segment) {
			if ((current !== undefined) && (current !== null) && (typeof current === "object")) {
				current = current [segment];
				}
			else {
				current = undefined;
				}
			});
		return (current);
		}
	const chevron = "«"; //left guillemot, Frontier's comment character
	function scriptToText (theScript, lineEnd) { //the source text of a stored script, the way string (@adr^) renders it in Frontier
		if (lineEnd === undefined) {
			lineEnd = "\r"; //what Frontier's editor expects; the JSON endpoints ask for \n
			}
		var theText = "";
		theScript.lines.forEach (function (line) {
			if ((line !== null) && (typeof line === "object") && (typeof line.text === "string")) { //a malformed entry is skipped, never a crash
				var ctTabs = Math.min (Math.max (Number (line.level) || 0, 0), 100); //the deepest real script in the odb is 16 levels
				var lineText = "";
				while (ctTabs > 0) {
					lineText += "\t";
					ctTabs--;
					}
				if (line.flComment) {
					lineText += chevron;
					}
				lineText += line.text;
				theText += lineText + lineEnd;
				}
			});
		return (theText);
		}
	function scriptToOpml (theScript, theTitle) { //8/4/26 by CC -- OPML is the currency between the server and Electric Drummer
		function encode (theString) {
			return (String (theString)
				.split ("&").join ("&amp;")
				.split ("<").join ("&lt;")
				.split (">").join ("&gt;")
				.split ("\"").join ("&quot;"));
			}
		var theText = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n\t<head>\n\t\t<title>" + encode (theTitle) + "</title>\n\t\t</head>\n\t<body>\n";

		/*  The lines are a flat list with a level on each one -- the same shape
			an outliner shows. The stack holds the level of every element that
			is open right now; a new line closes every open element at its own
			level or deeper, then opens itself inside whatever is left. That
			works no matter what the levels do -- a jump from 0 to 3, or a
			first line that isn't at 0, both of which an outliner can't make
			but the database can hold.  */

		const openLevels = [];
		function indent (ctTabs) {
			var theTabs = "";
			while (ctTabs > 0) {
				theTabs += "\t";
				ctTabs--;
				}
			return (theTabs);
			}
		function closeOne () {
			openLevels.pop ();
			theText += indent (openLevels.length + 2) + "</outline>\n";
			}
		theScript.lines.forEach (function (line) {
			if ((line !== null) && (typeof line === "object") && (typeof line.text === "string")) {
				const theLevel = Math.min (Math.max (Number (line.level) || 0, 0), 100);
				while ((openLevels.length > 0) && (openLevels [openLevels.length - 1] >= theLevel)) {
					closeOne ();
					}
				theText += indent (openLevels.length + 2) + "<outline text=\"" + encode (line.text) + "\"" + ((line.flComment) ? " isComment=\"true\"" : "") + ">\n";
				openLevels.push (theLevel);
				}
			});
		while (openLevels.length > 0) {
			closeOne ();
			}
		theText += "\t\t</body>\n\t</opml>\n";
		return (theText);
		}
	function opmlToScript (theXml, scriptType) { //8/4/26 by CC -- the inverse; nesting becomes levels, isComment rides along
		const theLines = [];
		var depth = 0;
		const tagPattern = /<outline\b([^>]*?)(\/?)>|<\/outline>/g;
		var theMatch;
		while ((theMatch = tagPattern.exec (theXml)) !== null) {
			if (theMatch [0] === "</outline>") {
				depth--;
				}
			else {
				const attributes = theMatch [1];
				const flSelfClosing = theMatch [2] === "/";
				const flComment = /isComment="true"/i.test (attributes);
				const textMatch = attributes.match (/text="([^"]*)"/);
				var text = "";
				if (textMatch !== null) {
					text = unescapeXml (textMatch [1]);
					}
				theLines.push ({level: depth, text, flExpanded: true, flComment, flBreakpoint: false});
				if (!flSelfClosing) {
					depth++;
					}
				}
			}
		return ({flOdbScript: true, scriptType, lines: theLines});
		}
	var macRomanFromChar; //assigned by stringToMacRoman on first use
	function stringToMacRoman (theText) { //the bytes Frontier's editor expects -- the exact inverse of frontierodb's decoder
		requireFrontierOdb ();
		if (macRomanFromChar === undefined) {
			macRomanFromChar = {};
			var theByte;
			for (theByte = 0x80; theByte <= 0xFF; theByte++) {
				macRomanFromChar [frontierodb.macRomanToString (Buffer.from ([theByte]))] = theByte;
				}
			}
		const theBytes = Buffer.alloc (theText.length);
		var ix = 0;
		theText.split ("").forEach (function (theChar) {
			const theCode = theChar.charCodeAt (0);
			if (theCode < 0x80) {
				theBytes [ix] = theCode;
				}
			else {
				const mapped = macRomanFromChar [theChar];
				theBytes [ix] = (mapped !== undefined) ? mapped : 0x3F; //question mark, when MacRoman has no such character
				}
			ix++;
			});
		return (theBytes);
		}
	function installValueAtAddress (segments, theValue) { //walk the database, creating missing tables on the way
		var current = theStore.odb;
		segments.slice (0, segments.length - 1).forEach (function (segment) {
			if ((current [segment] === undefined) || (current [segment] === null) || (typeof current [segment] !== "object")) {
				console.log (nowText () + " webedit: created table " + segment + " on the way to " + segments.join ("."));
				current [segment] = {};
				}
			current = current [segment];
			});
		current [segments [segments.length - 1]] = theValue;
		}
	function handleWebeditCall (theResponse, verb, params, format) {
		function answer (theText) {
			theResponse.writeHead (200, {
				"Content-Type": "text/xml; charset=utf-8",
				"Content-Length": Buffer.byteLength (theText)
				});
			theResponse.end (theText);
			}
		function fault (theMessage, flDelay) { //failed auth answers slowly, everything else right away
			console.log (nowText () + " webedit: " + theMessage);
			const theText = xmlrpc.getFaultText ({message: theMessage}, format);
			if (flDelay) {
				setTimeout (function () {
					answer (theText);
					}, 2000);
				}
			else {
				answer (theText);
				}
			}
		function handleGetFromServer () {
			try {
				if (params.length < 3) {
					fault ("Can't answer the call because webEdit.getFromServer takes 3 parameters and this call has " + params.length + ".");
					return;
					}
				const userName = String (params [0]);
				const password = String (params [1]);
				const addressString = String (params [2]);
				if ((config.webeditPassword.length === 0) || (userName !== config.webeditUsername) || (password !== config.webeditPassword)) {
					fault ("Can't get " + addressString + " because an invalid username or password was supplied.", true);
					return;
					}
				const segments = parseAddressString (addressString);
				if (segments === undefined) {
					fault ("Can't get " + addressString + " because it isn't a clean dotted address.");
					return;
					}
				const theValue = getValueAtAddress (segments);
				if ((theValue === undefined) || (theValue === null)) {
					fault ("Can't get " + addressString + " because there is no object at that address.");
					return;
					}
				if ((theValue.flOdbScript !== true) || (theValue.scriptType !== "script") || (!Array.isArray (theValue.lines))) {
					fault ("Can't get " + addressString + " because it isn't a script, and this version only downloads scripts.");
					return;
					}
				const theText = scriptToText (theValue);
				const theB64 = stringToMacRoman (theText).toString ("base64");
				console.log (nowText () + " webedit: sent " + segments.join (".") + ", " + theText.length + " characters.");
				answer (xmlrpc.getReturnText (theB64, format));
				}
			catch (err) { //a throw from in here would take the whole server down with it -- see the note in handleWebeditRequest
				fault ("Can't answer the call because " + err.message);
				}
			}
		if (verb === "webEdit.getFromServer") {
			handleGetFromServer ();
			return;
			}
		if (verb !== "webEdit.sendToServer") {
			fault ("Can't answer the call because " + verb + " isn't a procedure this server implements.");
			return;
			}
		if (params.length < 5) {
			fault ("Can't answer the call because webEdit.sendToServer takes at least 5 parameters and this call has " + params.length + ".");
			return;
			}
		const userName = String (params [0]);
		const password = String (params [1]);
		const addressString = String (params [2]);
		const dataB64 = String (params [3]);
		const objectType = String (params [4]);

		if ((config.webeditPassword.length === 0) || (userName !== config.webeditUsername) || (password !== config.webeditPassword)) {
			fault ("Can't replace " + addressString + " because an invalid username or password was supplied.", true);
			return;
			}
		const segments = parseAddressString (addressString);
		if (segments === undefined) {
			fault ("Can't replace " + addressString + " because it isn't a clean dotted address.");
			return;
			}
		if (objectType !== scriptType) {
			fault ("Can't replace " + addressString + " because this version only installs scripts, and the call says the object is a " + objectType + ".");
			return;
			}
		const theBuffer = Buffer.from (dataB64, "base64");
		const fname = saveReceivedBlob (theBuffer, segments);
		var theValue;
		try {
			theValue = decodePageData (dataB64);
			}
		catch (err) {
			fault ("Can't install " + addressString + " because the object couldn't be decoded: " + err.message + " Received " + theBuffer.length + " bytes, saved as " + fname + " for analysis.");
			return;
			}
		if ((theValue === undefined) || (theValue.type === undefined)) {
			fault ("Can't install " + addressString + " because the object couldn't be decoded: the bytes don't unpack as any known object type. Received " + theBuffer.length + " bytes, saved as " + fname + " for analysis.");
			return;
			}
		if (theValue.type !== "script") {
			fault ("Can't install " + addressString + " because it decoded as a " + theValue.type + ", and this version only installs scripts.");
			return;
			}
		const theScript = {flOdbScript: true, scriptType: "script", lines: theValue.lines};
		try {
			installValueAtAddress (segments, theScript);
			}
		catch (err) {
			fault ("Can't install " + addressString + " because the database write failed: " + err.message);
			return;
			}
		console.log (nowText () + " webedit: installed " + segments.join (".") + ", " + theBuffer.length + " bytes, saved as " + fname);
		answer (xmlrpc.getReturnText (addressString + " installed in trigger's database; the received bytes were also saved as " + fname + ".", format)); //persistence across restarts verified 8/1/26
		}
	function handleWebeditRequest (theRequest, theResponse) {
		var theBody = "";
		var flTooBig = false;
		theRequest.on ("data", function (chunk) {
			theBody += chunk;
			if ((theBody.length > config.maxWebeditBytes) && !flTooBig) {
				flTooBig = true;
				returnError (theResponse, 413, "Can't accept the request because it's bigger than " + config.maxWebeditBytes + " bytes.");
				theRequest.destroy ();
				}
			});
		theRequest.on ("end", function () {
			if (flTooBig) {
				return;
				}

			/*  Two gates before davexmlrpc sees the body. It throws from inside
				its parser callback on malformed XML, which would take the whole
				server down -- an unauthenticated caller must never reach that.  */

			const lowerBody = theBody.toLowerCase ();
			if ((lowerBody.indexOf ("<!doctype") !== -1) || (lowerBody.indexOf ("<!entity") !== -1)) {
				returnError (theResponse, 400, "Can't answer the request because doctype and entity declarations aren't accepted here.");
				return;
				}
			xml2jsTool.parseString (theBody, {explicitArray: false}, function (err, jstruct) {
				if ((err !== undefined) && (err !== null)) {
					returnError (theResponse, 400, "Can't answer the request because the body isn't well-formed XML: " + err.message);
					return;
					}
				if ((jstruct === undefined) || (jstruct === null) || (jstruct.methodCall === undefined)) {
					returnError (theResponse, 400, "Can't answer the request because the body isn't an XML-RPC methodCall.");
					return;
					}
				xmlrpc.server (theBody, function (err, verb, params, format) {
					if (err !== undefined) {
						returnError (theResponse, 400, err.message);
						}
					else {
						handleWebeditCall (theResponse, verb, params, format);
						}
					});
				});
			});
		}

//the web service
	function urlParam (theUrl, theName) { //searchParams.get answers null for a missing param, and we don't traffic in nulls
		const theValue = theUrl.searchParams.get (theName);
		if (theValue === null) {
			return (undefined);
			}
		return (theValue);
		}
	function passwordFromRequest (theRequest, theUrl) {
		const fromHeader = theRequest.headers ["x-trigger-password"];
		if (fromHeader !== undefined) {
			return (fromHeader);
			}
		return (urlParam (theUrl, "password"));
		}
	function requestIsAuthorized (theRequest, theUrl) {

		/*  Either password opens these calls. The webedit password already
			reads and writes every script in the database, so running a script
			is not more privilege -- and it's the one DW has, which is what
			Electric Drummer needs. 8/4/26 by CC.  */

		const thePassword = passwordFromRequest (theRequest, theUrl);
		if (thePassword === undefined) {
			return (false);
			}
		if ((config.password.length > 0) && (thePassword === config.password)) { //an empty password in config.json locks the server, it doesn't open it
			return (true);
			}
		if ((config.webeditPassword.length > 0) && (thePassword === config.webeditPassword)) {
			return (true);
			}
		return (false);
		}
	const headersCors = { //8/4/26 by CC -- so Electric Drummer can call directly, without the password going through a proxy server
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, x-trigger-password"
		};
	function returnJson (theResponse, theCode, theObject) {
		const theText = JSON.stringify (theObject, undefined, 4);
		theResponse.writeHead (theCode, Object.assign ({
			"Content-Type": "application/json; charset=utf-8",
			"Content-Length": Buffer.byteLength (theText)
			}, headersCors));
		theResponse.end (theText);
		}
	function returnText (theResponse, theCode, theText) {
		theResponse.writeHead (theCode, Object.assign ({
			"Content-Type": "text/plain; charset=utf-8",
			"Content-Length": Buffer.byteLength (theText)
			}, headersCors));
		theResponse.end (theText);
		}
	function returnError (theResponse, theCode, theMessage) {
		returnJson (theResponse, theCode, {message: theMessage});
		}
	function handleRun (theRequest, theResponse, theUrl, theScript) {
		if (theScript === undefined) {
			returnError (theResponse, 400, "Can't run anything because the request carried no script.");
			}
		else {
			if (theScript.trim ().length === 0) {
				returnError (theResponse, 400, "Can't run anything because the script is empty.");
				}
			else {
				const flTrace = theUrl.searchParams.has ("trace");
				try {
					const theResult = runScript (theScript);
					const theTrace = theResult.theTrace;
					delete theResult.theTrace;
					if (flTrace) {
						theResult.trace = traceText (theTrace);
						}
					if (config.flLogRequests) {
						console.log (nowText () + " ran " + theResult.ctVerbCalls + " verb calls in " + theResult.ctMilliseconds + "ms -> " + theResult.valueType);
						}
					returnJson (theResponse, 200, theResult);
					}
				catch (err) {
					if (config.flLogRequests) {
						console.log (nowText () + " failed: " + err.message);
						}
					returnError (theResponse, 500, err.message);
					}
				}
			}
		}
	function handleDownloadObject (theResponse, theAddressString) { //8/4/26 by CC -- the object comes back as OPML, the currency Electric Drummer speaks
		try {
			if (theAddressString === undefined) {
				returnError (theResponse, 400, "Can't download anything because the request carried no address.");
				return;
				}
			const segments = parseAddressString (theAddressString);
			if (segments === undefined) {
				returnError (theResponse, 400, "Can't download " + theAddressString + " because it isn't a clean dotted address.");
				return;
				}
			const theValue = getValueAtAddress (segments);
			if ((theValue === undefined) || (theValue === null)) {
				returnError (theResponse, 404, "Can't download " + theAddressString + " because there is no object at that address.");
				return;
				}
			if ((theValue.flOdbScript !== true) || (!Array.isArray (theValue.lines))) {
				returnError (theResponse, 400, "Can't download " + theAddressString + " because it isn't a script or an outline, and those are the two things this version moves.");
				return;
				}
			const theTitle = segments [segments.length - 1];
			const opmltext = scriptToOpml (theValue, theTitle);
			if (config.flLogRequests) {
				console.log (nowText () + " downloadobject: sent " + segments.join (".") + ", " + theValue.lines.length + " lines.");
				}
			returnJson (theResponse, 200, {
				address: segments.join ("."),
				scriptType: theValue.scriptType,
				ctLines: theValue.lines.length,
				opmltext
				});
			}
		catch (err) {
			returnError (theResponse, 500, "Can't download " + theAddressString + " because " + err.message);
			}
		}
	function handleUploadObject (theResponse, theAddressString, opmltext, scriptType) { //8/4/26 by CC
		try {
			if (theAddressString === undefined) {
				returnError (theResponse, 400, "Can't upload anything because the request carried no address.");
				return;
				}
			if ((opmltext === undefined) || (String (opmltext).trim ().length === 0)) {
				returnError (theResponse, 400, "Can't upload " + theAddressString + " because the request carried no OPML.");
				return;
				}
			if (scriptType === undefined) {
				scriptType = "script";
				}
			if ((scriptType !== "script") && (scriptType !== "outline")) {
				returnError (theResponse, 400, "Can't upload " + theAddressString + " because the type must be script or outline, and the request says " + scriptType + ".");
				return;
				}
			const segments = parseAddressString (theAddressString);
			if (segments === undefined) {
				returnError (theResponse, 400, "Can't upload " + theAddressString + " because it isn't a clean dotted address.");
				return;
				}
			const theValue = opmlToScript (opmltext, scriptType);
			if (theValue.lines.length === 0) {
				returnError (theResponse, 400, "Can't upload " + theAddressString + " because the OPML has no outline elements in it.");
				return;
				}
			installValueAtAddress (segments, theValue);
			if (config.flLogRequests) {
				console.log (nowText () + " uploadobject: installed " + segments.join (".") + ", " + theValue.lines.length + " lines.");
				}
			returnJson (theResponse, 200, {
				address: segments.join ("."),
				scriptType,
				ctLines: theValue.lines.length,
				note: segments.join (".") + " installed in trigger's database, " + theValue.lines.length + " lines."
				});
			}
		catch (err) {
			returnError (theResponse, 500, "Can't upload " + theAddressString + " because " + err.message);
			}
		}
	function summaryForRow (theRow) { //8/7/26 by CC -- one line of the odb browser: what goes in the value and kind columns

		/*  Works straight off the database row, so a table full of big values
			costs one query per entry, never a decode of the values themselves.
			The 8/4 performance lesson: never walk more of the database than
			the answer needs.  */

		function truncate (theText) {
			const oneLine = String (theText).replace (/\s+/g, " ");
			if (oneLine.length > 80) {
				return (oneLine.substring (0, 80) + "…"); //horizontal ellipsis
				}
			return (oneLine);
			}
		switch (theRow.type) {
			case "table": {
				const ctItems = countListerChildren.get (theRow.id).ct;
				return ({kind: "table", value: ctItems + ((ctItems === 1) ? " item" : " items"), flTable: true});
				}
			case "script": case "outline": {
				var ctLines = 0;
				try {
					ctLines = JSON.parse (theRow.value).length;
					}
				catch (err) {
					}
				return ({kind: theRow.type, value: ctLines + ((ctLines === 1) ? " line" : " lines")});
				}
			case "wptext":
				return ({kind: "wp text", value: truncate (theRow.value)});
			case "string":
				return ({kind: "string", value: truncate (theRow.value)});
			case "number": case "boolean":
				return ({kind: theRow.type, value: String (theRow.value)});
			case "date":
				return ({kind: "date", value: new Date (theRow.value).toLocaleString ()});
			case "list":
				return ({kind: "list", value: truncate (theRow.value)});
			case "address":
				return ({kind: "address", value: String (theRow.value)});
			case "novalue":
				return ({kind: "nothing", value: ""});
			case "marker": { //an undecoded value -- the row remembers its Frontier type and size, not the bytes
				var markerKind = "binary";
				try {
					markerKind = JSON.parse (theRow.value).type;
					}
				catch (err) {
					}
				return ({kind: markerKind, value: "on disk"});
				}
			default:
				return ({kind: theRow.type, value: ""});
			}
		}
	function handleListTable (theResponse, theUrl) { //8/7/26 by CC -- the odb browser asks what's in a table, one level, summaries only
		try {
			const theAddressString = urlParam (theUrl, "address");
			const theIdString = urlParam (theUrl, "id");
			var theId, addressForErrors;
			if (theIdString !== undefined) { //the browser expands by row id, so a name with a dot in it can't break the address

				addressForErrors = "id " + theIdString;
				theId = Number (theIdString);
				if (!Number.isInteger (theId)) {
					returnError (theResponse, 400, "Can't list " + addressForErrors + " because the id has to be a whole number.");
					return;
					}
				const theRow = selectListerRow.get (theId);
				if (theRow === undefined) {
					returnError (theResponse, 404, "Can't list " + addressForErrors + " because there is no object with that id.");
					return;
					}
				if (theRow.type !== "table") {
					returnError (theResponse, 400, "Can't list " + addressForErrors + " because it isn't a table.");
					return;
					}
				}
			else {
				if ((theAddressString === undefined) || (theAddressString.length === 0)) { //no address means the top level of the database
					addressForErrors = "the top level";
					theId = theStore.odb.odbId;
					}
				else {
					addressForErrors = theAddressString;
					const segments = parseAddressString (theAddressString);
					if (segments === undefined) {
						returnError (theResponse, 400, "Can't list " + theAddressString + " because it isn't a clean dotted address.");
						return;
						}
					const theValue = getValueAtAddress (segments);
					if ((theValue === undefined) || (theValue === null)) {
						returnError (theResponse, 404, "Can't list " + theAddressString + " because there is no object at that address.");
						return;
						}
					if (theValue.flOdbSqlTable !== true) {
						returnError (theResponse, 400, "Can't list " + theAddressString + " because it isn't a table.");
						return;
						}
					theId = theValue.odbId;
					}
				}
			const entries = [];
			selectListerChildren.all (theId).forEach (function (theRow) {
				const summary = summaryForRow (theRow);
				const entry = {
					name: theRow.name,
					kind: summary.kind,
					value: summary.value
					};
				if (summary.flTable === true) {
					entry.flTable = true;
					entry.id = theRow.id;
					}
				entries.push (entry);
				});
			if (config.flLogRequests) {
				console.log (nowText () + " listtable: " + addressForErrors + ", " + entries.length + " entries.");
				}
			returnJson (theResponse, 200, {
				address: (theAddressString === undefined) ? "" : theAddressString,
				ctEntries: entries.length,
				entries
				});
			}
		catch (err) {
			returnError (theResponse, 500, "Can't list the table because " + err.message);
			}
		}
	const typesForExtensions = { //8/7/26 by CC -- the odb browser's static files
		".html": "text/html; charset=utf-8",
		".js": "text/javascript; charset=utf-8",
		".css": "text/css; charset=utf-8",
		".svg": "image/svg+xml",
		".png": "image/png",
		".gif": "image/gif",
		".woff": "font/woff",
		".woff2": "font/woff2",
		".ttf": "font/ttf",
		".eot": "application/vnd.ms-fontobject",
		".map": "application/json"
		};
	function serveStaticFile (theResponse, folderBase, relativePath) {
		const fullPath = pathTool.normalize (pathTool.join (folderBase, relativePath));
		if (!fullPath.startsWith (folderBase + pathTool.sep)) { //nothing outside the folder, however the path is spelled
			returnError (theResponse, 403, "Can't serve " + relativePath + " because it reaches outside the folder.");
			return;
			}
		const theType = typesForExtensions [pathTool.extname (fullPath).toLowerCase ()];
		if (theType === undefined) {
			returnError (theResponse, 403, "Can't serve " + relativePath + " because files of that type aren't served here.");
			return;
			}
		fs.readFile (fullPath, function (err, theBuffer) {
			if (err) {
				returnError (theResponse, 404, "Can't serve " + relativePath + " because there is no file with that name.");
				}
			else {
				theResponse.writeHead (200, Object.assign ({
					"Content-Type": theType,
					"Content-Length": theBuffer.length
					}, headersCors));
				theResponse.end (theBuffer);
				}
			});
		}
	function handleOdbBrowserFile (theResponse, theUrl) { //8/7/26 by CC -- the browser app's page, and Concord out of its own folder

		var relativePath = theUrl.pathname.slice ("/odbbrowser".length); //the original casing -- fontAwesome's folder name has a capital in it

		if ((relativePath === "") || (relativePath === "/")) {
			relativePath = "/index.html";
			}
		if (relativePath.startsWith ("/concord/")) {
			serveStaticFile (theResponse, folderConcord, relativePath.slice ("/concord/".length));
			}
		else {
			serveStaticFile (theResponse, folderOdbBrowser, relativePath.slice (1));
			}
		}
	function readBody (theRequest, callback, theResponseForRefusing) {

		/*  theResponseForRefusing is optional -- pass it and an oversized body is
			refused here instead of being read into memory. 8/4/26 by CC.  */

		var theBody = "";
		var flTooBig = false;
		theRequest.on ("data", function (chunk) {
			theBody += chunk;
			if ((theResponseForRefusing !== undefined) && (theBody.length > config.maxWebeditBytes) && !flTooBig) {
				flTooBig = true;
				returnError (theResponseForRefusing, 413, "Can't accept the request because it's bigger than " + config.maxWebeditBytes + " bytes.");
				theRequest.destroy ();
				}
			});
		theRequest.on ("end", function () {
			if (!flTooBig) {
				callback (theBody);
				}
			});
		}
	function nowText () {
		return (new Date ().toLocaleString ());
		}
	function handleHttpRequest (theRequest, theResponse) {

		const theUrl = new URL (theRequest.url, "http://localhost");
		const thePath = theUrl.pathname.toLowerCase ();

		if (theRequest.method === "OPTIONS") { //8/4/26 by CC -- the preflight a browser sends before a cross-origin POST
			theResponse.writeHead (204, headersCors);
			theResponse.end ();
			return;
			}

		switch (thePath) {
			case "/":
				returnText (theResponse, 200, myProductName + " v" + myVersion + "\n\nPOST a UserTalk script to /run?password=xxx and the value comes back as JSON.\nA one-liner can go in the URL: /run?password=xxx&script=string.lower%20(%22HELLO%22)\nAdd &trace=1 to see every verb the script called.\n\nObjects move as OPML:\n/downloadobject?password=xxx&address=system.temp.hello\nPOST the OPML to /uploadobject?password=xxx&address=system.temp.hello&type=script\n");
				break;
			case "/version":
				returnJson (theResponse, 200, {
					product: myProductName,
					version: myVersion,
					usertalkVersion: versionUsertalk,
					ctDatabaseRows: theStore.countRows ()
					});
				break;
			case "/rpc2": //8/1/26 by CC -- the webEdit upload endpoint
				if (theRequest.method === "POST") {
					handleWebeditRequest (theRequest, theResponse);
					}
				else {
					returnText (theResponse, 405, "POST an XML-RPC call here -- the procedure is webEdit.sendToServer.\n");
					}
				break;
			case "/run":
				if (!requestIsAuthorized (theRequest, theUrl)) {
					returnError (theResponse, 401, "Can't run the script because the password is missing or wrong.");
					}
				else {
					if (theRequest.method === "POST") {
						readBody (theRequest, function (theBody) {
							handleRun (theRequest, theResponse, theUrl, theBody);
							});
						}
					else {
						handleRun (theRequest, theResponse, theUrl, urlParam (theUrl, "script"));
						}
					}
				break;
			case "/downloadobject": //8/4/26 by CC -- the three calls Electric Drummer makes
				if (!requestIsAuthorized (theRequest, theUrl)) {
					returnError (theResponse, 401, "Can't download the object because the password is missing or wrong.");
					}
				else {
					handleDownloadObject (theResponse, urlParam (theUrl, "address"));
					}
				break;
			case "/uploadobject":
				if (!requestIsAuthorized (theRequest, theUrl)) {
					returnError (theResponse, 401, "Can't upload the object because the password is missing or wrong.");
					}
				else {
					if (theRequest.method === "POST") {
						readBody (theRequest, function (theBody) {
							handleUploadObject (theResponse, urlParam (theUrl, "address"), theBody, urlParam (theUrl, "type"));
							}, theResponse);
						}
					else {
						returnError (theResponse, 405, "Can't upload the object because it has to be POSTed -- the OPML goes in the body of the request.");
						}
					}
				break;
			case "/listtable": //8/7/26 by CC -- the odb browser asks what's in a table
				if (!requestIsAuthorized (theRequest, theUrl)) {
					returnError (theResponse, 401, "Can't list the table because the password is missing or wrong.");
					}
				else {
					handleListTable (theResponse, theUrl);
					}
				break;
			default:
				if ((thePath === "/odbbrowser") || (thePath.startsWith ("/odbbrowser/"))) { //8/7/26 by CC -- the browser app itself, no password -- the data calls carry it
					handleOdbBrowserFile (theResponse, theUrl);
					}
				else {
					returnError (theResponse, 404, "Can't answer the request because " + theUrl.pathname + " isn't something this server does.");
					}
				break;
			}
		}

//startup
	function startup () {

		if (!fs.existsSync (pathDatabase)) {
			console.log ("Can't start because there's no database at " + pathDatabase + ".");
			process.exit (1);
			}

		theStore = odbSql.openDatabase (pathDatabase);

		const sqlite3 = require ("better-sqlite3"); //8/7/26 by CC -- a second, read-only connection for the odb browser's listings; WAL mode makes concurrent readers safe
		const listerDatabase = new sqlite3 (pathDatabase, {readonly: true});
		selectListerChildren = listerDatabase.prepare ("select id, name, type, value from odb where parentid = ? order by lowername;");
		selectListerRow = listerDatabase.prepare ("select id, name, type, value from odb where id = ?;");
		countListerChildren = listerDatabase.prepare ("select count (*) as ct from odb where parentid = ?;");

		console.log (myProductName + " v" + myVersion + " on port " + config.port + ", usertalk v" + versionUsertalk + ", " + theStore.countRows () + " rows in " + pathDatabase);
		if (config.password.length === 0) {
			console.log ("WARNING: config.json has no password, so every request will be refused.");
			}

		http.createServer (handleHttpRequest).listen (config.port);
		}

startup ();
