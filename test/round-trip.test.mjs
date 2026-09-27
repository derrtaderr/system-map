// THE round trip. This is the contract, and until this file existed the tool did not honour it.
//
//   derive  →  save the draft UNEDITED as .vibecodepm/system.md  →  scan  →  reconcile
//   must be exit 0, zero findings, on the UNCHANGED repo.
//
// It is the happy path `.vibecodepm/flow.md` promises, and it failed on the tool's own fixture with
// exit 1 and 10 false findings: every piece "unnamed", every metered client "unpriced", and three
// schedules reported as vanished alert surfaces. Three independent defects, none covered by a test,
// each of them a place where `derive` writes one vocabulary and `declared` reads another.
//
// The structural fix is that both ends now read ONE constant. A test at the bottom of this file
// asserts every heading derive emits classifies to the section the parser expects, so the two halves
// cannot drift apart again without a red suite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../src/scan.mjs';
import { deriveDraft } from '../src/derive.mjs';
import { reconcile } from '../src/reconcile.mjs';
import { parseDeclared } from '../src/declared.mjs';
import { ARCHITECT_HEADINGS, SECTION_OF_HEADING } from '../src/headings.mjs';
import { SECTION_KEYS } from '../src/declared.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-09-27T09:00:00.000Z';

// The whole loop, exactly as flow.md describes it and with nothing edited in between.
function roundTrip(root) {
  const scan = scanRepo(root);
  const draft = deriveDraft(scan, { now: NOW, repoName: basename(root) });
  const outcome = reconcile({ scan, declaredText: draft, committedBaseline: scan, now: NOW });
  return { scan, draft, outcome, declared: parseDeclared(draft) };
}

function withRepo(files, body) {
  const root = mkdtempSync(join(tmpdir(), 'system-map-rt-'));
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

function findings(outcome) {
  return Object.entries(outcome.sections)
    .filter(([, list]) => list.length > 0)
    .map(([key, list]) => `${key}: ${list.map((finding) => finding.id).join(', ')}`);
}

// --- the contract, on the repo's own fixture -------------------------------------------------------

test('THE round trip: derive, save unedited, reconcile the unchanged fixture — exit 0, zero findings', () => {
  const { outcome } = roundTrip(join(ROOT, 'fixtures/demo-repo'));

  assert.deepEqual(findings(outcome), [], 'a draft the tool wrote must reconcile clean against the code it was derived from');
  assert.equal(outcome.findings, 0);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.verdict, 'clean');
});

test('the round trip reads the draft’s own map, not its title', () => {
  // B1. The draft's H1 `# System map, derived` matched the map keyword and claimed the section, so
  // `## 1. The map` was dropped as a duplicate and every piece came back unnamed.
  const { declared, scan } = roundTrip(join(ROOT, 'fixtures/demo-repo'));

  assert.match(declared.sections.map.heading, /^1\. The map$/);
  assert.ok(declared.pieces.length >= 5, `${declared.pieces.length} pieces parsed`);
  assert.ok(declared.edges.length >= 1, `${declared.edges.length} edges parsed`);
  assert.ok(scan.modules.length > 0, 'and the scan found code to compare them against');
});

test('the round trip finds the bill section derive actually writes', () => {
  // B2. `## 4. What bills per use` did not match a pattern looking for the word "bill".
  const { declared } = roundTrip(join(ROOT, 'fixtures/demo-repo'));

  assert.match(declared.sections.bill.heading, /^4\. What bills per use$/);
  assert.ok(declared.bill.names.length >= 1, JSON.stringify(declared.bill.names));
});

test('a schedule derive wrote into section 5 is not reported as a vanished surface', () => {
  // B3. derive writes `crontab`, `github-actions` and `setInterval` into the 2am answer;
  // vanishedSurfaces checked section-5 tokens against observability, clients and routes only.
  const { outcome, scan } = roundTrip(join(ROOT, 'fixtures/demo-repo'));

  assert.ok(scan.schedules.length >= 3, 'the fixture does schedule work');
  assert.deepEqual(outcome.sections.vanishedSurfaces, []);
});

test('every one of the six sections is found in the tool’s own draft', () => {
  const { declared } = roundTrip(join(ROOT, 'fixtures/demo-repo'));
  assert.deepEqual([...declared.sectionsFound].sort(), [...SECTION_KEYS].sort());
});

test('the round trip leaves no limit claiming a section is missing', () => {
  // The limits list is where "the declared document has no section this parser recognised" lands.
  // On the tool's own output that sentence is always a parser bug.
  const { outcome } = roundTrip(join(ROOT, 'fixtures/demo-repo'));
  assert.deepEqual(outcome.limits.filter((limit) => limit.includes('no section this parser recognised')), []);
});

// --- the same contract on a repo whose directories are named nothing like the fixture's ------------

