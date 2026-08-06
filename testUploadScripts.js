/*  Local test for the publish-this-outline path: the adapted
	nodeEditorSuite.uploadScripts builds a fixture outline into rendered
	files, and its build script runs at the end through the evaluate verb.

	Works on a COPY of data/odb.db (the decoded ODB -- uploadScripts needs
	the real nodeEditorSuite: init, fixBuggyXml, macroProcess, the glossary
	and the opml shell), with the path map pointed at folders in the system
	temp folder. The live database is never touched.

	node testUploadScripts.js

	by CC, 8/4/26 */

const fs = require ("fs");
const os = require ("os");
const pathTool = require ("path");

const folderTrigger = __dirname;
const folderModules = pathTool.join (folderTrigger, "node_modules");

process.env.NODE_PATH = folderModules + ((process.env.NODE_PATH !== undefined) ? ":" + process.env.NODE_PATH : "");
require ("module")._initPaths ();

var folderUsertalk = pathTool.resolve (folderTrigger, "../usertalk");
try {
	const configReal = JSON.parse (fs.readFileSync (pathTool.join (folderTrigger, "config.json"), "utf8"));
	if (configReal.pathUsertalk !== undefined) {
		folderUsertalk = pathTool.resolve (folderTrigger, configReal.pathUsertalk);
		}
	}
catch (err) {
	}

const parse = require (pathTool.join (folderUsertalk, "code", "parse.js"));
const evaluate = require (pathTool.join (folderUsertalk, "code", "evaluate.js"));
const verbsMaker = require (pathTool.join (folderUsertalk, "code", "verbs.js"));
const odbSql = require (pathTool.join (folderUsertalk, "code", "odbSql.js"));

const folderTest = pathTool.join (os.tmpdir (), "triggerUploadScriptsTest");
const pathDatabaseLive = pathTool.join (folderTrigger, "data", "odb.db");
const pathDatabaseTest = pathTool.join (folderTest, "odb.db");
const folderFiles = pathTool.join (folderTest, "files");

var ctOk = 0, ctFailed = 0;
function check (what, flPassed, detail) {
	if (flPassed) {
		ctOk++;
		console.log ("ok    " + what);
		}
	else {
		ctFailed++;
		console.log ("FAIL  " + what + ((detail === undefined) ? "" : " -- " + detail));
		}
	}

//the isolated copy
	fs.rmSync (folderTest, {recursive: true, force: true});
	fs.mkdirSync (folderFiles, {recursive: true});
	fs.copyFileSync (pathDatabaseLive, pathDatabaseTest);
	const theStore = odbSql.openDatabase (pathDatabaseTest);

const thePathMap = {
	helpers: {
		getFolder: "Macintosh HD:Users:davewiner:Dropbox:public:misc:nodeeditor:",
		getAllServersFolder: "Macintosh HD:Users:davewiner:allservers:",
		getGitHubFolder: "Macintosh HD:Users:davewiner:GitHub:"
		},
	prefs: {},
	prefixes: {
		"Macintosh HD:Users:davewiner:Dropbox:public:misc:nodeeditor": pathTool.join (folderFiles, "staging"),
		"Macintosh HD:Users:davewiner:allservers": pathTool.join (folderFiles, "deploy"),
		"Macintosh HD:Users:davewiner:GitHub": pathTool.join (folderFiles, "github"),
		"Macintosh HD:Users:davewiner:Dropbox": pathTool.join (folderFiles, "dropbox")
		}
	};

