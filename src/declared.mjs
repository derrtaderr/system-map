// The tolerant parser for a hand-written system.md. docs/SPEC.md §3E row 4.
//
// Everything else in this repo reads code, where a rule is either right or visibly wrong. This file
// reads a document a person wrote in prose, so every rule in it is a guess about what somebody
// meant. Two properties make that acceptable:
//
//   it reports what it could NOT parse, so a reader sees the parser's blind spots instead of
//   mistaking silence for agreement, and
//
//   a document it understood nothing of is UNPARSEABLE, which is BLOCKING, because a reconcile
//   against a document nobody could read finds zero findings and exits clean. That is the most
//   dangerous false green in the whole tool: the report would say the design and the code agree.
//
// The target shape is the architect skill's own artifact: six sections of ADR-ish prose. Everything
// looser than that is a tolerance, not a supported format, and the unparsed list is where the
// difference shows up.

export const SECTION_KEYS = ['map', 'state', 'doors', 'bill', 'watch', 'blast'];

// Checked in order, first match wins. The words are the ones people actually head these sections
// with, collected from the skill's own prompts plus the obvious synonyms.
const SECTION_PATTERNS = [
  ['map', /\bmap\b|\bpieces\b|hangs together|the shape|components?\b|architecture/i],
  ['state', /\bstate\b|where data|data live|storage|database/i],
  ['doors', /doors|keys|secrets?\b|access|auth|permission/i],
  ['bill', /\bbill\b|\bcosts?\b|charges?\b|meter|pricing|price|spend/i],
  ['watch', /2am|broke|breaks|alert|monitor|find out|observ|logging|logs\b|paging/i],
  ['blast', /blast radius|10x|scale|scaling|ceiling|dependen/i],
];

const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.+?)\s*$/;

const ARROW = /^(.+?)\s*(?:→|->|=>|⟶)\s*(.+)$/;
const VERB = /^(.+?)\s+(?:calls|talks to|writes to|reads from|sends to|pushes to|queues to|publishes to|invokes|depends on)\s+(.+)$/i;

// Built fresh on every call. A shared /g regex carries its lastIndex between calls, and
// String.prototype.matchAll inherits that lastIndex, so one stray .exec() elsewhere in the module
// silently makes every later scan start halfway through its own input.
const backticked = () => /`([^`\n]+)`/g;
const ENV_SHAPED = /^[A-Z][A-Z0-9_]{1,}$/;

function stripMarkup(value) {
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s*[-*+]\s+/, '')
    .trim()
    .replace(/[.,;:]+$/, '')
    .trim();
}

// An edge's right-hand side stops at the first clause break. "API → Worker, over the queue" names
// one edge, and carrying the clause into the piece name would make it match nothing in the code.
//
// A full stop only breaks the clause when it ENDS a sentence, never when it sits inside a token.
// Splitting on every period turned `worker/run.py` into `worker/run`, which is a piece name that
// matches no file and would have been reported as a map the code does not implement.
function edgeEnd(value) {
  return stripMarkup(value.split(/[,;(]|\.\s|\.$/)[0]);
}

// Every backticked token in a run of lines, WITH the line it was written on. The line is what lets a
// finding about the declared document cite the declared document, rather than rendering "(no
// citation)" in a report whose whole claim is that every line cites its source.
function backtickedIn(lines) {
  const first = new Map();
  for (const line of lines) {
    for (const match of line.text.matchAll(backticked())) {
      const name = match[1].trim();
      if (!first.has(name)) first.set(name, line.n);
    }
  }
  return [...first.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => ({ name, line: n }));
}

function classify(heading) {
  for (const [key, pattern] of SECTION_PATTERNS) {
    if (pattern.test(heading)) return key;
  }
  return null;
}

function splitSections(text) {
  const lines = text.split('\n');
  const sections = Object.fromEntries(SECTION_KEYS.map((key) => [key, null]));
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const heading = HEADING.exec(lines[index]);

    if (heading !== null) {
      const key = classify(heading[1]);
      current = key === null || sections[key] !== null ? null : { key, heading: heading[1], line: index + 1, lines: [] };
      if (current !== null) sections[key] = current;
      continue;
    }

    if (current !== null) current.lines.push({ n: index + 1, text: lines[index] });
  }

  return sections;
}

function readMap(section) {
  const pieces = [];
  const edges = [];
  const unparsed = [];

  if (section === null) return { pieces, edges, unparsed };

  for (const line of section.lines) {
    const bullet = BULLET.exec(line.text);
    if (bullet === null) continue;
    const body = bullet[1];

    // An edge bullet is an edge and not also a piece. "API → Worker" names no new piece.
    const arrow = ARROW.exec(body);
    if (arrow !== null) {
      edges.push({ from: stripMarkup(arrow[1]), to: edgeEnd(arrow[2]), line: line.n });
      continue;
    }

    const verb = VERB.exec(body);
    if (verb !== null) {
      edges.push({ from: stripMarkup(verb[1]), to: edgeEnd(verb[2]), line: line.n });
      continue;
    }

    const bold = /\*\*([^*]+)\*\*/.exec(body);
    const firstTicked = /`([^`\n]+)`/.exec(body);
    const separated = body.split(/\s+(?:—|--|–)\s+|:\s+/)[0];

    const name = stripMarkup(bold !== null ? bold[1] : firstTicked !== null ? firstTicked[1] : separated);

    // A name with no letter and no digit is not a name. Reporting it as a piece would put a row in
    // the map that can never match anything in the code, and hide the fact that a line was missed.
    if (!/[A-Za-z0-9]/.test(name)) {
      unparsed.push({ line: line.n, text: body, reason: 'no piece name, no edge, and nothing nameable in the bullet' });
      continue;
    }

    const paths = [...body.matchAll(backticked())]
      .map((match) => match[1].trim())
      .filter((value) => value.includes('/') || value.includes('.'));

    pieces.push({ name, paths, line: line.n, cite: `${name}@${line.n}` });
  }

  return { pieces, edges, unparsed };
}

export function parseDeclared(text) {
  const sections = splitSections(text ?? '');
  const { pieces, edges, unparsed } = readMap(sections.map);

  const allLines = (text ?? '').split('\n').map((value, index) => ({ n: index + 1, text: value }));
  const allBackticked = backtickedIn(allLines).map((entry) => entry.name);

  const inSection = (key) => (sections[key] === null ? [] : backtickedIn(sections[key].lines));

  // `names` stays a list of strings, which is what every caller reads. `cited` carries the same
  // entries with the line each one was written on, for the findings that have to point back here.
  const shape = (entries) => ({ names: entries.map((entry) => entry.name), cited: entries });

  const doorsTicked = inSection('doors');
  const doors = {
    ...shape(doorsTicked),
    envNames: doorsTicked.filter((entry) => ENV_SHAPED.test(entry.name)).map((entry) => entry.name),
  };

  const bill = shape(inSection('bill'));
  const watch = shape(inSection('watch'));
  const state = shape(inSection('state'));

  const found = SECTION_KEYS.filter((key) => sections[key] !== null);
  const hasContent = found.some((key) => sections[key].lines.some((line) => line.text.trim() !== ''));

  return {
    sections,
    pieces,
    edges,
    unparsed,
    doors,
    bill,
    watch,
    state,
    allBackticked,
    sectionsFound: found,
    parsedAnything: found.length > 0 && (hasContent || pieces.length > 0 || edges.length > 0),
  };
}
