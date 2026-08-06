# trigger

Ship a UserTalk script to a server, run it there, get the value back.

Trigger is a small web service with one job. You send it the text of a script; it runs the script under the [usertalk](https://github.com/scripting/usertalk) interpreter, against an object database holding opml.root, and answers with the value the script returned. That's the whole product.

The point is that nothing has to be installed where you write. Use any outliner you like, save the outline wherever you like, and send it to Trigger when you want to see what it does. The server holds the interpreter and the database; your machine holds the editor.

## What it answers

**`/run`** -- the one that does the work. POST the script as the body of the request, or pass a one-liner in the URL as `script`. Every request needs the password.

**`/version`** -- the name, the version, the interpreter version, and how many objects are in the database.

**`/`** -- a one-screen reminder of the above.

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

## The password

Every `/run` request must carry the password, either as `?password=` in the URL or in an `x-trigger-password` header. It lives in `config.json` on the server and nowhere else. Because the connection is https, sending it in the clear is safe -- the URL and the headers are both inside the encrypted connection.

**If `config.json` has no password, every request is refused.** An unset password locks the server rather than opening it, because a service that runs whatever script it's handed is complete control of the machine, and there is no version of that which should be available to strangers.

## Where the state lives

The database is one SQLite file. A script that writes into it -- `scratchpad.myAnswer = 42` -- has really written, and the next request can read it. Locals don't survive; each request gets a fresh set of local variables, so nothing leaks from one run into the next.

Nothing is ever written back to the `.root` format. The database was built from roots once, and from then on the database is the truth.

## Installing

Trigger is plain Node with one compiled dependency.

1. Put the folder somewhere, with the `usertalk` package inside it (or point `pathUsertalk` in `config.json` at wherever it lives).
2. `npm install`
3. Put a database at `data/odb.db` -- build one with `odbSql.buildDatabase` from a folder of roots, or copy a built one over.
4. Put a password in `config.json`.
5. `node trigger.js`

It listens on the port in `config.json`, or on `PORT` from the environment if that's set, which is how PagePark hands a port to an app.

## config.json

| name | what it does |
| --- | --- |
| `password` | required on every `/run`; empty means refuse everything |
| `port` | the port to listen on; `PORT` in the environment wins |
| `pathUsertalk` | where the usertalk package is, relative to trigger.js |
| `pathDatabase` | the SQLite database, relative to trigger.js |
| `maxVerbCalls` | how many verb calls one script may make before it's stopped |
| `flLogRequests` | whether each request prints a line to the log |
