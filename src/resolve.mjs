// Turning a specifier into a module path, or into an honest nothing. docs/SPEC.md §3A.
//
// This is the step that makes an edge list a map rather than a list of strings. It is also where a
// heuristic tool earns or loses its credibility: a specifier that resolves to nothing must never be
// quietly upgraded into a module that does not exist, and a bare package name must never be
// reported as a missing internal file.

import { isBuiltin } from 'node:module';
import { dirname, join, normalize } from 'node:path/posix';

const NODE_EXTENSIONS = ['.mjs', '.js', '.cjs', '.jsx', '.mts', '.cts', '.ts', '.tsx'];

// TypeScript emits `./x.js` for a file called `x.ts`. Without this swap every TS repo reports a
// wall of unresolved specifiers and loses all of its internal edges.
const COMPILED_TO_SOURCE = new Map([
  ['.js', ['.ts', '.tsx']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
  ['.jsx', ['.tsx']],
]);

// Enough of the Python standard library to keep `import os` from reading as a missing file. It is a
// label, not a gate: an absolute Python import that resolves to nothing is external either way.
const PYTHON_STDLIB = new Set([
  'abc', 'argparse', 'asyncio', 'base64', 'collections', 'concurrent', 'contextlib', 'copy', 'csv',
  'dataclasses', 'datetime', 'decimal', 'enum', 'functools', 'glob', 'gzip', 'hashlib', 'hmac',
  'http', 'importlib', 'inspect', 'io', 'itertools', 'json', 'logging', 'math', 'multiprocessing',
  'operator', 'os', 'pathlib', 'pickle', 'random', 're', 'shutil', 'signal', 'socket', 'sqlite3',
  'statistics', 'string', 'subprocess', 'sys', 'tempfile', 'textwrap', 'threading', 'time',
  'traceback', 'types', 'typing', 'unittest', 'urllib', 'uuid', 'venv', 'warnings', 'zipfile',
]);

function candidatesForNode(specifier, from) {
  const base = normalize(join(dirname(from), specifier));
  const out = [base];

  const dot = base.lastIndexOf('.');
  const extension = dot > base.lastIndexOf('/') ? base.slice(dot) : '';
  for (const source of COMPILED_TO_SOURCE.get(extension) ?? []) out.push(`${base.slice(0, dot)}${source}`);

  for (const candidate of NODE_EXTENSIONS) out.push(`${base}${candidate}`);
  for (const candidate of NODE_EXTENSIONS) out.push(`${base}/index${candidate}`);

  return out;
}

function candidatesForPython(specifier, from) {
  const leading = /^\.*/.exec(specifier)[0].length;

  if (leading > 0) {
    let base = dirname(from);
    for (let step = 1; step < leading; step += 1) base = dirname(base);

    const rest = specifier.slice(leading).split('.').filter((part) => part !== '');
    const target = rest.length === 0 ? base : normalize(join(base, rest.join('/')));
    return [`${target}.py`, `${target}/__init__.py`, target === base ? `${base}/__init__.py` : null].filter((path) => path !== null);
  }

  // An absolute import resolves against the repo root, and against the importing file's own top
  // level, because a repo whose package root is `worker/` imports `engine.x` from inside it.
  const asPath = specifier.split('.').join('/');
  const top = from.includes('/') ? from.slice(0, from.indexOf('/')) : '';
  const roots = top === '' ? [''] : ['', `${top}/`];

  return roots.flatMap((prefix) => [`${prefix}${asPath}.py`, `${prefix}${asPath}/__init__.py`]);
}

export function resolveEdge(edge, fileSet) {
  const { specifier, kind, from } = edge;
  const python = kind === 'python-import';
  const relative = python ? specifier.startsWith('.') : specifier.startsWith('.');

  if (!relative && !python && isBuiltin(specifier)) {
    return { ...edge, to: null, external: true, builtin: true };
  }
  if (!python && !relative) {
    return { ...edge, to: null, external: true, builtin: false };
  }

  const candidates = python ? candidatesForPython(specifier, from) : candidatesForNode(specifier, from);
  for (const candidate of candidates) {
    const normalised = candidate.replace(/^\.\//, '');
    if (fileSet.has(normalised)) return { ...edge, to: normalised, external: false, builtin: false };
  }

  if (python && !relative) {
    // A package this repo does not contain. That is a dependency, not a missing file.
    const top = specifier.split('.')[0];
    return { ...edge, to: null, external: true, builtin: PYTHON_STDLIB.has(top) };
  }

  return { ...edge, to: null, external: false, builtin: false, unresolved: true };
}

export function resolveEdges(edges, fileSet) {
  const resolved = [];
  const gaps = [];

  for (const edge of edges) {
    const result = resolveEdge(edge, fileSet);
    if (result.unresolved === true) {
      gaps.push({
        tier: 'NOTED',
        code: 'UNRESOLVED_SPECIFIER',
        path: edge.from,
        line: edge.line,
        cite: edge.cite,
        detail: `"${edge.specifier}" names no file in this repo, so the edge it declares cannot be placed`,
      });
    }
    const { unresolved, ...clean } = result;
    resolved.push(clean);
  }

  return { edges: resolved, gaps };
}
