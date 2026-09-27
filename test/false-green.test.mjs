// The false-green table. docs/SPEC.md §3E.
//
// GREEN IS EARNED. Every row below is a way `reconcile` could look clean while it never actually
// read the thing it is judging. None of them may exit 0, and this file is what makes that a rule
// rather than an intention.
//
// The tiering in §3D is load bearing and row 7 is where it shows: a BLOCKING gap outranks a
// finding, because "I found no drift" and "my verdict is not trustworthy" are different sentences
// and a cron job reads only the number.

import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcile } from '../src/reconcile.mjs';
import { BASELINE_SCHEMA } from '../src/scan.mjs';

// A scan-shaped object with nothing wrong with it. Rows below break exactly one thing each.
function healthyScan(overrides = {}) {
  return {
    schema: BASELINE_SCHEMA,
    modules: [{ path: 'src/api.mjs', language: 'node' }],
    edges: [],
    manifests: [],
    env: [],
    routes: [],
    clients: [],
    hosts: [],
    schedules: [],
    observability: [],
    authChecks: [],
    gaps: [],
    counts: {},
    ...overrides,
  };
}

const DECLARED = ['## 1. The map', '', '- **API** (`src/api.mjs`) — answers requests.', ''].join('\n');

function run(overrides = {}) {
  return reconcile({
    scan: healthyScan(),
    declaredText: DECLARED,
    committedBaseline: healthyScan(),
    ...overrides,
  });
}

function codes(outcome) {
  return outcome.gaps.filter((gap) => gap.tier === 'BLOCKING').map((gap) => gap.code).sort();
}

// --- the control ------------------------------------------------------------------------------------

test('control: a scan that agrees with its map and its baseline exits 0', () => {
  // Without this row the whole file proves only that the tool never exits 0.
  const outcome = run();
  assert.deepEqual(codes(outcome), []);
  assert.equal(outcome.findings, 0);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.verdict, 'clean');
});

// --- the six blocking states ------------------------------------------------------------------------

test('row 1: an empty repo is BLOCKING EMPTY_REPO and exits 3', () => {
  const outcome = run({
    scan: healthyScan({
      modules: [],
      gaps: [{ tier: 'BLOCKING', code: 'EMPTY_REPO', path: '.', cite: '.', detail: 'no source file' }],
    }),
  });

  assert.deepEqual(codes(outcome), ['EMPTY_REPO']);
  assert.equal(outcome.exitCode, 3);
  assert.equal(outcome.verdict, 'cannot-judge');
});

test('row 2: a file that could not be read is BLOCKING UNREADABLE_FILE and exits 3', () => {
  const outcome = run({
    scan: healthyScan({
      gaps: [{ tier: 'BLOCKING', code: 'UNREADABLE_FILE', path: 'src/locked.mjs', cite: 'src/locked.mjs:1', detail: 'EACCES' }],
    }),
  });

  assert.deepEqual(codes(outcome), ['UNREADABLE_FILE']);
  assert.equal(outcome.exitCode, 3);
});

test('row 3: an absent system.md is BLOCKING SYSTEM_MD_ABSENT and exits 3', () => {
  const outcome = run({ declaredText: null });

  assert.deepEqual(codes(outcome), ['SYSTEM_MD_ABSENT']);
  assert.equal(outcome.exitCode, 3);
  assert.match(outcome.gaps[0].detail, /nothing to reconcile against/i);
});

test('row 4: a system.md nothing could be parsed from is BLOCKING and exits 3', () => {
  // The most dangerous row. An unreadable design document produces zero findings, and zero
  // findings reads as agreement.
  const outcome = run({ declaredText: '# Notes\n\nthoughts about the weekend\n' });

  assert.deepEqual(codes(outcome), ['SYSTEM_MD_UNPARSEABLE']);
  assert.equal(outcome.exitCode, 3);
  assert.equal(outcome.findings, 0, 'and it found nothing, which is exactly why 0 would have been a lie');
});

