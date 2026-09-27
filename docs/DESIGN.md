---
name: How system-map reads a repo, and what it cannot see
read_by: anyone deciding whether to trust a finding, before overruling it; and every session that adds or changes an extraction rule
---

# How it reads a repo, and what it cannot see

`system-map` is deterministic text matching. There is no parser, no model, and no dependency. That
buys three things — it runs anywhere Node runs, it produces the same bytes twice, and nothing it
says was invented — and it costs one thing, which is that some of what it says is wrong.

**The citation is what makes that trade acceptable.** Every entry carries `file:line`. A wrong edge
is a line you can open, look at, and overrule in one sentence. A confident uncited claim is the thing
this repo refuses to produce, because you cannot argue with it.

So: read this page before you trust a finding, and read it before you overrule one.

## The extraction rules, in full

### Modules and import edges

| Language | What counts as an edge |
|---|---|
| Node (`.mjs .cjs .js .jsx .mts .cts .ts .tsx`) | `import … from '…'`, a bare `import '…'`, `export … from '…'`, `require('…')`, `import('…')` with a literal specifier |
| Python (`.py`) | `import x`, `import x.y as z`, `import a, b`, `from x import y`, `from .x import y`, `from ..pkg import y` |

A multi-line import is cited at the line the specifier is on, not the line the statement opens.
`import type` is an edge and is labelled `import-type`, so a reviewer can discount it. `__future__`
is dropped: it is a compiler directive, not a piece of the system.

Comments never produce edges. That rule is worth naming because a commented-out import is the most
common false edge in any text-matching map generator, and a map that names a piece nobody runs is
worse than no map.

**Resolution.** A relative Node specifier is tried exactly, then with each extension Node would try,
then as `…/index.<ext>`. A `.js` specifier also tries `.ts` and `.tsx`, because TypeScript emits
`./x.js` for a file called `x.ts`, and without that swap a TS repo loses every internal edge to a
wall of false unresolveds. A relative Python import resolves against the importing file's directory,
one level up per extra leading dot, to `name.py` or `name/__init__.py`. An absolute Python import
resolves against the repo root and against the importing file's own top-level directory.

A bare specifier is an **external** edge and is kept, because external edges are what the bill is
made of. A relative specifier that resolves to nothing is a `NOTED UNRESOLVED_SPECIFIER` gap, never
an invented module.

### Manifests

`package.json` (dependencies, peerDependencies, devDependencies, scripts), `requirements.txt`
(names, version pins stripped), `pyproject.toml` (the PEP 621 `dependencies` array and the Poetry
dependency table; `python` itself is the interpreter, not a piece of the system).

A manifest that will not parse is **BLOCKING**. Every other extractor can miss something and still
leave a usable map; a dependency list that silently came back empty makes the bill answer and the
state answer both look clean for the wrong reason.

### Local file writes, and shelling out

A write call in a module that is part of the system, whose path expression is not scratch, is where state
lives (question 2). Node: `writeFileSync`, `appendFileSync`, `writeFile`, `appendFile`,
`createWriteStream`. Python: `open(p, 'w')`, `Path(p).write_text`/`write_bytes` (which cite their
**receiver**, because the argument is the content), `sqlite3.connect`, and pandas' `to_csv`/`to_json`/
`to_parquet` (which cite their **argument**, because the receiver is the data).

`mkdirSync` is not a write: a directory is not state, the file written into it is, and that write is
already a row. `json.dump(obj, handle)` is not a write: the path is not on that line, and the
`open(…, 'w')` that produced the handle is the row.

**One row per module.** A module that writes in six branches is one place state lives, and the extra
writes are counted rather than listed. Measured on three real repos this gives 1, 6 and 5 rows where a
row per call gave 4, 17 and 8.

`execFileSync|execFile|spawnSync|spawn|execSync|exec` with a literal first argument, and Python's
`subprocess.run|call|check_call|check_output|Popen`, are external systems: an edge in section 1 and a row
in section 4, because a process boundary is a boundary and appears in no dependency manifest.

### Environment variables

`process.env.X`, `process.env['X']`, `const { A, B } = process.env`, `os.environ['X']`,
`os.environ.get('X')`, `os.getenv('X')`, and the keys of a `.env.example` (or `.env.sample`,
`.env.template`).

**A real `.env` is never opened.** The live values are in it, and a scanner that reads your secrets
in order to tell you that you have secrets is the wrong tool. The guard is the filename, checked
before the content.

