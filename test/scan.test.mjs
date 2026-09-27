// The scan: the walk over a real repo on disk, edge resolution, and the assembled baseline.
// docs/SPEC.md §3A, §3B, §3I.
//
// Everything above this file works on a string. This is where the tool meets a filesystem, so
// this is where the two BLOCKING gaps that are about READING rather than parsing live:
// UNREADABLE_FILE and EMPTY_REPO.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { scanRepo, BASELINE_SCHEMA } from '../src/scan.mjs';

// A repo from a map of relative path to contents. Written to a real temp directory, because the
// point of this file is that the walk works against a filesystem.
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'system-map-scan-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

function withRepo(files, body) {
  const root = repo(files);
  try {
    return body(root);
  } finally {
    cleanup(root);
  }
}

function edgeRows(baseline) {
  return baseline.edges.map((edge) => `${edge.from} -> ${edge.to ?? `[${edge.specifier}]`} ${edge.external ? 'external' : 'internal'}`);
}

function gapRows(baseline) {
  return baseline.gaps.map((gap) => `${gap.tier} ${gap.code} ${gap.path}`);
}

// --- the walk -----------------------------------------------------------------------------------

test('every code file is a module, and its language is recorded', () => {
  withRepo({ 'src/a.mjs': '', 'worker/run.py': '', 'README.md': '# hi' }, (root) => {
    const baseline = scanRepo(root);
    assert.deepEqual(
      baseline.modules.map((module) => `${module.path} ${module.language}`),
      ['src/a.mjs node', 'worker/run.py python'],
    );
  });
});

test('ignored directories are not walked, so a dependency tree is never the system', () => {
  withRepo({
    'src/a.mjs': '',
    'node_modules/left-pad/index.js': '',
    '.venv/lib/site-packages/x.py': '',
    'dist/bundle.js': '',
    '__pycache__/a.cpython-311.pyc': '',
  }, (root) => {
    assert.deepEqual(scanRepo(root).modules.map((module) => module.path), ['src/a.mjs']);
  });
});

