var myProductName = "frontierOdb", myVersion = "0.2.1";

/*  Read a Frontier object database (.root file), or a fat page export
	(.fttb, .ftop, .ftsc), into a JavaScript structure.

	The format was learned from the Frontier kernel source, released under
	the GPL by UserLand Software: https://github.com/scripting/frontier

	Key source files: db.c and dbinternal.h (the block file), cancoon.c
	(the root record), langhash.c (packed tables), langexternal.c
	(externals, including the in-memory packing fat pages use),
	oppack.c (packed outlines), tablepack.c (fat page table wrapper).

	by CC, 7/26/26 */

const fs = require ("fs");

const valueTypeNames = {
	0: "novalue", 1: "char", 2: "int", 3: "long", 4: "oldstring", 5: "binary",
	6: "boolean", 7: "token", 8: "date", 9: "address", 10: "code", 11: "double",
	12: "string", 13: "external", 14: "direction", 15: "password", 16: "ostype",
	18: "point", 19: "rect", 20: "pattern", 21: "rgb", 22: "fixed", 23: "single",
	24: "olddouble", 25: "objspec", 26: "filespec", 27: "alias", 28: "enum",
	29: "list", 30: "record"
	};

const externalIdNames = {
	0: "outline", 1: "wptext", 2: "headrecord", 3: "table", 4: "script", 5: "menubar", 6: "pict", 7: "card"
	};

const macRomanHighChars =
	"ÄÅÇÉÑÖÜáàâäãåçéè" +
	"êëíìîïñóòôöõúùûü" +
	"†°¢£§•¶ß®©™´¨≠ÆØ" +
	"∞±≤≥¥µ∂∑∏π∫ªºΩæø" +
	"¿¡¬√ƒ≈∆«»… ÀÃÕŒœ" + //nonbreaking space
	"–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ" +
	"‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ" +
	"ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ"; //apple logo

function macRomanToString (theBuffer) {
	var result = "";
	theBuffer.forEach (function (theByte) {
		if (theByte < 0x80) {
			result += String.fromCharCode (theByte);
			}
		else {
			result += macRomanHighChars [theByte - 0x80];
			}
		});
	return (result);
	}

function unpackWpText (theBuffer) {

	/*  Word-processing text. The engine that wrote these was licensed and
		its source isn't in the kernel, but the packed form is mostly ASCII
		and the document's text is stored plainly: a length in hex, a
		comma, then that many bytes. The leading run (or runs, for a long
		document) is the text; what follows is the font table and the style
		records, which we don't keep.

		by CC, 7/28/26 */

	function flHexDigit (theByte) {
		return (((theByte >= 0x30) && (theByte <= 0x39)) || ((theByte >= 0x41) && (theByte <= 0x46)));
		}

	function flLooksLikeText (theBytes) { //a text run is printable; a font or style record isn't
		if (theBytes.length === 0) {
			return (false);
			}
		var ctPrintable = 0;
		theBytes.forEach (function (theByte) {
			if (((theByte >= 32) && (theByte < 127)) || (theByte === 13) || (theByte === 10) || (theByte === 9) || (theByte >= 0x80)) {
				ctPrintable++;
				}
			});
		return ((ctPrintable / theBytes.length) > 0.98);
		}

	const pieces = [];
	var ix = 0;
	var flStarted = false;

	while (ix < theBuffer.length) {

		var ixDigits = ix;
		while ((ixDigits < theBuffer.length) && flHexDigit (theBuffer [ixDigits])) {
			ixDigits++;
			}

		if ((ixDigits > ix) && (ixDigits < theBuffer.length) && (theBuffer [ixDigits] === 0x2c)) { //a comma closes the count
			const ctChars = parseInt (theBuffer.slice (ix, ixDigits).toString ("latin1"), 16);
			const ixText = ixDigits + 1;
			if ((ctChars > 0) && ((ixText + ctChars) <= theBuffer.length)) {
				const theRun = theBuffer.slice (ixText, ixText + ctChars);
				if (flLooksLikeText (theRun)) {
					pieces.push (macRomanToString (theRun));
					flStarted = true;
					ix = ixText + ctChars;
					continue;
					}
				if (flStarted) { //the text ended; the rest is fonts and styles
					break;
					}
				ix = ixText + ctChars;
				continue;
				}
			}

		ix++;
		}

	return (pieces.join (""));
	}

function convertMacDate (theSeconds) { //seconds since 1/1/1904, the Mac epoch
	if (theSeconds === 0) {
		return (undefined);
		}
	const macEpoch = Date.UTC (1904, 0, 1);
	return (new Date (macEpoch + theSeconds * 1000).toISOString ());
	}

function flNameLooksSecret (theName) { //apiSecret, SecretAccessKey, google.key -- credentials hide under many names
	const lower = theName.toLowerCase ();
	if (lower === "key") {
		return (true);
		}
	var result = false;
	["password", "passwd", "secret", "token", "credential", "apikey", "accesskey", "privatekey"].forEach (function (part) {
		if (lower.indexOf (part) !== -1) {
			result = true;
			}
		});
	return (result);
	}

