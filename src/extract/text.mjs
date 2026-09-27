// The text primitives every extractor shares: what language a path is, where an offset falls,
// and how to blank out comments without blanking out the string literals the extractors need.
//
// Masking is the one piece of lexing this repo does, and it exists for a single reason: a
// commented-out import is the most common false edge in any text-matching map generator, and a
// map that names a piece nobody runs is worse than no map.

const NODE_EXTENSIONS = new Set(['.mjs', '.cjs', '.js', '.jsx', '.mts', '.cts', '.ts', '.tsx']);
const PYTHON_EXTENSIONS = new Set(['.py']);

export function extensionOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

export function languageOf(path) {
  const extension = extensionOf(path);
  if (NODE_EXTENSIONS.has(extension)) return 'node';
  if (PYTHON_EXTENSIONS.has(extension)) return 'python';
  return null;
}

// Newlines before `offset`. Callers add their own base, so this counts from zero.
export function lineOf(text, offset) {
  let count = 0;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') count += 1;
  }
  return count;
}

const SPACE = ' ';

function maskNode(text) {
  const out = [];
  let state = 'code';
  let quote = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (state === 'code') {
      // A `//` whose left neighbour is a backslash is almost always an escaped slash inside a
      // regex literal (`/https:\/\//`), not the start of a comment. Cheap, and it keeps the
      // masker from eating the rest of a line that holds a real statement.
      if (char === '/' && next === '/' && text[index - 1] !== '\\') {
        state = 'line-comment';
        out.push(SPACE);
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'block-comment';
        out.push(SPACE);
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        state = 'string';
        quote = char;
        out.push(char);
        continue;
      }
      out.push(char);
      continue;
    }

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code';
        out.push('\n');
        continue;
      }
      out.push(SPACE);
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'code';
        out.push(SPACE, SPACE);
        index += 1;
        continue;
      }
      out.push(char === '\n' ? '\n' : SPACE);
      continue;
    }

    // state === 'string'
    out.push(char);
    if (char === '\\') {
      if (next !== undefined) {
        out.push(next === '\n' ? '\n' : next);
        index += 1;
      }
      continue;
    }
    if (char === quote) {
      state = 'code';
      quote = '';
      continue;
    }
    // An unterminated quote must not swallow the rest of the file. A newline inside a single or
    // double quoted string is a syntax error in the source, so treat it as the end of the string.
    if (char === '\n' && quote !== '`') {
      state = 'code';
      quote = '';
    }
  }

  return out.join('');
}

function maskPython(text) {
  const out = [];
  let state = 'code';
  let quote = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const triple = text.slice(index, index + 3);

    if (state === 'code') {
      if (char === '#') {
        state = 'comment';
        out.push(SPACE);
        continue;
      }
      if (triple === "'''" || triple === '"""') {
        state = 'string';
        quote = triple;
        out.push(triple);
        index += 2;
        continue;
      }
      if (char === "'" || char === '"') {
        state = 'string';
        quote = char;
        out.push(char);
        continue;
      }
      out.push(char);
      continue;
    }

    if (state === 'comment') {
      if (char === '\n') {
        state = 'code';
        out.push('\n');
        continue;
      }
      out.push(SPACE);
      continue;
    }

    // state === 'string'
    if (char === '\\') {
      out.push(char);
      const next = text[index + 1];
      if (next !== undefined) {
        out.push(next);
        index += 1;
      }
      continue;
    }
    if (quote.length === 3 && triple === quote) {
      out.push(triple);
      index += 2;
      state = 'code';
      quote = '';
      continue;
    }
    out.push(char);
    if (quote.length === 1 && (char === quote || char === '\n')) {
      state = 'code';
      quote = '';
    }
  }

  return out.join('');
}

export function maskComments(text, language) {
  if (language === 'python') return maskPython(text);
  if (language === 'node') return maskNode(text);
  return text;
}
