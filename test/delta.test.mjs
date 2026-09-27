// The delta: a committed baseline against a fresh scan. docs/SPEC.md decision D.
//
// This ships as its own module with its own tests because phase 2's ADR drafter consumes it, and a
// diff engine that only ever ran inside a report is a diff engine nobody can reuse. Phase 1 exposes
// no verb for it; section 6 of the reconcile report is its only caller today.
//
// The one judgement that matters here: identity is WHAT a thing is, never where it sits. A function
// that moved from line 12 to line 30 is not architectural drift, and a tool that reported it as
// drift would train its reader to ignore the report.

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeDelta, DELTA_KINDS } from '../src/delta.mjs';

function baseline(overrides = {}) {
  return {
    schema: 'system-map/baseline@1',
    modules: [],
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
    ...overrides,
  };
}

function rows(delta, kind) {
  return {
    added: delta[kind].added.map((entry) => entry.id),
    removed: delta[kind].removed.map((entry) => entry.id),
  };
}

// --- the empty case ---------------------------------------------------------------------------------

test('a baseline against itself is an empty delta, and says so in one boolean', () => {
  const only = baseline({ modules: [{ path: 'src/a.mjs', language: 'node' }] });
  const delta = computeDelta(only, only);

  assert.equal(delta.empty, true);
  assert.equal(delta.count, 0);
  for (const kind of DELTA_KINDS) {
    assert.deepEqual(delta[kind].added, [], kind);
    assert.deepEqual(delta[kind].removed, [], kind);
  }
});

test('the kinds are the documented set, so a caller can loop without knowing the shape', () => {
  assert.deepEqual([...DELTA_KINDS].sort(), [
    'authChecks',
    'clients',
    'edges',
    'env',
    'hosts',
    'modules',
    'observability',
    'routes',
    'schedules',
    'shells',
    'writes',
  ]);
});

// --- identity is what a thing is, not where it sits -------------------------------------------------

test('a module that moved to a different line is not drift', () => {
  const before = baseline({ env: [{ name: 'PORT', cite: 'src/a.mjs:3' }] });
  const after = baseline({ env: [{ name: 'PORT', cite: 'src/a.mjs:41' }] });

  const delta = computeDelta(before, after);
  assert.equal(delta.empty, true);
});

test('an edge is identified by its two ends, not by the line the import sits on', () => {
  const before = baseline({ edges: [{ from: 'src/a.mjs', to: 'src/b.mjs', specifier: './b.mjs', cite: 'src/a.mjs:1' }] });
  const after = baseline({ edges: [{ from: 'src/a.mjs', to: 'src/b.mjs', specifier: './b.mjs', cite: 'src/a.mjs:9' }] });

  assert.equal(computeDelta(before, after).empty, true);
});

test('an external edge is identified by its specifier, because it has no other end', () => {
  const before = baseline({ edges: [{ from: 'src/a.mjs', to: null, external: true, specifier: 'stripe', cite: 'src/a.mjs:1' }] });
  const after = baseline({ edges: [{ from: 'src/a.mjs', to: null, external: true, specifier: 'openai', cite: 'src/a.mjs:1' }] });

  assert.deepEqual(rows(computeDelta(before, after), 'edges'), {
    added: ['src/a.mjs -> openai'],
    removed: ['src/a.mjs -> stripe'],
  });
});

// --- each kind ----------------------------------------------------------------------------------------

test('a new module and a deleted module both land, in their own lists', () => {
  const before = baseline({ modules: [{ path: 'src/a.mjs' }, { path: 'src/gone.mjs' }] });
  const after = baseline({ modules: [{ path: 'src/a.mjs' }, { path: 'src/new.mjs' }] });

  assert.deepEqual(rows(computeDelta(before, after), 'modules'), { added: ['src/new.mjs'], removed: ['src/gone.mjs'] });
});

