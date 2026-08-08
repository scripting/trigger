/*  marinUpdateSandbox0.js -- runs ON marin, via ssh, to update the
	sandbox0.usertalk.org app in place.

	Before this runs, /root/staging-sandbox0update/sandbox0update.tar.gz
	is scp'd up, holding some or all of: data/sandbox0.db (a database
	rebuilt by misc/buildSandbox0Db.js), usertalk/ code, frontierodb.js.

	The order matters for the database: the new file is unpacked to the
	side, the running process is killed, and the file is renamed into
	place before forever respawns the app -- a rename is atomic, so the
	respawn can never open a half-written database. Code files are safe
	to copy over a running process; node already has them in memory.

	First used 8/8/26 to ship the decoded custom menu (usertalk 0.3.2,
	frontierodb 0.3.0). Nothing here touches any other domain.

	by CC, 8/8/26 */

const fs = require ("fs");
const childProcess = require ("child_process");

const pathBundle = "/root/staging-sandbox0update/sandbox0update.tar.gz";
const folderStaging = "/root/staging-sandbox0update/unpacked";
const folderDomain = "/root/marin/pagepark/domains/sandbox0.usertalk.org";

function fail (message) {
	console.log ("UPDATE FAILED: " + message);
	process.exit (1);
	}

//assertions
	if (!fs.existsSync (pathBundle)) {
		fail ("Can't update because the bundle isn't at " + pathBundle + ".");
		}
	if (!fs.existsSync (folderDomain + "/trigger.js")) {
		fail ("Can't update because " + folderDomain + " doesn't look like the deployed app.");
		}

//unpack to the side
	fs.rmSync (folderStaging, {recursive: true, force: true});
	fs.mkdirSync (folderStaging, {recursive: true});
	childProcess.execSync ("tar xzf " + pathBundle + " -C " + folderStaging + " 2>/dev/null || true");
	const flAnyPayload = fs.existsSync (folderStaging + "/data/sandbox0.db") || fs.existsSync (folderStaging + "/usertalk") || fs.existsSync (folderStaging + "/frontierodb.js");
	if (!flAnyPayload) {
		fail ("Can't update because nothing recognizable came out of the bundle.");
		}
	console.log ("bundle unpacked to staging");

//code files copy straight in
	["frontierodb.js"].forEach (function (fname) {
		if (fs.existsSync (folderStaging + "/" + fname)) {
			fs.copyFileSync (folderStaging + "/" + fname, folderDomain + "/" + fname);
			console.log ("copied " + fname);
			}
		});
	if (fs.existsSync (folderStaging + "/usertalk")) {
		childProcess.execSync ("cp -R " + folderStaging + "/usertalk/. " + folderDomain + "/usertalk/");
		console.log ("copied usertalk");
		}

//the database: stage beside, kill, rename into place
	const pathNewDb = folderStaging + "/data/sandbox0.db";
	if (fs.existsSync (pathNewDb)) {
		fs.renameSync (pathNewDb, folderDomain + "/data/sandbox0.db.new");
		/*  Find the pid from ps output rather than pgrep -f: pgrep can match
			more than one pid (a respawn in progress rides beside the dying
			process) and a multiline answer glued into a kill command runs the
			second pid as a shell command -- that bit on the first run, 8/8/26.  */

		var thePid;
		childProcess.execSync ("ps -eo pid,args").toString ().split ("\n").forEach (function (theLine) {
			if ((theLine.indexOf ("sandbox0.usertalk.org/trigger.js") >= 0) && (theLine.indexOf ("ps -eo") < 0)) {
				thePid = theLine.trim ().split (" ") [0];
				}
			});
		if (thePid !== undefined) {
			childProcess.execSync ("kill " + thePid);
			console.log ("killed the app, pid " + thePid);
			}
		fs.renameSync (folderDomain + "/data/sandbox0.db.new", folderDomain + "/data/sandbox0.db");
		["sandbox0.db-shm", "sandbox0.db-wal"].forEach (function (fname) {
			fs.rmSync (folderDomain + "/data/" + fname, {force: true});
			});
		console.log ("database in place");
		}

//wait for the respawn, prove it end to end through the proxy
	var ctTries = 0;
	function poll () {
		ctTries++;
		childProcess.exec ("curl -s -m 5 -H \"Host: sandbox0.usertalk.org\" http://localhost:1339/version", function (err, stdout) {
			if ((stdout !== undefined) && (stdout.indexOf ("ctDatabaseRows") >= 0)) {
				console.log ("LIVE: " + stdout);
				process.exit (0);
				}
			else {
				if (ctTries >= 30) {
					fail ("The app didn't answer after 30 tries. Last answer: " + stdout);
					}
				setTimeout (poll, 5000);
				}
			});
		}
	poll ();
