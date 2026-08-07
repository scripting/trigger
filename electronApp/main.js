const {app, BrowserWindow} = require ("electron");
const http = require ("http");
const childProcess = require ("child_process");
const fs = require ("fs");
const pathTool = require ("path");

const urlServer = "http://localhost:1680";
const urlBrowsePage = urlServer + "/odbbrowser/";
const folderTrigger = pathTool.resolve (__dirname, "..");

var theServerProcess; //assigned by startServer, only if no server was already answering
var pathWindowState; //assigned at ready -- userData isn't known before then
const openWindows = []; //every live window, so state can be saved as they move and close
var theSaveTimer;

function checkServer (callback) { //flUp
	const theRequest = http.get (urlServer + "/version", function (theResponse) {
		theResponse.resume ();
		callback (theResponse.statusCode === 200);
		});
	theRequest.on ("error", function () {
		callback (false);
		});
	theRequest.setTimeout (1000, function () {
		theRequest.destroy ();
		callback (false);
		});
	}

function startServer (callback) { //use the running server if there is one, else launch our own
	checkServer (function (flUp) {
		if (flUp) {
			callback ();
			}
		else {
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

function readWindowState () {
	try {
		const jstruct = JSON.parse (fs.readFileSync (pathWindowState, "utf8"));
		if (Array.isArray (jstruct.windows) && (jstruct.windows.length > 0)) {
			return (jstruct);
			}
		}
	catch (err) {
		}
	return ({windows: [{url: urlBrowsePage, bounds: {width: 1100, height: 750}}]});
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
	pathWindowState = pathTool.join (app.getPath ("userData"), "windowState.json");
	startServer (function () {
		const theState = readWindowState ();
		theState.windows.forEach (function (savedWindow) {
			createWindow (savedWindow.url, savedWindow.bounds);
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
