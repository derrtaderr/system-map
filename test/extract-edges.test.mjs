// The import-edge extraction rules, as a table: input snippet in, expected cited entries out.
//
// Every row here is a rule docs/SPEC.md §3B promises, or a limit §3C admits to. The extractor
// emits SPECIFIERS and cites them; turning a specifier into a module path is resolution, and
// lives in src/resolve.mjs, because it needs the whole file list and this does not.

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractEdges } from '../src/extract/edges.mjs';

// One row of the table, reduced to what a human reads in a review: kind, specifier, cite.
function rows(path, text) {
  return extractEdges(path, text).edges.map((edge) => `${edge.kind} ${edge.specifier} ${edge.cite}`);
}

function gaps(path, text) {
  return extractEdges(path, text).gaps.map((gap) => `${gap.tier} ${gap.code} ${gap.cite}`);
}

// --- node, static imports -----------------------------------------------------------------

test('a bare-specifier import is an edge at its own line', () => {
  assert.deepEqual(rows('src/a.mjs', "import { join } from 'node:path';\n"), [
    'import node:path src/a.mjs:1',
  ]);
});

test('a relative import keeps the specifier verbatim, resolution is somebody else’s job', () => {
  assert.deepEqual(rows('src/a.mjs', "\nimport b from './b.mjs';\n"), ['import ./b.mjs src/a.mjs:2']);
});

test('double and single quotes both parse', () => {
  assert.deepEqual(rows('src/a.mjs', 'import x from "./x.js";\n'), ['import ./x.js src/a.mjs:1']);
});

test('a side-effect import with no bindings is still an edge', () => {
  assert.deepEqual(rows('src/a.mjs', "import './register.mjs';\n"), ['import ./register.mjs src/a.mjs:1']);
});

test('a multi-line import statement cites the line the specifier is on', () => {
  const text = ['import {', '  one,', '  two,', "} from './pair.mjs';", ''].join('\n');
  assert.deepEqual(rows('src/a.mjs', text), ['import ./pair.mjs src/a.mjs:4']);
});

test('a re-export is an edge, because the dependency is real either way', () => {
  assert.deepEqual(rows('src/i.mjs', "export { a } from './a.mjs';\nexport * from './b.mjs';\n"), [
    'import ./a.mjs src/i.mjs:1',
    'import ./b.mjs src/i.mjs:2',
  ]);
});

test('a type-only import is an edge, and it is labelled so a reviewer can discount it', () => {
  const { edges } = extractEdges('src/a.ts', "import type { T } from './types.ts';\n");
  assert.equal(edges.length, 1);
  assert.equal(edges[0].kind, 'import-type');
});

// --- node, require and dynamic import ------------------------------------------------------

test('require is an edge', () => {
  assert.deepEqual(rows('src/a.cjs', "const fs = require('node:fs');\n"), ['require node:fs src/a.cjs:1']);
});

test('a dynamic import with a literal specifier is an edge', () => {
  assert.deepEqual(rows('src/a.mjs', "const m = await import('./late.mjs');\n"), [
    'dynamic-import ./late.mjs src/a.mjs:1',
  ]);
});

test('a dynamic import with a computed specifier is a NOTED gap, never a silent drop', () => {
  // docs/SPEC.md §3C. The one thing text extraction structurally cannot follow, and the
  // reason the report has a "what this run could not see" section at all.
  const text = "const m = await import(`./plugins/${name}.mjs`);\n";
  assert.deepEqual(rows('src/a.mjs', text), []);
  assert.deepEqual(gaps('src/a.mjs', text), ['NOTED DYNAMIC_SPECIFIER src/a.mjs:1']);
});

test('a computed require is the same NOTED gap', () => {
  assert.deepEqual(gaps('src/a.cjs', 'const m = require(name);\n'), ['NOTED DYNAMIC_SPECIFIER src/a.cjs:1']);
});

// --- node, things that look like imports and are not ---------------------------------------

test('the word import inside a line comment is not an edge', () => {
  assert.deepEqual(rows('src/a.mjs', "// import x from './x.mjs';\n"), []);
});

test('the word import inside a block comment is not an edge', () => {
  const text = ['/*', " * import x from './x.mjs';", ' */', ''].join('\n');
  assert.deepEqual(rows('src/a.mjs', text), []);
});

test('import.meta.url is not an edge', () => {
  assert.deepEqual(rows('src/a.mjs', 'const here = import.meta.url;\n'), []);
});

test('a string that merely contains the word import is not an edge', () => {
  assert.deepEqual(rows('src/a.mjs', "console.log('run npm import first');\n"), []);
});

test('a word ending in import does not open an import statement', () => {
  assert.deepEqual(rows('src/a.mjs', "reimport from './x.mjs';\n"), []);
});

// --- python ---------------------------------------------------------------------------------

test('a plain python import is an edge', () => {
  assert.deepEqual(rows('worker/run.py', 'import os\n'), ['python-import os worker/run.py:1']);
});

test('a dotted python import keeps the dotted name', () => {
  assert.deepEqual(rows('worker/run.py', 'import engine.scoring as scoring\n'), [
    'python-import engine.scoring worker/run.py:1',
  ]);
});

test('a comma-separated python import is several edges on one line', () => {
  assert.deepEqual(rows('worker/run.py', 'import os, sys\n'), [
    'python-import os worker/run.py:1',
    'python-import sys worker/run.py:1',
  ]);
});

test('from X import Y cites X, the module, not Y, the binding', () => {
  assert.deepEqual(rows('worker/run.py', 'from engine.rules import score\n'), [
    'python-import engine.rules worker/run.py:1',
  ]);
});

test('a relative python import keeps its leading dots, which is what resolution needs', () => {
  assert.deepEqual(rows('worker/run.py', 'from .rules import score\nfrom ..shared import util\n'), [
    'python-import .rules worker/run.py:1',
    'python-import ..shared worker/run.py:2',
  ]);
});

test('a python comment is not an edge', () => {
  assert.deepEqual(rows('worker/run.py', '# import os\n'), []);
});

test('an indented python import inside a function is still an edge', () => {
  assert.deepEqual(rows('worker/run.py', 'def f():\n    import json\n'), ['python-import json worker/run.py:2']);
});

test('__future__ is dropped, because it is a compiler directive and not a piece of the system', () => {
  assert.deepEqual(rows('worker/run.py', 'from __future__ import annotations\n'), []);
});

// --- the language gate ----------------------------------------------------------------------

test('python syntax in a .mjs file yields nothing, and node syntax in a .py file yields nothing', () => {
  assert.deepEqual(rows('src/a.mjs', 'import os\n'), []);
  assert.deepEqual(rows('worker/run.py', "import x from './x.mjs';\n"), []);
});

test('a file of an unknown extension yields no edges and no gaps', () => {
  assert.deepEqual(rows('README.md', "import x from './x.mjs';\n"), []);
  assert.deepEqual(gaps('README.md', "import x from './x.mjs';\n"), []);
});

// --- determinism ----------------------------------------------------------------------------

test('the same input yields byte-identical output, which is the whole promise of no LLM', () => {
  const text = "import a from './a.mjs';\nconst b = require('./b.cjs');\n";
  assert.deepEqual(extractEdges('src/x.mjs', text), extractEdges('src/x.mjs', text));
});
