// Manifests. docs/SPEC.md §3B, and the MANIFEST_UNPARSED row of the false-green table in §3E.
//
// A manifest is the one place a repo states its dependencies out loud, so a manifest the scan
// could not read is a BLOCKING gap, not a shrug. Every other extractor can miss something and
// still leave a usable map. A dependency list that silently came back empty makes the bill answer
// and the state answer both look clean for the wrong reason.

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractManifest, isManifestPath } from '../src/extract/manifests.mjs';

// --- which files are manifests at all ------------------------------------------------------------

test('the four manifest filenames are recognised, and a lookalike is not', () => {
  for (const path of ['package.json', 'api/package.json', 'requirements.txt', 'worker/requirements.txt', 'pyproject.toml']) {
    assert.ok(isManifestPath(path), path);
  }
  for (const path of ['package-lock.json', 'tsconfig.json', 'requirements-dev.txt', 'src/package.json.bak']) {
    assert.ok(!isManifestPath(path), path);
  }
});

test('a manifest inside an ignored directory is not this repo’s manifest', () => {
  assert.ok(!isManifestPath('node_modules/left-pad/package.json'));
});

// --- package.json ---------------------------------------------------------------------------------

test('package.json yields its dependencies and its scripts, sorted, cited at the file', () => {
  const text = JSON.stringify({
    name: 'demo',
    dependencies: { stripe: '^14.0.0', pino: '^8.0.0' },
    devDependencies: { 'node-test-helper': '^1.0.0' },
    scripts: { start: 'node src/index.mjs', test: 'node --test' },
  });

  const { manifest, gaps } = extractManifest('package.json', text);
  assert.deepEqual(gaps, []);
  assert.equal(manifest.kind, 'package.json');
  assert.deepEqual(manifest.deps, ['pino', 'stripe']);
  assert.deepEqual(manifest.devDeps, ['node-test-helper']);
  assert.deepEqual(manifest.scripts, ['start', 'test']);
  assert.equal(manifest.cite, 'package.json:1');
});

test('a package.json with no dependencies is a real answer, not a gap', () => {
  // A zero-dependency repo is this repo. An empty list must not read as a failure to look.
  const { manifest, gaps } = extractManifest('package.json', JSON.stringify({ name: 'x', dependencies: {} }));
  assert.deepEqual(gaps, []);
  assert.deepEqual(manifest.deps, []);
  assert.equal(manifest.declaresNothing, true);
});

test('a package.json that is not valid JSON is a BLOCKING gap and yields no manifest', () => {
  const { manifest, gaps } = extractManifest('package.json', '{ "name": "demo", }\n');
  assert.equal(manifest, null);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].tier, 'BLOCKING');
  assert.equal(gaps[0].code, 'MANIFEST_UNPARSED');
  assert.equal(gaps[0].cite, 'package.json:1');
  assert.match(gaps[0].detail, /JSON/);
});

test('a package.json that parses to something other than an object is the same BLOCKING gap', () => {
  const { manifest, gaps } = extractManifest('package.json', '[1, 2, 3]\n');
  assert.equal(manifest, null);
  assert.equal(gaps[0].code, 'MANIFEST_UNPARSED');
});

// --- requirements.txt -------------------------------------------------------------------------------

test('requirements.txt yields package names with their version pins stripped', () => {
  const text = [
    '# the worker',
    'requests==2.31.0',
    'boto3>=1.28',
    'sqlalchemy[asyncio]~=2.0',
    'structlog',
    '',
    '-r shared.txt',
    '',
  ].join('\n');

  const { manifest, gaps } = extractManifest('worker/requirements.txt', text);
  assert.deepEqual(gaps, []);
  assert.equal(manifest.kind, 'requirements.txt');
  assert.deepEqual(manifest.deps, ['boto3', 'requests', 'sqlalchemy', 'structlog']);
});

test('an empty requirements.txt declares nothing, and says so', () => {
  const { manifest, gaps } = extractManifest('requirements.txt', '# nothing yet\n');
  assert.deepEqual(gaps, []);
  assert.deepEqual(manifest.deps, []);
  assert.equal(manifest.declaresNothing, true);
});

// --- pyproject.toml -----------------------------------------------------------------------------------

test('a PEP 621 dependencies array is read', () => {
  const text = [
    '[project]',
    'name = "worker"',
    'dependencies = [',
    '  "requests>=2.31",',
    '  "structlog",',
    ']',
    '',
  ].join('\n');

  const { manifest, gaps } = extractManifest('pyproject.toml', text);
  assert.deepEqual(gaps, []);
  assert.equal(manifest.kind, 'pyproject.toml');
  assert.deepEqual(manifest.deps, ['requests', 'structlog']);
});

test('a poetry dependency table is read, and python itself is not a dependency of the system', () => {
  const text = ['[tool.poetry.dependencies]', 'python = "^3.11"', 'boto3 = "^1.28"', 'celery = { version = "^5" }', ''].join('\n');

  const { manifest } = extractManifest('pyproject.toml', text);
  assert.deepEqual(manifest.deps, ['boto3', 'celery']);
});

test('a pyproject.toml with no table header at all is a BLOCKING gap', () => {
  // TOML without a section is either not TOML or truncated. Either way the dependency list that
  // comes back empty is not evidence of a dependency-free project.
  const { manifest, gaps } = extractManifest('pyproject.toml', 'this is not toml\n');
  assert.equal(manifest, null);
  assert.equal(gaps[0].code, 'MANIFEST_UNPARSED');
  assert.equal(gaps[0].tier, 'BLOCKING');
});

// --- determinism ------------------------------------------------------------------------------------------

test('the same manifest twice is byte identical', () => {
  const text = JSON.stringify({ dependencies: { b: '1', a: '2' }, scripts: { z: 'x', a: 'y' } });
  assert.deepEqual(extractManifest('package.json', text), extractManifest('package.json', text));
});
