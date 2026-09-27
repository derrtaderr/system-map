// Every environment variable the code reads, and every one a .env.example declares.
// docs/SPEC.md §3B. This feeds question 3 of derive, doors and keys, and section 3 of the
// reconcile report, "env vars read that section 3 never lists".
//
// One rule here is a refusal rather than an extraction: a real `.env` is never read. The live
// values are in it, and a scanner that opens your secrets to tell you that you have secrets is
// the wrong tool. The guard is the filename, checked before the content.

import { languageOf, maskComments, maskCommentsAndStrings } from './text.mjs';

// The shapes that read as a credential rather than a setting. Used to separate keys from
// configuration in derive's question 3, never to decide whether a variable is reported.
export const SECRETISH = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|_PAT|^PAT$|^SK_|^AK_|AUTH|SIGNATURE|WEBHOOK)/i;

const EXAMPLE_NAMES = new Set(['.env.example', '.env.sample', '.env.template', '.env.defaults', 'env.example']);

function basename(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

// A `.env` that is not one of the example names holds live values. Never opened.
export function isLiveEnvFile(path) {
  const base = basename(path);
  return base.startsWith('.env') && !EXAMPLE_NAMES.has(base);
}

export function isEnvExample(path) {
  return EXAMPLE_NAMES.has(basename(path));
}

// docs/SPEC.md §4A row D3. An environment injected as a parameter — `main({ env = process.env })`, read
// as `env.LANDED_N8N_API_KEY` — was invisible, so landed's only credential was missed and the two
// variables the scan DID find both came from test files.
//
// The first build recorded a noise argument for not widening the rule. The reviewer measured it: a probe
// for `<name>.env.UPPER` other than `process.env` over the three dogfood repos returned ZERO hits. The
// argument was asserted, not measured, and the measurement said the opposite.
//
// What keeps it safe is the shape, not the receiver: SCREAMING_SNAKE of three characters or more. That is
// why `env.mode`, `env.Production` and `env.X` do not match, and why the receiver still has to be an env
// object, so `CONSTANTS.MAX_RETRIES` does not either.
const INJECTED_HOW = 'via an injected env object';

const NODE_PATTERNS = [
  [/\bprocess\.env\.([A-Za-z_$][A-Za-z0-9_$]*)/g, 'process.env', 1],
  [/\bprocess\.env\[\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]/g, 'process.env', 2],
  [/\bimport\.meta\.env\.([A-Z][A-Z0-9_]{2,})/g, 'process.env', 1],
  [/(?<!process\.)(?<!import\.meta\.)\benv\.([A-Z][A-Z0-9_]{2,})\b/g, INJECTED_HOW, 1],
  [/(?<!process\.)(?<!import\.meta\.)\benv\[\s*(['"])([A-Z][A-Z0-9_]{2,})\1\s*\]/g, INJECTED_HOW, 2],
];

const PYTHON_PATTERNS = [
  [/\b(?:os\.)?environ\[\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]/g, 'os.environ', 2],
  [/\b(?:os\.)?environ\.get\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1/g, 'os.environ.get', 2],
  [/\bos\.getenv\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1/g, 'os.getenv', 2],
  [/\bgetenv\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1/g, 'os.getenv', 2],
];

function fromExample(path, text) {
  const found = [];
  const lines = text.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/#.*$/, '');
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match !== null) found.push({ name: match[1], how: '.env.example', line: index + 1 });
  }

  return found;
}

function fromCode(path, text) {
  const language = languageOf(path);
  if (language === null) return [];

  // M5: string CONTENTS are blanked here. A help string documenting `process.env.GHOST_KEY` is not a
  // read of it, and the masker only blanked comments.
  const lines = maskCommentsAndStrings(text, language).split('\n');
  const patterns = language === 'python' ? PYTHON_PATTERNS : NODE_PATTERNS;
  const found = [];

  // Bracket notation puts the NAME inside a string, so those two patterns read a copy with only
  // comments blanked. The dotted patterns read the fully masked copy, which is what M5 needs.
  const codeLines = maskComments(text, language).split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const [pattern, how, group] of patterns) {
      const subject = group === 2 ? codeLines[index] : line;
      for (const match of subject.matchAll(pattern)) found.push({ name: match[group], how, line: index + 1 });
    }

    if (language !== 'python') {
      // `const { ONE, TWO } = process.env` reads two variables and matches none of the
      // patterns above, because the variable names never touch the word `env`.
      const destructured = /\{([^}]*)\}\s*=\s*process\.env\b/.exec(line);
      if (destructured !== null) {
        for (const part of destructured[1].split(',')) {
          const name = part.split(/[:=]/)[0].trim();
          if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) found.push({ name, how: 'process.env', line: index + 1 });
        }
      }
    }
  }

  return found;
}

export function extractEnv(path, text) {
  if (isLiveEnvFile(path) && !isEnvExample(path)) return { env: [], gaps: [] };

  const found = isEnvExample(path) ? fromExample(path, text) : fromCode(path, text);

  // First citation wins, so a variable read eleven times is one row pointing at the first one.
  const first = new Map();
  for (const entry of found.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name))) {
    if (first.has(entry.name)) continue;
    first.set(entry.name, {
      ...entry,
      path,
      secretish: SECRETISH.test(entry.name),
      cite: `${path}:${entry.line}`,
    });
  }

  return { env: [...first.values()], gaps: [] };
}
