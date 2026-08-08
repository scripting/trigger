#### 8/8/26; 5:30:00 PM by CC

The app has DW's menubar -- plan step 2. Trigger 0.5.3 adds /getmenubar, a read call that serves the menu structure with each command's script rendered as OPML (so isComment survives; 25 of the menu's scripts carry comment lines that must not run). The desktop app fetches it at launch, borrows the saved connection the browse page already made, and builds native menus: his initials as the first menu's name -- the "=user.prefs.initials" title really evaluates on the server -- then Script and NodeEditor, separators, submenus, command keys, commented lines left out. Choosing a command runs its script in the frontmost window, and dialogs appear there, over whatever the person is looking at -- the run-with-dialogs machinery moved from the script window into the shared layer so every window has it.

The local server config now points at the sandbox database, so the app opens on the same world as sandbox0.usertalk.org: the projects, the prefs, the menu. Deployed to marin the same hour; the update script now ships code as well as databases and restarts whenever either changed.

#### 8/8/26; 4:00:00 PM by CC

DW's custom menu is in the sandbox. He exported user.menus.customMenu from the OPML Editor as misc/menus.customMenu.ftmb, and frontierodb 0.3.0 learned to decode menubars -- both forms, the packed fat-page kind and the kind stored inside a database, so the two menubars inside nodeEditor.root that used to be opaque markers decode now too. 542 lines, 422 commands carrying their scripts; the rss.network command really runs nodeEditorSuite.openProjectWindow ("rssNetwork"), which is the front door the menu layer needs.

The build script mounts the export at user.menus.customMenu and the copy from the old database now merges instead of replacing, so an export in the build folder always wins. Deployed to marin with misc/marinUpdateSandbox0.js -- unpack to the side, kill, atomic rename, forever respawns. One lesson in that script's comments: find the pid from ps, not pgrep -f, which can answer two pids while a respawn is in flight.

#### 8/8/26; 1:45:00 PM by CC

sandbox0.usertalk.org is live on marin -- the sandbox for the new Frontier, step 1 of the plan. DW named it and pointed the DNS at marin. It's a second trigger instance in its own pagepark domain folder, serving the odb browser and concord, with its own database and its own pair of sandbox-only passwords.

The database is built by misc/buildSandbox0Db.js: odbHome-style from data/sandbox0odb/ (nodeEditor.root), then config.nodeEditor.projects (519 projects), user.menus and user.prefs copied over from the old layered odb.db by direct SQL row copy -- values never decoded, so the copy is exact. One gap: user.menus.customMenu is an undecoded marker in that database, so the real menu has to come from a DW export; the folder is where it goes, then rebuild.

Along the way, usertalk 0.3.1: the language constants no longer persist into every SQL database the evaluator touches -- they resolve at lookup time now -- and temp is a true alias of system.temp instead of a copy that silently diverged. The sandbox root shows exactly the 14 tables DW recognizes, nothing else.

Deploy notes for next time: pagepark launches any domains folder that has a package.json, but it only scans at boot -- or when you ask, curl the CLI port, localhost:1349/rescan. The deploy script (misc/marinDeploySandbox0.js) ships the manifest as packageJson.hold and renames it as the last step so a half-built folder can't launch.

#### 8/7/26; 2:05:33 PM by CC

Rewrote readme.md to describe the product as it is now -- the odb browser, the script windows and their buttons, dialogs, the desktop app, and the two-password permission split. It still described the 7/30 server, one endpoint and one password, and the repo is public now.

#### 8/7/26; 1:30:12 PM by CC

Big day -- trigger grew a face. The odb browser: a Concord outline over the database, Name/Value/Kind columns like Frontier's odb windows, lazy per-table loading through the new /listtable endpoint. Double-click a script's name and it opens in an editable window with Save, Run and Zoom buttons. Edits auto-save locally; the database changes only on Save. Run runs what's in the window and shows the value in the status line.

Dialogs. A script run through /run?interactive=1 executes on a worker thread, and the dialog verbs -- dialog.ask, dialog.confirm, dialog.alert/notify -- block on Atomics.wait until the person answers. The browser shows the dialog and POSTs the answer to /dialoganswer, which wakes the worker. The server stays fully alive while a script waits. Unanswered dialogs time out after 10 minutes.

The Electron app, in electronApp/. npm start finds a running server or launches trigger itself, restores every window where it was, and double-clicked scripts open real desktop windows. Electron is pinned at 22.3.27 because node 16 can't run newer electron's installer.

The two passwords now have different permissions: the webedit password opens everything; the run password opens the read calls only -- downloadobject and listtable -- and is refused on run, uploadobject and dialoganswer. Deployed to marin as 0.5.2, along with the fix that stops path-map helpers from shadowing the real nodeEditorSuite scripts in the database (see usertalk's worknotes, same day). The deploy script, with its backups and count-asserted edits, is misc/marinDeploy20260807.js.

The local test database is now built from nodeEditor.root alone -- data/nodeeditor.db -- so the browser opens on tables DW recognizes.

#### 8/7/26; 9:45:00 AM by CC

The repo is born. DW created it on GitHub with the LICENSE; everything else pushed from his Mac, where the GitHub CLI is now authorized. config.json is in the first commit per DW's convention -- committed once so it's there, then never updated again. node_modules, the data folder and backups stay out.

#### 8/4/26; 5:00:00 PM by DW and CC

The edit-publish loop closed. DW edited an outline in Electric Drummer, ran two lines, and it published to marin.scripting.com/sallysreader through his own uploadScripts and buildSallyReader, running unmodified in usertalk on marin. Trigger 0.5.0: uploadobject/downloadobject for Electric Drummer, the config-driven path map, webEdit over XML-RPC at /rpc2.

#### 7/29/26; 12:00:00 PM by CC

Created. Ship a UserTalk script to a server, run it there, get the value back as JSON. Named by DW. One endpoint that matters -- /run -- plus /version. The password comes from config.json; an empty password locks the server rather than opening it.
