/*  buildSandbox0Db.js -- build the database for sandbox0.usertalk.org.

	The sandbox database is built odbHome-style from a folder --
	data/sandbox0odb/ -- which holds nodeEditor.root. When DW supplies
	exports (the custom menu, say), they go in that folder and this
	script runs again.

	Then three subtrees come over from the old layered odb.db by direct
	SQL row copy, never decoding values (the 8/4 performance lesson,
	and it means the copy is exact):

	1. config.nodeEditor.projects -- the projects table, 519 projects.
	2. user.menus -- customMenu is an undecoded marker in odb.db, so the
	   real menu must come from a DW export later; the table comes over
	   anyway so the browser shows where it lands.
	3. user.prefs -- 41 entries.

	Output: data/sandbox0.db. Run from the trigger folder:
	node misc/buildSandbox0Db.js

	by CC, 8/8/26 */

const fs = require ("fs");
const pathTool = require ("path");

const folderTrigger = pathTool.resolve (__dirname, "..");
const folderOdb = pathTool.join (folderTrigger, "data", "sandbox0odb");
const folderActiveApps = "/Users/davewiner/Claude/daveMigrates/apps/active";
const pathOldOdb = pathTool.join (folderTrigger, "data", "odb.db");
const pathNewDb = pathTool.join (folderTrigger, "data", "sandbox0.db");

const odbSql = require (pathTool.join (folderTrigger, "..", "usertalk", "code", "odbSql.js"));
const frontierodb = require (pathTool.join (folderTrigger, "..", "frontierOdb", "frontierodb.js"));
const sqlite3 = require ("better-sqlite3");

/*  The build folder mirrors DW's OPML Editor environment: every .root in
	daveMigrates/apps/active is one of his four active apps -- manila,
	nodeEditor, worldOutline, xmlRpc (8/9/26, his folder, his call: "the
	safest approach is to use the actual worldOutlineSuite function").
	They're copied fresh every build, so a re-export lands on rebuild.  */

	fs.mkdirSync (folderOdb, {recursive: true});
	const rootFileNames = [];
	fs.readdirSync (folderActiveApps).forEach (function (fname) {
		if (fname.toLowerCase ().endsWith (".root")) {
			fs.copyFileSync (pathTool.join (folderActiveApps, fname), pathTool.join (folderOdb, fname));
			rootFileNames.push (fname);
			console.log ("Copied " + fname + " into the build folder.");
			}
		});
	rootFileNames.sort (); //the order odbHome merges them in -- later files win collisions

/*  Which top-level names each database owns -- read before the merge, so
	the files table can say which window each table belongs to. A name two
	databases both carry belongs to the later one, matching the merge; the
	four standard tables belong to the main root, never to a guest.  */

	const standardNames = ["config", "system", "user", "scratchpad"];
	const nameOwners = {}; //top-level name -> root file that owns it
	rootFileNames.forEach (function (fname) {
		const theTopLevel = frontierodb.readRootFile (pathTool.join (folderOdb, fname));
		Object.keys (theTopLevel).forEach (function (name) {
			if (standardNames.indexOf (name) === -1) {
				nameOwners [name] = fname;
				}
			});
		console.log (fname + " read for the files table.");
		});

/*  DW exports land in the folder too, mounted where their subfolder says.
	The custom menu came as misc/menus.customMenu.ftmb (8/8/26); it mounts
	at user.menus.customMenu, and the merge-style copy of user.menus below
	leaves it standing -- the export wins over the old database's
	undecoded marker.  */

	const pathMenuExport = pathTool.join (folderTrigger, "misc", "menus.customMenu.ftmb");
	if (fs.existsSync (pathMenuExport)) {
		const folderMenus = pathTool.join (folderOdb, "user", "menus");
		fs.mkdirSync (folderMenus, {recursive: true});
		fs.copyFileSync (pathMenuExport, pathTool.join (folderMenus, "customMenu.ftmb"));
		console.log ("Copied the custom menu export into the build folder.");
		}

//phase 1: the roots become the database
	odbSql.buildDatabase (folderOdb, pathNewDb, function (message) {
		console.log (message);
		});