test('a new client is drift, and it is the drift that costs money', () => {
  const before = baseline({ clients: [] });
  const after = baseline({ clients: [{ name: 'openai', categories: ['metered'], cite: 'src/x.mjs:2' }] });

  assert.deepEqual(rows(computeDelta(before, after), 'clients'), { added: ['openai'], removed: [] });
});

test('a route that disappeared is drift, because something used to be reachable', () => {
  const before = baseline({ routes: [{ method: 'GET', path: '/health', cite: 'src/api.mjs:4' }] });
  const after = baseline({ routes: [] });

  assert.deepEqual(rows(computeDelta(before, after), 'routes'), { added: [], removed: ['GET /health'] });
});

test('an observability surface that vanished is drift, which is report section 5', () => {
  const before = baseline({ observability: [{ kind: 'pushes', name: 'hooks.slack.com', cite: 'src/a.mjs:8' }] });
  const after = baseline({ observability: [] });

  assert.deepEqual(rows(computeDelta(before, after), 'observability'), { added: [], removed: ['pushes hooks.slack.com'] });
});

test('a schedule, a host, an env var and an auth check each diff on their own identity', () => {
  const before = baseline({
    schedules: [{ kind: 'cron', detail: '0 9 * * *', cite: 'a:1' }],
    hosts: [{ host: 'api.example.com', cite: 'a:2' }],
    env: [{ name: 'OLD_KEY', cite: 'a:3' }],
    authChecks: [{ name: 'requireAuth', cite: 'a:4' }],
  });
  const after = baseline({
    schedules: [{ kind: 'cron', detail: '0 6 * * *', cite: 'a:1' }],
    hosts: [{ host: 'api.other.example.com', cite: 'a:2' }],
    env: [{ name: 'NEW_KEY', cite: 'a:3' }],
    authChecks: [],
  });

  const delta = computeDelta(before, after);
  assert.deepEqual(rows(delta, 'schedules'), { added: ['cron 0 6 * * *'], removed: ['cron 0 9 * * *'] });
  assert.deepEqual(rows(delta, 'hosts'), { added: ['api.other.example.com'], removed: ['api.example.com'] });
  assert.deepEqual(rows(delta, 'env'), { added: ['NEW_KEY'], removed: ['OLD_KEY'] });
  assert.deepEqual(rows(delta, 'authChecks'), { added: [], removed: ['requireAuth'] });
});

// --- what the caller gets ----------------------------------------------------------------------------

test('every delta entry carries the citation of the side it came from', () => {
  const before = baseline({ modules: [{ path: 'src/gone.mjs' }] });
  const after = baseline({ modules: [{ path: 'src/new.mjs', language: 'node' }] });

  const delta = computeDelta(before, after);
  assert.equal(delta.modules.added[0].entry.language, 'node');
  assert.equal(delta.modules.removed[0].entry.path, 'src/gone.mjs');
});

test('count is the total across every kind, so one number answers "did anything move"', () => {
  const before = baseline({ modules: [{ path: 'a' }], env: [{ name: 'X' }] });
  const after = baseline({ modules: [{ path: 'b' }], env: [] });

  const delta = computeDelta(before, after);
  assert.equal(delta.count, 3);
  assert.equal(delta.empty, false);
});

test('a missing key on either side is treated as an empty list, not a crash', () => {
  // A baseline written by an older version of the tool is missing keys a newer one reads. The
  // report says BASELINE_SCHEMA_OLD elsewhere; the delta must not throw before it gets there.
  const delta = computeDelta({ modules: [{ path: 'a' }] }, {});
  assert.deepEqual(rows(delta, 'modules'), { added: [], removed: ['a'] });
  assert.deepEqual(rows(delta, 'routes'), { added: [], removed: [] });
});

test('the delta is deterministic and sorted inside every list', () => {
  const before = baseline({ modules: [] });
  const after = baseline({ modules: [{ path: 'src/z.mjs' }, { path: 'src/a.mjs' }] });

  assert.deepEqual(rows(computeDelta(before, after), 'modules').added, ['src/a.mjs', 'src/z.mjs']);
});
