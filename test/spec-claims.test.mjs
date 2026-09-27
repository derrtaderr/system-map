// The SPEC's tables, pinned to the code. docs/SPEC.md's own frontmatter has named this file since the
// first commit, and it did not exist — which a ship-check caught, and which is the smallest possible
// version of the failure this whole repo is about: a document claiming a reader that was never wired.
//
// It also fixes the second half of that finding. SPEC listed six blocking codes "exhaustively" while
// README and DESIGN listed seven, and fix wave 1 added an eighth. There is now ONE list, in
// src/gaps.mjs, and everything that enumerates gap codes is checked against it here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLOCKING_CODES, NOTED_CODES, ALL_GAP_CODES, isBlockingCode } from '../src/gaps.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const SPEC = read('docs/SPEC.md');
const DESIGN = read('docs/DESIGN.md');
const README = read('README.md');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

const sources = walk(join(ROOT, 'src')).filter((file) => file.endsWith('.mjs'));

// --- the one list ---------------------------------------------------------------------------------

test('the blocking list is the eight states fix wave 1 leaves behind', () => {
  assert.deepEqual([...BLOCKING_CODES].sort(), [
    'BASELINE_ABSENT',
    'BASELINE_SCHEMA_UNKNOWN',
    'EMPTY_REPO',
    'MANIFEST_UNPARSED',
    'SYSTEM_MD_ABSENT',
    'SYSTEM_MD_UNPARSEABLE',
    'UNREADABLE_DIR',
    'UNREADABLE_FILE',
  ]);
});

test('no code is both blocking and noted, and the union has no duplicate', () => {
  for (const code of BLOCKING_CODES) assert.ok(!NOTED_CODES.includes(code), code);
  assert.equal(new Set(ALL_GAP_CODES).size, ALL_GAP_CODES.length);
});

test('isBlockingCode agrees with the list, and refuses a code it has never heard of', () => {
  for (const code of BLOCKING_CODES) assert.equal(isBlockingCode(code), true, code);
  for (const code of NOTED_CODES) assert.equal(isBlockingCode(code), false, code);
  assert.throws(() => isBlockingCode('INVENTED_CODE'), /INVENTED_CODE/);
});

// --- every code the code emits is in the list, and the other way round ------------------------------

test('every gap code any source file emits is declared in src/gaps.mjs', () => {
  const emitted = new Set();
  for (const file of sources) {
    for (const match of readFileSync(file, 'utf8').matchAll(/code:\s*'([A-Z][A-Z0-9_]+)'/g)) emitted.add(match[1]);
  }

  assert.ok(emitted.size >= 8, `${emitted.size} codes found in src/`);
  for (const code of emitted) assert.ok(ALL_GAP_CODES.includes(code), `${code} is declared`);
});

test('every declared code is actually emitted somewhere, so the list is not aspirational', () => {
  const body = sources.map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const code of ALL_GAP_CODES) assert.match(body, new RegExp(`'${code}'`), code);
});

// --- and every document that enumerates them lists the same set --------------------------------------

test('SPEC, DESIGN and README each list all eight blocking codes', () => {
  for (const code of BLOCKING_CODES) {
    assert.ok(SPEC.includes(code), `SPEC names ${code}`);
    assert.ok(DESIGN.includes(code), `DESIGN names ${code}`);
    assert.ok(README.includes(code), `README names ${code}`);
  }
});

test('SPEC does not claim a count that contradicts the list', () => {
  // "six blocking codes, exhaustively" was true once and then was not. A claim about a number is a
  // claim the code can check.
  const stale = /\b(six|seven)\b[^.\n]{0,40}\bBLOCKING\b/i.exec(SPEC);
  assert.equal(stale, null, stale === null ? '' : `SPEC still says "${stale[0]}"`);
});

test('every file the SPEC frontmatter names as its reader exists', () => {
  // This file was named and absent, which is the failure the whole repo is about, in miniature.
  const frontmatter = SPEC.split('---')[1] ?? '';
  for (const match of frontmatter.matchAll(/([a-z0-9/_.-]+\.(?:mjs|md))/g)) {
    assert.doesNotThrow(() => read(match[1]), `${match[1]} exists`);
  }
});

test('the gate set the SPEC declares is the gate set package.json can run', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(SPEC.includes('npm test') && pkg.scripts.test, 'the suite');
  assert.ok(SPEC.includes('npm run privacy') && pkg.scripts.privacy, 'the privacy guard');
  assert.ok(SPEC.includes('demo --out'), 'the demo');
  assert.ok(SPEC.includes('test/readme.test.mjs'), 'the README claims test');
  assert.ok(SPEC.includes('test/syntax.test.mjs'), 'the parse gate');
});

test('the SPEC records every contract decision fix wave 1 made', () => {
  // The lane rule: a divergence or a contract decision is recorded with its reason, in §4.
  assert.match(SPEC, /### 4A\./, 'the fix-wave section exists');
  for (const marker of ['round trip is the contract', 'one constant', 'UNREADABLE_DIR']) {
    assert.ok(SPEC.includes(marker) || SPEC.toLowerCase().includes(marker.toLowerCase()), marker);
  }
});