test('the baseline carries no absolute path anywhere, so it is safe to commit', () => {
  withRepo({ 'src/a.mjs': "import './b.mjs';\n", 'src/b.mjs': '' }, (root) => {
    const serialised = JSON.stringify(scanRepo(root));
    assert.ok(!serialised.includes(root), 'the temp root does not appear in the baseline');
    assert.ok(!/\/Users\/|\/home\/|\/var\/folders\//.test(serialised), serialised.slice(0, 200));
  });
});

test('the baseline names its schema, so a future version can refuse an old file', () => {
  withRepo({ 'src/a.mjs': '' }, (root) => {
    assert.equal(scanRepo(root).schema, BASELINE_SCHEMA);
  });
});

test('the baseline carries no timestamp, because a timestamp would make every diff dirty', () => {
  withRepo({ 'src/a.mjs': '' }, (root) => {
    const first = JSON.stringify(scanRepo(root));
    const second = JSON.stringify(scanRepo(root));
    assert.equal(first, second);
    assert.ok(!/generated_at|scanned_at/.test(first));
  });
});

// --- the two BLOCKING gaps that are about reading -----------------------------------------------

test('a repo with no code at all is a BLOCKING EMPTY_REPO, never a clean scan', () => {
  // False-green row 1. Zero modules is the state where everything downstream looks agreed.
  withRepo({ 'README.md': '# nothing here' }, (root) => {
    const baseline = scanRepo(root);
    assert.deepEqual(baseline.modules, []);
    assert.deepEqual(gapRows(baseline), ['BLOCKING EMPTY_REPO .']);
  });
});

test('a file that cannot be read is a BLOCKING UNREADABLE_FILE naming the file', () => {
  // False-green row 2. An unread file is not an empty file.
  withRepo({ 'src/a.mjs': "import './b.mjs';\n", 'src/locked.mjs': 'import "stripe";\n' }, (root) => {
    const locked = join(root, 'src/locked.mjs');
    chmodSync(locked, 0o000);
    try {
      const baseline = scanRepo(root);
      assert.deepEqual(gapRows(baseline).filter((row) => row.includes('UNREADABLE')), ['BLOCKING UNREADABLE_FILE src/locked.mjs']);
      // And the module is still listed, because the file exists whether or not we could open it.
      assert.ok(baseline.modules.some((module) => module.path === 'src/locked.mjs'));
    } finally {
      chmodSync(locked, 0o644);
    }
  });
});

// --- edge resolution ------------------------------------------------------------------------------

test('a relative node specifier resolves to the module it names', () => {
  withRepo({ 'src/a.mjs': "import './b.mjs';\n", 'src/b.mjs': '' }, (root) => {
    assert.deepEqual(edgeRows(scanRepo(root)), ['src/a.mjs -> src/b.mjs internal']);
  });
});

test('an extensionless specifier resolves by trying the extensions node would try', () => {
  withRepo({ 'src/a.mjs': "import './b';\n", 'src/b.mjs': '' }, (root) => {
    assert.deepEqual(edgeRows(scanRepo(root)), ['src/a.mjs -> src/b.mjs internal']);
  });
});

test('a .js specifier resolves to the .ts file TypeScript compiled it from', () => {
  // Not a nicety. TS projects import './x.js' and ship './x.ts', so without this every
  // TypeScript repo reports a wall of unresolved specifiers and the map loses its internal edges.
  withRepo({ 'src/a.ts': "import './b.js';\n", 'src/b.ts': '' }, (root) => {
    assert.deepEqual(edgeRows(scanRepo(root)), ['src/a.ts -> src/b.ts internal']);
  });
});

test('a directory specifier resolves to its index file', () => {
  withRepo({ 'src/a.mjs': "import './sub';\n", 'src/sub/index.mjs': '' }, (root) => {
    assert.deepEqual(edgeRows(scanRepo(root)), ['src/a.mjs -> src/sub/index.mjs internal']);
  });
});

test('a parent-directory specifier resolves upward', () => {
  withRepo({ 'src/deep/a.mjs': "import '../b.mjs';\n", 'src/b.mjs': '' }, (root) => {
    assert.deepEqual(edgeRows(scanRepo(root)), ['src/deep/a.mjs -> src/b.mjs internal']);
  });
});

test('a bare specifier is an external edge, kept because it is what the bill is made of', () => {
  withRepo({ 'src/a.mjs': "import Stripe from 'stripe';\n" }, (root) => {
    assert.deepEqual(edgeRows(scanRepo(root)), ['src/a.mjs -> [stripe] external']);
  });
});

test('a node builtin is an external edge and is labelled a builtin', () => {
  withRepo({ 'src/a.mjs': "import { join } from 'node:path';\nimport fs from 'fs';\n" }, (root) => {
    const baseline = scanRepo(root);
    assert.deepEqual(baseline.edges.map((edge) => `${edge.specifier} ${edge.builtin}`), ['node:path true', 'fs true']);
  });
});

test('a relative specifier that resolves to nothing is a NOTED gap, not an invented module', () => {
  withRepo({ 'src/a.mjs': "import './gone.mjs';\n" }, (root) => {
    const baseline = scanRepo(root);
    assert.deepEqual(gapRows(baseline).filter((row) => row.includes('UNRESOLVED')), ['NOTED UNRESOLVED_SPECIFIER src/a.mjs']);
    assert.equal(baseline.edges[0].to, null);
  });
});

test('a relative python import resolves against the importing file’s directory', () => {
  withRepo({ 'worker/run.py': 'from .rules import score\n', 'worker/rules.py': '' }, (root) => {
    assert.deepEqual(edgeRows(scanRepo(root)), ['worker/run.py -> worker/rules.py internal']);
  });
});

test('a relative python package import resolves to its __init__', () => {
  withRepo({ 'worker/run.py': 'from .engine import score\n', 'worker/engine/__init__.py': '' }, (root) => {
    assert.deepEqual(edgeRows(scanRepo(root)), ['worker/run.py -> worker/engine/__init__.py internal']);
  });
});

test('an absolute python import resolves against the repo root when a file answers to it', () => {
  withRepo({ 'worker/run.py': 'from engine.scoring import rank\n', 'engine/scoring.py': '' }, (root) => {
    assert.deepEqual(edgeRows(scanRepo(root)), ['worker/run.py -> engine/scoring.py internal']);
  });
});

test('a python stdlib import is external and is not called a missing module', () => {
  withRepo({ 'worker/run.py': 'import os\nimport json\n' }, (root) => {
    const baseline = scanRepo(root);
    assert.deepEqual(edgeRows(baseline), ['worker/run.py -> [os] external', 'worker/run.py -> [json] external']);
    assert.deepEqual(gapRows(baseline).filter((row) => row.includes('UNRESOLVED')), []);
  });
});

// --- assembly -------------------------------------------------------------------------------------

test('the scan assembles every extractor’s output under its own key, with counts', () => {
  withRepo({
    'package.json': JSON.stringify({ dependencies: { stripe: '^14' }, scripts: { start: 'node src/api.mjs' } }),
    'src/api.mjs': [
      "import Stripe from 'stripe';",
      "app.get('/health', handler);",
      'const key = process.env.STRIPE_KEY;',
      "console.error('boom');",
      "app.post('/score', requireAuth, handler);",
      "setInterval(sweep, 60000);",
      "await fetch('https://api.example.com/x');",
      '',
    ].join('\n'),
  }, (root) => {
    const baseline = scanRepo(root);

    assert.deepEqual(baseline.manifests.map((manifest) => manifest.kind), ['package.json']);
    assert.deepEqual(baseline.env.map((entry) => entry.name), ['STRIPE_KEY']);
    assert.deepEqual(baseline.routes.map((route) => `${route.method} ${route.path}`), ['GET /health', 'POST /score']);
    assert.deepEqual(baseline.clients.map((client) => client.name), ['stripe']);
    assert.deepEqual(baseline.hosts.map((host) => host.host), ['api.example.com']);
    assert.deepEqual(baseline.schedules.map((entry) => entry.kind), ['setInterval']);
    assert.deepEqual(baseline.observability.map((entry) => `${entry.kind} ${entry.name}`), ['records console.error']);
    assert.deepEqual(baseline.authChecks.map((check) => check.name), ['requireAuth']);

    assert.equal(baseline.counts.modules, 1);
    assert.equal(baseline.counts.routes, 2);
    assert.equal(baseline.counts.clients, 1);
  });
});

test('every list in the baseline is sorted by path, so two machines produce one file', () => {
  withRepo({ 'src/z.mjs': 'process.env.Z;\n', 'src/a.mjs': 'process.env.A;\n' }, (root) => {
    const baseline = scanRepo(root);
    assert.deepEqual(baseline.modules.map((module) => module.path), ['src/a.mjs', 'src/z.mjs']);
    assert.deepEqual(baseline.env.map((entry) => entry.cite), ['src/a.mjs:1', 'src/z.mjs:1']);
  });
});

test('a .env.example contributes its keys, and a real .env is never opened', () => {
  withRepo({ 'src/a.mjs': '', '.env.example': 'SK_EXAMPLE=\n', '.env': 'LIVE=secretvalue\n' }, (root) => {
    const baseline = scanRepo(root);
    assert.deepEqual(baseline.env.map((entry) => entry.name), ['SK_EXAMPLE']);
    assert.ok(!JSON.stringify(baseline).includes('secretvalue'));
    assert.ok(!JSON.stringify(baseline).includes('LIVE'));
  });
});

test('a queue client is reachable through its category, which is how the report finds it', () => {
  withRepo({ 'src/q.mjs': "import { Queue } from 'bullmq';\n" }, (root) => {
    const [client] = scanRepo(root).clients;
    assert.ok(client.categories.includes('queue'));
  });
});
