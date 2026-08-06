# What trigger can do

*Written 8/4/26 for Jake Savin and Dave Winer. Describes trigger v0.5.0 running usertalk v0.3.0 at https://trigger.usertalk.org, backed by a SQL copy of Dave's Frontier object database — 212,591 objects, decoded from the real .root files.*

## The one-paragraph version

Trigger is a web server that runs UserTalk. You send it a script over HTTP and it answers with the value. The scripts are Dave's own — not ported, not rewritten — read straight out of a decoded copy of his object database, and the language underneath is a fresh implementation of the UserTalk interpreter in JavaScript. As of today it runs the nodeEditor build pipeline end to end: an outline written in Electric Drummer on a laptop is uploaded, built by `nodeEditorSuite.uploadScripts`, and the rendered files land on a live website.

## The endpoints

| Endpoint | What it does |
|---|---|
| `GET /version` | product, version, usertalk version, row count. No password. |
| `GET|POST /run` | Runs a script, answers the value as JSON. The script may be plain text (tab-indented), OPML from an outliner, or a URL parameter. `&trace=1` adds the list of verb calls. |
| `GET /downloadobject?address=…` | Answers a script or outline from the database as OPML. |
| `POST /uploadobject?address=…&type=script|outline` | Installs OPML into the database at that address. |
| `POST /rpc2` | XML-RPC. `webEdit.sendToServer` and `webEdit.getFromServer` — the same calls the 1999 webEdit suite makes, so desktop Frontier can read and write objects here. |

Everything but `/version` takes a password. There is no other boundary: **any address in the database is reachable.** That was a deliberate call — "I don't know any part that can be untouchable."

Answers are JSON. **A `message` property always means an error**, everywhere, no exceptions. Success answers use other names (`value`, `note`, `opmltext`).

## What's implemented

**180 verbs** across 27 families. The ones that matter:

- **string** (28) — replaceAll, multipleReplaceAll, mid, delete, patternMatch, parseAddress, urlEncode/Decode, padWithZeros, trimWhitespace, nthField…
- **file** (14) — readWholeFile, writeWholeFile, copy, exists, sureFilePath, isFolder, newFolder, rename, delete, modified
- **date** (17) and **clock** (2) — the full arithmetic set: nextMonth, firstOfMonth, daysInMonth, netStandardString…
- **xml** (13) — compile, decompile, getAddress, getAddressList, getValue, getAttributeValue, addTable, addValue, opml.getBodyAddress
- **table** (4), **wp** (3), **script** (2), **target** (3), **thread** (4), **sys** (6), **semaphore** (2)
- **html** (7) — including `html.directory.getRawHtml`, the renderer at the heart of the build pipeline
- **lang** (25) — the `lang.` spellings of the core verbs, so both forms work
- Core operators as verbs: string, number, boolean, date, sizeOf, defined, typeOf, nameOf, new, delete, random, abs

The language itself: handlers with default and named parameters, `local`/`global`, `bundle`, `with`, `if/else`, `case`, `for`/`for-in`/`loop`, `while`, `try`, `return`/`break`/`continue`, addresses (`@`) and dereference (`^`), computed identifiers (`[expr].name`), nth-entry subscripts, `++`/`--`, and Frontier's case-insensitive name lookup everywhere.

Scripts stored in the database are parsed on first call and called like verbs. Trailing `bundle` blocks are treated as test code and skipped, the way Frontier does.

## What is NOT implemented

**Stubs — they answer but do nothing.** A script calling one keeps running; it does not fail:

- `s3.newobject`, `s3.getobject`, `s3.objectexists` — no S3
- `tcp.httpreadurl` — **no outbound HTTP** (this one bites: a script that fetches a URL silently gets nothing)
- `op.insert`, `op.go`, `op.firstSummit`, `op.getCursor`, `op.setCursor`, `op.deleteLine`, `op.getLineText`, `op.setLineText`, `op.wipe`, `op.sort`, `op.xmlToOutline` — the outline-cursor verbs, which assume a window
- `window.frontmost` — there is no window
- `json.compile`, `json.decompile`
- `export.sendObject`, `file.getDatePath`, `fatPages.buildFileAtts`
- `nodeEditorSuite.saveSourceOpmlToRepo`, `.building.copyFile`, `.utilities.deleteDsStoreFiles`

**Screen verbs are no-ops by family.** Anything starting with `menu.`, `window.`, `speaker.`, `mouse.`, `kb.`, `clipboard.` answers success (or `false` for an `is…` question) without doing anything. There's no screen.

**Any other missing kernel verb fails loudly, by name** — "Can't call the kernel verb X because it isn't implemented in the verb library." That's deliberate: gaps announce themselves instead of silently doing nothing.

**Not implemented at all:** the ODB write-back to `.root` format (data moves Frontier → server, never back), `mainResponder`/website-framework serving, agents and the scheduler, sound, serial, AppleScript/OSA.

## Limits on how types can be used

- **Tables are the database.** Reading or writing a table entry is a SQL row operation, and writes persist immediately — there is no save step and no transaction. A script that writes into `scratchpad` has changed the database when it returns.
- **`local (x = someTable)` binds a REFERENCE, not a copy.** Frontier copied on assignment; this doesn't. Code that says "work with a copy" and then modifies entries will modify the original. Copy explicitly when you mean a copy.
- **Outlines and scripts** are first-class values (`outlinetype`, `scripttype`) and move as OPML through the endpoints. Attributes on outline nodes are **dropped** on upload — only text, level and the isComment flag survive. Comment lines survive.
- **wptext** is a string that knows it's wptext. Values loaded from the old database arrive decoded; new ones are built from strings.
- **Binary values and other Frontier types** that the decoder couldn't read arrive as markers carrying their type and byte count, not their bytes. A script that reads one gets a marker, not data.
- **`file` verbs read and write latin-1.** Characters above U+00FF (em-dash, curly quotes) are written as a corrupt byte. Ordinary text is fine; this is a known gap, not a design choice.
- **Colon paths are mapped.** File paths are Frontier-style (`Macintosh HD:Users:davewiner:…`) and a configured path map translates a prefix to a real folder. A path no prefix covers is refused, and `..` segments are refused.
- **Addresses** are symbolic: taking `@a.b.c` never touches the database, the path resolves each time it's used, and assigning through an address creates the tables on the way.
- **Every request gets a fresh environment.** Locals don't survive between calls; anything a script means to keep, it writes into the database.
- **A runaway script is capped** at a million verb calls and then faults.

## Speed

A full nodeEditor build of a small site (7 files, ~1,200 verb calls) runs in **about 150 milliseconds**. It was 25 seconds this afternoon; the difference was two lookups that walked the whole 212,000-row database instead of asking for one row.

## The known rough edges

1. The latin-1 write path above.
2. Outline node attributes are lost on upload.
3. A `return` at the top level of text passed to `evaluate` returns from the calling handler.
4. Prefix matching in the path map has no segment boundary, so a prefix `…/foo` would also match `…/foobar`.

## Where the code is

`github.com/scripting/usertalk` — the interpreter (parse, evaluate, verbs, the SQL object database). Trigger itself is a single `trigger.js` on top of it, plus `frontierodb` for reading the original `.root` files.
