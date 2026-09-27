---
name: system-map metrics
phase: metrics
status: accepted
read_by: `ship-check` before any release, and the first session that asks whether this tool is used
---

# Metrics

## Activation event

**The first `reconcile` report with a populated section, on a real repo.** Not an install, not a
`demo` run, not a `derive`. The tool has done its job the first time it tells somebody something
about their own code that their own design document did not say.

The demo deliberately does not count. It is a recording, and it finds drift by construction.

## North star

**Reconcile runs per repo per month, on repos that have already seen one report.** A drift detector's
whole value is that it runs again, and the single failure mode that kills one is a report whose
findings the reader stops believing. A repo that ran it once and never again is the signal to read.

## Week-one numbers

| Number | Target | Why it is the number |
|---|---|---|
| Repos with a committed `.system-map/baseline.json` | 3 | Committing a baseline is the first real act of adoption |
| Reconcile reports with at least one populated section | 3 | Activation, above |
| Findings overruled as wrong, per report | under 3 | The credibility ceiling. Past this the report gets skimmed |
| Answer lines in a `derive` draft that are `Unknown` | 10 to 40 per cent | Below 10 it is probably inventing; above 40 the extractors are too thin to be useful |
| Exit 3 runs that were a genuine unread, not a first run | 0 unexplained | Every one is either a real gap or a bug in the tiering |

## Instrumentation

There is no telemetry and there will not be. This is a local CLI on somebody's own repository, and a
tool that phones home to tell us about a private codebase is a door the architect's question 3 would
have to name. The numbers above are read off artifacts instead, which is why the artifacts are shaped
the way they are:

| Number | Where it is read from |
|---|---|
| Baselines committed | `.system-map/baseline.json` present in a repo's git history |
| Reports with findings | `.system-map/reconcile-*.md`, committed or not, and its exit line |
| Findings overruled | the map diff in the commit that follows a report, against that report's findings |
| Unknown ratio | countable from any draft, since every answer line is either cited or an `Unknown` |
| Exit 3 causes | every blocking gap carries its code and its path in the report |

Each one is legible from a file a person already has. That is the whole instrumentation plan, and it
is the reason `reconcile` writes a dated report rather than only printing to a terminal.
