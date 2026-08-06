# From Drummer to a deployed app in PagePark — the plan

*By CC, night of 8/5/26, for DW's review. Everything below was read off the actual scripts and the actual servers, not from memory.*

## The shape of it, in one paragraph

`nodeEditorSuite.uploadScripts` is a router. It walks the project outline, and every first-level node is a **destination path** whose prefix decides where that group of files goes — a local folder, Dropbox, the public folder, a GitHub folder, S3, or **allservers**. Only allservers reaches a running server. The allservers route is not a copy; it is a **queue**: files land in a per-server folder, an uploader pushes that folder to an S3 bucket, and each server's own loader app pulls its subtree down into its PagePark folder when pinged. Today that uploader runs on DW's desktop. **Getting it onto marin is the one missing link between "Drummer saves" and "the app is live."**

---

## 1. The complete list of destinations

Every route `uploadScripts` can take, read from the script itself. The prefix is the first thing on the destination node.

| # | Prefix | Where it goes | Reaches a live server? | Status on marin |
|---|---|---|---|---|
| 1 | *(none)* | `data.prefs.folder` + flattened path — the project's render folder | no | **working** — `trigger.usertalk.org/files/nodeeditor/` |
| 2 | *(none)* + `flUploadToS3` | also `s3.newobject (path, text, type)` | only if something serves that bucket | **stub** — `s3.newobject` returns a stub marker |
| 3 | `file:` | the path exactly as written | no | **working**, bounded by the path map |
| 4 | `dropbox:` | `user.prefs.dropboxfolder` + path | no | **mapped** to `files/dropbox`, nothing reads it |
| 5 | `publicfolder:` | `user.prefs.publicfolder` + path | via the publicfolder app | **not mapped** — no prefix for it |
| 6 | `github:` | `data.prefs.github.folder` + path, **and** `nodeEditorSuite.github.upload` | no | folder **working** (`files/github`), the upload call is **unimplemented** |
| 7 | `allservers:` | `nodeEditorSuite.getAllServersFolder ()` + path | **yes, this is the one** | folder **mapped and empty**; nothing carries it onward |

Two more things happen for every file, regardless of route:

8. **A companion `.opml` is written beside it** — the outline the file was rendered from, with `<%title%>` and `<%dateModified%>` substituted. Working.
9. **The project's build script runs last** — `evaluate (buildScript)`. Working; this is what ran `buildSallyReader` on 8/4.

**One special case already wired**, and it is the reason sallysReader went live without any of this: marin's path map sends
`allservers:peabody:pagepark:domains:sally.scripting.com` straight to `/root/marin/pagepark/domains/marin.scripting.com/sallysreader`.
That is a hard-wired shortcut for one project. It proves the render is right; it does not scale.

---

## 2. How allservers actually works

Read from `/Claude/allServers/allservers.js`, its config, and marin's `loader9`:

1. Files are written into `~/Dropbox/portableDave/allServers/<servername>/pagepark/domains/<domain>/…`
2. **`allservers.js` runs on DW's desktop.** It watches that folder and mirrors it to the S3 bucket `allservers.scripting.com`, under `/<servername>/…`, ACL private.
3. It then **pings every server's loader**: `http://loader0…loader8.scripting.com/reload` — palatka, peru, africa, boston, peabody, maine, taos, utica.
4. Each server runs **`batchloader2.js`**, which on `/reload` calls
   `s3folderloader.load ("/allservers.scripting.com/<servername>/pagepark/", "/root/<servername>/pagepark/")`
   — pulling its own subtree into its live PagePark folder.

**Marin's own loader is beside the point** (DW, 8/6: *"your loader app on marin has nothing to do with what i'm doing"*). Marin's job here is to **build and to push** — it runs the interpreter and it will run the uploader. The loader that matters is the one on the machine being deployed to, which is **peru**. What marin already has that the uploader needs is `~/.aws/credentials`. What it does not have running is step 2.

