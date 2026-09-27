---
name: system-map phase 1 spec
read_by: every session that touches this repo, before the first edit; test/spec-claims.test.mjs pins the tables below
---

# system-map, phase 1

**One line.** Derive a cited `system.md` from an agent-built repo, and reconcile the declared
design against the code, deterministically, with every line cited or marked `Unknown`.

## 1. The problem this is built for

Research done 2026-09-27, every source opened at origin.

| Source | What it reports |
|---|---|
| yarramate (author) | "Your coding agents re-derive your system's design every session, and each one derives it a little differently. The design document that could stop them says whatever it said the day someone last edited it" |
| Scryer | "What you meant drifts from what got built" |
| Jai Kora | Individual agent PRs "look professional in isolation" while cumulative architectural drift stays invisible to static analysis, to humans, and to AI reviewers |
| Thoughtworks Technology Radar vol 34, April 2026 | Named "architecture drift reduction with LLMs" as a technique to watch |

The gap is not a missing map generator and not a missing checker. It is the join between them.

| Prior art | Where it stops |
|---|---|
| CodeBoarding | Generates a component map. Derives no posture: no secrets, no metered calls, no alerting, no blast radius |
| codemap | Same. Components and edges, nothing about how the system behaves or bills |
| kratai | Same. Structural only |
| yarramate | Declares-then-checks, but the model is hand authored. Someone has to write the truth first |
| Scryer | Same shape. A hand-authored intent, checked against code |
| archik | Same. Architecture rules a human writes |
| the-architect | Pre-build. Designs a system that does not exist yet |

**The empty middle, and this repo's scope: posture derivation from code, plus a diff against a
declared design.** Every existing tool does one half.

## 2. Scope

Three verbs, phase 1.

| Verb | What it does |
|---|---|
| `scan` | Deterministic text extraction over a repo, into `.system-map/baseline.json`. No LLM, no dependency, no network |
| `derive` | Writes a draft `system.md` pre-filling the six architect questions from the scan. Every sentence cites `file:line` or is written `Unknown: <what the scan could not see>` |
| `reconcile` | Re-scans, diffs against the committed baseline AND the declared `system.md`, writes a dated report, and sets an exit code |

Plus `demo`, which runs all three on a synthetic fixture repo with no key and no network.

**Out of scope, phase 1, and not to be added by improvisation:** the `decisions` verb (ADR
drafting from the delta) is phase 2; boundary-rule export; diagrams of any kind; any LLM
anywhere. The delta computation ships as its own module with its own tests precisely because
phase 2 consumes it, but phase 1 exposes no verb for it.

## 3. Decisions

### 3A. The baseline is committed by the operator

`.system-map/baseline.json`, produced by `scan`, committed to the repo by a human. It is the
"what we agreed the code was" reference point. `reconcile` reads it and reports movement since.

Extraction is deterministic text matching. It is heuristic, and heuristic is acceptable
**because every entry carries `file:line`**: a wrong edge is visible and a human can overrule it.
An uncited claim is the thing this repo refuses to produce.

### 3B. What the scan extracts

| Kind | Sources |
|---|---|
| modules | Every `.mjs .js .cjs .jsx .mts .cts .ts .tsx` and `.py` file under the repo, minus ignored directories |
| edges | Node `import` / `export ... from` / `require(` / dynamic `import(`; Python `import x` / `from x import y`, relative and absolute |
| manifests | `package.json` (deps and scripts), `requirements.txt`, `pyproject.toml` |
| env | `process.env.X`, `process.env['X']`, `os.environ['X']`, `os.environ.get('X')`, `os.getenv('X')`, keys in `.env.example` |
| routes | express / fastify / hono `app.get('/x'`; FastAPI / Flask decorators `@app.get("/x")`, `@app.route("/x")`; Next.js `app/**/route.*` and `pages/api/**` |
| clients | Imports matching the known-SDK registry (`src/registry.mjs`), plus `fetch(` and `requests.*` to a literal host |
| schedules | 5- and 6-field cron strings, GitHub Actions `schedule:` blocks, launchd `StartInterval` / `StartCalendarInterval`, `setInterval(` |
| queues | Registry entries categorised `queue` |
| observability | Registry entries categorised `observability`, plus `console.error`, health routes, and alert sinks (`SLACK_WEBHOOK`-shaped env, Sentry) |
| auth checks | A named pattern list (`requireAuth`, `login_required`, `Depends(...auth...)`, an `Authorization` header read, and the rest of §3F) |

