// Shelling out is an external dependency. docs/SPEC.md §4A row D2.
//
// `landed` reaches GitHub entirely through `execFile('gh', …)` and `job-radar` reaches git the same way,
// and the first build's draft said "nothing here bills per use" and drew no external edge for either.
// A process boundary is a boundary: the thing on the other side can be down, can change, can rate-limit
// you, and is not in your dependency manifest — which is exactly why the import graph misses it and why
// a map that omits it is wrong about the system's edges.
//
// Only a literal first argument counts. A computed command is not invented, on the same principle as a
// computed import specifier and a route path built from a variable.

import { languageOf, maskComments } from './text.mjs';
import { isTestPath } from '../walk.mjs';

const NODE_SPAWN = /\b(execFileSync|execFile|spawnSync|spawn|execSync|exec)\s*\(\s*(['"`])([^'"`\n]+)\2/g;
const PY_SPAWN = /\b(?:subprocess\.)?(run|call|check_call|check_output|Popen)\s*\(\s*(?:\[\s*)?(['"])([^'"\n]+)\2/g;

// `exec('ls -la')` and `check_output('gh api')` pass a whole command line. The program is the first word.
function programOf(argument) {
  const first = argument.trim().split(/\s+/)[0];
  // A path to a binary still names the binary.
  return first.slice(first.lastIndexOf('/') + 1);
}

export function extractShellOuts(path, text, { includeTests = false } = {}) {
  const language = languageOf(path);
  if (language === null) return { shells: [] };
  if (!includeTests && isTestPath(path)) return { shells: [] };

  const lines = maskComments(text, language).split('\n');
  const patterns = language === 'python' ? [PY_SPAWN] : [NODE_SPAWN];
  const first = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    for (const pattern of patterns) {
      for (const match of lines[index].matchAll(pattern)) {
        const target = programOf(match[3]);
        if (target === '') continue;
        if (first.has(target)) continue;
        first.set(target, { call: match[1], target, path, line: index + 1, cite: `${path}:${index + 1}` });
      }
    }
  }

  return { shells: [...first.values()].sort((a, b) => a.line - b.line || a.target.localeCompare(b.target)) };
}
