// What counts as a piece, and what is not part of the system at all. docs/SPEC.md §4A rows D4 and D5.
//
// Both rules came out of a ship-check that ran the tool on real repos rather than on its fixture, and
// both are scoping decisions the first build simply never made:
//
//   D4  job-radar's `tests` directory was 48 of 80 modules, so `tests` was a piece with its own blast
//       radius, `tools → tests` was an architectural edge, and the first weekly reconcile would have
//       been dominated by test-file churn. Two of landed's three "environment variables" were `PATH`
//       read inside a test's env allowlist.
//
//   D5  a `packages/{api,worker,shared}` monorepo derived to ONE piece called `packages`, zero internal
//       edges, and a blast radius of "nothing in this repo imports it" for the whole system.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { scanRepo } from '../src/scan.mjs';
import { deriveDraft } from '../src/derive.mjs';
import { reconcile } from '../src/reconcile.mjs';
import { parseDeclared } from '../src/declared.mjs';
import { isTestPath } from '../src/walk.mjs';
import { piecesOf } from '../src/pieces.mjs';

const NOW = '2026-09-27T09:00:00.000Z';

function withRepo(files, body) {
  const root = mkdtempSync(join(tmpdir(), 'system-map-pieces-'));
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

const pieceNames = (root, options) => [...piecesOf(scanRepo(root, options)).keys()];

// --- D4: which paths are tests -------------------------------------------------------------------------

test('every documented test shape is recognised, and a lookalike is not', () => {
  for (const path of [
    'test/a.test.mjs',
    'tests/b.py',
    '__tests__/c.jsx',
    'src/thing.test.mjs',
    'src/thing.spec.ts',
    'engine/rules_test.py',
    'engine/test_rules.py',
    'spec/d.mjs',
    'packages/api/test/e.mjs',
  ]) {
    assert.equal(isTestPath(path), true, path);
  }

  for (const path of [
    'src/latest.mjs',
    'src/contest.mjs',
    'src/protest/a.mjs',
    'src/testify.mjs',
    'specs/openapi.mjs',
    'src/attestation.py',
  ]) {
    assert.equal(isTestPath(path), false, path);
  }
});

test('a test directory is not a piece, and the map says how many files it excluded', () => {
  withRepo({
    'src/api.mjs': "import './db.mjs';\n",
    'src/db.mjs': '',
    'test/api.test.mjs': "import '../src/api.mjs';\nprocess.env.PATH;\n",
    'test/db.test.mjs': "import '../src/db.mjs';\n",
  }, (root) => {
    assert.deepEqual(pieceNames(root), ['src']);

    const draft = deriveDraft(scanRepo(root), { now: NOW, repoName: basename(root) });
    assert.match(draft, /tests: 2 files, excluded from the map/);
    assert.match(draft, /--include-tests/);
  });
});

test('an env var read only in a test file is not reported', () => {
  // This is where landed's two "environment variables" came from: `PATH`, inside a test's env
  // allowlist. A key the system does not read is not a door.
  withRepo({ 'src/api.mjs': '', 'test/a.test.mjs': 'process.env.PATH;\nprocess.env.CI;\n' }, (root) => {
    assert.deepEqual(scanRepo(root).env.map((entry) => entry.name), []);
  });
});

test('a route declared only in a test file is not reported', () => {
  withRepo({ 'src/api.mjs': '', 'test/a.test.mjs': "app.get('/only-in-a-test', h);\n" }, (root) => {
    assert.deepEqual(scanRepo(root).routes, []);
  });
});

test('an env var read in BOTH a test and a source file is reported, cited at the source file', () => {
  withRepo({ 'src/api.mjs': '\nprocess.env.REAL_KEY;\n', 'test/a.test.mjs': 'process.env.REAL_KEY;\n' }, (root) => {
    const { env } = scanRepo(root);
    assert.deepEqual(env.map((entry) => `${entry.name} ${entry.cite}`), ['REAL_KEY src/api.mjs:2']);
  });
});

test('--include-tests puts them back, which is what makes the default a choice and not a blind spot', () => {
  withRepo({ 'src/api.mjs': '', 'test/a.test.mjs': 'process.env.PATH;\n' }, (root) => {
    assert.deepEqual(pieceNames(root, { includeTests: true }).sort(), ['src', 'test']);
    assert.deepEqual(scanRepo(root, { includeTests: true }).env.map((entry) => entry.name), ['PATH']);
  });
});

test('a test file is still counted, so "excluded" never means "unread"', () => {
  withRepo({ 'src/api.mjs': '', 'test/a.test.mjs': '', 'test/b.test.mjs': '' }, (root) => {
    const scan = scanRepo(root);
    assert.equal(scan.counts.testFiles, 2);
    assert.equal(scan.counts.modules, 1);
  });
});

test('a repo that is ONLY tests is not an empty repo, and says which it is', () => {
  // Otherwise excluding tests turns a test-only package into EMPTY_REPO, which is a different claim.
  withRepo({ 'test/a.test.mjs': '' }, (root) => {
    const scan = scanRepo(root);
    assert.equal(scan.counts.testFiles, 1);
    assert.ok(scan.gaps.some((gap) => gap.code === 'EMPTY_REPO'), 'still blocking');
    assert.match(scan.gaps.find((gap) => gap.code === 'EMPTY_REPO').detail, /only test files|--include-tests/);
  });
});

// --- D5: pieces descend one level when a directory holds only directories --------------------------------

test('a monorepo whose top level holds only directories splits into one piece per package', () => {
  withRepo({
    'package.json': JSON.stringify({ name: 'mono' }),
    'packages/api/src/index.mjs': "import { fmt } from '../../shared/src/fmt.mjs';\n",
    'packages/worker/src/index.mjs': "import { fmt } from '../../shared/src/fmt.mjs';\n",
    'packages/shared/src/fmt.mjs': 'export const fmt = () => {};\n',
  }, (root) => {
    assert.deepEqual(pieceNames(root).sort(), ['packages/api', 'packages/shared', 'packages/worker']);
  });
});

test('the monorepo’s internal edges are between packages, not inside one piece', () => {
  withRepo({
    'packages/api/src/index.mjs': "import { fmt } from '../../shared/src/fmt.mjs';\n",
    'packages/shared/src/fmt.mjs': '',
  }, (root) => {
    const draft = deriveDraft(scanRepo(root), { now: NOW, repoName: 'mono' });
    assert.match(draft, /packages\/api → packages\/shared/);
    assert.match(draft, /\*\*packages\/shared\*\* — 1 other piece imports it/);
  });
});

test('a directory holding files stays one piece, however many subdirectories it also has', () => {
  withRepo({ 'src/api.mjs': '', 'src/adapters/gh.mjs': '', 'src/adapters/n8n.mjs': '' }, (root) => {
    assert.deepEqual(pieceNames(root), ['src']);
  });
});

test('descent goes one level and no further', () => {
  // `a/b/c/d.mjs` with nothing else must not become a piece called `a/b/c`. One level is a scoping
  // decision; unlimited descent is just the directory tree again.
  withRepo({ 'a/b/c/d.mjs': '', 'a/b/c/e.mjs': '' }, (root) => {
    assert.deepEqual(pieceNames(root), ['a/b']);
  });
});

test('a file at the repo root is still its own piece', () => {
  withRepo({ 'index.mjs': '', 'src/a.mjs': '' }, (root) => {
    assert.deepEqual(pieceNames(root).sort(), ['index.mjs', 'src']);
  });
});

test('a top level of only directories where one is tests does not count tests as a package', () => {
  withRepo({ 'packages/api/src/a.mjs': '', 'test/a.test.mjs': '' }, (root) => {
    assert.deepEqual(pieceNames(root), ['packages/api']);
  });
});

// --- and the round trip survives both ---------------------------------------------------------------------

test('THE round trip holds on the monorepo', () => {
  withRepo({
    'package.json': JSON.stringify({ name: 'mono', dependencies: { stripe: '^14' } }),
    'packages/api/src/index.mjs': ["import Stripe from 'stripe';", "import { fmt } from '../../shared/src/fmt.mjs';", 'process.env.MONO_SECRET;', "console.error('x');", ''].join('\n'),
    'packages/shared/src/fmt.mjs': 'export const fmt = () => {};\n',
    'test/api.test.mjs': "import '../packages/api/src/index.mjs';\nprocess.env.PATH;\n",
  }, (root) => {
    const scan = scanRepo(root);
    const draft = deriveDraft(scan, { now: NOW, repoName: 'mono' });
    const outcome = reconcile({ scan, declaredText: draft, committedBaseline: scan, now: NOW });

    const shown = Object.entries(outcome.sections).filter(([, list]) => list.length > 0);
    assert.deepEqual(shown, []);
    assert.equal(outcome.exitCode, 0);

    const declared = parseDeclared(draft);
    assert.ok(declared.pieces.some((piece) => piece.name === 'packages/api'), JSON.stringify(declared.pieces.map((p) => p.name)));
  });
});