//phase 2: the three subtrees come over from the old odb.db
	const oldDb = new sqlite3 (pathOldOdb, {readonly: true});
	const newDb = new sqlite3 (pathNewDb);

	const oldChild = oldDb.prepare ("select id, name, lowername, type, value from odb where parentid = ? and lowername = ?");
	const oldChildren = oldDb.prepare ("select id, name, lowername, type, value from odb where parentid = ? order by id");
	const newChild = newDb.prepare ("select id, name, type from odb where parentid = ? and lowername = ?");
	const newInsert = newDb.prepare ("insert into odb (parentid, name, lowername, type, value) values (?, ?, ?, ?, ?)");

	function findOldRow (thePath) { //walk a dotted path in the old database, answer the row
		var current = {id: 0};
		thePath.split (".").forEach (function (part) {
			if (current !== undefined) {
				current = oldChild.get (current.id, part.toLowerCase ());
				}
			});
		if (current === undefined) {
			const message = "Can't copy " + thePath + " because it isn't in the old database.";
			throw new Error (message);
			}
		return (current);
		}

	function ensureNewTable (thePath) { //walk a dotted path in the new database, creating tables, answer the id
		var currentId = 0;
		thePath.split (".").forEach (function (part) {
			const existing = newChild.get (currentId, part.toLowerCase ());
			if (existing === undefined) {
				currentId = newInsert.run (currentId, part, part.toLowerCase (), "table", undefined).lastInsertRowid;
				}
			else {
				if (existing.type !== "table") {
					const message = "Can't create the table " + thePath + " because " + part + " already exists and isn't a table.";
					throw new Error (message);
					}
				currentId = existing.id;
				}
			});
		return (currentId);
		}

	function deleteNewSubtree (theId) { //remove a row and everything under it
		const kids = newDb.prepare ("select id from odb where parentid = ?").all (theId);
		kids.forEach (function (theKid) {
			deleteNewSubtree (theKid.id);
			});
		newDb.prepare ("delete from odb where id = ?").run (theId);
		}

	var ctCopied; //counted by copyRows, reported per subtree

	function copyRows (oldParentId, newParentId) {
		oldChildren.all (oldParentId).forEach (function (theRow) {
			const newId = newInsert.run (newParentId, theRow.name, theRow.lowername, theRow.type, theRow.value).lastInsertRowid;
			ctCopied++;
			if (theRow.type === "table") {
				copyRows (theRow.id, newId);
				}
			});
		}

	function copyRowInto (oldRow, newParentId, flKeepExisting, pathForLog) {

		/*  flKeepExisting: when the destination already holds a child with
			the same name -- two tables merge child by child, anything else
			stays as the folder build made it -- so a DW export in the build
			folder always wins over the old database's copy. Recursion works
			on rows and ids, never by re-splitting a dotted path: a name can
			contain a dot.  */

		const existing = newChild.get (newParentId, oldRow.lowername);
		if (existing === undefined) {
			const newId = newInsert.run (newParentId, oldRow.name, oldRow.lowername, oldRow.type, oldRow.value).lastInsertRowid;
			ctCopied++;
			if (oldRow.type === "table") {
				copyRows (oldRow.id, newId);
				}
			}
		else {
			if (flKeepExisting === true) {
				if ((existing.type === "table") && (oldRow.type === "table")) {
					oldChildren.all (oldRow.id).forEach (function (theRow) {
						copyRowInto (theRow, existing.id, true, pathForLog + "." + oldRow.name);
						});
					}
				else {
					console.log ("Kept the existing " + pathForLog + "." + oldRow.name + ".");
					}
				}
			else {
				deleteNewSubtree (existing.id);
				console.log ("Replaced the existing " + pathForLog + "." + oldRow.name + ".");
				const newId = newInsert.run (newParentId, oldRow.name, oldRow.lowername, oldRow.type, oldRow.value).lastInsertRowid;
				ctCopied++;
				if (oldRow.type === "table") {
					copyRows (oldRow.id, newId);
					}
				}
			}
		}

	function copySubtree (oldPath, newParentPath, flKeepExisting) {
		const oldRow = findOldRow (oldPath);
		const newParentId = ensureNewTable (newParentPath);
		ctCopied = 0;
		copyRowInto (oldRow, newParentId, flKeepExisting, newParentPath);
		console.log ("Copied " + oldPath + " into " + newParentPath + " -- " + ctCopied + " rows.");
		}

	const copyAll = newDb.transaction (function () {
		copySubtree ("config.nodeEditor.projects", "config.nodeEditor");
		copySubtree ("user.menus", "user", true);
		copySubtree ("user.prefs", "user");
		});
	copyAll ();

/*  The files table -- which logical database each top-level name belongs
	to, the way the kernel's compiler files table tracks open guests. The
	storage is one merged SQL file, but the WINDOWS follow databases (DW,
	8/8): each active app is its own window, config is the window
	config.root, and system/user/scratchpad are the main root,
	sandbox0.root. The browser reads this through /getdatabases. The
	ownership map was read from the root files themselves, up top.  */

	const idFiles = ensureNewTable ("system.compiler.files");
	function addFileRecord (theName, theAddress, theNames) {
		const existing = newChild.get (idFiles, theName.toLowerCase ());
		if (existing !== undefined) {
			deleteNewSubtree (existing.id);
			}
		const idRecord = newInsert.run (idFiles, theName, theName.toLowerCase (), "table", undefined).lastInsertRowid;
		newInsert.run (idRecord, "adr", "adr", "string", theAddress);
		newInsert.run (idRecord, "names", "names", "list", JSON.stringify (theNames));
		}
	rootFileNames.forEach (function (fname) {
		const theNames = [];
		Object.keys (nameOwners).forEach (function (name) {
			if (nameOwners [name] === fname) {
				theNames.push (name);
				}
			});
		theNames.sort (function (a, b) {
			return (a.toLowerCase () < b.toLowerCase () ? -1 : 1);
			});
		addFileRecord (fname, "", theNames);
		console.log (fname + " owns " + theNames.length + " top-level tables.");
		});
	addFileRecord ("config.root", "config", []);
	addFileRecord ("sandbox0.root", "", ["system", "user", "scratchpad"]);
	console.log ("Wrote system.compiler.files -- " + (rootFileNames.length + 2) + " databases.");

	const ctTotal = newDb.prepare ("select count (*) as ct from odb").get ().ct;
	console.log ("Done. " + ctTotal + " rows in " + pathNewDb + ".");

	oldDb.close ();
	newDb.close ();
