#!/usr/bin/env node
// Generates the fixture repo's COMMITTED baseline: the reference point the demo's reconcile diffs
// against. docs/SPEC.md §3A and decision E.
//
// It is generated rather than hand-written because a hand-written baseline drifts from the fixture
// the first time somebody edits a fixture file, and then the demo's report is wrong in a way nobody
// notices. test/demo.test.mjs asserts the committed file equals this script's output, so editing the
// fixture without re-running this fails the suite in the commit that broke it.
//
// What it does: scan the fixture, then deliberately make the baseline OLDER than the code, in the two
// ways a real baseline goes stale.
//
//   1. `billing/` did not exist yet. The whole piece, its edges, its client and its host are removed,
//      so the demo shows a new piece arriving after the design was agreed.
//   2. Something used to push. An alert surface that no longer exists is added, so the demo shows the
//      case that matters most: a thing that used to tell you, and stopped.
//
// Run it with: node scripts/make-fixture-baseline.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../src/scan.mjs';
import { DEMO_NOW, FIXTURE_DIR } from '../src/demo.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = fileURLToPath(new URL(`../${FIXTURE_DIR}/`, import.meta.url));
const OUT = fileURLToPath(new URL(`../${FIXTURE_DIR}/.system-map/baseline.json`, import.meta.url));

// The piece that had not been built when the map was written.
const LATER = 'billing/';

const inLater = (value) => typeof value === 'string' && value.startsWith(LATER);

// An alert surface the baseline recorded and the code no longer has. This is the drift a person most
// wants to be told about, so the fixture has to contain one.
const SURFACE_THAT_VANISHED = {
  kind: 'pushes',
  name: 'events.pagerduty.com',
  path: 'notify/slack.mjs',
  line: 9,
  cite: 'notify/slack.mjs:9',
};

export function buildCommittedBaseline() {
  const scan = scanRepo(FIXTURE);

  const baseline = {
    ...scan,
    modules: scan.modules.filter((module) => !inLater(module.path)),
    edges: scan.edges.filter((edge) => !inLater(edge.from) && !inLater(edge.to)),
    manifests: scan.manifests,
    env: scan.env.filter((entry) => !inLater(entry.path)),
    routes: scan.routes.filter((route) => !inLater(route.from)),
    clients: scan.clients.filter((client) => !client.cites.every(inLater)),
    hosts: scan.hosts.filter((host) => !inLater(host.path)),
    schedules: scan.schedules.filter((entry) => !inLater(entry.path)),
    observability: [...scan.observability.filter((surface) => !inLater(surface.path)), SURFACE_THAT_VANISHED]
      .sort((a, b) => a.cite.localeCompare(b.cite)),
    authChecks: scan.authChecks.filter((check) => !inLater(check.path)),
    gaps: scan.gaps.filter((gap) => !inLater(gap.path)),
  };

  baseline.counts = Object.fromEntries(
    Object.keys(scan.counts).map((key) => {
      if (key === 'blockingGaps') return [key, baseline.gaps.filter((gap) => gap.tier === 'BLOCKING').length];
      return [key, Array.isArray(baseline[key]) ? baseline[key].length : scan.counts[key]];
    }),
  );

  baseline.generated_at = DEMO_NOW;

  return `${JSON.stringify(baseline, null, 2)}\n`;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('make-fixture-baseline.mjs')) {
  writeFileSync(OUT, buildCommittedBaseline());
  console.log(`wrote ${OUT.replace(ROOT, '')}`);
}
