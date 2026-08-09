const {app, BrowserWindow, Menu} = require ("electron");
const http = require ("http");
const https = require ("https");
const childProcess = require ("child_process");
const fs = require ("fs");
const pathTool = require ("path");

/*  Which server -- 8/9/26 by CC. A packaged copy of the app is a window
	onto the sandbox on marin: nothing to install beside it, it just
	connects. Running from the repo (npm start) keeps the developer loop --
	find or spawn the local server. A serverUrl in appConfig.json in the
	app's data folder overrides either, so any copy can be pointed
	anywhere.  */

const urlSandbox = "https://sandbox0.usertalk.org";
var urlServer = "http://localhost:1680"; //assigned for real at ready
var urlBrowsePage; //assigned at ready, from urlServer
const folderTrigger = pathTool.resolve (__dirname, "..");

function chooseServer () {
	if ((process.env.ODB_SERVER_URL !== undefined) && (process.env.ODB_SERVER_URL.length > 0)) { //for testing a copy against any server
		return (process.env.ODB_SERVER_URL);
		}
	try {
		const theConfig = JSON.parse (fs.readFileSync (pathTool.join (app.getPath ("userData"), "appConfig.json"), "utf8"));
		if ((typeof theConfig.serverUrl === "string") && (theConfig.serverUrl.length > 0)) {
			return (theConfig.serverUrl);
			}
		}
	catch (err) {
		}
	if (app.isPackaged) {
		return (urlSandbox);
		}
	return ("http://localhost:1680");
	}

function flLocalServer () {
	return (urlServer.indexOf ("http://localhost") === 0);
	}

function webRequest (theUrl, theOptions, callback) { //http or https, whichever the url says
	const theModule = (theUrl.indexOf ("https:") === 0) ? https : http;
	return (theModule.request (theUrl, theOptions, callback));
	}

var theServerProcess; //assigned by startServer, only if no server was already answering
var pathWindowState; //assigned at ready -- userData isn't known before then
const openWindows = []; //every live window, so state can be saved as they move and close
var theSaveTimer;
var thePassword; //assigned by borrowPassword -- the same saved value the browse page asked for

function checkServer (callback) { //flUp
	const theRequest = webRequest (urlServer + "/version", {method: "GET"}, function (theResponse) {
		theResponse.resume ();
		callback (theResponse.statusCode === 200);
		});
	theRequest.on ("error", function () {
		callback (false);
		});
	theRequest.setTimeout (2500, function () {
		theRequest.destroy ();
		callback (false);
		});
	theRequest.end ();
	}

function startServer (callback) { //a remote server just has to answer; a local one we find running or launch ourselves
	checkServer (function (flUp) {
		if (flUp) {
			callback ();
			}
		else {
			if (!flLocalServer ()) { //nothing to launch -- open the window anyway, the page says what's wrong
				callback ();
				return;
				}
			theServerProcess = childProcess.spawn ("node", ["trigger.js"], {
				cwd: folderTrigger,
				env: Object.assign ({}, process.env, {NODE_PATH: pathTool.join (folderTrigger, "node_modules")})
				});
			var ctPolls = 0;
			function poll () {
				checkServer (function (flUpNow) {
					if (flUpNow) {
						callback ();
						}
					else {
						ctPolls++;
						if (ctPolls < 40) {
							setTimeout (poll, 250);
							}
						else {
							console.log ("Can't start because the odb server didn't come up.");
							app.quit ();
							}
						}
					});
				}
			poll ();
			}
		});
	}

/*  The menubar -- 8/8/26 by CC. The app's menus come from the database:
	user.menus.customMenu, served by /getmenubar with each command's script
	riding along as OPML. A menu named "=expression" gets the expression's
	value as its name, evaluated on the server. Choosing a command sends its
	script to the frontmost window's page, which runs it with the same
	machinery as the Run button -- so dialogs appear over what the person is
	looking at.  */

function serverJson (thePath, theBody, callback) { //one transport primitive for the app's own calls
	const theOptions = {
		method: (theBody === undefined) ? "GET" : "POST",
		headers: {"x-trigger-password": thePassword}
		};
	const theRequest = webRequest (urlServer + thePath, theOptions, function (theResponse) {
		var theText = "";
		theResponse.on ("data", function (chunk) {
			theText += chunk;
			});
		theResponse.on ("end", function () {
			var jstruct;
			try {
				jstruct = JSON.parse (theText);
				}
			catch (err) {
				callback ({message: "Can't understand the server's answer to " + thePath + "."});
				return;
				}
			if (theResponse.statusCode !== 200) {
				callback (jstruct);
				return;
				}
			callback (undefined, jstruct);
			});
		});
	theRequest.on ("error", function (err) {
		callback (err);
		});
	if (theBody !== undefined) {
		theRequest.write (theBody);
		}
	theRequest.end ();
	}

