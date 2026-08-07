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
