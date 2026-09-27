// The six report sections, each against a real repo on disk. docs/SPEC.md §3G.
//
// These run the whole chain — walk, extract, resolve, parse the declared document, diff — because
// the value of the tool is the join, and a join tested only on hand-built inputs is a join that has
// never met a filesystem.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { scanRepo } from '../src/scan.mjs';
import { reconcile } from '../src/reconcile.mjs';

function withRepo(files, body) {
  const root = mkdtempSync(join(tmpdir(), 'system-map-rec-'));
  try {
    for (const [path, contents] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The whole chain, with the committed baseline defaulting to the current scan so that only the
// section under test produces findings.
function judge(files, declaredText, { committedBaseline } = {}) {
  return withRepo(files, (root) => {
    const scan = scanRepo(root);
    return reconcile({ scan, declaredText, committedBaseline: committedBaseline ?? scan });
  });
}

const MAP_OF_ONE = ['## 1. The map', '', '- **API** (`src/api.mjs`) — answers requests.', ''].join('\n');

function ids(outcome, key) {
  return outcome.sections[key].map((finding) => finding.id);
}

// --- section 1: pieces present in code the map does not name ---------------------------------------

test('a directory the map never names is a finding, cited at a real file', () => {
  const outcome = judge(
    { 'src/api.mjs': '', 'billing/charge.mjs': '' },
    MAP_OF_ONE,
  );

  assert.deepEqual(ids(outcome, 'unnamedPieces'), ['billing']);
  assert.equal(outcome.sections.unnamedPieces[0].cite, 'billing/charge.mjs:1');
});

test('a piece the map names by its path is not a finding', () => {
  assert.deepEqual(ids(judge({ 'src/api.mjs': '' }, MAP_OF_ONE), 'unnamedPieces'), []);
});

test('a piece the map names only in prose still counts, matched on the module’s own name', () => {
  // A hand-written map says "the worker". Requiring a backticked path would make every honest
  // prose map fail, and the tool would be teaching people to write it its way.
  const declared = ['## The map', '', '- **api** — answers requests.', '- **charge** — takes the money.', ''].join('\n');
  assert.deepEqual(ids(judge({ 'src/api.mjs': '', 'billing/charge.mjs': '' }, declared), 'unnamedPieces'), []);
});

test('a file at the repo root is its own piece', () => {
  const outcome = judge({ 'index.mjs': '', 'src/api.mjs': '' }, MAP_OF_ONE);
  assert.deepEqual(ids(outcome, 'unnamedPieces'), ['index.mjs']);
});

// --- section 2: edges present the map omits ----------------------------------------------------------

test('an edge between two named pieces that the map does not declare is a finding', () => {
  const declared = [
    '## 1. The map',
    '',
    '- **API** (`src/api.mjs`) — answers requests.',
    '- **Billing** (`billing/charge.mjs`) — takes the money.',
    '',
  ].join('\n');

  const outcome = judge({ 'src/api.mjs': "import './../billing/charge.mjs';\n", 'billing/charge.mjs': '' }, declared);
  assert.deepEqual(ids(outcome, 'undeclaredEdges'), ['src -> billing']);
  assert.equal(outcome.sections.undeclaredEdges[0].cite, 'src/api.mjs:1');
});

test('an edge the map declares is not a finding, in either notation', () => {
  const declared = [
    '## 1. The map',
    '',
    '- **API** (`src/api.mjs`) — answers requests.',
    '- **Billing** (`billing/charge.mjs`) — takes the money.',
    '- API → Billing',
    '',
  ].join('\n');

  assert.deepEqual(ids(judge({ 'src/api.mjs': "import '../billing/charge.mjs';\n", 'billing/charge.mjs': '' }, declared), 'undeclaredEdges'), []);
});

test('an edge touching a piece the map never names belongs to section 1, not section 2', () => {
  // Otherwise one unnamed directory produces a finding in both sections and the reader reads the
  // same problem twice under two different headings.
  const outcome = judge({ 'src/api.mjs': "import '../billing/charge.mjs';\n", 'billing/charge.mjs': '' }, MAP_OF_ONE);
  assert.deepEqual(ids(outcome, 'unnamedPieces'), ['billing']);
  assert.deepEqual(ids(outcome, 'undeclaredEdges'), []);
});

test('an edge inside one piece is not an edge between pieces', () => {
  assert.deepEqual(ids(judge({ 'src/api.mjs': "import './db.mjs';\n", 'src/db.mjs': '' }, MAP_OF_ONE), 'undeclaredEdges'), []);
});

// --- section 3: env vars read that section 3 never lists ----------------------------------------------

test('an env var the doors section never lists is a finding, and a secret-shaped one is flagged', () => {
  const declared = [MAP_OF_ONE, '## 3. Doors and keys', '', 'The only key is `SK_EXAMPLE`.', ''].join('\n');
  const code = 'process.env.SK_EXAMPLE;\nprocess.env.STRIPE_SECRET;\nprocess.env.PORT;\n';

  const outcome = judge({ 'src/api.mjs': code }, declared);
  assert.deepEqual(ids(outcome, 'undeclaredEnv'), ['STRIPE_SECRET', 'PORT']);
  assert.equal(outcome.sections.undeclaredEnv[0].secretish, true, 'the credential sorts first');
  assert.equal(outcome.sections.undeclaredEnv[1].secretish, false);
});

test('an env var listed in the doors section is not a finding', () => {
  const declared = [MAP_OF_ONE, '## 3. Doors and keys', '', '`SK_EXAMPLE` and `PORT`.', ''].join('\n');
  assert.deepEqual(ids(judge({ 'src/api.mjs': 'process.env.SK_EXAMPLE;\nprocess.env.PORT;\n' }, declared), 'undeclaredEnv'), []);
});

test('an env var listed under the BILL section is still missing from section 3', () => {
  const declared = [MAP_OF_ONE, '## 3. Doors and keys', '', 'Nothing much.', '', '## 4. The bill', '', '`SK_EXAMPLE` pays.', ''].join('\n');
  assert.deepEqual(ids(judge({ 'src/api.mjs': 'process.env.SK_EXAMPLE;\n' }, declared), 'undeclaredEnv'), ['SK_EXAMPLE']);
});

// --- section 4: metered clients section 4 never prices -------------------------------------------------

test('a metered client the bill section never prices is a finding, carrying why it meters', () => {
  const declared = [MAP_OF_ONE, '## 4. The bill', '', 'Only `stripe` charges.', ''].join('\n');
  const outcome = judge({ 'src/api.mjs': "import Stripe from 'stripe';\nimport OpenAI from 'openai';\n" }, declared);

  assert.deepEqual(ids(outcome, 'unpricedClients'), ['openai']);
  assert.match(outcome.sections.unpricedClients[0].detail, /per token/);
});

test('a state-only client is not a bill finding, because it does not meter', () => {
  const declared = [MAP_OF_ONE, '## 4. The bill', '', 'Nothing charges.', ''].join('\n');
  assert.deepEqual(ids(judge({ 'src/api.mjs': "import pg from 'pg';\n" }, declared), 'unpricedClients'), []);
});

test('the bill section naming a client in different case still prices it', () => {
  const declared = [MAP_OF_ONE, '## 4. The bill', '', 'The `OpenAI` calls cost per token.', ''].join('\n');
  assert.deepEqual(ids(judge({ 'src/api.mjs': "import OpenAI from 'openai';\n" }, declared), 'unpricedClients'), []);
});

// --- section 5: alert and log surfaces that vanished ----------------------------------------------------

test('a surface the watch section names but the code does not have is a finding', () => {
  const declared = [MAP_OF_ONE, '## 5. The 2am question', '', 'Failures go to `Sentry.captureException` and `pino`.', ''].join('\n');
  const outcome = judge({ 'src/api.mjs': "console.error('x');\n" }, declared);

  assert.deepEqual(ids(outcome, 'vanishedSurfaces').sort(), ['Sentry.captureException', 'pino']);
});

test('a surface that was in the committed baseline and is gone now is a finding', () => {
  const declared = [MAP_OF_ONE, '## 5. The 2am question', '', 'Nothing declared.', ''].join('\n');

  const outcome = withRepo({ 'src/api.mjs': "console.log('quiet');\n" }, (root) => {
    const scan = scanRepo(root);
    const committedBaseline = {
      ...scan,
      observability: [{ kind: 'pushes', name: 'hooks.slack.com', cite: 'src/api.mjs:4' }],
    };
    return reconcile({ scan, declaredText: declared, committedBaseline });
  });

  assert.ok(ids(outcome, 'vanishedSurfaces').includes('pushes hooks.slack.com'));
});

test('a surface the code does have is not a finding', () => {
  const declared = [MAP_OF_ONE, '## 5. The 2am question', '', 'Failures reach `console.error`.', ''].join('\n');
  assert.deepEqual(ids(judge({ 'src/api.mjs': "console.error('x');\n" }, declared), 'vanishedSurfaces'), []);
});

// --- section 6: drift since the committed baseline --------------------------------------------------------

test('a new module since the committed baseline is drift, named in section 6', () => {
  const outcome = withRepo({ 'src/api.mjs': '', 'src/new.mjs': '' }, (root) => {
    const scan = scanRepo(root);
    const committedBaseline = { ...scan, modules: [{ path: 'src/api.mjs', language: 'node' }] };
    return reconcile({ scan, declaredText: MAP_OF_ONE, committedBaseline });
  });

  assert.deepEqual(outcome.sections.drift.map((entry) => entry.id), ['modules added: src/new.mjs']);
  assert.equal(outcome.exitCode, 1);
});

test('a removed module since the committed baseline is drift too', () => {
  const outcome = withRepo({ 'src/api.mjs': '' }, (root) => {
    const scan = scanRepo(root);
    const committedBaseline = {
      ...scan,
      modules: [{ path: 'src/api.mjs', language: 'node' }, { path: 'src/gone.mjs', language: 'node' }],
    };
    return reconcile({ scan, declaredText: MAP_OF_ONE, committedBaseline });
  });

  assert.deepEqual(outcome.sections.drift.map((entry) => entry.id), ['modules removed: src/gone.mjs']);
});

// --- the whole outcome ----------------------------------------------------------------------------------------

test('a clean repo exits 0 and says so in one sentence', () => {
  const outcome = judge({ 'src/api.mjs': '' }, MAP_OF_ONE);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.findings, 0);
  assert.equal(outcome.verdict, 'clean');
});

test('every one of the seven sections appears in the report even when it is empty', () => {
  // An absent section reads as "nothing to say" when it means "never checked". docs/SPEC.md §3G.
  const outcome = judge({ 'src/api.mjs': '' }, MAP_OF_ONE);
  for (const heading of [
    'Pieces present in code the map does not name',
    'Edges present the map omits',
    'Env vars read that section 3 never lists',
    'Metered clients section 4 never prices',
    'Alert and log surfaces that vanished',
    'Drift since the committed baseline',
    'What this run could not see',
  ]) {
    assert.ok(outcome.report.includes(heading), heading);
  }
});

test('a piece the map names that no code path matched is reported as a limit, not as agreement', () => {
  const declared = ['## The map', '', '- **API** (`src/api.mjs`) — answers requests.', '- **Ghost** (`ghost/`) — does not exist.', ''].join('\n');
  const outcome = judge({ 'src/api.mjs': '' }, declared);

  assert.ok(outcome.limits.some((limit) => limit.includes('Ghost')), JSON.stringify(outcome.limits));
});

test('a declared bullet the parser could not read is carried into the report', () => {
  const declared = ['## The map', '', '- **API** (`src/api.mjs`) — fine.', '- ???', ''].join('\n');
  const outcome = judge({ 'src/api.mjs': '' }, declared);

  assert.ok(outcome.limits.some((limit) => limit.includes('???')), JSON.stringify(outcome.limits));
});

test('the report is deterministic for one input', () => {
  const files = { 'src/api.mjs': "import 'stripe';\nprocess.env.SK_EXAMPLE;\n", 'billing/charge.mjs': '' };
  assert.equal(judge(files, MAP_OF_ONE).report, judge(files, MAP_OF_ONE).report);
});

// --- I7: a hand-written map, matched the way a person wrote it ------------------------------------------
//
// The reviewer's case: 11 findings against this map on the demo fixture, of which 4 were false. All four
// were the tool failing to read a document that was right.

const PROSE_MAP = [
  '# Kiteline, as we understand it',
  '',
  '## How it hangs together',
  '',
  '- The front door is the API. It lives in `src/`.',
  '- The database layer, our store, sits in `store/`.',
  '- The Slack notifier. See `notify/slack.mjs`.',
  '- The nightly worker, in Python.',
  '- The billing module charges cards.',
  '- The API calls the store.',
  '- The worker talks to the store.',
  '- The API sends to the notifier.',
  '',
].join('\n');

test('a piece named only in a description matches the directory it describes', () => {
  const outcome = judge({ 'src/api.mjs': '', 'worker/run.py': '', 'billing/charge.mjs': '' }, PROSE_MAP);
  assert.deepEqual(ids(outcome, 'unnamedPieces'), []);
});

test('an edge whose endpoints carry articles is a declared edge', () => {
  const outcome = judge(
    { 'src/api.mjs': "import '../store/db.mjs';\nimport '../notify/slack.mjs';\n", 'store/db.mjs': '', 'notify/slack.mjs': '' },
    PROSE_MAP,
  );
  assert.deepEqual(ids(outcome, 'undeclaredEdges'), []);
});

test('the prose map still catches its own lie', () => {
  // The map says "we do not use OpenAI anywhere". Tolerance must not become credulity.
  const declared = [PROSE_MAP, '## Costs', '', '`stripe` bills per charge. We do not use OpenAI anywhere.', ''].join('\n');
  const outcome = judge({ 'src/api.mjs': "import 'stripe';\nimport 'openai';\n" }, declared);
  assert.deepEqual(ids(outcome, 'unpricedClients'), ['openai']);
});

test('tolerance does not make an unrelated word match a piece', () => {
  // "charges cards" must not match a `cards` directory that has nothing to do with it, and the stemming
  // must not collapse two real pieces into one.
  const outcome = judge({ 'src/api.mjs': '', 'cards/deck.mjs': '', 'charges/fee.mjs': '' }, PROSE_MAP);
  assert.deepEqual(ids(outcome, 'unnamedPieces').sort(), ['cards', 'charges']);
});