function borrowPassword (callback) { //the page asks the person once and saves it; the app reads the same saved value

	/*  8/9/26 by CC -- any live window will do, and the poll never gives
		up while the app runs: the first version watched only the first
		window, and if that one was closed before the person connected, the
		menubar silently never arrived.  */

	function poll () {
		var theWindow;
		openWindows.forEach (function (openWindow) {
			if ((theWindow === undefined) && !openWindow.isDestroyed ()) {
				theWindow = openWindow;
				}
			});
		if (theWindow === undefined) {
			setTimeout (poll, 1000);
			return;
			}
		theWindow.webContents.executeJavaScript ("localStorage.getItem (\"odbBrowserPassword\")").then (function (theValue) {
			if ((theValue !== null) && (theValue !== undefined) && (theValue.length > 0)) {
				callback (theValue);
				}
			else {
				setTimeout (poll, 1000);
				}
			}).catch (function () {
				setTimeout (poll, 1000);
				});
		}
	poll ();
	}

function runMenuCommand (theLine) { //the command's script runs in the frontmost window, dialogs and all
	var theWindow = BrowserWindow.getFocusedWindow ();
	if (theWindow === null) {
		theWindow = undefined;
		}
	if (theWindow === undefined) {
		openWindows.forEach (function (openWindow) {
			if ((theWindow === undefined) && !openWindow.isDestroyed ()) {
				theWindow = openWindow;
				}
			});
		}
	if (theWindow === undefined) {
		return;
		}
	theWindow.webContents.executeJavaScript ("runMenuScript (" + JSON.stringify (theLine.scriptOpml) + ")").catch (function (err) {
		console.log ("Can't run the menu command " + theLine.text + " because " + err.message);
		});
	}

function menuTemplateFromLines (theLines) { //the flat lines with levels become nested menus

	const summits = [];
	const stack = [];
	theLines.forEach (function (theLine) {
		const theNode = {line: theLine, subs: []};
		while ((stack.length > 0) && (stack [stack.length - 1].line.level >= theLine.level)) {
			stack.pop ();
			}
		if (stack.length === 0) {
			summits.push (theNode);
			}
		else {
			stack [stack.length - 1].subs.push (theNode);
			}
		stack.push (theNode);
		});

	function itemFromNode (theNode) {
		const theLine = theNode.line;
		if (theLine.flComment === true) { //a commented line is turned off, its whole branch with it
			return (undefined);
			}
		if (theLine.text === "-") {
			return ({type: "separator"});
			}
		const theItem = {label: theLine.text};
		if (theNode.subs.length > 0) {
			const submenu = [];
			theNode.subs.forEach (function (subNode) {
				const subItem = itemFromNode (subNode);
				if (subItem !== undefined) {
					submenu.push (subItem);
					}
				});
			theItem.submenu = submenu;
			}
		else {
			if (theLine.scriptOpml !== undefined) {
				if (theLine.cmdkey !== undefined) {
					theItem.accelerator = "CommandOrControl+" + theLine.cmdkey;
					}
				theItem.click = function () {
					runMenuCommand (theLine);
					};
				}
			}
		return (theItem);
		}

	const menus = [];
	summits.forEach (function (theNode) {
		const theItem = itemFromNode (theNode);
		if ((theItem !== undefined) && (theItem.submenu !== undefined)) { //a summit with no items isn't a menu
			menus.push (theItem);
			}
		});
	return (menus);
	}

function evaluateMenuTitles (customMenus, callback) { //a menu named "=expression" gets the expression's value as its name
	const pending = [];
	customMenus.forEach (function (theMenu) {
		if (theMenu.label.startsWith ("=")) {
			pending.push (theMenu);
			}
		});
	function doNext () {
		if (pending.length === 0) {
			callback ();
			return;
			}
		const theMenu = pending.shift ();
		serverJson ("/run", theMenu.label.slice (1), function (err, data) {
			if ((err === undefined) && (data.value !== undefined)) {
				theMenu.label = String (data.value);
				}
			doNext (); //an error leaves the "=expression" name showing, which at least says what it is
			});
		}
	doNext ();
	}

function fileMenuTemplate (callback) { //File lists the databases -- each one opens as its own window, DW's model
	serverJson ("/getdatabases", undefined, function (err, data) {
		const items = [];
		if ((err === undefined) && (data.databases.length > 0)) {
			data.databases.forEach (function (theDatabase) {
				items.push ({
					label: theDatabase.name,
					click: function () {
						createWindow (urlBrowsePage + "?database=" + encodeURIComponent (theDatabase.name));
						}
					});
				});
			items.push ({type: "separator"});
			}
		items.push ({role: "close"});
		callback ({label: "File", submenu: items});
		});
	}

