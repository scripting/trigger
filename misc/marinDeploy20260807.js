/*  marinDeploy20260807.js -- runs ON marin, once, via ssh.

	The 8/6 queued items: (1) the two passwords get different permissions --
	the new trigger.js already carries that; (2) the nodeEditorSuite folder
	HELPERS come out of the path map, so the real scripts in the database run.

	The helper fix needs two edits here: the config entries removed, and the
	verb registrations in usertalk/code/verbs.js made conditional -- marin's
	usertalk is edited surgically rather than replaced, so nothing else about
	the proven 8/4 build changes.

	trigger.js and runnerWorker.js are scp'd up BEFORE this runs. This script
	backs everything up, applies the edits with exact-match assertions, then
	kills the trigger process -- PagePark respawns it on the next request.  */

const fs = require ("fs");
const childProcess = require ("child_process");

const folderDomain = "/root/marin/pagepark/domains/trigger.usertalk.org/";
const pathConfig = folderDomain + "config.json";
const pathVerbs = folderDomain + "usertalk/code/verbs.js";
const stamp = "bak-7aug2026-helperFix";

function fail (message) {
	console.log ("DEPLOY FAILED: " + message);
	process.exit (1);
	}

//backups
	[pathConfig, pathVerbs].forEach (function (thePath) {
		fs.copyFileSync (thePath, thePath + "." + stamp);
		});
	console.log ("backed up config.json and verbs.js");

//config: the three helpers come out
	const config = JSON.parse (fs.readFileSync (pathConfig, "utf8"));
	["getFolder", "getAllServersFolder", "getGitHubFolder"].forEach (function (name) {
		if (config.pathMap.helpers [name] === undefined) {
			fail ("Can't remove the helper " + name + " because it isn't in the config.");
			}
		delete config.pathMap.helpers [name];
		});
	fs.writeFileSync (pathConfig, JSON.stringify (config, undefined, "\t") + "\n");
	console.log ("config: helpers removed");

//verbs.js: the three registrations become conditional
	var verbsText = fs.readFileSync (pathVerbs, "utf8");
	const edits = [
		{
			oldText: "\tverbs [\"nodeeditorsuite.getfolder\"] = function (args) {\n\t\treturn (thePathMap.helpers.getFolder);\n\t\t};",
			newText: "\tif (thePathMap.helpers.getFolder !== undefined) { //8/7/26 by CC -- no helper configured means the real script in the database runs\n\t\tverbs [\"nodeeditorsuite.getfolder\"] = function (args) {\n\t\t\treturn (thePathMap.helpers.getFolder);\n\t\t\t};\n\t\t}"
			},
		{
			oldText: "\tverbs [\"nodeeditorsuite.getallserversfolder\"] = function (args) {\n\t\treturn (thePathMap.helpers.getAllServersFolder);\n\t\t};",
			newText: "\tif (thePathMap.helpers.getAllServersFolder !== undefined) {\n\t\tverbs [\"nodeeditorsuite.getallserversfolder\"] = function (args) {\n\t\t\treturn (thePathMap.helpers.getAllServersFolder);\n\t\t\t};\n\t\t}"
			},
		{
			oldText: "\tverbs [\"nodeeditorsuite.getgithubfolder\"] = function (args) {\n\t\treturn (thePathMap.helpers.getGitHubFolder);\n\t\t};",
			newText: "\tif (thePathMap.helpers.getGitHubFolder !== undefined) {\n\t\tverbs [\"nodeeditorsuite.getgithubfolder\"] = function (args) {\n\t\t\treturn (thePathMap.helpers.getGitHubFolder);\n\t\t\t};\n\t\t}"
			}
		];
	edits.forEach (function (theEdit) {
		const ctMatches = verbsText.split (theEdit.oldText).length - 1;
		if (ctMatches !== 1) {
			fail ("Can't edit verbs.js because the anchor matched " + ctMatches + " times instead of once: " + theEdit.oldText.substring (0, 60));
			}
		verbsText = verbsText.replace (theEdit.oldText, theEdit.newText);
		});
	fs.writeFileSync (pathVerbs, verbsText);
	childProcess.execSync ("node --check " + pathVerbs);
	console.log ("verbs.js: helper registrations now conditional, syntax checks");

//restart -- pagepark respawns the app on the next request
	const psOutput = childProcess.execSync ("ps -o pid=,cmd= -C node").toString ();
	var triggerPid;
	psOutput.split ("\n").forEach (function (theLine) {
		if (theLine.indexOf ("trigger.usertalk.org/trigger.js") !== -1) {
			triggerPid = Number (theLine.trim ().split (" ") [0]);
			}
		});
	if (triggerPid === undefined) {
		fail ("Can't restart trigger because its process wasn't found.");
		}
	process.kill (triggerPid);
	console.log ("killed trigger pid " + triggerPid + " -- pagepark will respawn it");
	console.log ("DEPLOY OK");
