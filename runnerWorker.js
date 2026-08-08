/*  runnerWorker.js -- 8/7/26 by CC

	Runs one script on a worker thread so it can STOP AND WAIT for a person.

	The dialog verbs post their question to the main thread and block on
	Atomics.wait until the answer is written into shared memory. The server
	stays free to serve requests the whole time -- including the request
	that carries the answer.

	The parsing and serializing here (opmlToTree, textToTree, serializeValue,
	the trace cap) are copied from trigger.js, which can't be required
	because loading it starts the server. Change one, change both.  */

const {parentPort, workerData} = require ("worker_threads");
const pathTool = require ("path");

const folderUsertalk = workerData.folderUsertalk;
const parse = require (folderUsertalk + "/code/parse.js");
const evaluate = require (folderUsertalk + "/code/evaluate.js");
const verbsMaker = require (folderUsertalk + "/code/verbs.js");
const odbSql = require (folderUsertalk + "/code/odbSql.js");

const theControl = new Int32Array (workerData.sharedControl); //[0] answer-ready flag, [1] answer byte count
const theAnswerBytes = new Uint8Array (workerData.sharedData);

//the script that came in -- copied from trigger.js
	function unescapeXml (theString) {
		return (theString
			.replace (/&lt;/g, "<")
			.replace (/&gt;/g, ">")
			.replace (/&quot;/g, "\"")
			.replace (/&apos;/g, "'")
			.replace (/&amp;/g, "&"));
		}
	function opmlToTree (theXml) {
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
	function textToTree (theText) {
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

//the value going back -- copied from trigger.js
	function serializeValue (theValue, level) {
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

//asking the person on the other side
	function askUser (theQuestion) { //post the question, sleep until the answer arrives

		Atomics.store (theControl, 0, 0);
		parentPort.postMessage ({type: "dialog", question: theQuestion});
		Atomics.wait (theControl, 0, 0); //blocks this thread only -- the server keeps serving

		const ctBytes = Atomics.load (theControl, 1);
		const theText = Buffer.from (theAnswerBytes.slice (0, ctBytes)).toString ("utf8");
		try {
			return (JSON.parse (theText));
			}
		catch (err) {
			return ({button: "cancel"});
			}
		}
	function installDialogVerbs (verbs) {
		verbs ["dialog.alert"] = function (args) {
			askUser ({kind: "alert", prompt: String (args [0])});
			return (true);
			};
		verbs ["dialog.notify"] = verbs ["dialog.alert"];
		verbs ["dialog.confirm"] = function (args) {
			const theAnswer = askUser ({kind: "confirm", prompt: String (args [0])});
			return (theAnswer.button === "ok");
			};
		verbs ["edit"] = function (args) { //edit (@adr, title, flReadonly, @buttonsTable) -- opens a real window in the app

			/*  8/8/26 by CC -- Frontier's edit verb, the way nodeEditor uses it:
				the fourth parameter is the address of a TABLE OF SCRIPTS, one
				per button -- buttons are data, user-editable, not chrome. The
				window request rides the same channel as a dialog; the app
				answers as soon as the window is open, and the script moves on --
				edit doesn't wait for the window to close, same as Frontier.  */

			const theAddress = args [0];
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				const message = "Can't edit because the first parameter isn't the address of the object to open.";
				throw new Error (message);
				}
			const theQuestion = {kind: "edit", address: theAddress.pathText};
			var theObject = theAddress.reference.get (); //a table opens a table window; scripts and outlines open the editor
			if ((theObject !== undefined) && (theObject !== null) && (typeof theObject === "object") &&
				(theObject.flOdbScript === undefined) && (theObject.flOdbMenubar === undefined) &&
				(theObject.flWpText === undefined) && (theObject.flOdbAddressText === undefined) &&
				(theObject.flAddress === undefined) && (theObject.type === undefined) && (!Array.isArray (theObject))) {
				theQuestion.objectType = "table";
				}
			if (args [1] !== undefined) {
				theQuestion.title = String (args [1]);
				}
			if (args [2] === true) {
				theQuestion.flReadonly = true;
				}
			const adrButtons = args [3];
			if ((adrButtons !== undefined) && (adrButtons !== null) && (adrButtons.flAddress === true)) {
				theQuestion.buttonsAddress = adrButtons.pathText;
				}
			askUser (theQuestion);
			return (true);
			};
		verbs ["dialog.ask"] = function (args) { //dialog.ask (prompt, @answer) -- true on OK, the text lands at the address
			const thePrompt = String (args [0]);
			const theAddress = args [1];
			if ((theAddress === undefined) || (theAddress === null) || (theAddress.flAddress !== true)) {
				const message = "Can't ask because the second parameter isn't the address the answer goes to.";
				throw new Error (message);
				}
			var startValue = theAddress.reference.get ();
			if (typeof startValue !== "string") {
				startValue = "";
				}
			const theAnswer = askUser ({kind: "ask", prompt: thePrompt, startValue});
			if (theAnswer.button !== "ok") {
				return (false);
				}
			theAddress.reference.set (String (theAnswer.text));
			return (true);
			};
		}

//run it
	function main () {
		const whenStart = new Date ();
		try {
			const theStore = odbSql.openDatabase (workerData.pathDatabase);
			const theStatements = scriptToStatements (workerData.scriptText);

			const theTrace = [];
			theTrace.push = function (entry) { //a loop with no bottom must not run forever
				Array.prototype.push.call (this, entry);
				if (this.length >= workerData.maxVerbCalls) {
					const message = "Can't finish the script because it hit the cap of " + workerData.maxVerbCalls + " verb calls -- probably a loop that never ends.";
					throw new Error (message);
					}
				};

			const made = verbsMaker.makeVerbs (workerData.pathMap, theTrace);
			installDialogVerbs (made.verbs);
			const environment = evaluate.makeEnvironment (theStore.odb, made.verbs, theTrace);
			environment.parseScript = function (theLines) {
				return (parse.parseOutline (parse.linesToTree (theLines)));
				};
			environment.frames.push ({vars: {}});

			const theValue = evaluate.evaluate (theStatements, environment);

			const theResult = serializeValue (theValue);
			theResult.ctVerbCalls = theTrace.length;
			theResult.ctMilliseconds = new Date () - whenStart;
			parentPort.postMessage ({type: "done", result: theResult});
			}
		catch (err) {
			parentPort.postMessage ({type: "failed", message: err.message});
			}
		}

main ();
