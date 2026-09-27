# system-map

Derive a cited `system.md` from an agent-built repo, and reconcile the declared design against the
code. Deterministically, with every line carrying the file and line it came from, or written as an
`Unknown` naming what could not be seen.

```
scan  →  derive  →  reconcile
```

No model. No network. Zero dependencies. Just Node.

## Why

> Your coding agents re-derive your system's design every session, and each one derives it a little
> differently. The design document that could stop them says whatever it said the day someone last
> edited it.

Individual agent pull requests look professional in isolation while the architecture underneath them
moves, and the movement is invisible to static analysis, to human reviewers and to AI reviewers alike.
What you meant drifts from what got built, and the document that was supposed to hold the line is the
one thing nobody updates.

Two kinds of tool exist already, and each does one half.

| Prior art | Where it stops |
|---|---|
| CodeBoarding, codemap, kratai | Generate a component map. Derive no posture: no secrets, no metered calls, no alerting, no blast radius |
| yarramate, Scryer, archik | Declare, then check. But the model is hand authored, so somebody has to write the truth first |
| the-architect | Pre-build. Designs a system that does not exist yet |

**The empty middle is posture derivation from code, plus a diff against a declared design.** That is
this repo.

## Try it

You need Node 20 or newer. There is nothing to install, no API key, and no network call.

```console
$ git clone https://github.com/derrtaderr/system-map.git
$ cd system-map
$ npm test
```

The demo runs `scan`, `derive` and `reconcile` over a synthetic fixture repo: an invented Node service
and an invented Python worker, shipped with a declared design document that is deliberately out of
date. Every service name, host and key in it is made up.

<!-- verified-block: demo -->
```console
$ node bin/system-map.mjs demo --out /tmp/system-map-demo
system-map demo

  Scanned an invented Node service and an invented Python worker: 6 modules,
  12 edges, 3 routes, 5 known clients, 10 environment variables.
  No key, no network call, and nothing written outside --out.

  derive  54 answers across the six architect questions
          50 read out of the code and cited at file:line
          4 written as Unknown, naming what the scan could not see

  reconcile  19 findings against a declared map that is deliberately out of date
        1  pieces the map does not name
        1  edges the map omits
        8  env vars section 3 never lists
        1  metered clients section 4 never prices
        2  alert or log surfaces that vanished
        6  changes since the committed baseline

  baseline   /tmp/system-map-demo/baseline.json
  draft      /tmp/system-map-demo/system.draft.md
  report     /tmp/system-map-demo/reconcile-2026-09-27.md

  The report inside exits 1, because the fixture disagrees with its own map on
  purpose. The demo itself exits 0: a non-zero demo reads as a broken install rather
  than as a working tool.
```

Open the three files it wrote. The report is the point, and this is a real line out of it:

```
- `openai` — billed per token, and a retry loop has no natural ceiling, and the bill
  section does not price it (billing/charge.mjs:2)
```

## The three verbs

### `scan` — write the reference point

```console
$ node bin/system-map.mjs scan
```

Deterministic text extraction into `.system-map/baseline.json`, which **you commit**. It is the
"what we agreed the code was" line that `reconcile` measures from.

<!-- verified-block: scan -->
```console
$ node bin/system-map.mjs scan fixtures/demo-repo --out /tmp/system-map-demo/baseline.json --now 2026-09-27T09:00:00.000Z
system-map scan  fixtures/demo-repo

  6 modules, 12 edges, 3 routes, 5 clients
  10 env reads, 3 auth checks, 3 schedules, 5 log or alert surfaces

  baseline  /tmp/system-map-demo/baseline.json
```

What it reads: modules and their import edges (Node and Python), manifests, environment reads, HTTP
routes, known third-party clients, external hosts, scheduled work, and logging and alerting surfaces.
Every entry carries `file:line`. `docs/DESIGN.md` states every rule in full.

Clients are classified from a small registry in four categories, each entry carrying the note that
says why: `metered`, `state`, `observability`, `queue`. A component map knows that `src/pay.mjs`
imports `stripe`; it does not know that the import is a meter.

### `derive` — a draft system.md you can check

```console
$ node bin/system-map.mjs derive
```

Pre-fills the six architect questions from the scan, into `.vibecodepm/system.draft.md`:

1. **The map** — the pieces, and the edges between them
2. **Where state lives** — the stores, and the variables that point at them
3. **Doors and keys** — every secret read, every check found
4. **What bills per use** — the metered clients, and why each one meters
5. **How you find out it broke** — what records, and separately, what pushes
6. **Blast radius per piece** — what depends on what

**Every answer line either carries a `file:line` citation or begins with `Unknown:`.** There is no
third shape, and a test walks the output to enforce it. A repo with nothing in it produces a page of
`Unknown`s rather than a page of plausible sentences.

Two of those `Unknown`s are raised every single time, because no repository can answer them: whether a
backup has ever been restored, and where the spend cap is set.

It is a draft, not a decision. `derive` will never write a file called `system.md` — the confirmed
document is yours.

### `reconcile` — the join

```console
$ node bin/system-map.mjs reconcile
```

Re-scans, diffs against both the committed baseline and the declared `system.md`, and writes
`.system-map/reconcile-YYYY-MM-DD.md` with seven named sections:

1. Pieces present in code the map does not name
2. Edges present the map omits
3. Env vars read that section 3 never lists
4. Metered clients section 4 never prices
5. Alert and log surfaces that vanished
6. Drift since the committed baseline
7. What this run could not see