//install the adapted script and the fixture outline
	function unescapeXml (theString) {
		return (theString
			.replace (/&lt;/g, "<")
			.replace (/&gt;/g, ">")
			.replace (/&quot;/g, "\"")
			.replace (/&apos;/g, "'")
			.replace (/&amp;/g, "&"));
		}
	function opmlToScript (theXml, scriptType) { //the same conversion trigger.js makes for /uploadobject
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
	function findKeyInsensitive (theTable, theName) {
		var found;
		const lower = theName.toLowerCase ();
		Reflect.ownKeys (theTable).forEach (function (key) {
			if ((found === undefined) && (typeof key === "string") && (key.toLowerCase () === lower)) {
				found = key;
				}
			});
		return (found);
		}
	function installValueAtAddress (segments, theValue) {
		var current = theStore.odb;
		segments.slice (0, segments.length - 1).forEach (function (segment) {
			const key = findKeyInsensitive (current, segment) || segment;
			if ((current [key] === undefined) || (current [key] === null) || (typeof current [key] !== "object")) {
				current [key] = {};
				}
			current = current [key];
			});
		const lastKey = findKeyInsensitive (current, segments [segments.length - 1]) || segments [segments.length - 1];
		current [lastKey] = theValue;
		}

	const serverScriptOpml = fs.readFileSync (pathTool.join (folderTrigger, "uploadScriptsServer.opml"), "utf8");
	installValueAtAddress (["nodeEditorSuite", "uploadScripts"], opmlToScript (serverScriptOpml, "script")); //the suite is a guest database at the odb root

	const fixtureOpml = [
		"<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
		"<opml version=\"2.0\">",
		"<head><title>fixture</title></head>",
		"<body>",
		"<outline text=\"/test.example.com/fixture/\">",
		"<outline text=\"readme.md\">",
		"<outline text=\"# The fixture\" />",
		"<outline text=\"A line with &amp;amp; and &amp;lt; in it.\" />",
		"<outline text=\"A comment that must not appear.\" isComment=\"true\" />",
		"</outline>",
		"<outline text=\"code.js\">",
		"<outline text=\"function hello () {\">",
		"<outline text=\"return (true);\" />",
		"<outline text=\"}\" />",
		"</outline>",
		"</outline>",
		"<outline text=\"page.opml\">",
		"<outline text=\"first line\">",
		"<outline text=\"a child line\" />",
		"</outline>",
		"</outline>",
		"</outline>",
		"<outline text=\"build script\">",
		"<outline text=\"file.surefilepath (\\&quot;Macintosh HD:Users:davewiner:allservers:copied.md\\&quot;)\" />",
		"<outline text=\"file.copy (\\&quot;Macintosh HD:Users:davewiner:Dropbox:public:misc:nodeeditor:test.example.com-fixture:readme.md\\&quot;, \\&quot;Macintosh HD:Users:davewiner:allservers:copied.md\\&quot;)\" />",
		"</outline>",
		"</body>",
		"</opml>"
		].join ("\n").replace (/\\&quot;/g, "&quot;");
	installValueAtAddress (["system", "temp", "uploadscriptsfixture"], opmlToScript (fixtureOpml, "outline"));

//run scripts the way trigger's /run does
	function runScript (theScript) {
		const theTrace = [];
		const made = verbsMaker.makeVerbs (thePathMap, theTrace);
		const environment = evaluate.makeEnvironment (theStore.odb, made.verbs, theTrace);
		environment.parseScript = function (theLines) {
			return (parse.parseOutline (parse.linesToTree (theLines)));
			};
		environment.frames.push ({vars: {}});
		const theLines = [];
		theScript.split ("\n").forEach (function (line) {
			const withoutTabs = line.replace (/^\t+/, "");
			if (withoutTabs.trim ().length > 0) {
				theLines.push ({level: line.length - withoutTabs.length, text: withoutTabs, flComment: false});
				}
			});
		return (evaluate.evaluate (parse.parseOutline (parse.linesToTree (theLines)), environment));
		}

//the build
	runScript ("config.nodeEditor.prefs.folder = \"Macintosh HD:Users:davewiner:Dropbox:public:misc:nodeeditor:\"");
	var buildError;
	try {
		runScript ("nodeEditorSuite.uploadScripts (@system.temp.uploadscriptsfixture)");
		}
	catch (err) {
		buildError = err;
		}
	check ("the build runs without an error", buildError === undefined, (buildError === undefined) ? undefined : buildError.message);

//the rendered files
	const folderProject = pathTool.join (folderFiles, "staging", "test.example.com-fixture");
	const pathReadme = pathTool.join (folderProject, "readme.md");
	check ("readme.md is rendered", fs.existsSync (pathReadme));
	if (fs.existsSync (pathReadme)) {
		const readmeText = fs.readFileSync (pathReadme, "latin1");
		check ("markdown flattens: no tabs, blank line between nodes", readmeText === "# The fixture\n\nA line with &amp; and &lt; in it.\n\n", JSON.stringify (readmeText));
		check ("comment nodes stay out of rendered files", readmeText.indexOf ("must not appear") === -1);
		}
	const pathCode = pathTool.join (folderProject, "code.js");
	check ("code.js is rendered", fs.existsSync (pathCode));
	if (fs.existsSync (pathCode)) {
		const codeText = fs.readFileSync (pathCode, "latin1");
		check ("code indents a tab per level, one linefeed per line", codeText === "function hello () {\n\treturn (true);\n\t}\n", JSON.stringify (codeText));
		}
	const pathPage = pathTool.join (folderProject, "page.opml");
	check ("page.opml is rendered", fs.existsSync (pathPage));
	if (fs.existsSync (pathPage)) {
		const pageText = fs.readFileSync (pathPage, "latin1");
		check ("the opml prolog is the fixed form", pageText.startsWith ("<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>"), JSON.stringify (pageText.substring (0, 60)));
		check ("the title macro is substituted", pageText.indexOf ("<title>page.opml</title>") !== -1, pageText.substring (0, 200));
		check ("no unsubstituted macros remain", pageText.indexOf ("<%") === -1);
		}
	check ("the build script ran through evaluate: the copy exists", fs.existsSync (pathTool.join (folderFiles, "deploy", "copied.md")));

//an outline with NO build script must build too -- the case that caught the locals bug
	const fixtureNoBuild = [
		"<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
		"<opml version=\"2.0\">",
		"<head><title>nobuild</title></head>",
		"<body>",
		"<outline text=\"/test.example.com/nobuild/\">",
		"<outline text=\"plain.md\">",
		"<outline text=\"No build script here.\" />",
		"</outline>",
		"</outline>",
		"</body>",
		"</opml>"
		].join ("\n");
	installValueAtAddress (["system", "temp", "uploadscriptsnobuild"], opmlToScript (fixtureNoBuild, "outline"));
	var noBuildError;
	try {
		runScript ("nodeEditorSuite.uploadScripts (@system.temp.uploadscriptsnobuild)");
		}
	catch (err) {
		noBuildError = err;
		}
	check ("an outline with no build script builds", noBuildError === undefined, (noBuildError === undefined) ? undefined : noBuildError.message);
	check ("and its file is rendered", fs.existsSync (pathTool.join (folderFiles, "staging", "test.example.com-nobuild", "plain.md")));

//the database glossary survived untouched (the copy-not-reference rule)
	const glossCheck = runScript ("typeof (nodeEditorSuite.data.glossary.basicIncludes2)");
	check ("the suite glossary entry is still an outline, not a flattened string", glossCheck === "outlinetype", String (glossCheck));

if (theStore.close !== undefined) {
	theStore.close ();
	}
fs.rmSync (folderTest, {recursive: true, force: true});
console.log (ctOk + " ok, " + ctFailed + " failed");
process.exit ((ctFailed === 0) ? 0 : 1);
