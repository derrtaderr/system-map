// The minor findings from the ship-check. Each one is small, and each one is a place where the tool
// asserts something the cited line does not show, or drops something SPEC says it never drops.
// docs/SPEC.md §4A rows M6 to M9.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { scanRepo } from '../src/scan.mjs';
import { deriveDraft } from '../src/derive.mjs';
import { reconcile } from '../src/reconcile.mjs';
import { extractEdges } from '../src/extract/edges.mjs';
import { extractRoutes } from '../src/extract/routes.mjs';
import { computeDelta } from '../src/delta.mjs';

const NOW = '2026-09-27T09:00:00.000Z';

function withRepo(files, body) {
  const root = mkdtempSync(join(tmpdir(), 'system-map-minor-'));
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

const gapCodes = (baseline) => baseline.gaps.map((gap) => gap.code);

// --- M6: a symlink out of the repo, and a file too big to be source ---------------------------------

test('a symlink resolving outside the repo is skipped with a NOTED gap naming it', () => {
  // The scan read `src/passwd.mjs → /etc/passwd` and listed it as a module. A file outside the repo is
  // not part of the repo, whatever a link inside it says.
  withRepo({ 'src/a.mjs': '' }, (root) => {
    symlinkSync('/etc/hosts', join(root, 'src/outside.mjs'));

    const baseline = scanRepo(root);
    assert.deepEqual(baseline.modules.map((module) => module.path), ['src/a.mjs']);
    assert.ok(gapCodes(baseline).includes('SYMLINK_OUTSIDE_REPO'), JSON.stringify(gapCodes(baseline)));
    assert.equal(baseline.gaps.find((gap) => gap.code === 'SYMLINK_OUTSIDE_REPO').tier, 'NOTED');
  });
});

test('a symlink INSIDE the repo is followed, because that is an ordinary repo layout', () => {
  withRepo({ 'src/a.mjs': '', 'src/real.mjs': '' }, (root) => {
    symlinkSync(join(root, 'src/real.mjs'), join(root, 'src/link.mjs'));
    assert.deepEqual(scanRepo(root).modules.map((module) => module.path).sort(), ['src/a.mjs', 'src/link.mjs', 'src/real.mjs']);
  });
});

test('a file over the size ceiling is skipped with a NOTED gap naming it', () => {
  // A 21.7 MB minified bundle outside `dist/` became a module, a piece, and a 3.4 second scan.
  withRepo({ 'src/a.mjs': '', 'src/huge.mjs': `// ${'x'.repeat(2 * 1024 * 1024 + 10)}\n` }, (root) => {
    const baseline = scanRepo(root);
    assert.deepEqual(baseline.modules.map((module) => module.path), ['src/a.mjs']);

    const gap = baseline.gaps.find((entry) => entry.code === 'FILE_TOO_LARGE');
    assert.ok(gap !== undefined, JSON.stringify(gapCodes(baseline)));
    assert.equal(gap.tier, 'NOTED');
    assert.match(gap.detail, /src\/huge\.mjs|2 MB|bytes/);
  });
});

// --- M7: three Python and framework gaps ----------------------------------------------------------------

test('importlib.import_module with a literal is an edge', () => {
  const { edges } = extractEdges('engine/load.py', 'mod = importlib.import_module("engine.rules")\n');
  assert.deepEqual(edges.map((edge) => `${edge.kind} ${edge.specifier}`), ['python-import engine.rules']);
});

test('importlib.import_module with a computed name is a NOTED gap, never dropped', () => {
  // SPEC §3C says a dynamic import is noted, never dropped. This one was dropped.
  const { edges, gaps } = extractEdges('engine/load.py', 'mod = importlib.import_module(name)\n');
  assert.deepEqual(edges, []);
  assert.deepEqual(gaps.map((gap) => `${gap.tier} ${gap.code}`), ['NOTED DYNAMIC_IMPORT_MODULE']);
});

test('an import under if TYPE_CHECKING is tagged type-only, like Node’s import type', () => {
  const text = ['from typing import TYPE_CHECKING', '', 'if TYPE_CHECKING:', '    from .rules import Rule', ''].join('\n');
  const { edges } = extractEdges('engine/score.py', text);
  const rule = edges.find((edge) => edge.specifier === '.rules');
  assert.equal(rule.kind, 'python-import-type');
});

test('a type-only edge is excluded from blast radius, because nothing imports it at runtime', () => {
  withRepo({
    'engine/score.py': ['from typing import TYPE_CHECKING', '', 'if TYPE_CHECKING:', '    from .rules import Rule', ''].join('\n'),
    'engine/rules.py': '',
    'other/use.py': 'from engine.score import run\n',
  }, (root) => {
    const draft = deriveDraft(scanRepo(root), { now: NOW, repoName: 'x' });
    assert.match(draft, /\*\*engine\*\* — 1 other piece imports it/);
  });
});

test('a FastAPI router prefix is prepended to the route path', () => {
  const text = ['router = APIRouter(prefix="/api/v2")', '', '@router.get("/leads")', 'def leads():', '    pass', ''].join('\n');
  assert.deepEqual(extractRoutes('worker/api.py', text).routes.map((route) => `${route.method} ${route.path}`), ['GET /api/v2/leads']);
});

test('a router with no prefix is unchanged', () => {
  const text = ['router = APIRouter()', '', '@router.get("/leads")', ''].join('\n');
  assert.deepEqual(extractRoutes('worker/api.py', text).routes.map((route) => route.path), ['/leads']);
});

// --- M8: a registry note is attributed to the registry ------------------------------------------------------

test('a registry note is labelled as the registry’s claim, not as something the cited line shows', () => {
  // The cited line shows an IMPORT. "charges per API call and settles real money" is a claim from
  // src/registry.mjs, and printing it at the import citation made the citation look like its evidence.
  withRepo({ 'src/pay.mjs': "import Stripe from 'stripe';\n" }, (root) => {
    const draft = deriveDraft(scanRepo(root), { now: NOW, repoName: 'x' });
    assert.match(draft, /registry: charges per API call/);
  });
});

test('the same attribution appears in a reconcile finding', () => {
  withRepo({ 'src/pay.mjs': "import OpenAI from 'openai';\n" }, (root) => {
    const scan = scanRepo(root);
    const declared = ['## 1. The map', '', '- **src** (`src/pay.mjs`) — pays.', '', '## 4. The bill', '', 'Nothing charges.', ''].join('\n');
    const outcome = reconcile({ scan, declaredText: declared, committedBaseline: scan, now: NOW });

    assert.match(outcome.sections.unpricedClients[0].detail, /registry: billed per token/);
  });
});

// --- M9: a rename is one row -------------------------------------------------------------------------------------

test('a renamed module is ONE drift row, not four', () => {
  // Module added, module removed, edge added, edge removed: four rows for one rename, on a report whose
  // whole value is that a reader finishes it.
  const before = {
    modules: [{ path: 'src/old.mjs', contentHash: 'aaa' }, { path: 'src/keep.mjs', contentHash: 'bbb' }],
  };
  const after = {
    modules: [{ path: 'src/new.mjs', contentHash: 'aaa' }, { path: 'src/keep.mjs', contentHash: 'bbb' }],
  };

  const delta = computeDelta(before, after);
  assert.deepEqual(delta.modules.renamed.map((entry) => entry.id), ['renamed src/old.mjs → src/new.mjs']);
  assert.deepEqual(delta.modules.added, []);
  assert.deepEqual(delta.modules.removed, []);
  assert.equal(delta.count, 1);
});

test('two files with the same content are not a rename when both still exist', () => {
  const before = { modules: [{ path: 'a.mjs', contentHash: 'x' }] };
  const after = { modules: [{ path: 'a.mjs', contentHash: 'x' }, { path: 'b.mjs', contentHash: 'x' }] };

  const delta = computeDelta(before, after);
  assert.deepEqual(delta.modules.renamed, []);
  assert.deepEqual(delta.modules.added.map((entry) => entry.id), ['b.mjs']);
});

test('a module whose content changed is not a rename', () => {
  const before = { modules: [{ path: 'src/a.mjs', contentHash: 'x' }] };
  const after = { modules: [{ path: 'src/b.mjs', contentHash: 'y' }] };

  const delta = computeDelta(before, after);
  assert.deepEqual(delta.modules.renamed, []);
  assert.deepEqual(delta.modules.added.map((entry) => entry.id), ['src/b.mjs']);
  assert.deepEqual(delta.modules.removed.map((entry) => entry.id), ['src/a.mjs']);
});

test('the rename row reaches the report', () => {
  withRepo({ 'src/a.mjs': "export const x = 1;\n" }, (root) => {
    const scan = scanRepo(root);
    const committed = {
      ...scan,
      modules: scan.modules.map((module) => ({ ...module, path: 'src/was.mjs', cite: 'src/was.mjs:1' })),
    };
    const declared = ['## 1. The map', '', '- **src** (`src/a.mjs`) — it.', ''].join('\n');
    const outcome = reconcile({ scan, declaredText: declared, committedBaseline: committed, now: NOW });

    assert.ok(outcome.report.includes('renamed src/was.mjs → src/a.mjs'), outcome.report);
  });
});