function makeUnpacker (getBlock, flMemory) {

	/*  The unpack functions, shared by the two readers. In a .root file,
		big values live in db blocks reached through getBlock; in a fat
		page (flMemory true) everything is inline and getBlock is never
		called.  */

	function getPascalString (theBuffer, ix) {
		const len = theBuffer [ix];
		return (macRomanToString (theBuffer.slice (ix + 1, ix + 1 + len)));
		}

	function unmergeHandles (theBuffer) { //[4-byte size of first part][first part][second part]
		const sizeFirst = theBuffer.readUInt32BE (0);
		return ({
			part1: theBuffer.slice (4, 4 + sizeFirst),
			part2: theBuffer.slice (4 + sizeFirst)
			});
		}

	function getScalarBytes (hstrings, ix) { //[4-byte len][bytes], or len == -1 then [dbaddress], .root files only
		const len = hstrings.readInt32BE (ix);
		if (len === -1) {
			const adr = hstrings.readUInt32BE (ix + 4);
			return (getBlock (adr));
			}
		return (hstrings.slice (ix + 4, ix + 4 + len));
		}

	function unpackOutline (theBuffer) {

		const sizelinetable = theBuffer.readUInt32BE (2);
		const sizetext = theBuffer.readUInt32BE (6);
		const headerSize = theBuffer.length - sizetext - sizelinetable;
		const textBytes = theBuffer.slice (headerSize, headerSize + sizetext);
		const tableBytes = theBuffer.slice (headerSize + sizetext, headerSize + sizetext + sizelinetable);

		const lines = [];
		var ixText = 0;
		while (ixText < textBytes.length) { //CR-separated lines, leading tabs are the depth
			var level = 0;
			while (textBytes [ixText] === 9) { //tab
				level++;
				ixText++;
				}
			const ixStart = ixText;
			while ((ixText < textBytes.length) && (textBytes [ixText] !== 13)) { //carriage return
				ixText++;
				}
			lines.push ({level, text: macRomanToString (textBytes.slice (ixStart, ixText))});
			ixText++;
			if (textBytes [ixText] === 10) { //linefeed
				ixText++;
				}
			}

		var ixTable = 0;
		lines.forEach (function (line) { //per line: flags short, refcon length long, refcon bytes
			if (ixTable + 6 <= tableBytes.length) {
				const flags = tableBytes.readUInt16BE (ixTable);
				const lenrefcon = tableBytes.readUInt32BE (ixTable + 2);
				ixTable += 6 + lenrefcon;
				line.flExpanded = (flags & 0x8000) !== 0;
				line.flComment = (flags & 0x0400) !== 0;
				line.flBreakpoint = (flags & 0x0200) !== 0;
				}
			});

		return (lines);
		}

	function unpackExternal (packed, depth) { //[version short][id byte][pad], then a dbaddress or the data inline

		const id = packed [2];
		const kind = externalIdNames [id];

		function getExternalData () {
			if (flMemory) {
				return (packed.slice (4));
				}
			return (getBlock (packed.readUInt32BE (4)));
			}

		if (kind === "table") {
			if (depth > 100) {
				const message = "Can't unpack the table because it's nested more than 100 levels deep.";
				throw new Error (message);
				}
			return ({type: "table", value: unpackTable (getExternalData (), depth + 1)});
			}
		else {
			if ((kind === "outline") || (kind === "script")) {
				return ({type: kind, lines: unpackOutline (getExternalData ())});
				}
			else {
				const blockData = getExternalData ();
				var length = 0;
				if (blockData !== undefined) {
					length = blockData.length;
					}
				if ((kind === "wptext") && (blockData !== undefined)) {
					return ({type: kind, length, text: unpackWpText (blockData)});
					}
				return ({type: kind, length});
				}
			}
		}

	function unpackTable (theBuffer, depth) {

		const outer = unmergeHandles (theBuffer); //part1 is the packed hash table, part2 the display formats
		const inner = unmergeHandles (outer.part1); //part1 is the records, part2 the strings
		const hrecords = inner.part1;
		const hstrings = inner.part2;

		const table = {};
		var ix = 0;

		const headerVersion = hrecords.readUInt16BE (0);
		if (headerVersion > 0) { //a 16-byte table header: version, sortorder, timecreated, timelastsave, flags
			ix = 16;
			}

		while (ix + 10 <= hrecords.length) { //10-byte records: name index long, type byte, version byte, data 4 bytes

			const ixkey = hrecords.readUInt32BE (ix);
			const valuetype = hrecords [ix + 4];
			const name = getPascalString (hstrings, ixkey);
			const typeName = valueTypeNames [valuetype];
			var value;

			switch (typeName) {
				case "string":
					value = macRomanToString (getScalarBytes (hstrings, hrecords.readUInt32BE (ix + 6)));
					break;
				case "password": //never import passwords
					value = "xxx";
					break;
				case "oldstring":
					value = getPascalString (hstrings, hrecords.readUInt32BE (ix + 6));
					break;
				case "address":
					value = {type: "address", path: getPascalString (hstrings, hrecords.readUInt32BE (ix + 6))};
					break;
				case "boolean":
					value = hrecords [ix + 6] !== 0;
					break;
				case "char":
					value = macRomanToString (hrecords.slice (ix + 6, ix + 7));
					break;
				case "int": case "token": case "direction":
					value = hrecords.readInt16BE (ix + 6);
					break;
				case "long": case "fixed": case "enum":
					value = hrecords.readInt32BE (ix + 6);
					break;
				case "ostype":
					value = macRomanToString (hrecords.slice (ix + 6, ix + 10));
					break;
				case "date":
					value = convertMacDate (hrecords.readUInt32BE (ix + 6));
					break;
				case "point": //stored directly in the record, not in the strings block: v then h, two shorts
					value = {type: "point", v: hrecords.readInt16BE (ix + 6), h: hrecords.readInt16BE (ix + 8)};
					break;
				case "single": //also direct, a 4-byte float
					value = hrecords.readFloatBE (ix + 6);
					break;
				case "external":
					const ixval = hrecords.readUInt32BE (ix + 6);
					const len = hstrings.readInt32BE (ixval);
					value = unpackExternal (hstrings.slice (ixval + 4, ixval + 4 + len), depth);
					break;
				case "novalue":
					value = undefined;
					break;
				default: //binary, double, code, the rest -- kept as a marker, not decoded
					const bytes = getScalarBytes (hstrings, hrecords.readUInt32BE (ix + 6));
					var length = 0;
					if (bytes !== undefined) {
						length = bytes.length;
						}
					value = {type: typeName, length};
					break;
				}

			const flStructure = (typeof value === "object") && (value !== null) && ((value.type === "table") || (value.lines !== undefined)); //a script named checkPassword is code, not a secret
			if (flNameLooksSecret (name) && !flStructure) { //never import credentials, whatever the type
				value = "xxx";
				}
			table [name] = value;
			ix += 10;
			}

		return (table);
		}

	return ({unpackTable, unpackExternal});
	}

