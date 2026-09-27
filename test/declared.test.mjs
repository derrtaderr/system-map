// The tolerant parser for a hand-written system.md. docs/SPEC.md §3C-adjacent, §3E row 4.
//
// This file reads a document a human wrote in prose, which means every rule in it is a guess about
// what somebody meant. Two properties make that acceptable, and both are tested here:
//
//   it reports what it could NOT parse, so a reader can see the parser's blind spots rather than
//   mistaking silence for agreement, and
//
//   a document it understood nothing of is UNPARSEABLE, which is BLOCKING, because a reconcile
//   against a document nobody could read would find zero findings and exit clean.
//
// The architect skill's own artifact shape is the target: six numbered sections of ADR-ish prose.
// Everything looser than that is a tolerance, not a format.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDeclared, SECTION_KEYS } from '../src/declared.mjs';

const SIX_SECTIONS = [
  '---',
  'phase: architect',
  '---',
  '',
  '## 1. The map',
  '',
  '- **API** (`src/api.mjs`) — takes the request and answers it.',
  '- **Worker** (`worker/run.py`) — does the slow part.',
  '- API → Worker, over the queue.',
  '',
  '## 2. Where state lives',
  '',
  'Leads live in Postgres. Nothing has ever been restored from the backup.',
  '',
  '## 3. Doors and keys',
  '',
  'The only secret is `SK_EXAMPLE`, read from the environment. `DB_HOST` is configuration.',
  'Every write is checked in the worker, which the browser cannot reach.',
  '',
  '## 4. The bill',
  '',
  'Only `stripe` charges per use. The cap is the plan limit.',
  '',
  '## 5. The 2am question',
  '',
  'Failures are recorded by `pino`. Nothing pushes. That is the gap.',
  '',
  '## 6. The 10x line',
  '',
  'A hundred leads a day. At a thousand the worker is the first thing to fall over.',
  '',
].join('\n');

// --- sections -----------------------------------------------------------------------------------

test('the six section keys are the documented set', () => {
  assert.deepEqual([...SECTION_KEYS].sort(), ['bill', 'blast', 'doors', 'map', 'state', 'watch']);
});

test('all six numbered sections are found, each with the heading it was found by', () => {
  const declared = parseDeclared(SIX_SECTIONS);
  assert.deepEqual(
    SECTION_KEYS.map((key) => `${key}:${declared.sections[key] === null ? 'absent' : declared.sections[key].heading}`),
    [
      'map:1. The map',
      'state:2. Where state lives',
      'doors:3. Doors and keys',
      'bill:4. The bill',
      'watch:5. The 2am question',
      'blast:6. The 10x line',
    ],
  );
});

test('a heading with no number and different words still matches its section', () => {
  const text = ['# How it hangs together', '', '- **App** (`src/app.mjs`) — everything.', '', '## Secrets and access', '', '`SK_EXAMPLE` only.', ''].join('\n');
  const declared = parseDeclared(text);
  assert.ok(declared.sections.map !== null, 'a map section by another name');
  assert.ok(declared.sections.doors !== null, 'a doors section by another name');
});

test('a document with no recognisable section parses nothing, which is what BLOCKING is for', () => {
  const declared = parseDeclared('# Notes\n\nSome thoughts about the weekend.\n');
  assert.equal(declared.parsedAnything, false);
  for (const key of SECTION_KEYS) assert.equal(declared.sections[key], null, key);
});

test('an empty document parses nothing', () => {
  assert.equal(parseDeclared('').parsedAnything, false);
});

// --- pieces --------------------------------------------------------------------------------------

test('a bolded piece with a backticked path yields both the name and the path', () => {
  const declared = parseDeclared(SIX_SECTIONS);
  assert.deepEqual(
    declared.pieces.map((piece) => `${piece.name} [${piece.paths.join(',')}] ${piece.line}`),
    ['API [src/api.mjs] 7', 'Worker [worker/run.py] 8'],
  );
});

test('a piece named only by a backticked path is still a piece', () => {
  const text = ['## The map', '', '- `src/api.mjs` — the HTTP surface.', ''].join('\n');
  const [piece] = parseDeclared(text).pieces;
  assert.equal(piece.name, 'src/api.mjs');
  assert.deepEqual(piece.paths, ['src/api.mjs']);
});

test('a piece named in plain prose, with an em-dash description, is still a piece', () => {
  // The article is dropped as of fix wave 1 (I7): "The scoring worker" and `worker` name the same thing,
  // and keeping the article meant a hand-written map matched no piece in any repo.
  const text = ['## The map', '', '- The scoring worker — ranks the queue.', ''].join('\n');
  assert.deepEqual(parseDeclared(text).pieces.map((piece) => piece.name), ['scoring worker']);
});

test('a bullet that is only an edge is not also a piece', () => {
  const declared = parseDeclared(SIX_SECTIONS);
  assert.ok(!declared.pieces.some((piece) => piece.name.includes('→')), 'the arrow bullet did not become a piece');
});

test('pieces are only read from the map section, so a secret is never mistaken for a piece', () => {
  const text = ['## Doors and keys', '', '- **SK_EXAMPLE** — the only key.', ''].join('\n');
  assert.deepEqual(parseDeclared(text).pieces, []);
});

// --- edges ----------------------------------------------------------------------------------------

test('an arrow edge is read, in both notations', () => {
  const text = ['## The map', '', '- API → Worker', '- Worker -> Postgres', ''].join('\n');
  assert.deepEqual(
    parseDeclared(text).edges.map((edge) => `${edge.from}=>${edge.to}`),
    ['API=>Worker', 'Worker=>Postgres'],
  );
});

