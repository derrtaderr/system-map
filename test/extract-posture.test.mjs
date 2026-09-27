// The posture extractors: what the system depends on that costs money or holds state, what it
// calls off the machine, what runs on a clock, and what would tell you it broke.
//
// docs/SPEC.md §3B. These four are the difference between this repo and every component-map
// generator in §1's prior-art table. A component map stops at "these files import each other".
// Questions 2, 4 and 5 of the architect's six need to know which of those imports bills you,
// which one holds your data, and which one would page you at 2am.

import test from 'node:test';
import assert from 'node:assert/strict';

import { REGISTRY, CATEGORIES, lookupModule } from '../src/registry.mjs';
import { clientsFromEdges, extractHosts } from '../src/extract/clients.mjs';
import { extractSchedules } from '../src/extract/schedules.mjs';
import { extractObservability } from '../src/extract/observability.mjs';

// --- the registry -------------------------------------------------------------------------------

test('every registry entry names a module and at least one known category', () => {
  assert.ok(REGISTRY.length >= 40, `${REGISTRY.length} entries`);
  for (const entry of REGISTRY) {
    assert.match(entry.module, /^[@A-Za-z0-9._/-]+$/, entry.module);
    assert.ok(entry.categories.length > 0, entry.module);
    for (const category of entry.categories) assert.ok(CATEGORIES.includes(category), `${entry.module}: ${category}`);
    assert.ok(typeof entry.note === 'string' && entry.note !== '', `${entry.module} carries a note`);
  }
});

test('the registry has no duplicate module, so a lookup has one answer', () => {
  const names = REGISTRY.map((entry) => entry.module);
  assert.deepEqual([...new Set(names)].length, names.length);
});

test('a metered entry says what meters, because "metered" with no reason is not a finding', () => {
  for (const entry of REGISTRY.filter((candidate) => candidate.categories.includes('metered'))) {
    assert.ok(entry.note.length > 10, entry.module);
  }
});

test('the four categories are the documented set and nothing else', () => {
  assert.deepEqual([...CATEGORIES].sort(), ['metered', 'observability', 'queue', 'state']);
});

test('lookup matches an exact module name', () => {
  assert.equal(lookupModule('stripe')?.module, 'stripe');
});

test('lookup matches a subpath of a package, because that is how SDKs are imported', () => {
  assert.equal(lookupModule('openai/resources')?.module, 'openai');
  assert.equal(lookupModule('@aws-sdk/client-s3')?.module, '@aws-sdk');
});

test('lookup matches a dotted python submodule', () => {
  assert.equal(lookupModule('sqlalchemy.orm')?.module, 'sqlalchemy');
});

test('lookup does not match a package that merely starts with the same letters', () => {
  assert.equal(lookupModule('stripe-webhook-helper'), null);
  assert.equal(lookupModule('redisearch-tools'), null);
});

test('a relative specifier is never a third-party client', () => {
  for (const specifier of ['./stripe.mjs', '../redis/index.mjs', '.stripe']) {
    assert.equal(lookupModule(specifier), null, specifier);
  }
});

// --- clients, derived from the edges already extracted -------------------------------------------

function clientRows(edges) {
  return clientsFromEdges(edges).map((client) => `${client.name} ${client.categories.join('+')} ${client.cite}`);
}

test('an import of a known SDK is a client, carrying its categories and its citation', () => {
  const edges = [
    { from: 'src/pay.mjs', specifier: 'stripe', kind: 'import', line: 1, cite: 'src/pay.mjs:1' },
    { from: 'src/db.mjs', specifier: '@supabase/supabase-js', kind: 'import', line: 3, cite: 'src/db.mjs:3' },
  ];
  assert.deepEqual(clientRows(edges), ['@supabase/supabase-js state src/db.mjs:3', 'stripe metered src/pay.mjs:1']);
});

test('a node builtin is not a client', () => {
  const edges = [{ from: 'src/a.mjs', specifier: 'node:fs', kind: 'import', line: 1, cite: 'src/a.mjs:1' }];
  assert.deepEqual(clientRows(edges), []);
});

test('the same SDK imported in two files is one client with both citations', () => {
  const edges = [
    { from: 'src/b.mjs', specifier: 'stripe', kind: 'import', line: 2, cite: 'src/b.mjs:2' },
    { from: 'src/a.mjs', specifier: 'stripe', kind: 'import', line: 1, cite: 'src/a.mjs:1' },
  ];
  const [client] = clientsFromEdges(edges);
  assert.equal(client.name, 'stripe');
  assert.deepEqual(client.cites, ['src/a.mjs:1', 'src/b.mjs:2']);
  assert.equal(client.cite, 'src/a.mjs:1');
});

test('a client in two categories keeps both', () => {
  const edges = [{ from: 'w/r.py', specifier: 'boto3', kind: 'python-import', line: 4, cite: 'w/r.py:4' }];
  const [client] = clientsFromEdges(edges);
  assert.ok(client.categories.includes('metered'), 'boto3 bills');
  assert.ok(client.categories.includes('state'), 'boto3 also holds objects');
});

// --- external hosts -------------------------------------------------------------------------------

function hostRows(path, text) {
  return extractHosts(path, text).hosts.map((host) => `${host.host} ${host.via} ${host.cite}`);
}

test('a fetch to a literal host is an external call', () => {
  assert.deepEqual(hostRows('src/a.mjs', "await fetch('https://api.example.com/v1/score');\n"), [
    'api.example.com fetch src/a.mjs:1',
  ]);
});

test('a python requests call to a literal host is an external call', () => {
  assert.deepEqual(hostRows('w/r.py', 'requests.post("https://hooks.example.com/abc", json=body)\n'), [
    'hooks.example.com requests w/r.py:1',
  ]);
});

