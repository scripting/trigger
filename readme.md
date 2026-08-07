# trigger

Ship a UserTalk script to a server, run it there, get the value back.

Trigger is a small web service. You send it the text of a script; it runs the script under the [usertalk](https://github.com/scripting/usertalk) interpreter, against an object database built from Frontier roots, and answers with the value the script returned. Around that core it now also serves **the odb browser** -- windows onto the database, in a web browser or in a desktop app, where you can expand tables, open scripts, edit them, save them and run them, and where a running script can put up a dialog and wait for your answer.

The point is that nothing has to be installed where you write. The server holds the interpreter and the database; your machine holds the editor.

## The odb browser

Open `/odbbrowser/` and you're looking at the database the way Frontier shows it: Name, Value and Kind columns, wedges that expand tables in place. What was expanded stays expanded across visits, and the scroll position holds.

Double-click a script's name and it opens in its own window with three buttons:

- **Save** -- the only thing that writes to the database. Your edits auto-save locally as you type, and survive closing the window; the database changes when you say so.
- **Run** -- runs what's in the window, saved or not, and shows the value in the status line with the verb-call count and time. If the script asks a question -- `dialog.ask`, `dialog.confirm`, `dialog.notify` -- the dialog appears right there, the script waits as long as you take, and picks up where it was.
- **Zoom** -- collapse everything, cursor to the first summit.

The outliner is [Concord](https://github.com/scripting/concord); trigger serves it from the folder named by `pathConcord` in config.json.

## The desktop app

`electronApp/` wraps the same pages in real desktop windows. `npm start` in that folder finds a running server, or starts one itself, and restores every window where you left it -- same urls, same positions. Double-clicked scripts open new windows. Electron is pinned at 22.3.27 because node 16 can't run newer Electron's installer.

## What it answers

**`/run`** -- the one that does the work. POST the script as the body of the request, or pass a one-liner in the URL as `script`. Add `interactive=1` and the script runs on a worker thread where the dialog verbs work: the response either carries the finished value, or `{finished: false, runId, dialog}` -- show the dialog, POST the answer to `/dialoganswer?runid=...`, and repeat until finished. An unanswered dialog times out after ten minutes.

**`/downloadobject`** and **`/uploadobject`** -- scripts and outlines move as OPML, by address. This is what Electric Drummer and the script windows speak.

**`/listtable`** -- one level of a table, with a summary value and kind per entry. The odb browser's way of looking without loading.

**`/rpc2`** -- the webEdit endpoint, XML-RPC, for Frontier-family editors.

**`/version`** -- the name, the version, the interpreter version, and how many objects are in the database.

**`/`** -- a one-screen reminder.

## Running a script

The simplest thing that works:

```
curl "https://trigger.usertalk.org/run?password=xxx&script=string.lower(%22HELLO%22)"
```

The answer:

```json
{
    "valueType": "string",
    "value": "hello frontier",
    "ctVerbCalls": 1,
    "ctMilliseconds": 2
    }
```

A script of more than one line goes in the body of a POST, which is also how an outliner would send one:

```
curl -X POST "https://trigger.usertalk.org/run?password=xxx" --data-binary @myscript.opml
```

The body can be either an OPML document -- what an outliner saves -- or plain text with tabs for indenting, which is what a script looks like pasted out of an outline. Trigger figures out which it got by looking at the first character. Comment lines in the OPML are skipped, the way the interpreter skips them everywhere else.

Add `&trace=1` and the answer includes every verb the script called, in order. It's the fastest way to see where a script actually went.

## What comes back

Always JSON, and always either a value or a message.

`valueType` names what kind of value it is: `string`, `number`, `boolean`, `date`, `list`, `address`, `table`, or `nothing`. For the simple types, `value` is the value. An address answers with its path, so `@system.verbs.builtins.string` comes back as that text. A **table answers with the names of its entries and nothing more** -- a table in this database can have a very large tree under it, and dragging all of it back over HTTP is never what you meant. Ask for the entry you want by name.

When a script fails, the answer is a 500 with the interpreter's own message:

```json
{
    "message": "Can't call noSuchVerb because it isn't a verb, a handler or a script."
    }
```

A script that loops forever is stopped at a million verb calls, so one bad script can't take the server down.

## The two passwords

Every request but `/`, `/version` and the browser's static files carries a password, either as `?password=` in the URL or in an `x-trigger-password` header. There are two, with different permissions:

- **`webeditPassword`** opens everything -- run, upload, download, list, dialogs.
- **`password`** opens the read calls only: `/downloadobject` and `/listtable`. Running scripts and writing objects refuse it.

The split is a lock, not a promise: give an agent the read password and it can look all it wants, and cannot change the database no matter what it does. Both live in `config.json` on the server and nowhere else. Because the connection is https, sending them in the clear is safe.

**An empty password locks the server rather than opening it** -- a service that runs whatever script it's handed is complete control of the machine, and there is no version of that which should be available to strangers.

## Where the state lives

The database is one SQLite file. A script that writes into it -- `scratchpad.myAnswer = 42` -- has really written, and the next request can read it. Locals don't survive; each request gets a fresh set of local variables, so nothing leaks from one run into the next.

Nothing is ever written back to the `.root` format. The database was built from roots once, and from then on the database is the truth.

## Installing

Trigger is plain Node with one compiled dependency.

1. Put the folder somewhere, with the `usertalk` package inside it (or point `pathUsertalk` in `config.json` at wherever it lives).
2. `npm install`
3. Put a database at the path named by `pathDatabase` -- build one with `odbSql.buildDatabase` from a folder of roots, or copy a built one over.
4. Put passwords in `config.json`.
5. `node trigger.js`

It listens on the port in `config.json`, or on `PORT` from the environment if that's set, which is how PagePark hands a port to an app.

## config.json

| name | what it does |
| --- | --- |
| `password` | the read-only password: downloadobject and listtable; empty means refuse |
| `webeditPassword` | the full password: everything, including running scripts; empty means refuse |
| `webeditUsername` | the username the XML-RPC webEdit endpoint expects |
| `port` | the port to listen on; `PORT` in the environment wins |
| `pathUsertalk` | where the usertalk package is, relative to trigger.js |
| `pathDatabase` | the SQLite database, relative to trigger.js |
| `pathConcord` | where the Concord outliner's files are, for the odb browser |
| `pathMap` | prefixes that translate Frontier-style colon paths to real folders, for the file verbs |
| `maxVerbCalls` | how many verb calls one script may make before it's stopped |
| `flLogRequests` | whether each request prints a line to the log |
