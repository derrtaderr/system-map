// Where state lives when it lives on disk. docs/SPEC.md §3F and §4A row D1.
//
// §3F promised this from the first commit and no extractor existed, so all three dogfood repos — every
// one of which keeps state in files — derived to "Unknown: no database or storage client was found".
// That is the answer to question 2 being blind rather than wrong, on repos whose whole job is to write
// a durable record.
//
// The rule is deliberately narrow, because question 2 is only useful if it is short enough to read. A
// write is a state row when it is a write call, in a module that is part of the system, whose path is
// not scratch. The reviewer measured 2, 10 and 5 rows on the three dogfood repos under exactly this
// rule, which is why it is this rule.

import { languageOf, maskComments } from './text.mjs';
import { isTestPath } from '../walk.mjs';

// The call names. The first argument is read by `firstArgument` below rather than by the regex, because
// a comma inside a nested call is not an argument separator: `join(dir, 'receipt.json')` is ONE path
// expression, and a pattern that stopped at the first comma cited `join(dir` — which tells a reader
// nothing.
//
// The point is to cite the path EXPRESSION, not to evaluate it. Evaluating it is not something text
// extraction can honestly do, and the expression as written already says where to look.
const NODE_WRITE_CALLS = /\b(writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream)\s*\(/g;

// `mkdirSync` is deliberately absent. A directory is not state; the file written into it is, and that
// write is already a row. Including it doubled every row on the dogfood repos.
//
// Python's method-style writes take the CONTENT as their first argument and the path as their RECEIVER:
// `Path(path).write_text(json.dumps(state))` is a write to `path`, and reading the first argument cited
// `json.dumps(state, indent=1, sort_keys=True)` as the place state lives. So these capture what is
// before the dot. `json.dump(obj, handle)` is absent for the same reason in reverse: the path is not on
// that line at all, and the `open(..., 'w')` that produced the handle is a row already.
// pathlib's writes take the CONTENT as their argument and the path as their receiver.
const PYTHON_RECEIVER_WRITES = /([A-Za-z_][A-Za-z0-9_.]*\s*\([^()]*\)|[A-Za-z_][A-Za-z0-9_.]*)\s*\.\s*(write_text|write_bytes)\s*\(/g;

// pandas' writers are the other way round: `frame.to_csv(path)`. The receiver is the data, the argument
// is the path. Getting this backwards is how `frame` ended up reported as a place state lives.
const PYTHON_ARG_WRITES = /\b(sqlite3\.connect|to_csv|to_json|to_parquet)\s*\(/g;

// `Path(x)` names the same place as `x`, and the shorter one is the one a reader recognises.
function unwrapPath(expression) {
  const match = /^Path\s*\(\s*([^()]*?)\s*\)$/.exec(expression.trim());
  return match === null ? expression.trim() : match[1].trim();
}

// The first argument of a call whose name match ends at `from`, respecting nesting and quotes. Returns
// the source text as written, which is the whole point: a citation a reader can follow.
function firstArgument(line, from) {
  let depth = 0;
  let quote = '';
  let start = -1;

  for (let index = from; index < line.length; index += 1) {
    const char = line[index];

    if (quote !== '') {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      if (depth === 1) start = index + 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) return start === -1 ? '' : line.slice(start, index).trim();
      continue;
    }
    if (char === ',' && depth === 1) return line.slice(start, index).trim();
  }

  // An argument list that runs past the end of the line. An honest partial beats a wrong guess.
  return start === -1 ? '' : line.slice(start).trim();
}

// `open(path, 'w')` is a write; `open(path)` and `open(path, 'r')` are not.
const PYTHON_OPEN_WRITE = /\b(open)\s*\(\s*([^,)\n]+)\s*,\s*(['"])[wax]\+?b?\3/g;

// Scratch is not state. Without this the section fills up with temp files and stops being read.
const SCRATCH = /\btmp\b|\btemp\b|tmpdir|mkdtemp|TemporaryDirectory|NamedTemporary|\/tmp\/|os\.tmp/i;

export function extractWrites(path, text, { includeTests = false } = {}) {
  const language = languageOf(path);
  if (language === null) return { writes: [] };
  // A fixture a test writes is not where the system keeps its state.
  if (!includeTests && isTestPath(path)) return { writes: [] };

  const lines = maskComments(text, language).split('\n');
  const found = [];

  const record = (call, rawTarget, index) => {
    const target = unwrapPath(rawTarget);
    if (target === '' || SCRATCH.test(target)) return;
    found.push({ call, target, path, line: index + 1, cite: `${path}:${index + 1}` });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (language === 'python') {
      for (const match of line.matchAll(PYTHON_RECEIVER_WRITES)) record(match[2], match[1], index);
      for (const match of line.matchAll(PYTHON_ARG_WRITES)) {
        record(match[1], firstArgument(line, match.index + match[0].length - 1), index);
      }
      for (const match of line.matchAll(PYTHON_OPEN_WRITE)) record(match[1], match[2].trim(), index);
    } else {
      for (const match of line.matchAll(NODE_WRITE_CALLS)) {
        record(match[1], firstArgument(line, match.index + match[0].length - 1), index);
      }
    }
  }

  // ONE ROW PER MODULE. The module is the unit a reader acts on, and a module that writes in six
  // branches is one place state lives, not six. Measured on the three dogfood repos this gives 2, 10
  // and 5 rows; a row per call gave 4, 17 and 8, and section 2 stops being read somewhere in between.
  // The extra writes are counted so nothing is hidden.
  if (found.length === 0) return { writes: [] };

  const sorted = found.sort((a, b) => a.line - b.line || a.call.localeCompare(b.call));
  const [firstWrite] = sorted;

  // The dedupe keeps the section short; the CITATIONS keep it complete. Two writes in one module through
  // a variable of the same name are two files, and the line number is the only honest way to point at the
  // second one when the literal filename lives in a constant somewhere else.
  return {
    writes: [{
      ...firstWrite,
      alsoWrites: sorted.length - 1,
      alsoAt: sorted.slice(1).map((write) => write.cite),
      targets: [...new Set(sorted.map((write) => write.target))],
    }],
  };
}