A variable read in five places is one entry, at its first citation, with the rest carried as
`alsoAt`. `SECRETISH` separates a credential-shaped name from a setting; it never decides whether a
variable is reported.

### Routes

| Convention | Shape |
|---|---|
| Method call | `app.get('/x', …)` for receivers `app router server fastify hono api instance srv` |
| Python decorator | `@app.get("/x")`, and `@app.route("/x", methods=[…])`, defaulting to GET the way Flask does |
| Next.js app router | `app/**/route.*`, path from the directory, methods from the exported `GET`/`POST`/… |
| Next.js pages api | `pages/api/**`, path from the filename, method `ANY` |

The receiver list is closed on purpose: `client.get(url)` and `map.get(key)` are the two most common
false routes in any regex scanner, and both are excluded by requiring a receiver that names a server
**and** a first argument that is a literal path. A route path built from a variable yields nothing
rather than an invented name. A Next route group in parentheses is dropped, because Next never
serves it.

### Clients, and why the registry exists

A component map knows that `src/pay.mjs` imports `stripe`. It does not know that the import is a
meter, and the architect's fourth question is "which pieces charge per use". That judgement cannot be
derived from text, so it is written down once in `src/registry.mjs`, in four categories, each entry
carrying the note that says **why**:

| Category | Means |
|---|---|
| `metered` | charges per use, so it belongs in question 4 and in a bad-month story |
| `state` | holds data that outlives the process, so it belongs in question 2 |
| `observability` | records or pushes, so it belongs in question 5 |
| `queue` | work handed to something else, which is an edge the import graph hides |

A registry miss is a **noted absence, not a wrong answer**: the import still appears in the edge list
with its citation, it simply is not classified. Adding an entry is a one-line change plus the note
that justifies it.

### External hosts

A literal `https://…` inside `fetch(`, `requests.*(`, `httpx.*(`, `axios(` or `urlopen(`. Loopback
is excluded: a call to your own machine opens no door and bills nothing. A host assembled from
variables is not reported, because inventing a name for it would put an uncited line in the map.

### Schedules

Cron literals, `setInterval` with its delay or an honest `unknown`, GitHub Actions `schedule:`
blocks, launchd `StartInterval` and `StartCalendarInterval`, celery `crontab(`, `schedule.every(`,
`CronTrigger(`.

A cron literal must contain at least one `*`. Without that rule, `"1 2 3 4 5"` is a cron string and
the scanner reports arithmetic as a schedule.

### Observability

`console.error`, `console.warn`, `logger.error`, `logging.error`, `logging.exception` and friends are
`records`. `Sentry.captureException`, `sentry_sdk.capture_exception` and the webhook hosts whose only
purpose is to interrupt a human (`hooks.slack.com`, `events.pagerduty.com`, …) are `pushes`.

That split is the architect skill's own, and it is the whole question: **a log nobody opens is not an
alert.** `console.log` is deliberately not a surface, or a chatty repo would look instrumented.

### Auth checks

A named list of middleware and decorator shapes (`requireAuth`, `login_required`, `getServerSession`,
`Depends(get_current_user)`, an `Authorization` header read, and the rest of the list in
`src/extract/auth.mjs`).

A commented-out check is **not** a check. A guard somebody disabled in a hurry is exactly the drift
this tool exists to surface, and counting it as present would hide the thing we are looking for.

## What it cannot see

Named here so a stranger is not surprised, and so a gap is never mistaken for an absence.

- **Dynamic imports** whose specifier is computed. Reported as `NOTED DYNAMIC_SPECIFIER`.
- **Reflection, runtime registries, monkey patching.** A piece wired up at runtime looks like a piece
  nothing imports.
- **Generated code and build output.** `dist/`, `.next/`, `build/` and friends are not walked.
- **String-built route paths**, and anything behind a framework convention this repo does not name.
- **Configuration that arrives from outside the repo.** A cron in a vendor dashboard, an alert rule in
  Datadog, a spend cap in a billing console. `derive` raises these as `Unknown` rather than guessing.
- **Whether a backup has ever been restored.** No file can answer it, so `derive` says so every time.
- **Queue edges.** A producer and a consumer that meet in Redis share no import. The queue client is
  reported; the edge cannot be.
- **Any language that is not Node or Python.** A Go service in the same monorepo is invisible.
- **An injected WRITE function.** `appendClaim(path, claim, { write = appendFileSync })` performs its
  write through `write(…)`, and a rule keyed on the function's name cannot see it. Widening to any
  `write(` would match `stream.write`, `res.write` and every other unrelated writer, so the miss is named
  here. Same shape as the injected-env case, which IS now handled — the difference is that the env rule
  can key on SCREAMING_SNAKE and this one has nothing to key on.
