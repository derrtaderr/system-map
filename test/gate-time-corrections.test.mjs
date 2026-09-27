// Corrections made at gate time by the orchestrator after the second ship-check pass (BLESS with
// N1-N5 on record plus one advocate finding). Each test was red against a134bea before its fix.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveEdge } from '../src/resolve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'system-map.mjs');

function sandbox(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'system-map-gate-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}
function run(argv, { cwd }) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...argv], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH } });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}
function withSandbox(files, body) {
  const root = sandbox(files);
  try { return body(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

const REPO = {
  'package.json': '{"name":"gate","type":"module","dependencies":{}}',
  'src/a.mjs': 'import { b } from "./b.mjs";\nexport const a = b;\n',
  'src/b.mjs': 'export const b = 1;\n',
  'test/a.test.mjs': 'import { a } from "../src/a.mjs";\nprocess.env.PATH;\n',
};

// N1. The flag every draft tells the user to pass must exist on every verb that scans.
test('N1: --include-tests is accepted by scan, derive and reconcile, and it includes the tests', () => {
  withSandbox(REPO, (root) => {
    assert.equal(run(['scan', '.', '--include-tests'], { cwd: root }).code, 0);
    const d = run(['derive', '.', '--include-tests', '--out', 'draft.md'], { cwd: root });
    assert.equal(d.code, 0);
    const draft = readFileSync(join(root, 'draft.md'), 'utf8');
    assert.match(draft, /\*\*test\*\*/, 'with the flag, test is a piece');
    assert.doesNotMatch(draft, /excluded from the map/);
    mkdirSync(join(root, '.vibecodepm'), { recursive: true });
    writeFileSync(join(root, '.vibecodepm', 'system.md'), draft);
    assert.notEqual(run(['reconcile', '.', '--include-tests'], { cwd: root }).code, 2);
  });
});

// N2. A symlink to a directory inside the repo is walked once, never sixteen times.
test('N2: a symlinked directory loop inside the repo is walked once and noted, not descended until ELOOP', () => {
  withSandbox(REPO, (root) => {
    symlinkSync(join(root, 'src'), join(root, 'src', 'loop'));
    const r = run(['scan', '.', '--out', 'b.json'], { cwd: root });
    assert.equal(r.code, 0, r.stderr);
    const baseline = JSON.parse(readFileSync(join(root, 'b.json'), 'utf8'));
    const modules = baseline.modules.map((m) => m.path);
    assert.deepEqual(modules.filter((p) => p.startsWith('src/')).sort(), ['src/a.mjs', 'src/b.mjs']);
    assert.ok(baseline.gaps.some((g) => g.code === 'SYMLINK_LOOP'), 'the loop is a NOTED gap');
  });
});

// N3. A type-only Python import still resolves to its module; it is tagged, not orphaned.
test('N3: an import under if TYPE_CHECKING resolves like any other relative import', () => {
  const files = new Set(['pkg/__init__.py', 'pkg/core.py', 'pkg/models.py']);
  const edge = { from: 'pkg/core.py', specifier: '.models', kind: 'python-import-type' };
  const resolved = resolveEdge(edge, files);
  assert.equal(resolved.to, 'pkg/models.py');
});

// N4. A stopword that is also a real piece name is never stripped.
test('N4: "The core module" names a core/ directory; no unnamed-piece finding', () => {
  const files = {
    'package.json': '{"name":"gate","type":"module","dependencies":{}}',
    'core/index.mjs': 'export const x = 1;\n',
    'app/main.mjs': 'import { x } from "../core/index.mjs";\nexport const y = x;\n',
    '.vibecodepm/system.md': '# gate\n\n## 1. The map\n\n- **The core module** — holds the rules (core/index.mjs:1)\n- **The app** — the entry (app/main.mjs:1)\n- The app calls the core module\n\n## 2. Where state lives\n\n- Unknown: none\n\n## 3. Doors and keys\n\n- Unknown: none\n\n## 4. What bills per use\n\n- Unknown: none\n\n## 5. How you find out it broke\n\n- Unknown: none\n\n## 6. Blast radius per piece\n\n- **core** — imported by app (app/main.mjs:1)\n',
  };
  withSandbox(files, (root) => {
    assert.equal(run(['scan', '.'], { cwd: root }).code, 0);
    const r = run(['reconcile', '.'], { cwd: root });
    assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  });
});

// N5. A crash is never reported with the exit code that means "drift found, run trustworthy".
test('N5: an uncaught error exits 3, never 1', () => {
  withSandbox({ 'afile.txt': 'x' }, (root) => {
    const r = run(['demo', '--out', join(root, 'afile.txt', 'sub')], { cwd: root });
    assert.equal(r.code, 3, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /crash|could not complete|not trustworthy/i);
  });
});

// Advocate: a connection string commonly carries a password; the draft may not call it "not a key".
test('DSN: a DATABASE_URL is written as a connection string that may carry a credential', () => {
  const files = {
    'package.json': '{"name":"gate","type":"module","dependencies":{}}',
    'src/db.mjs': 'export const url = process.env.DATABASE_URL;\n',
  };
  withSandbox(files, (root) => {
    assert.equal(run(['derive', '.', '--out', 'draft.md'], { cwd: root }).code, 0);
    const draft = readFileSync(join(root, 'draft.md'), 'utf8');
    assert.doesNotMatch(draft, /DATABASE_URL`? is configuration rather than a key/);
    assert.match(draft, /DATABASE_URL.*connection string.*(password|credential)/i);
  });
});