test('a verb edge is read, for the verbs a person actually writes', () => {
  const text = ['## The map', '', '- The API calls Stripe', '- The worker talks to Postgres', '- The worker writes to the ledger', ''].join('\n');
  assert.deepEqual(
    parseDeclared(text).edges.map((edge) => `${edge.from}=>${edge.to}`),
    ['API=>Stripe', 'worker=>Postgres', 'worker=>ledger'],
  );
});

test('an edge strips the bold and backtick markup from both ends', () => {
  const text = ['## The map', '', '- **API** → `worker/run.py`', ''].join('\n');
  assert.deepEqual(parseDeclared(text).edges.map((edge) => `${edge.from}=>${edge.to}`), ['API=>worker/run.py']);
});

test('an edge is read even when a trailing clause follows it', () => {
  const declared = parseDeclared(SIX_SECTIONS);
  assert.deepEqual(declared.edges.map((edge) => `${edge.from}=>${edge.to}`), ['API=>Worker']);
});

// --- env, secrets, metered clients, alert surfaces ---------------------------------------------------

test('backticked env-shaped names in the doors section are what section 3 declares', () => {
  const declared = parseDeclared(SIX_SECTIONS);
  assert.deepEqual(declared.doors.envNames, ['DB_HOST', 'SK_EXAMPLE']);
});

test('a backticked name in a different section does not count as declared in section 3', () => {
  // The whole value of report section 3 is that it names variables the DOORS section never lists.
  // Crediting a mention under "the bill" would hide exactly the miss the section exists to catch.
  const text = ['## 3. Doors and keys', '', 'Just `SK_EXAMPLE`.', '', '## 4. The bill', '', '`OTHER_KEY` is billed.', ''].join('\n');
  const declared = parseDeclared(text);
  assert.deepEqual(declared.doors.envNames, ['SK_EXAMPLE']);
  assert.ok(declared.allBackticked.includes('OTHER_KEY'), 'still visible globally');
});

test('a lowercase backticked token is not an env name', () => {
  const text = ['## 3. Doors and keys', '', 'The check is in `src/api.mjs`, and `SK_EXAMPLE` is the key.', ''].join('\n');
  assert.deepEqual(parseDeclared(text).doors.envNames, ['SK_EXAMPLE']);
});

test('the bill section yields the names it prices', () => {
  assert.deepEqual(parseDeclared(SIX_SECTIONS).bill.names, ['stripe']);
});

test('the watch section yields the surfaces it names', () => {
  assert.deepEqual(parseDeclared(SIX_SECTIONS).watch.names, ['pino']);
});

// --- what it could not read ----------------------------------------------------------------------------

test('a bullet in the map section that yields no piece and no edge is reported unparsed', () => {
  const text = ['## The map', '', '- ????', '- **Real** — a piece.', ''].join('\n');
  const declared = parseDeclared(text);
  assert.deepEqual(declared.unparsed.map((entry) => `${entry.line}:${entry.text}`), ['3:????']);
  assert.deepEqual(declared.pieces.map((piece) => piece.name), ['Real']);
});

test('a declared document that parsed something says so, so the caller can tell the two apart', () => {
  assert.equal(parseDeclared(SIX_SECTIONS).parsedAnything, true);
});

test('parsing is deterministic', () => {
  assert.deepEqual(parseDeclared(SIX_SECTIONS), parseDeclared(SIX_SECTIONS));
});

// --- I7: a hand-written map is prose, and prose has articles and descriptions ------------------------
//
// A ship-check ran the tool against a map somebody wrote by hand and got 4 false findings out of 11:
// two pieces named by description ("The nightly worker, in Python") and two edges whose endpoints carry
// articles ("The API calls the store"). Every one of those is a document that is RIGHT and a tool that
// cannot read it, which is the failure mode that gets a tool uninstalled.

test('a leading article is not part of a piece name', () => {
  const text = ['## The map', '', '- The nightly worker, in Python.', '- the billing module charges cards', ''].join('\n');
  assert.deepEqual(parseDeclared(text).pieces.map((piece) => piece.name), ['nightly worker', 'billing module charges cards']);
});

test('a piece name stops at the first clause break, so a description is not a name', () => {
  const text = ['## The map', '', '- The nightly worker, in Python and quite slow.', ''].join('\n');
  assert.deepEqual(parseDeclared(text).pieces.map((piece) => piece.name), ['nightly worker']);
});

test('an edge endpoint drops its article at both ends', () => {
  const text = ['## The map', '', '- The API calls the store.', '- The worker talks to the notifier.', ''].join('\n');
  assert.deepEqual(
    parseDeclared(text).edges.map((edge) => `${edge.from}=>${edge.to}`),
    ['API=>store', 'worker=>notifier'],
  );
});

test('every documented edge verb is read', () => {
  const lines = [
    '- The api calls the store',
    '- The api reads the store',
    '- The api writes the store',
    '- The api imports the store',
    '- The api depends on the store',
    '- The api uses the store',
    '- The api → the store',
    '- The api -> the store',
  ];
  for (const line of lines) {
    const declared = parseDeclared(['## The map', '', line, ''].join('\n'));
    assert.deepEqual(declared.edges.map((edge) => `${edge.from}=>${edge.to}`), ['api=>store'], line);
  }
});

test('a piece named only by a sentence with a path still keeps the path', () => {
  const text = ['## The map', '', '- The front door is the API. It lives in `src/`.', ''].join('\n');
  const [piece] = parseDeclared(text).pieces;
  assert.deepEqual(piece.paths, ['src/']);
});
