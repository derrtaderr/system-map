---
date: 2026-09-27
status: draft
phase: ship-check
read_by: the next ship-check run on this repo, and /build-lane when it decides whether row 66 lane 1 merges
---

```yaml
goal: derive a cited system.md from an agent-built repo and reconcile the declared design against the code, fail-closed
user: an operator whose repo was largely written by coding agents and who no longer trusts .vibecodepm/system.md
phase: ship-check
critical_assumption: a derive draft, saved as system.md, reconciles clean on the unchanged repo (the round trip is the contract)
decision: BLOCK
hard_gate: derive output saved as system.md reconciles to exit 0 on the unchanged fixture; an unlistable directory is a BLOCKING gap; reconcile defaults for --system and --baseline resolve against [path] or the report names what it read
success_window: three real repos with a committed baseline and one reconcile report each with a populated section, per metrics.md
```

# Ship-check, row 66 lane 1, `lane/row66-system-map-core` @ 18c2e41

Reviewer `row66_reviewer`, independent of the builder. flow.md and metrics.md are both `status: accepted`.

## Verdict

**BLOCK.** The happy path in flow.md (`derive → save as system.md → scan → reconcile, exit 0`) exits 1 with
10 false findings on the tool's own fixture. Three independent defects in `src/declared.mjs` and
`src/reconcile.mjs` cause it, and none is covered by a test. Two more states exit 0 or exit with a
plausible report when the run did not read what it claims to have read.

## Blocking findings

