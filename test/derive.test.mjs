// `derive`. docs/SPEC.md §3F, and the architect skill's own rule: "every derived answer cites its
// source" and "a derived answer is a draft, not a decision".
//
// The first test in this file is the one that matters. Every other map generator in SPEC §1's
// prior-art list produces prose you have to trust. This one produces prose you can check, and the
// only way that claim survives a refactor is a test that walks every bullet in the output and
// demands a citation or an admission.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { scanRepo } from '../src/scan.mjs';
import { deriveDraft, ARCHITECT_HEADINGS } from '../src/derive.mjs';

const NOW = '2026-09-27T00:00:00.000Z';

function withRepo(files, body) {
  const root = mkdtempSync(join(tmpdir(), 'system-map-derive-'));
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

function draftFor(files) {
  return withRepo(files, (root) => deriveDraft(scanRepo(root), { now: NOW, repoName: 'demo' }));
}

function bullets(markdown) {
  return markdown.split('\n').filter((line) => line.startsWith('- '));
}

const A_REAL_REPO = {
  'package.json': JSON.stringify({ dependencies: { stripe: '^14', pg: '^8' } }),
  'src/api.mjs': [
    "import Stripe from 'stripe';",
    "import { query } from '../store/db.mjs';",
    "app.get('/health', handler);",
    "app.post('/charge', requireAuth, handler);",
    'const key = process.env.STRIPE_SECRET;',
    'const port = process.env.PORT;',
    "console.error('failed', error);",
    '',
  ].join('\n'),
  'store/db.mjs': ["import pg from 'pg';", 'const url = process.env.DATABASE_URL;', ''].join('\n'),
  'worker/run.py': ['import requests', "TOKEN = os.getenv('WORKER_TOKEN')", "crontab(hour=9, minute=0)", ''].join('\n'),
};

// --- the load-bearing test ---------------------------------------------------------------------------

// Every ANSWER line. The gap list at the end of the draft is the admission section, not a derived
// answer, so it is held to its own contract two tests below.
function answerBullets(markdown) {
  return ARCHITECT_HEADINGS.flatMap((heading) => bullets(sectionOf(markdown, heading)));
}

test('every answer in the draft either carries a file:line citation or is written as an Unknown', () => {
  const draft = draftFor(A_REAL_REPO);
  const offenders = answerBullets(draft).filter((line) => !/\([^()]+:\d+\)$/.test(line) && !line.startsWith('- Unknown:'));

  assert.deepEqual(offenders, []);
  assert.ok(answerBullets(draft).length >= 12, `${answerBullets(draft).length} answers`);
});

test('a repo with nothing in it produces Unknowns and no invented prose', () => {
  const draft = draftFor({ 'README.md': '# empty' });
  const rows = answerBullets(draft);

  assert.ok(rows.length > 0, 'it still answers all six questions');
  assert.deepEqual(rows.filter((line) => !line.startsWith('- Unknown:')), []);
});

test('the gap list names a tier and a code on every line, so an admission is never vague', () => {
  const draft = draftFor({ 'README.md': '# empty' });
  const rows = bullets(sectionOf(draft, 'What the scan could not see'));

  assert.ok(rows.length > 0, 'an empty repo has something to admit');
  for (const row of rows) assert.match(row, /^- `(BLOCKING|NOTED)` `[A-Z_]+` — /, row);
});

test('an empty repo derives the same bytes twice, with no scanned-directory name in the output', () => {
  // A temp directory's name is a non-deterministic token, and it buys the reader nothing.
  const first = draftFor({ 'README.md': '# empty' });
  const second = draftFor({ 'README.md': '# empty' });
  assert.equal(first, second);
});

// --- the shape ----------------------------------------------------------------------------------------

test('all six architect headings are present, in the skill’s order, and the admission comes last', () => {
  const draft = draftFor(A_REAL_REPO);
  const found = draft.split('\n').filter((line) => line.startsWith('## ')).map((line) => line.slice(3));
  assert.deepEqual(found, [...ARCHITECT_HEADINGS, 'What the scan could not see']);
});

test('the frontmatter marks it a draft and names its reader', () => {
  const draft = draftFor(A_REAL_REPO);
  assert.ok(draft.startsWith('---\n'), 'frontmatter first');
  assert.match(draft, /\nphase: architect\n/);
  assert.match(draft, /\nstatus: draft\n/);
  assert.match(draft, /\nread_by:/);
  assert.match(draft, /\nderived_by: system-map/);
});

test('the draft says out loud that it is a draft and not a decision', () => {
  // The architect skill's rule. A derived answer that reads as the user's decision is worse than
  // no answer, because the next reader will defend it.
  const draft = draftFor(A_REAL_REPO);
  assert.match(draft, /draft/i);
  assert.match(draft, /not a decision|confirm|correct/i);
});

// --- question 1, the map -------------------------------------------------------------------------------

test('the map names every code piece and the edges between them', () => {
  const draft = draftFor(A_REAL_REPO);
  const section = sectionOf(draft, ARCHITECT_HEADINGS[0]);

  for (const piece of ['src', 'store', 'worker']) assert.ok(section.includes(`**${piece}**`), piece);
  assert.ok(section.includes('src → store'), 'the internal edge');
  assert.ok(/stripe/.test(section), 'the external dependency is part of the map');
});

// --- question 2, state ----------------------------------------------------------------------------------

test('state names the store client and the connection variable, and admits the backup is unknowable', () => {
  const section = sectionOf(draftFor(A_REAL_REPO), ARCHITECT_HEADINGS[1]);

  assert.ok(section.includes('`pg`'), 'the client that holds data');
  assert.ok(section.includes('DATABASE_URL'), 'the variable that points at it');
  assert.match(section, /- Unknown:.*restored/i, 'a backup nobody has restored is a rumour, and no file can say');
});

// --- question 3, doors and keys ---------------------------------------------------------------------------

test('doors names every secret read and every check found, and separates keys from settings', () => {
  const section = sectionOf(draftFor(A_REAL_REPO), ARCHITECT_HEADINGS[2]);

  assert.ok(section.includes('STRIPE_SECRET'), 'the key');
  assert.ok(section.includes('WORKER_TOKEN'), 'the other key');
  assert.ok(section.includes('requireAuth'), 'the check');
  assert.ok(section.includes('PORT'), 'and the setting, labelled as one');
  assert.match(section, /configuration|setting/i);
});

test('a repo with routes and no check anywhere says so as an Unknown, not as a silence', () => {
  const section = sectionOf(draftFor({ 'src/api.mjs': "app.get('/admin', handler);\n" }), ARCHITECT_HEADINGS[2]);
  assert.match(section, /- Unknown:.*no authorization check/i);
});

// --- question 4, the bill -----------------------------------------------------------------------------------

test('the bill names each metered client with the reason it meters, plus every external host', () => {
  const section = sectionOf(draftFor(A_REAL_REPO), ARCHITECT_HEADINGS[3]);

  assert.ok(section.includes('`stripe`'), 'the metered client');
  assert.match(section, /settles real money|per API call/, 'and why it meters');
  assert.match(section, /- Unknown:.*cap/i, 'where the ceiling is set cannot be read from a repo');
});

test('a repo that bills for nothing says that, rather than leaving the section blank', () => {
  const section = sectionOf(draftFor({ 'src/a.mjs': "import pg from 'pg';\n" }), ARCHITECT_HEADINGS[3]);
  assert.match(section, /- Unknown:.*nothing/i);
});

// --- question 5, the 2am question ----------------------------------------------------------------------------

test('the 2am answer separates what records from what pushes, and names the health route', () => {
  const section = sectionOf(draftFor(A_REAL_REPO), ARCHITECT_HEADINGS[4]);

  assert.ok(section.includes('console.error'), 'the recording surface');
  assert.ok(section.includes('/health'), 'the health route');
  assert.ok(section.includes('crontab'), 'the schedule whose silence is itself a signal');
  assert.match(section, /- Unknown:.*push/i, 'nothing pushes, and that is the gap the skill asks about');
});

test('a repo that does push says so, and does not raise the pushing Unknown', () => {
  const section = sectionOf(
    draftFor({ 'src/a.mjs': "await fetch('https://hooks.slack.com/services/T0/B0/x');\n" }),
    ARCHITECT_HEADINGS[4],
  );

  assert.ok(section.includes('hooks.slack.com'));
  assert.ok(!/- Unknown:.*nothing in the code pushes/i.test(section), section);
});

// --- question 6, blast radius ----------------------------------------------------------------------------------

test('blast radius counts what depends on each piece, and says when nothing does', () => {
  const section = sectionOf(draftFor(A_REAL_REPO), ARCHITECT_HEADINGS[5]);

  assert.match(section, /\*\*store\*\*.*1 (?:other )?piece/i, 'store is imported by src');
  assert.match(section, /\*\*worker\*\*.*nothing/i, 'and nothing imports the worker');
});

// --- determinism ---------------------------------------------------------------------------------------------------

test('the same repo derives the same bytes', () => {
  assert.equal(draftFor(A_REAL_REPO), draftFor(A_REAL_REPO));
});

test('the draft carries no absolute path', () => {
  const draft = draftFor(A_REAL_REPO);
  assert.ok(!/\/Users\/|\/home\/|\/var\/folders\//.test(draft));
});

function sectionOf(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  assert.ok(start !== -1, `heading present: ${heading}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}