function readRootFile (path) {

	const buf = fs.readFileSync (path);

	function getBlock (adr) { //the data bytes of the db block at adr
		if (adr === 0) {
			return (undefined);
			}
		const sizeword = buf.readUInt32BE (adr);
		const flFree = (sizeword & 0x80000000) !== 0;
		if (flFree) {
			const message = "Can't read the block at " + adr + " because it's on the free list.";
			throw new Error (message);
			}
		const nodebytes = sizeword & 0x7FFFFFFF;
		const variance = buf.readUInt32BE (adr + 4);
		return (buf.slice (adr + 8, adr + 8 + nodebytes - variance));
		}

	//the file header: system id byte, version byte, then the availlist; the root view address is at offset 10
	const versionnumber = buf [1];
	if ((versionnumber < 5) || (versionnumber > 6)) {
		const message = "Can't read " + path + " because its version is " + versionnumber + " and this package reads versions 5 and 6.";
		throw new Error (message);
		}
	const rootview = buf.readUInt32BE (10);

	//the root record: a version short, then the address of the root table
	const ccrec = getBlock (rootview);
	const adrroottable = ccrec.readUInt32BE (2);

	const unpacker = makeUnpacker (getBlock, false);
	return (unpacker.unpackTable (getBlock (adrroottable), 0));
	}

function readFatPage (path) {

	/*  A fat page is a text file: CR-separated #directive lines, with the
		value packed into a base64 #pageData directive. Frontier exported
		them as .fttb (table), .ftop (outline), .ftsc (script).  */

	const theText = fs.readFileSync (path, "latin1");

	const directives = {};
	theText.split ("\r").forEach (function (line) {
		if (line.charAt (0) === "#") {
			const ixSpace = line.indexOf (" ");
			if (ixSpace === -1) {
				directives [line.slice (1)] = true;
				}
			else {
				directives [line.slice (1, ixSpace)] = line.slice (ixSpace + 1);
				}
			}
		});

	if (directives.pageData === undefined) {
		const message = "Can't read " + path + " because it doesn't have a #pageData directive.";
		throw new Error (message);
		}

	const packed = Buffer.from (directives.pageData, "base64");
	delete directives.pageData;

	const unpacker = makeUnpacker (undefined, true);
	return ({directives, value: unpacker.unpackExternal (packed, 0)});
	}

function getAddress (theDatabase, thePath) { //"nodeEditorSuite.data.glossary" -> the value at that path
	var current = theDatabase;
	thePath.split (".").forEach (function (part) {
		if (current === undefined) {
			return;
			}
		var next = current [part];
		if ((next !== undefined) && (next.type === "table")) {
			next = next.value;
			}
		current = next;
		});
	return (current);
	}

exports.readRootFile = readRootFile;
exports.readFatPage = readFatPage;
exports.getAddress = getAddress;
exports.macRomanToString = macRomanToString; //8/3/26 by CC -- so callers can build the exact inverse encoding
exports.myVersion = myVersion;