test('row 5: an absent committed baseline is BLOCKING BASELINE_ABSENT and exits 3', () => {
  const outcome = run({ committedBaseline: null });

  assert.deepEqual(codes(outcome), ['BASELINE_ABSENT']);
  assert.equal(outcome.exitCode, 3);
});

test('row 6: an unparsed manifest is BLOCKING MANIFEST_UNPARSED and exits 3', () => {
  const outcome = run({
    scan: healthyScan({
      gaps: [{ tier: 'BLOCKING', code: 'MANIFEST_UNPARSED', path: 'package.json', cite: 'package.json:1', detail: 'not valid JSON' }],
    }),
  });

  assert.deepEqual(codes(outcome), ['MANIFEST_UNPARSED']);
  assert.equal(outcome.exitCode, 3);
});

test('a baseline written by a schema this build does not know is BLOCKING, not a silent reread', () => {
  const outcome = run({ committedBaseline: healthyScan({ schema: 'system-map/baseline@99' }) });

  assert.deepEqual(codes(outcome), ['BASELINE_SCHEMA_UNKNOWN']);
  assert.equal(outcome.exitCode, 3);
});

// --- row 7, the tiering ------------------------------------------------------------------------------

test('row 7: drift AND a blocking gap exits 3, never 1, because the verdict is not trustworthy', () => {
  const outcome = run({
    scan: healthyScan({
      modules: [{ path: 'src/api.mjs', language: 'node' }, { path: 'billing/charge.mjs', language: 'node' }],
      gaps: [{ tier: 'BLOCKING', code: 'UNREADABLE_FILE', path: 'src/locked.mjs', cite: 'src/locked.mjs:1', detail: 'EACCES' }],
    }),
  });

  assert.ok(outcome.findings > 0, 'it did find drift');
  assert.equal(outcome.exitCode, 3);
  assert.equal(outcome.verdict, 'cannot-judge');
});

test('a NOTED gap alone never changes the exit code, or the tool would never return a verdict', () => {
  // The other half of §3D. Every real repo has an unresolvable dynamic import. If NOTED were
  // blocking, reconcile would exit 3 forever and nobody would run it twice.
  const outcome = run({
    scan: healthyScan({
      gaps: [{ tier: 'NOTED', code: 'DYNAMIC_SPECIFIER', path: 'src/api.mjs', cite: 'src/api.mjs:9', detail: 'computed' }],
    }),
  });

  assert.deepEqual(codes(outcome), []);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.gaps.filter((gap) => gap.tier === 'NOTED').length, 1, 'and it is still reported');
});

// --- the closing invariant ----------------------------------------------------------------------------

test('no state in this table can produce exit 0', () => {
  const states = [
    { scan: healthyScan({ modules: [], gaps: [{ tier: 'BLOCKING', code: 'EMPTY_REPO', path: '.', cite: '.', detail: 'x' }] }) },
    { scan: healthyScan({ gaps: [{ tier: 'BLOCKING', code: 'UNREADABLE_FILE', path: 'a', cite: 'a:1', detail: 'x' }] }) },
    { declaredText: null },
    { declaredText: '# Notes\n' },
    { committedBaseline: null },
    { scan: healthyScan({ gaps: [{ tier: 'BLOCKING', code: 'MANIFEST_UNPARSED', path: 'p', cite: 'p:1', detail: 'x' }] }) },
    { committedBaseline: healthyScan({ schema: 'other' }) },
  ];

  for (const state of states) {
    const outcome = run(state);
    assert.notEqual(outcome.exitCode, 0, JSON.stringify(Object.keys(state)));
    assert.equal(outcome.verdict, 'cannot-judge', JSON.stringify(Object.keys(state)));
  }
});

test('a blocking gap is stated in the report, not only in the exit code', () => {
  // A number a cron job reads is not a report a person reads. Both have to carry it.
  const outcome = run({ declaredText: null });
  assert.ok(outcome.report.includes('What this run could not see'), 'the section is present');
  assert.ok(outcome.report.includes('SYSTEM_MD_ABSENT'), 'and it names the code');
});