| id | file:line | defect | reproduce |
|---|---|---|---|
| B1 | `src/declared.mjs:23,94` | The derive H1 `# System map, derived` matches `\bmap\b` and claims the map section; the real `## 1. The map` is then dropped as a duplicate, so every code piece is "unnamed" | derive fixture → save as system.md → reconcile fixture: 5 unnamed pieces |
| B2 | `src/declared.mjs:26` | `## 4. What bills per use` (derive's own heading) does not match `\bbill\b`; bill section null; every metered client is "unpriced" | same run: `openai`, `stripe` unpriced; limits say no "bill" section |
| B3 | `src/reconcile.mjs:160-164` vs `src/derive.mjs:180-182` | derive writes schedule kinds into section 5; vanishedSurfaces checks section-5 tokens against observability, clients and routes only, never schedules | same run: `crontab`, `github-actions`, `setInterval` reported as vanished |
| B4 | `src/walk.mjs:36-42` | A directory `readdirSync` cannot list is skipped with no gap. `chmod 000 src/hidden` with a baseline scanned in the same state → exit 0 "No drift" | scratch `review66/fg`, run "chmod000 dir, baseline scanned in same state" |
| B5 | `src/cli.mjs:236-250` | `--system` and `--baseline` defaults resolve against cwd, not `[path]`; `reconcile ../repo` from another project read that project's system.md and baseline and exited 1 with 6 plausible findings; neither stdout nor the report names the inputs read | scratch `review66/blast/elsewhere` |

## Important findings

| id | file:line | defect |
|---|---|---|
| I1 | `src/cli.mjs:190` | `--out .vibecodepm/System.md --force` overwrote the confirmed `system.md` on APFS (case-insensitive). README, USAGE and flow.md say derive will never write one, "no escape hatch" |
| I2 | `docs/SPEC.md:127` vs `src/derive.mjs:88-107` | SPEC §3F promises "file writes" feed section 2; no file-write extractor exists. All three dogfood repos keep state on disk (landed `src/receipts.mjs:58,168`, `src/append.mjs`; job-radar `engine/radar/state.py`) and every draft says `Unknown: no database or storage client` |
| I3 | `src/extract/env.mjs:31-34` | Injected env (`main({ env = process.env })`, `env.LANDED_N8N_API_KEY`) is invisible; landed's only credential is missed, and the two env vars the scan did find come from test files. A probe for `<name>.env.UPPER` other than `process.env` over the three repos returned 0 hits, so the "noise" argument in DESIGN.md was not measured |
| I4 | `src/extract/clients.mjs` | `execFile('gh', …)` (landed `src/adapters/github.mjs:69`) and `subprocess` of `git` (job-radar) are external systems reached by shelling out; the draft reports no external edge and "nothing here bills per use" |
| I5 | `src/reconcile.mjs:19-22` | Pieces are top-level directories: a `packages/a`, `packages/b` monorepo derives to one piece, zero internal edges, and blast radius "nothing in this repo imports it" |
| I6 | `src/walk.mjs`, `src/derive.mjs` | Test files are pieces: job-radar `tests` is 48 of 80 modules, has a blast radius, and `tools → tests` is an edge. Section 6 drift will be dominated by test-file churn on the first weekly run |
| I7 | `src/reconcile.mjs:37-68` | Prose pieces named by description ("The nightly worker, in Python") and edges with articles ("The API calls the store") never match; a hand-written map produced 4 false findings out of 11 |
| I8 | `.vibecodepm/metrics.md` vs PR body | The builder's own Unknown-ratio instrument reads 40%, 41%, 43% on the three dogfood repos (its "too thin" line is 40) and 7% on the demo (its "probably inventing" line is 10); the PR body reports the counts and never applies the threshold |

## Minor findings

- `docs/SPEC.md:3` names `test/spec-claims.test.mjs`, which does not exist. SPEC §3D/§3E list six blocking codes "exhaustively"; README and DESIGN list seven (`BASELINE_SCHEMA_UNKNOWN`).
- Report and gap lines echo an absolute `--system`/`--baseline` path when one is given (the same class as the derive `derived_from` bug the builder fixed).
- Two reconciles on one day silently overwrite `reconcile-YYYY-MM-DD.md`.
- `process.env.X` inside a string or template literal is counted as an env read (`src/extract/text.mjs` masks comments only).
- A symlink to a file outside the repo (`src/passwd.mjs → /etc/passwd`) is read and listed as a module; a 21.7 MB minified file outside `dist/` becomes a module and a piece (3.4 s scan).
- Python: `importlib.import_module("literal")` yields no edge and no NOTED gap (SPEC §3C says dynamic imports are noted, never dropped); `if TYPE_CHECKING:` imports are ordinary edges (Node `import type` is labelled); router `prefix=` is dropped from route paths.
- Registry notes ("charges per API call and settles real money") are printed at the import citation; the cited line shows an import, the claim lives in `src/registry.mjs`.
- A rename is four drift rows (module added/removed, edge added/removed).

## What passed

- Suite 312/312 exit 0; `npm run privacy` exit 0 (59 tracked files); demo exit 0; `node --check` over every module; no LLM string in `src/` or `bin/` outside registry entries; `decisions` refused, exit 2, and a hygiene test pins it; repo PRIVATE; baselines carry no absolute path; dogfood repos untouched.
- False-green table, all seven states via the CLI: EMPTY_REPO 3, UNREADABLE_FILE 3, MANIFEST_UNPARSED 3, SYSTEM_MD_ABSENT 3, SYSTEM_MD_UNPARSEABLE 3, BASELINE_ABSENT 3, BASELINE_SCHEMA_UNKNOWN 3; control 0; drift plus blocking gap 3; drift alone 1; corrupt-JSON baseline 2 (as flow.md says); NOTED-only gap 0.
- Hostile content: comments masked, markdown not scanned, `dist/` skipped, symlink loop not followed, filenames with spaces resolve.
- Python: relative imports at every depth, `__init__.py` re-exports, `os.environ.get` with a default, `Depends(get_current_user)`, PEP 621 dependencies.
- Prose map: the deliberate lie was caught.

## Stranger walk (vibecodepm:user-advocate, fresh clone of the branch, Node 25.6.1, own 5-file repo)

Scratch: `review66/stranger/`. The advocate read README and flow.md only, never `src/`.

| step | result | finding |
|---|---|---|
| A `npm test`, demo per README | 312 pass; demo output byte-identical to the README block except the three `--out` path lines; the quoted "real line" is in the report verbatim | none |
| B happy path from inside `myapp`: derive → save unedited as system.md → scan → reconcile | **exit 1, 4 findings** (3 pieces "unnamed" that the draft names in bold; `stripe` "unpriced" with `## 4. What bills per use` present). Isolated by editing the document only: H1 `# myapp` + `## 4. The bill` → exit 0 | BUILD, reproduces B1 and B2 |
| C `reconcile ../myapp` from an empty sibling dir | exit 3 `BASELINE_ABSENT`, `SYSTEM_MD_ABSENT` while both files exist in `myapp`; report written into the sibling's `.system-map/` | BUILD, reproduces B5 |
| D recovery paths | `derive` twice → exit 2 with `--force` offered; `--out .vibecodepm/system.md` → exit 2, never written (`cmp` clean); `--out=foo.md`, unknown verb, `decisions`, no verb → exit 2 with a correct sentence | matches flow.md |
| D first-run exit 3 report | gap lines name the missing file and never the verb (`scan`, `derive`); flow.md "Every state" and "Recovery paths" promise both | BUILD (I9): `src/reconcile.mjs:236,260` |
| D refusals | one sentence plus the full ~45-line usage; flow.md says "one sentence" | MAP, minor |
| E `--help`, `-h` | exit 0; every verb and flag findable without the README. `help` and `--version` are unknown verbs | minor |
| persistence | second `scan` silently overwrote the committed baseline (flow.md: re-agreeing the baseline is "a decision, not a side effect"); second same-day `reconcile` silently overwrote the report | I10 (`src/cli.mjs:162`), minor |

Axes per verb: demo good on all five; scan good except persistence (silent baseline overwrite); derive good on invocation, comprehension, persistence, recovery, and fails waste (the draft it tells you to confirm is a draft the next verb cannot read); reconcile fails comprehension and waste on the first run (B1, B2, B5, I9).

Advocate comprehension notes worth keeping: `DB_URL` is classed "configuration rather than a key" (a database URL usually carries the password; `CONNECTION_ENV` puts it in section 2 but `SECRETISH` does not); `express` never appears in the map while `stripe` does (registry has no web-framework category, and the draft does not say so); one test leaks `system-map: name a verb…` to stderr during `npm test`.

## Instrumentation

metrics.md declares no telemetry by design; every number is read off artifacts. Confirmed: the report exit line (`src/report.mjs:86-91`), the dated report filename, and the two-shape draft lines make the Unknown ratio and exit-3 causes countable. Activation ("first reconcile report with a populated section on a real repo") has not happened: no real repo has a committed baseline or a reconcile report yet.

## Security surface

No egress, no key, no network. A real `.env` is never opened (filename guard). The scan follows file symlinks outside the repo (minor above); only matched tokens reach output. `--out` resolves against cwd so a scan of another repo cannot write into it (verified). Fail direction: seven blocking states fail closed; an unlistable directory does not (B4).
