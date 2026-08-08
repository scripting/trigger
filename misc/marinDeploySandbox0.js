/*  marinDeploySandbox0.js -- runs ON marin, once, via ssh.

	Stands up sandbox0.usertalk.org -- the sandbox database for the new
	Frontier, per the plan agreed 8/7. A second trigger instance in its
	own pagepark domain folder, serving a database built from
	nodeEditor.root plus the projects table, user.menus and user.prefs
	from the old layered odb.db (built by misc/buildSandbox0Db.js).

	Before this runs, /root/staging-sandbox0/sandbox0bundle.tar.gz is
	scp'd up. The bundle holds trigger 0.5.2, usertalk 0.3.1 (today's
	constants fix), the odb browser, concord, config.json with fresh
	sandbox-only passwords, and the database. The app manifest travels
	as packageJson.hold and becomes package.json as the LAST step,
	because pagepark scans the domains folder every minute and launches
	any folder that has a package.json -- the rename is the go signal.

	node_modules comes from the trigger.usertalk.org folder beside it:
	same four dependencies, already built for this machine's node.

	Nothing here touches trigger.usertalk.org or any other domain.

	by CC, 8/8/26 */

const fs = require ("fs");
const childProcess = require ("child_process");

const pathBundle = "/root/staging-sandbox0/sandbox0bundle.tar.gz";
const folderDomain = "/root/marin/pagepark/domains/sandbox0.usertalk.org";
const folderTriggerNodeModules = "/root/marin/pagepark/domains/trigger.usertalk.org/node_modules";

function fail (message) {
	console.log ("DEPLOY FAILED: " + message);
	process.exit (1);
	}

//assertions before anything happens
	if (!fs.existsSync (pathBundle)) {
		fail ("Can't deploy because the bundle isn't at " + pathBundle + ".");
		}
	if (fs.existsSync (folderDomain)) {
		fail ("Can't deploy because " + folderDomain + " already exists.");
		}
	if (!fs.existsSync (folderTriggerNodeModules)) {
		fail ("Can't deploy because trigger's node_modules isn't where expected.");
		}
	["better-sqlite3", "davexmlrpc", "xml2js", "daves3"].forEach (function (name) {
		if (!fs.existsSync (folderTriggerNodeModules + "/" + name)) {
			fail ("Can't deploy because the dependency " + name + " isn't in trigger's node_modules.");
			}
		});

//unpack the bundle -- no package.json yet, so pagepark leaves the folder alone
	fs.mkdirSync (folderDomain);
	childProcess.execSync ("tar xzf " + pathBundle + " -C " + folderDomain);
	if (!fs.existsSync (folderDomain + "/trigger.js")) {
		fail ("Can't continue because trigger.js didn't come out of the bundle.");
		}
	if (!fs.existsSync (folderDomain + "/data/sandbox0.db")) {
		fail ("Can't continue because the database didn't come out of the bundle.");
		}
	if (fs.existsSync (folderDomain + "/package.json")) {
		fail ("The bundle contained a package.json -- it must travel as packageJson.hold so pagepark can't launch a half-built folder.");
		}
	console.log ("bundle unpacked");

//node_modules from the proven trigger install
	childProcess.execSync ("cp -R " + folderTriggerNodeModules + " " + folderDomain + "/node_modules");
	console.log ("node_modules copied");

//the go signal
	fs.renameSync (folderDomain + "/packageJson.hold", folderDomain + "/package.json");
	console.log ("package.json in place -- pagepark launches it within a minute");

//wait for pagepark to launch it, then prove it end to end through the proxy
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