Every section appears in the file even when it is empty, because an absent heading reads as "nothing
to say" when it means "never checked".

<!-- verified-block: reconcile -->
```console
$ node bin/system-map.mjs reconcile fixtures/demo-repo --system fixtures/demo-repo/.vibecodepm/system.md --baseline /tmp/system-map-demo/baseline.json --out /tmp/system-map-demo --now 2026-09-27T09:00:00.000Z
system-map reconcile  fixtures/demo-repo

  12 findings, every one cited:
      1  pieces the map does not name
      1  edges the map omits
      8  env vars section 3 never lists
      1  metered clients section 4 never prices
      1  alert or log surfaces that vanished

  report  /tmp/system-map-demo/reconcile-2026-09-27.md
```

That run measures against a baseline scanned one second earlier, so section 6 is empty and section 5
loses the surface that vanished. The demo above uses the fixture's **committed** baseline instead,
which is what a real one looks like: weeks behind the code.

## Exit codes

This runs from a scheduler, so the exit code is the only thing that is always read.

| Code | Means |
|---|---|
| `0` | the run read what it needed and found no drift |
| `1` | drift found, and the run was trustworthy |
| `2` | a refusal: a flag that makes no sense, a path that is not there, a file it will not overwrite |
| `3` | it could not read enough to judge |

**3 outranks 1.** "I found no drift" and "my verdict is not trustworthy" are different sentences, and
a scheduler reads only the number.

## Green is earned

A drift detector that reports nothing when it read nothing is worse than no drift detector, because
it is reassuring. Seven states make a run untrustworthy, each one a blocking gap named in the report
and an exit 3:

| Code | The state |
|---|---|
| `EMPTY_REPO` | no source file was found |
| `UNREADABLE_FILE` | a file the walk named would not open |
| `MANIFEST_UNPARSED` | a `package.json` or `pyproject.toml` that would not parse |
| `SYSTEM_MD_ABSENT` | there is no declared design to reconcile against |
| `SYSTEM_MD_UNPARSEABLE` | there is one, and no section of it could be read |
| `BASELINE_ABSENT` | no committed baseline, so nothing can say what moved |
| `BASELINE_SCHEMA_UNKNOWN` | the baseline was written by a version this build does not read |

`SYSTEM_MD_UNPARSEABLE` is the dangerous one. A reconcile against a document nobody could read finds
zero findings, and zero findings reads as agreement. `test/false-green.test.mjs` is what makes all
seven a rule rather than an intention, and it carries a control row so the file cannot pass by never
returning 0 at all.

The counterpart matters just as much: a **noted** limit never changes the exit code. Every real repo
has one dynamic import that text extraction cannot follow, and a tool that exits 3 forever is a tool
nobody runs twice.

## What it cannot see

Heuristics are acceptable here for exactly one reason: **the citation.** A wrong edge is a line you
can open and overrule in a sentence. An uncited claim is the thing this repo refuses to produce,
because you cannot argue with it.

It cannot follow a computed import specifier, reflection, a runtime registry, generated code, a
string-built route path, or a queue edge where a producer and a consumer meet in Redis and share no
import. It cannot see configuration that lives in a vendor dashboard. It reads Node and Python, so a
Go service in the same monorepo is invisible to it.

`docs/DESIGN.md` states all of it, rule by rule, along with what each extractor does match. Read it
before you trust a finding, and read it before you overrule one.

## Privacy

A real `.env` is never opened. The live values are in it, and a scanner that reads your secrets in
order to tell you that you have secrets is the wrong tool; the guard is the filename, checked before
the content. The baseline carries no absolute path. `--out` always resolves against your working
directory and never against the repo being scanned, so pointing this at somebody else's repository
cannot write into it.

```console
$ npm run privacy
```

A tracked-file guard refuses real-looking email addresses, phone-shaped strings outside `fixtures/`,
and absolute home paths. Fixtures are synthetic by rule.

## What is not here

The `decisions` verb, which drafts ADR stubs from the delta, is phase 2. The delta computation ships
as `src/delta.mjs` with its own tests because that verb will consume it, but there is no way to call
it today beyond report section 6.

There are no diagrams, on purpose and in agreement with the architect skill this tool fills in for:
the map is bullets and one-sentence descriptions, words a non-engineer reads.

And there is no model anywhere. Two tests enforce that and the zero-dependency claim against the code
rather than against `package.json`.

## Layout

```
bin/system-map.mjs      the CLI shim
src/cli.mjs             verbs, flags, exit codes
src/scan.mjs            one pass over a repo, into a baseline
src/walk.mjs            enumeration, and every file it could not open
src/resolve.mjs         a specifier into a module path, or an honest nothing
src/extract/            the extraction rules, one file per kind
src/registry.mjs        the known-SDK table, four categories, each with its reason
src/declared.mjs        the tolerant parser for a hand-written system.md
src/delta.mjs           a committed baseline against a fresh scan (phase 2 consumes this)
src/reconcile.mjs       the join, and the exit code
src/report.mjs          the seven sections
src/derive.mjs          the six architect answers
src/demo.mjs            the keyless demo
docs/SPEC.md            scope, decisions, the false-green table, the gate set
docs/DESIGN.md          every extraction rule, and everything it cannot see
fixtures/demo-repo/     the synthetic repo, invented end to end
```