test('localhost and a loopback address are not external', () => {
  const text = "fetch('http://localhost:3000/x');\nfetch('http://127.0.0.1:5678/y');\n";
  assert.deepEqual(hostRows('src/a.mjs', text), []);
});

test('a relative fetch has no host and is not reported as one', () => {
  assert.deepEqual(hostRows('src/a.mjs', "fetch('/api/score');\n"), []);
});

test('a host is reported once with its first citation, however many times it is called', () => {
  const text = "fetch('https://api.example.com/a');\nfetch('https://api.example.com/b');\n";
  assert.deepEqual(hostRows('src/a.mjs', text), ['api.example.com fetch src/a.mjs:1']);
});

test('a url in a comment is not an external call', () => {
  assert.deepEqual(hostRows('src/a.mjs', "// see https://docs.example.com/guide\n"), []);
});

// --- schedules --------------------------------------------------------------------------------------

function scheduleRows(path, text) {
  return extractSchedules(path, text).schedules.map((entry) => `${entry.kind} ${entry.detail} ${entry.cite}`);
}

test('a five-field cron string is a schedule', () => {
  assert.deepEqual(scheduleRows('src/cron.mjs', "const daily = '0 9 * * *';\n"), ['cron 0 9 * * * src/cron.mjs:1']);
});

test('a six-field cron string is a schedule', () => {
  assert.deepEqual(scheduleRows('src/cron.mjs', 'schedule("*/30 * * * * *");\n'), [
    'cron */30 * * * * * src/cron.mjs:1',
  ]);
});

test('a date, a version and a plain number sequence are not cron strings', () => {
  for (const sample of ["'2026-09-27'", "'1.2.3'", "'1 2 3 4 5'", "'10:05:00'"]) {
    assert.deepEqual(scheduleRows('src/a.mjs', `const x = ${sample};\n`), [], sample);
  }
});

test('setInterval is a schedule and carries its delay', () => {
  assert.deepEqual(scheduleRows('src/a.mjs', 'setInterval(tick, 60000);\n'), ['setInterval 60000 src/a.mjs:1']);
});

test('setInterval with a computed delay is still a schedule, delay unknown', () => {
  assert.deepEqual(scheduleRows('src/a.mjs', 'setInterval(tick, delay);\n'), ['setInterval unknown src/a.mjs:1']);
});

test('a GitHub Actions schedule block is a schedule', () => {
  const text = ['on:', '  schedule:', "    - cron: '0 9 * * 1'", ''].join('\n');
  assert.deepEqual(scheduleRows('.github/workflows/nightly.yml', text), [
    'github-actions 0 9 * * 1 .github/workflows/nightly.yml:3',
  ]);
});

test('a launchd plist interval is a schedule', () => {
  const text = ['<key>StartInterval</key>', '<integer>3600</integer>', ''].join('\n');
  assert.deepEqual(scheduleRows('ops/com.example.worker.plist', text), [
    'launchd StartInterval ops/com.example.worker.plist:1',
  ]);
});

test('a python celery crontab call is a schedule', () => {
  assert.deepEqual(scheduleRows('w/beat.py', 'crontab(hour=9, minute=0)\n'), ['crontab hour=9, minute=0 w/beat.py:1']);
});

test('a cron string in a comment is not a schedule', () => {
  assert.deepEqual(scheduleRows('src/a.mjs', "// runs on '0 9 * * *'\n"), []);
});

// --- observability -----------------------------------------------------------------------------------

function observeRows(path, text) {
  return extractObservability(path, text).surfaces.map((entry) => `${entry.kind} ${entry.name} ${entry.cite}`);
}

test('console.error is a recording surface', () => {
  assert.deepEqual(observeRows('src/a.mjs', "console.error('failed', error);\n"), [
    'records console.error src/a.mjs:1',
  ]);
});

test('a logger error call is a recording surface', () => {
  assert.deepEqual(observeRows('src/a.mjs', "logger.error({ err }, 'failed');\n"), ['records logger.error src/a.mjs:1']);
});

test('a python logging error and exception call are recording surfaces', () => {
  assert.deepEqual(observeRows('w/r.py', "logging.error('x')\nlogging.exception('y')\n"), [
    'records logging.error w/r.py:1',
    'records logging.exception w/r.py:2',
  ]);
});

test('a Sentry capture is a pushing surface, which is the half metrics never builds', () => {
  // The architect skill's 2am question splits exactly here: what RECORDS the failure, and what
  // PUSHES to you. A log nobody opens is not an alert, so the two are labelled apart.
  assert.deepEqual(observeRows('src/a.mjs', 'Sentry.captureException(error);\n'), [
    'pushes Sentry.captureException src/a.mjs:1',
  ]);
});

test('a slack webhook host is a pushing surface', () => {
  assert.deepEqual(observeRows('src/a.mjs', "await fetch('https://hooks.slack.com/services/T0/B0/xxx');\n"), [
    'pushes hooks.slack.com src/a.mjs:1',
  ]);
});

test('console.log is not an observability surface, because it records nothing anyone reads', () => {
  assert.deepEqual(observeRows('src/a.mjs', "console.log('ok');\n"), []);
});

test('a commented-out error log is not a surface', () => {
  assert.deepEqual(observeRows('src/a.mjs', "// console.error('failed');\n"), []);
});

test('the same surface twice in a file is one row at its first citation', () => {
  assert.deepEqual(observeRows('src/a.mjs', "console.error('a');\nconsole.error('b');\n"), [
    'records console.error src/a.mjs:1',
  ]);
});