function installMenubar () {

	/*  8/9/26 by CC -- keeps trying until the menubar is really up: one
		failed fetch used to mean no menus for the whole session.  */

	serverJson ("/getmenubar", undefined, function (err, data) {
		if (err !== undefined) {
			console.log ("Can't build the menubar yet (" + err.message + ") -- trying again in 5 seconds.");
			setTimeout (installMenubar, 5000);
			return;
			}
		const customMenus = menuTemplateFromLines (data.lines);
		evaluateMenuTitles (customMenus, function () {
			fileMenuTemplate (function (theFileMenu) {
				try {
					const theTemplate = [
						{role: "appMenu"},
						theFileMenu,
						{role: "editMenu"},
						{role: "viewMenu"}
						].concat (customMenus).concat ([
						{role: "windowMenu"}
						]);
					Menu.setApplicationMenu (Menu.buildFromTemplate (theTemplate));
					console.log ("menubar installed -- " + customMenus.length + " custom menus");
					}
				catch (buildErr) {
					console.log ("Can't install the menubar because " + buildErr.message);
					}
				});
			});
		});
	}

function readWindowState () {

	/*  8/8/26 by CC -- windows follow databases now, so a saved plain
		browse window (the merged-root view, a storage artifact) comes back
		as the nodeEditor.root window, and a fresh start opens that too.  */

	const urlDefaultWindow = urlBrowsePage + "?database=nodeEditor.root";
	try {
		const jstruct = JSON.parse (fs.readFileSync (pathWindowState, "utf8"));
		if (Array.isArray (jstruct.windows) && (jstruct.windows.length > 0)) {
			jstruct.windows.forEach (function (savedWindow) {
				const ixPath = savedWindow.url.indexOf ("/odbbrowser/");
				if (ixPath !== -1) { //windows follow the app to whatever server it talks to now
					savedWindow.url = urlServer + savedWindow.url.slice (ixPath);
					}
				if ((savedWindow.url === urlBrowsePage) || (savedWindow.url === urlBrowsePage + "index.html")) {
					savedWindow.url = urlDefaultWindow;
					}
				});
			return (jstruct);
			}
		}
	catch (err) {
		}
	return ({windows: [{url: urlDefaultWindow, bounds: {width: 1100, height: 750}}]});
	}

function saveWindowState () {
	const theWindows = [];
	openWindows.forEach (function (theWindow) {
		if (!theWindow.isDestroyed ()) {
			theWindows.push ({
				url: theWindow.webContents.getURL (),
				bounds: theWindow.getBounds ()
				});
			}
		});
	if (theWindows.length > 0) { //quitting closes windows one by one -- never save the emptied-out end state
		fs.writeFileSync (pathWindowState, JSON.stringify ({windows: theWindows}, undefined, "\t"));
		}
	}

function saveSoon () {
	clearTimeout (theSaveTimer);
	theSaveTimer = setTimeout (saveWindowState, 500);
	}

function trackWindow (theWindow) {
	openWindows.push (theWindow);
	theWindow.on ("move", saveSoon);
	theWindow.on ("resize", saveSoon);
	theWindow.on ("close", saveWindowState); //synchronous -- a debounced save can lose the race against quit
	theWindow.webContents.setWindowOpenHandler (function () { //a double-clicked script opens a real window
		return ({action: "allow"});
		});
	theWindow.webContents.on ("did-create-window", function (childWindow) {
		trackWindow (childWindow);
		});
	}

function createWindow (theUrl, theBounds) {
	const theWindow = new BrowserWindow (Object.assign ({
		width: 1100,
		height: 750
		}, theBounds));
	trackWindow (theWindow);
	theWindow.loadURL (theUrl);
	return (theWindow);
	}

app.whenReady ().then (function () {
	urlServer = chooseServer ();
	urlBrowsePage = urlServer + "/odbbrowser/";
	pathWindowState = pathTool.join (app.getPath ("userData"), "windowState.json");
	startServer (function () {
		const theState = readWindowState ();
		theState.windows.forEach (function (savedWindow) {
			createWindow (savedWindow.url, savedWindow.bounds);
			});
		borrowPassword (function (theValue) { //the menubar comes up as soon as the saved connection is readable
			thePassword = theValue;
			installMenubar ();
			});
		});
	});

app.on ("window-all-closed", function () {
	app.quit ();
	});

app.on ("will-quit", function () {
	if (theServerProcess !== undefined) {
		theServerProcess.kill ();
		}
	});
