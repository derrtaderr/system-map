// Repo hygiene: the things that make a byte comparison mean the same thing on every machine, and the
// things a stranger's clone depends on.
//
// The control-character rule has already paid for itself in this repo. Several dedupe keys were
// written with a NUL escape inside a template literal, and four source files ended up carrying a real
// NUL byte. (This comment deliberately does not spell the escape, because writing it here put one in
// this file too.) The code worked. But grep treats those files as binary, which is the precedent from
// signal-desk and landed exactly: a separator you cannot see is a separator you cannot debug.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

const TEXT_DIRS = ['src', 'test', 'scripts', 'bin', 'fixtures', 'docs', '.vibecodepm'];
const textFiles = TEXT_DIRS.filter((dir) => existsSync(join(ROOT, dir))).flatMap((dir) => walk(join(ROOT, dir)));

test('the file list is not empty, so the loops below are not vacuous', () => {
  assert.ok(textFiles.length >= 25, `${textFiles.length} files`);
});

test('no tracked text file contains a control character outside tab, newline and return', () => {
  const offenders = [];

  for (const file of textFiles) {
    const text = readFileSync(file, 'utf8');
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        offenders.push(`${relative(ROOT, file)}:${text.slice(0, index).split('\n').length} contains U+${code.toString(16).padStart(4, '0')}`);
        break;
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test('.gitattributes pins LF for every type a byte-comparing test reads', () => {
  const rules = readFileSync(join(ROOT, '.gitattributes'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line !== '');

  assert.ok(rules.some((rule) => /^\*\s+text=auto\s+eol=lf$/.test(rule)), 'a repo-wide default');
  for (const extension of ['.md', '.json', '.mjs', '.py', '.yml']) {
    assert.ok(rules.some((rule) => rule.startsWith(`*${extension} `) && rule.includes('eol=lf')), `eol=lf for ${extension}`);
  }
});

test('the bin entry point is a shim that resolves to real code, and package.json points at it', () => {
  const bin = readFileSync(join(ROOT, 'bin', 'system-map.mjs'), 'utf8');
  assert.match(bin, /^#!\/usr\/bin\/env node/);
  assert.match(bin, /src\/cli\.mjs/);

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.bin['system-map'], './bin/system-map.mjs');
  assert.equal(pkg.type, 'module');
});

test('the repo has no runtime dependency, which is the claim the README makes', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies, {});
  assert.deepEqual(pkg.devDependencies, {});
});

test('the fixture corpus is present, because the demo and the README both depend on it', () => {
  for (const path of [
    'fixtures/demo-repo/package.json',
    'fixtures/demo-repo/src/api.mjs',
    'fixtures/demo-repo/worker/run.py',
    'fixtures/demo-repo/.vibecodepm/system.md',
    'fixtures/demo-repo/.system-map/baseline.json',
    'fixtures/demo-repo/.env.example',
  ]) {
    assert.ok(existsSync(join(ROOT, path)), path);
  }
});

test('every JSON file in the repo parses', () => {
  for (const file of textFiles.filter((path) => path.endsWith('.json'))) {
    JSON.parse(readFileSync(file, 'utf8'));
  }
});

test('the docs a future session is told to read exist and declare a reader', () => {
  for (const path of ['docs/SPEC.md', 'docs/DESIGN.md', '.vibecodepm/flow.md', '.vibecodepm/metrics.md']) {
    const full = join(ROOT, path);
    assert.ok(existsSync(full), path);
    assert.match(readFileSync(full, 'utf8'), /^---\n[\s\S]*?read_by:/, `${path} names who reads it`);
  }
});

test('no source file mentions a verb this phase did not build', () => {
  // docs/SPEC.md §2 keeps `decisions` out of phase 1 on purpose. A half-wired verb is how a scope
  // line gets crossed without anybody deciding to cross it.
  const sources = textFiles.filter((file) => file.startsWith(join(ROOT, 'src')) && file.endsWith('.mjs'));
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    const code = text.split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n');
    assert.ok(!/['"]decisions['"]\s*:/.test(code), `${relative(ROOT, file)} does not register a decisions verb`);
  }
});