- **An environment injected as a parameter is now read** (`env.MY_KEY`, fix wave 1, SPEC §4A row D3),
  and this entry used to say it could not be. The reason given was noise; measured across three real
  repos, the feared false positive returned zero hits. What was missing was the measurement, not the
  rule.
- **Test files are excluded from the system by default** (fix wave 1, SPEC §4A row D4). They are
  counted and named in section 1, so "excluded" never reads as "unread", but they are not pieces, have
  no blast radius, and a variable or route that appears only in a test is not reported.
  `--include-tests` puts them back. The shapes: `test/`, `tests/`, `__tests__/`, `spec/`, `testing/`,
  `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.py`. `specs/` is deliberately not one, because
  `specs/openapi.mjs` is a schema.

## The two tiers, and why the tiering is load bearing

| Tier | Means | Effect on the exit code |
|---|---|---|
| `BLOCKING` | the run could not read enough to judge | exit 3, and 3 outranks 1 |
| `NOTED` | a structural limit of text extraction, known in advance | none |

A single tier makes the tool useless in both directions. If every gap were blocking, every real repo
has one unresolvable dynamic import and `reconcile` would exit 3 forever, so nobody would run it
twice. If no gap were blocking, a reconcile against a `system.md` nobody could read would find zero
findings and exit clean, and the report would say the design and the code agree.

`BLOCKING` is the list in `src/gaps.mjs`, and nothing else may be: `EMPTY_REPO`, `UNREADABLE_FILE`,
`UNREADABLE_DIR`, `MANIFEST_UNPARSED`, `SYSTEM_MD_ABSENT`, `SYSTEM_MD_UNPARSEABLE`, `BASELINE_ABSENT`,
`BASELINE_SCHEMA_UNKNOWN`. Each one is a row in the false-green table in `docs/SPEC.md` §3E, and
`test/false-green.test.mjs` is what makes it a rule. `UNREADABLE_DIR` was added in fix wave 1: a
directory the walk could not list was skipped with no gap, so `chmod 000` on a subdirectory reported
"No drift".

## Reading a declared system.md

The parser is tolerant, and that is a liability it manages by being loud. Sections are found by
keyword, not by number, so "How it hangs together" is the map and "Secrets and access" is doors.
Pieces come only from the map section. An arrow bullet (`A → B`) or a verb bullet (`A calls B`) is an
edge and not also a piece. A backticked `UPPER_SNAKE` token counts as declared in section 3 only when
it is **in** section 3, because crediting a mention under "the bill" would hide exactly the miss that
report section 3 exists to catch.

Anything it could not read goes in the report's last section, under "Declared, but not found or not
understood". A document it understood nothing of is `SYSTEM_MD_UNPARSEABLE`, which is blocking.

## What a piece is

A piece is the unit the map names, the unit blast radius is measured in, and the unit report section 1
reports. It is the top-level directory a module sits in, **except** that a directory containing only
directories and no files of its own hands its name to its children: `packages/{api,worker,shared}` is
three pieces, `src/` with files in it is one piece however many subdirectories it also has, and a file
at the repo root is its own piece.

Descent goes exactly one level. Unlimited descent is just the directory tree again, and the whole value
of a piece is that there are three to five of them. `src/pieces.mjs` holds the rule, and both `derive`
and `reconcile` read it, because if the two ends disagree about what a piece is the round trip reports
the tool's own map back as findings.

## Phase 1 has no boundary rules

`reconcile`'s section 2 is "edges present the map omits", not "forbids or omits", because nothing in
this repo can express a prohibition yet. What replaces it is a closed-set reading: for the pieces the
map **names**, the declared edge list is treated as complete, so a code edge between two named pieces
that the map does not draw is a finding. An edge touching a piece the map never names belongs to
section 1 instead, so one unnamed directory is never reported twice under two headings.

## What is deliberately not here

The `decisions` verb (drafting ADR stubs from the delta) is phase 2. The delta computation ships as
`src/delta.mjs` with its own tests precisely because that verb will consume it, but phase 1 exposes
no way to call it beyond report section 6. There are no diagrams, by design and in agreement with the
architect skill, which forbids them: the map is bullets and one-sentence descriptions, words a
non-engineer reads. And there is no model anywhere.