So the chain has exactly one gap:

```
Drummer → trigger → uploadScripts → allservers folder → [ GAP ] → S3 → loader ping → PagePark
```

---

## 2a. DW's answers, 8/6 — and what's already done

He listened to the questions and settled them, so §3's phases below are superseded where they conflict. His words, and what I did about them overnight:

- **"We need to have S3."** Right — and Phase 1 as written contradicted Phase 2 by trying to route around it. **The three S3 verbs are implemented and proven against the real bucket from marin.** `s3.objectExists` false → `s3.newObject` → `s3.objectExists` true → `s3.getObject` returns the exact text back. They are no longer stubs. Detail in §6.
- **The app is sallysReader.** I had that backwards; it is the one to worry about, not the one to avoid.
- **The target server is peru.** *"It was down for like a month or two and nobody noticed"* — so peru is the machine to test all the daveMigrates work against. Peru's loader is **loader1.scripting.com**, and it is already in the ping list.
- **Folders on marin: just put them somewhere.** No Dropbox on marin, ever. `dropbox:` and `publicfolder:` should have somewhere to land, but nothing needs to read them for now.
- **The two priorities are S3 and allservers**, in no particular order.

## 3. What has to be built, in order

Each item is checkable on its own, and each one leaves the loop working better than before.

### Phase 1 — deploy to marin, no S3 at all *(smallest thing that is real)*

Marin can write straight into its own PagePark folders. No bucket, no loader, no credentials.

1. **Add a path-map prefix per marin domain**: `Macintosh HD:Users:davewiner:allservers:marin:pagepark:domains` → `/root/marin/pagepark/domains`. One line in trigger's config.json, and it generalises the sallysReader shortcut instead of adding another one.
2. **Decide the staging rule.** Today's build renders to a staging folder and DW's own build script copies staging → live, so a half-finished render can never overwrite a served site. Keep that; it should be the pattern for every app, not a one-off.
3. **Prove it with a second app** — anything but sallysReader, so the path is exercised generically.

**Done when:** editing an outline in Drummer and saving puts new files into a real PagePark domain folder on marin, and the site serves them.

### Phase 2 — the S3 verbs

Three stubs, all one-liners on `daveS3`, which marin already has.

4. `s3.newobject (path, text, type)` — `s3.newObject`, with the ACL from config.
5. `s3.objectexists (path)` — `s3.getObjectMetadata`, true/false.
6. `s3.getobject (path)` — `s3.getObject`.
7. **Where the credentials come from.** They are in `~/.aws/credentials` on marin, which the AWS SDK finds on its own. Worth a decision: leave it implicit, or name it in trigger's config so it is visible.

**Done when:** a project with `flUploadToS3` true publishes its files to the bucket from marin.

### Phase 3 — allservers on marin

8. **Run `allservers.js` on marin**, watching marin's allservers folder instead of the Dropbox one. It is a small node app with two dependencies (`daveutils`, `publicfolder`).
9. **Point its `watchFolder`** at whatever the path map calls allservers.
10. **The ping list is hard-coded in the source** — eight `pingXxx` functions with literal loader URLs. Moving it to marin is the moment to ask whether that list belongs in config.json.
11. **Two uploaders, one bucket.** If the desktop copy keeps running while marin's does too, both are writing the same tree. That needs a decision before it is switched on, not after.

**Done when:** a file written to `allservers:<server>:…` on marin appears on that server without DW's Mac being involved.

### Phase 4 — the rest of the routes

12. `nodeEditorSuite.github.upload` — `davegithub` exists; this is the same shape as the S3 work.
13. `publicfolder:` has no prefix in marin's path map at all. Add one, or decide the route is retired.
14. `dropbox:` is mapped to a folder nothing reads. Same question: is Dropbox still in the loop now that the editing happens on the laptop and the building happens on marin?

---

## 6. What got done overnight, 8/5–6