### 3C. What the scan cannot see, stated so a stranger is not surprised

Dynamic imports whose specifier is a variable. Reflection and runtime registries. Generated
code and build output. String-built route paths. Anything behind a framework convention this
repo does not name. Monkey patching. Configuration that arrives from outside the repo.

These are recorded as `NOTED` limits in the report, not silently dropped, and not treated as
failures to judge. The distinction is §3D.

### 3D. Two tiers of gap, and why the tiering is load bearing

A single tier makes `reconcile` useless: every real repo has an unresolvable dynamic import, so
a rule of "any gap means exit 3" means the tool never returns a verdict and nobody runs it.

| Tier | Meaning | Effect on the exit code |
|---|---|---|
| `BLOCKING` | The run could not read enough to judge | exit 3, and 3 outranks 1 |
| `NOTED` | A structural limit of text extraction, known in advance | none; reported in its own section |

`BLOCKING` gaps live in **one** list, `src/gaps.mjs`, checked against this document, README,
DESIGN and the code by `test/spec-claims.test.mjs`. There are eight: `EMPTY_REPO`,
`UNREADABLE_FILE`, `UNREADABLE_DIR`, `MANIFEST_UNPARSED`, `SYSTEM_MD_ABSENT`,
`SYSTEM_MD_UNPARSEABLE`, `BASELINE_ABSENT`, `BASELINE_SCHEMA_UNKNOWN`.

This paragraph previously called six of them exhaustive while README and DESIGN listed seven.
That is why the list is now code rather than prose in four places.

### 3E. The false-green table

GREEN IS EARNED. Each row is a way `reconcile` could look clean while it never actually read
the thing it is judging. None of them may exit 0. `test/false-green.test.mjs` is what makes
this a rule rather than an intention.

| # | State | Required outcome |
|---|---|---|
| 1 | Empty repo: zero modules found | `BLOCKING` `EMPTY_REPO`, exit 3 |
| 2 | A file the scan could not read | `BLOCKING` `UNREADABLE_FILE`, exit 3 |
| 3 | `system.md` absent | `BLOCKING` `SYSTEM_MD_ABSENT`, exit 3 |
| 4 | `system.md` present but no section parsed | `BLOCKING` `SYSTEM_MD_UNPARSEABLE`, exit 3 |
| 5 | Committed baseline absent | `BLOCKING` `BASELINE_ABSENT`, exit 3 |
| 6 | A manifest that is not valid JSON or TOML | `BLOCKING` `MANIFEST_UNPARSED`, exit 3 |
| 7 | Drift found AND a blocking gap present | exit 3, never 1, because the verdict is not trustworthy |
| 8 | A directory the walk could not list | `BLOCKING` `UNREADABLE_DIR`, exit 3 |

### 3F. `derive` fills the six architect questions

From `vibecodepm-plugin/skills/architect/SKILL.md`, whose rule this repo obeys: **every derived
answer cites its source.** A derived answer is a draft, never a decision.

| § | Question | Filled from |
|---|---|---|
| 1 | The map | modules grouped into pieces, and the edges between them |
| 2 | Where state lives | registry `state` clients, connection-string env names, file writes |
| 3 | Doors and keys | every env read, plus every auth check found; `Unknown` when none |
| 4 | What bills per use | registry `metered` clients, plus literal external hosts |
| 5 | How you find out it broke | logging and alert surfaces, health routes, schedules |
| 6 | Blast radius per piece | reverse dependency count from the edge list |

`derive` refuses to overwrite an existing `.vibecodepm/system.md`. The draft lands beside it.

### 3G. `reconcile` report sections

Named, in this order, every one present in the file even when empty, because an absent section
reads as "nothing to say" when it means "never checked".

1. Pieces present in code the map does not name
2. Edges present the map omits
3. Env vars read that section 3 never lists
4. Metered clients section 4 never prices
5. Alert and log surfaces that vanished
6. Drift since the committed baseline
7. What this run could not see

Phase 1 has no boundary-rule language, so section 2 treats the declared edge set as **closed for
the pieces the map names**: a code edge between two named pieces that the map does not declare
is a finding. Edges touching a piece the map never names belong to section 1.