const SECOND_FIXTURE = {
  'package.json': JSON.stringify({ name: 'quarry', dependencies: { stripe: '^14', pino: '^8' } }),
  'gateway/serve.mjs': [
    "import Stripe from 'stripe';",
    "import { persist } from '../vault/rows.mjs';",
    "import { page } from '../paging/duty.mjs';",
    "app.get('/healthz', handler);",
    'const key = process.env.QUARRY_SECRET;',
    "console.error('failed');",
    '',
  ].join('\n'),
  'vault/rows.mjs': ["import pg from 'pg';", 'const dsn = process.env.DATABASE_URL;', ''].join('\n'),
  'paging/duty.mjs': ["await fetch('https://hooks.slack.com/services/T0/B0/x');", ''].join('\n'),
  'crunch/nightly.py': ['import logging', "import os", "SCHEDULE = '0 4 * * *'", "TOKEN = os.getenv('CRUNCH_TOKEN')", ''].join('\n'),
};

test('THE round trip on a second repo, different directory names — exit 0, zero findings', () => {
  withRepo(SECOND_FIXTURE, (root) => {
    const { outcome, declared } = roundTrip(root);

    assert.deepEqual(findings(outcome), []);
    assert.equal(outcome.exitCode, 0);
    assert.ok(declared.pieces.length >= 4, `${declared.pieces.length} pieces`);
  });
});

test('THE round trip on a single-file repo at the root', () => {
  withRepo({ 'index.mjs': "process.env.ONLY_KEY;\nconsole.error('x');\n" }, (root) => {
    const { outcome } = roundTrip(root);
    assert.deepEqual(findings(outcome), []);
    assert.equal(outcome.exitCode, 0);
  });
});

test('THE round trip on a Python-only repo', () => {
  withRepo({
    'requirements.txt': 'requests\nstructlog\n',
    'ingest/pull.py': ['import requests', 'import os', "KEY = os.environ['INGEST_KEY']", "logging.error('x')", ''].join('\n'),
    'ingest/shape.py': ['from .pull import fetch_rows', ''].join('\n'),
  }, (root) => {
    const { outcome } = roundTrip(root);
    assert.deepEqual(findings(outcome), []);
    assert.equal(outcome.exitCode, 0);
  });
});

// --- and the round trip still notices a real change -------------------------------------------------

test('the round trip is not vacuous: a piece added after the draft IS a finding', () => {
  // Without this, every assertion above would be satisfied by a reconcile that finds nothing ever.
  withRepo(SECOND_FIXTURE, (root) => {
    const scan = scanRepo(root);
    const draft = deriveDraft(scan, { now: NOW, repoName: basename(root) });

    mkdirSync(join(root, 'billing'), { recursive: true });
    writeFileSync(join(root, 'billing/charge.mjs'), "import OpenAI from 'openai';\n");
    const after = scanRepo(root);

    const outcome = reconcile({ scan: after, declaredText: draft, committedBaseline: scan, now: NOW });
    assert.ok(outcome.sections.unnamedPieces.some((finding) => finding.id === 'billing'), JSON.stringify(findings(outcome)));
    assert.ok(outcome.sections.unpricedClients.some((finding) => finding.id === 'openai'));
    assert.equal(outcome.exitCode, 1);
  });
});

// --- the structural fix: one constant, read by both ends ----------------------------------------------

test('every heading derive emits classifies to the section the parser expects', () => {
  // This is the test that keeps B1 and B2 from coming back. The two halves of the round trip read
  // ONE table, and a heading changed on either side without the other fails here.
  assert.deepEqual(
    ARCHITECT_HEADINGS.map((heading) => SECTION_OF_HEADING.get(heading)),
    ['map', 'state', 'doors', 'bill', 'watch', 'blast'],
  );
  assert.equal(SECTION_OF_HEADING.size, ARCHITECT_HEADINGS.length);
});

test('a canonical heading beats a keyword match elsewhere in the document', () => {
  const text = [
    '# System map, derived',
    '',
    'prose that mentions the bill and the map',
    '',
    '## 1. The map',
    '',
    '- **API** (`src/api.mjs`) — answers requests.',
    '',
    '## 4. What bills per use',
    '',
    '`stripe` charges.',
    '',
  ].join('\n');

  const declared = parseDeclared(text);
  assert.equal(declared.sections.map.heading, '1. The map');
  assert.equal(declared.sections.bill.heading, '4. What bills per use');
  assert.deepEqual(declared.pieces.map((piece) => piece.name), ['API']);
});

test('a level-1 heading is still a section when no deeper heading claims that key', () => {
  // The hand-written case must keep working. `# How it hangs together` is somebody's whole map.
  const declared = parseDeclared(['# How it hangs together', '', '- **App** (`src/app.mjs`) — everything.', ''].join('\n'));
  assert.ok(declared.sections.map !== null);
  assert.deepEqual(declared.pieces.map((piece) => piece.name), ['App']);
});
