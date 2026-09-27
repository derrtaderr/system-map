// Import-edge extraction. docs/SPEC.md §3B, and the limits it admits to in §3C.
//
// This is deliberately text matching and not a parser. A parser for Node plus Python plus JSX
// plus TypeScript is either a dependency this repo refuses to take or a year of work, and the
// thing that makes heuristics acceptable here is the citation: every edge carries file:line, so
// a wrong one is visible in the report and a human overrules it in a sentence. An uncited edge
// is the thing this repo will not emit.
//
// What it does do carefully: comments never produce edges, and a computed specifier is reported
// as a NOTED gap rather than dropped. Those two are the difference between a heuristic and a
// guess.

import { lineOf, maskComments, languageOf } from './text.mjs';

// The clause between `import` and `from` in a real import statement. Anything else, and the
// `import` we matched was not opening an import statement.
const IMPORT_CLAUSE = /^[\sA-Za-z0-9_$,{}*]*$/;

const STATEMENT_START = /^\s*(?:export\s+)?import\b|^\s*export\s*[{*]/;
const FROM_SPECIFIER = /\bfrom\s*(['"])([^'"\n]+)\1/d;

// A statement spread over more lines than this is not an import; it is a file we have lost the
// thread of, and continuing to accumulate would let one bad line swallow the rest of the module.
const MAX_STATEMENT_LINES = 25;

function nodeEdges(path, masked) {
  const edges = [];
  const gaps = [];
  const lines = masked.split('\n');

  // --- static imports and re-exports, which may span lines -------------------------------
  for (let index = 0; index < lines.length; index += 1) {
    if (!STATEMENT_START.test(lines[index])) continue;

    let joined = '';
    for (let end = index; end < Math.min(lines.length, index + MAX_STATEMENT_LINES); end += 1) {
      joined = end === index ? lines[end] : `${joined}\n${lines[end]}`;

      const match = FROM_SPECIFIER.exec(joined);
      if (match !== null) {
        const head = joined.slice(0, match.index);
        const clause = head.replace(/^\s*(?:export\s+)?import\b/, '').replace(/^\s*export\b/, '');
        const typeOnly = /^\s*(?:export\s+)?import\s+type\b/.test(head);
        const withoutType = typeOnly ? clause.replace(/^\s*type\b/, '') : clause;

        if (IMPORT_CLAUSE.test(withoutType)) {
          edges.push({
            from: path,
            specifier: match[2],
            kind: typeOnly ? 'import-type' : 'import',
            line: index + 1 + lineOf(joined, match.indices[2][0]),
          });
        }
        break;
      }

      // A statement that ended without naming a module imports nothing. `export const x = 1`
      // and `import('./late.mjs').then(...)` both land here.
      if (lines[end].includes(';')) break;
    }
  }

  // --- side-effect imports, which name a module with no bindings at all -------------------
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*import\s*(['"])([^'"\n]+)\1/.exec(lines[index]);
    if (match !== null) edges.push({ from: path, specifier: match[2], kind: 'import', line: index + 1 });
  }

  // --- require and dynamic import, both single line by construction -----------------------
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const [pattern, kind] of [
      [/\brequire\s*\(\s*(['"])([^'"\n]*)\1\s*\)/g, 'require'],
      [/\bimport\s*\(\s*(['"])([^'"\n]*)\1\s*\)/g, 'dynamic-import'],
    ]) {
      for (const match of line.matchAll(pattern)) {
        edges.push({ from: path, specifier: match[2], kind, line: index + 1 });
      }
    }

    // A call whose argument is not a literal. docs/SPEC.md §3C: the one thing text extraction
    // structurally cannot follow, so it is named rather than dropped.
    for (const pattern of [/\brequire\s*\(\s*(?!['"])[^)\n]/g, /\bimport\s*\(\s*(?!['"])[^)\n]/g]) {
      if (pattern.test(line)) {
        gaps.push({
          tier: 'NOTED',
          code: 'DYNAMIC_SPECIFIER',
          path,
          line: index + 1,
          detail: 'a module is loaded from a computed specifier, so the edge it creates cannot be read from the text',
        });
        break;
      }
    }
  }

  return { edges, gaps };
}

// A block whose imports only exist for a type checker. Node's `import type` is already labelled; this is
// the Python equivalent, and it matters for blast radius because nothing imports it at runtime.
function typeCheckingBlock(lines) {
  const typeOnly = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^(\s*)if\s+TYPE_CHECKING\s*:/.test(lines[index])) continue;
    const indent = /^(\s*)/.exec(lines[index])[1].length;

    for (let inner = index + 1; inner < lines.length; inner += 1) {
      if (lines[inner].trim() === '') continue;
      const innerIndent = /^(\s*)/.exec(lines[inner])[1].length;
      if (innerIndent <= indent) break;
      typeOnly.add(inner + 1);
    }
  }

  return typeOnly;
}

function pythonEdges(path, masked) {
  const edges = [];
  const gaps = [];
  const lines = masked.split('\n');
  const typeOnlyLines = typeCheckingBlock(lines);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    // SPEC §3C: a dynamic import is NOTED, never dropped. This one was dropped entirely.
    const dynamic = /\bimportlib\.import_module\s*\(\s*(?:(['"])([^'"\n]+)\1)?/.exec(line);
    if (dynamic !== null) {
      if (dynamic[2] !== undefined) {
        edges.push({ from: path, specifier: dynamic[2], kind: 'python-import', line: index + 1 });
      } else {
        gaps.push({
          tier: 'NOTED',
          code: 'DYNAMIC_IMPORT_MODULE',
          path,
          line: index + 1,
          detail: 'importlib.import_module is called with a computed name, so the edge it creates cannot be read from the text',
        });
      }
      continue;
    }

    const kind = typeOnlyLines.has(index + 1) ? 'python-import-type' : 'python-import';

    const from = /^\s*from\s+(\.*[A-Za-z0-9_.]*)\s+import\b/.exec(line);
    if (from !== null) {
      if (from[1] !== '__future__') edges.push({ from: path, specifier: from[1], kind, line: index + 1 });
      continue;
    }

    const plain = /^\s*import\s+([A-Za-z0-9_.,\s]+?)\s*$/.exec(line);
    if (plain === null) continue;

    for (const part of plain[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name === '' || name === '__future__') continue;
      if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) continue;
      edges.push({ from: path, specifier: name, kind, line: index + 1 });
    }
  }

  return { edges, gaps };
}

export function extractEdges(path, text) {
  const language = languageOf(path);
  if (language === null) return { edges: [], gaps: [] };

  const masked = maskComments(text, language);
  const { edges, gaps } = language === 'python' ? pythonEdges(path, masked) : nodeEdges(path, masked);

  // Sorted and deduplicated, so the same input is the same bytes on every machine.
  const seen = new Set();
  const unique = [];
  for (const edge of edges.sort((a, b) => a.line - b.line || a.specifier.localeCompare(b.specifier) || a.kind.localeCompare(b.kind))) {
    // JSON, not a control character. A separator you cannot see in a grep is a separator you
    // cannot debug, and a raw NUL in a source file makes every tool treat it as binary.
    const key = JSON.stringify([edge.line, edge.kind, edge.specifier]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...edge, cite: `${path}:${edge.line}` });
  }

  return {
    edges: unique,
    gaps: gaps.map((gap) => ({ ...gap, cite: `${path}:${gap.line}` })),
  };
}