### The S3 verbs are real

`s3.newobject`, `s3.getobject` and `s3.objectexists` are implemented and out of the stub list. Run from marin against the live bucket, in order:

```
1. does it exist before  ->  false
2. write it              ->  true
3. does it exist now     ->  true
4. read it back          ->  "written by the usertalk s3 verbs at 2026-08-06T13:28:29.740Z"
```

The scratch object was deleted afterward.

**How they work, and the one design decision.** UserTalk is synchronous and daveS3 is callback-based, and nothing in node can wait for a callback synchronously. So each verb runs **`usertalk/code/s3helper.js`** in a child process with `execFileSync` — one process per object, JSON in on stdin, JSON out on stdout. That is the cost; correctness is what it buys. If it ever matters for a big build, the fix is batching, not architecture.

Two things worth knowing:

- **daveS3 narrates to the console**, and one log line makes the helper's JSON unparseable. The helper sends everything daveS3 says to stderr and keeps stdout for the answer.
- **The allservers bucket refuses public ACLs** — `BlockPublicAcls` — and daveS3 defaults to `public-read`. So the first write failed with a permissions message that reads like a credentials problem and isn't. Passing `"private"` writes fine. This matters: **the default ACL is right for publishing a website and wrong for the allservers bucket.** `uploadScripts` calls `s3.newobject` with no ACL, but only on the no-prefix route, which is website publishing — so the default is correct where it is used. The verb takes an explicit ACL when a caller needs one.

Marin now has `daves3` declared in trigger's package.json and installed. Credentials were already there in `~/.aws/credentials`.

### allservers is staged on marin, and deliberately not started

At **`/root/marin/allservers/`**: the app, its package.json, `npm install` done, and a config.json pointing at marin's own watch folder rather than Dropbox —

```json
{
	"watchFolder": "/root/marin/allservers/watch/",
	"s3Folder": "/allservers.scripting.com/",
	"urlS3Folder": "http://allservers.scripting.com/",
	"s3DefaultAcl": "private"
}
```

**It is not running.** Your desktop copy watches the same bucket, and two uploaders over one tree is a decision rather than a detail — the one question from §4 that your memo didn't settle. Say which way and it's a one-line start.

### Still to do

1. **Decide the two-uploaders question**, then start it.
2. **Point the path map at peru** — `allservers:peru:pagepark:domains:…` needs a prefix, the way sallysReader's marin path has one today.
3. **Prove the whole chain with sallysReader onto peru**: Drummer saves → uploadScripts writes into the watch folder → allservers pushes to S3 → ping loader1 → peru pulls → the site is live.
4. `nodeEditorSuite.github.upload` is still unimplemented; `dropbox:` and `publicfolder:` still need somewhere on marin to land.

### Custody

Everything is in `usertalk/source.opml` as well as the rendered files — `code/evaluate.js`, `code/verbs.js`, and the new `code/s3helper.js` all render back out byte-identical, so a build won't lose any of it.

## 4. What I would ask you before starting

1. **Which app is the first real one?** Phase 1 needs a target that isn't sallysReader. That choice shapes the staging rule.
2. **Do the desktop allservers and a marin allservers coexist**, or does marin take over outright?
3. **Is Dropbox still part of this?** Three of the seven routes point at folders that only mattered when the desktop was the build machine.
4. **Should the loader list live in config.json?** It is eight hard-coded URLs in the source today.

---

## 5. What is already proven, so it doesn't get re-litigated

- The render is byte-correct: sallysReader's deployed files were reproduced exactly, and the 8/4 build ran DW's own `uploadScripts` and `buildSallyReader` unmodified.
- The interpreter runs the corpus: 361/361 build scripts parse, 336/361 execute against the real ODB.
- Drummer → trigger → marin works end to end; that is what shipped on 8/4.
- The pieces marin is missing are **not language work**. They are three S3 verbs, one small node app, and some path-map entries.
