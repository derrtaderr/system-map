// `node --check` over every module, inside the suite.
//
// It is also one of the declared gate commands in docs/SPEC.md §5, and having it here means a file
// that does not parse fails the same run that broke it, rather than the next time somebody remembers
// to run the gate by hand.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

// Including fixtures: the fixture repo's modules are read as text by the scan, but they are also real
// JavaScript, and a fixture that does not parse is a fixture whose extraction results mean nothing.
const modules = ['src', 'bin', 'scripts', 'test', 'fixtures']
  .flatMap((dir) => walk(join(ROOT, dir)))
  .filter((file) => file.endsWith('.mjs'));

test('the module list is not empty, so the loop below is not vacuous', () => {
  assert.ok(modules.length >= 25, `found ${modules.length} modules`);
});

test('every module parses', () => {
  const offenders = [];
  for (const file of modules) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (error) {
      offenders.push(`${relative(ROOT, file)}: ${error.stderr?.toString().split('\n')[0] ?? error.message}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('no module imports anything outside this repo and the Node standard library', () => {
  // The zero-dependency claim, checked against the code rather than against package.json. A dev
  // dependency that crept into a source file would pass `npm test` on this machine and fail on a
  // fresh clone.
  const offenders = [];

  for (const file of modules.filter((path) => !path.includes(`${ROOT}/fixtures`))) {
    const text = execFileSync('cat', [file], { encoding: 'utf8' });
    for (const match of text.matchAll(/^import[^'"\n]*from\s+['"]([^'"]+)['"]/gm)) {
      const specifier = match[1];
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      offenders.push(`${relative(ROOT, file)} imports ${specifier}`);
    }
  }

  assert.deepEqual(offenders, []);
});
