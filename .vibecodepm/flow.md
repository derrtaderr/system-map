---
name: system-map flow
phase: flow
status: accepted
read_by: `ship-check` before any release, and every session that adds a verb or changes an exit code
---

# Flow

Who walks this: an operator whose repo was largely written by coding agents, who has a
`.vibecodepm/system.md` (or is about to) and no confidence that it still describes the code.

## Entry points

1. **`node bin/system-map.mjs demo --out <dir>`** — the stranger's first move. No key, no network,
   nothing written outside `--out`. Decides in one screen whether the tool is worth five more minutes.
2. **`node bin/system-map.mjs derive`** — has code, has no system map. Produces a cited draft to
   confirm or correct.
3. **`node bin/system-map.mjs scan`** — has a system map, wants a committed reference point.
4. **`node bin/system-map.mjs reconcile`** — has both, run on a schedule from then on.

## The happy path

```
derive  →  read the draft, correct it, save it as .vibecodepm/system.md
        →  scan       (commit .system-map/baseline.json)
        →  reconcile  (exit 0, nothing to do)
        ... weeks of agent PRs ...
        →  reconcile  (exit 1, a dated report naming what moved, every line cited)
        →  fix the code, or amend the map, then re-scan to re-agree the baseline
```

The loop closes at "re-scan to re-agree the baseline". That is the only step a person has to choose,
and it is deliberately manual: agreeing a new baseline is a decision, not a side effect.

## Every state

| State | What the operator sees | Exit |
|---|---|---|
| Clean | "No drift. The declared design and the code agree." | 0 |
| Drift | a count per section, then a dated report with every line cited | 1 |
| Refused | one sentence naming the flag, the path, or the file it will not overwrite | 2 |
| Cannot judge | "Could not read enough to judge", each blocking gap by code and path | 3 |
| First run, no baseline | `BASELINE_ABSENT`, and the report says to run `scan` | 3 |
| First run, no system map | `SYSTEM_MD_ABSENT`, and the report says to run `derive` | 3 |
| Map exists but unreadable | `SYSTEM_MD_UNPARSEABLE`, naming that no section parsed | 3 |
| A file would not open | `UNREADABLE_FILE`, naming the file | 3 |
| Nothing to scan | `EMPTY_REPO` | 3 |

## Recovery paths

- **Exit 3 on a first run** is the expected first experience, not a failure. Both messages name the
  verb that fixes them.
- **A finding that is wrong.** Every line carries `file:line`. Open it, decide, and either fix the
  code or amend the map. `docs/DESIGN.md` states what the scan cannot see, so overruling it is a
  five-second judgement rather than an argument.
- **`derive` refuses to overwrite.** The path is named and `--force` is offered, except for a file
  called `system.md`, which it will never write.
- **A corrupt committed baseline** is exit 2 naming the file, not exit 3, because "it is right there
  and it is broken" and "it is not there" send the reader to different places.
- **Noise from a directory that is not really a piece.** Add it to the map in a sentence, or leave the
  finding standing as a known one. There is no ignore file in phase 1, on purpose: an ignore list is
  where a drift detector goes to die.

## What the operator never has to do

Install anything. Hold a key. Wait on a network call. Read a diagram. Trust a sentence with no
citation behind it.