### 3H. Exit codes

| Code | Meaning |
|---|---|
| 0 | The run read what it needed and found no drift |
| 1 | Drift found, and the run was trustworthy |
| 2 | A refusal: a flag that makes no sense, an unreadable root, an unwritable `--out` |
| 3 | The run could not read enough to judge. Outranks 1 |

### 3I. Determinism

`scan` output is sorted on every list and carries no timestamp. The CLI stamps `generated_at`
when it writes a baseline, and the delta ignores it. `--now <ISO>` pins the clock wherever a
date reaches output, so a byte-comparing test and a README example mean the same thing every
day. `demo` pins its clock to the corpus date by default, for the same reason.

### 3J. Privacy and fixtures

Fixtures are synthetic: invented service names, `example.com` hosts, `SK_EXAMPLE`-style env
names. A tracked-files privacy guard refuses real-looking emails anywhere, phone-shaped strings
outside `fixtures/`, and absolute home paths anywhere. Pinned by tests. The repo stays private.

### 3K. Paths resolve against the working directory, never against the scanned repo

`--out` is resolved against the process working directory. A relative `--out` run from inside
the repo behaves as expected, and a scan of somebody else's repo cannot write into it. This is
what makes the dogfood runs read-only by construction.

## 4. Divergences from the lane brief

| Divergence | Reason |
|---|---|
| The gap tiering of §3D is finer than the brief's "a gap is exit 3" | A single tier makes every real repo exit 3 forever, which retires the verdict. `BLOCKING` keeps the brief's fail-closed intent; `NOTED` keeps the tool usable |
| Section 2 of the report is "Edges present the map omits", not "forbids or omits" | Phase 1 exports no boundary rules, so nothing in the repo can express a prohibition. §3G states the closed-set reading that replaces it |
| `--now` exists | Required for deterministic doc examples and a byte-comparing README test. Not in the brief, additive, documented |

### 4A. Contract decisions made in fix wave 1 (2026-09-27, after an independent ship-check BLOCKed the lane)

| # | Decision | Why |
|---|---|---|
| RT | **The round trip is the contract.** `derive` → save the draft unedited as `system.md` → `scan` → `reconcile` on the unchanged repo is exit 0, zero findings, and `test/round-trip.test.mjs` holds it on four repos | It failed on this repo's own fixture with exit 1 and 10 false findings. derive was only ever tested against its own output and the parser only against hand-written documents; nothing exercised the join |
| RT-1 | Section headings live in one constant, `src/headings.mjs`, read by both `derive` and `declared` | The two ends disagreed about `## 4. What bills per use` and about whether the draft's H1 was a section. A shared table plus a test over it makes that class of bug red rather than silent |
| RT-2 | A heading that names a section **exactly** beats one that merely mentions a keyword, and a `##` beats a `#`, decided over the whole document before any line is assigned | First-match-wins let the draft's title claim the map section out from under the real map heading |
| RT-3 | **Section 5's vocabulary is whatever section 5 of a derived draft can contain**, schedules included | Otherwise the tool reports its own sentences back as findings |
| B4 | A directory that cannot be **listed** is `BLOCKING UNREADABLE_DIR`, the eighth false-green row | It was skipped with no gap at all, so `chmod 000` on a subdirectory plus a baseline scanned in the same state reported "No drift" and exited 0 |
| M2 | The gap codes live in `src/gaps.mjs` and nowhere else. `isBlockingCode` **throws** on an undeclared code | The list was written down four times and the four disagreed. A typo that silently downgraded a blocking gap to noted would turn a fail-closed tool into one that exits 0 on an unread repo |

## 5. The gate set

Per area, run before any claim that this repo is green.

| Gate | Command |
|---|---|
| Suite | `npm test` |
| Demo | `node bin/system-map.mjs demo --out /tmp/system-map-demo`, exit 0 |
| Privacy | `npm run privacy` |
| README claims | `node --test test/readme.test.mjs` |
| Parse | `node --test test/syntax.test.mjs` (`node --check` over every module) |

## 6. Freshness coupling

`README.md`, `docs/DESIGN.md`, the demo's expected output, `.vibecodepm/flow.md` and
`.vibecodepm/metrics.md` change in the same commit as the code that staled them. The README test
executes the documented commands and compares bytes, so a stale example fails the suite in the
commit that staled it.
