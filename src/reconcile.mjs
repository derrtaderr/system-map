// The join. docs/SPEC.md §3E, §3G, §3H.
//
// This is the whole point of the repo: a declared design on one side, a scan of the code on the
// other, and a diff that either names what moved or says honestly that it could not tell. Pure
// function, no IO, so the false-green table can drive it directly and the CLI is the only thing
// that ever touches a disk.
//
// The rule the exit code encodes: 3 outranks 1. "I found no drift" and "my verdict is not
// trustworthy" are different sentences, and a cron job reads only the number.

import { parseDeclared } from './declared.mjs';
import { computeDelta, DELTA_KINDS } from './delta.mjs';
import { BASELINE_SCHEMA } from './scan.mjs';
import { renderReconcile } from './report.mjs';
import { pieceResolver } from './pieces.mjs';

// Piece classification lives in src/pieces.mjs, because derive and reconcile have to agree about it
// exactly or the round trip reports the tool's own map back as findings. Kept as a named export here
// for the callers that had it.
export { pieceOfPath, pieceResolver, piecesOf } from './pieces.mjs';

function normalise(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// A crude stem, so `notifier` and `notify` are one word, and so are `worker`/`work` and
// `billing`/`bill`. docs/SPEC.md §4A row I7. It strips ONE trailing form and only when at least four
// characters remain, which is what keeps `api` and `src` intact and keeps `cards` from becoming `card`
// and matching nothing by accident.
const SUFFIXES = ['ier', 'ers', 'ing', 'ies', 'er', 'or', 'es', 's', 'y'];

export function stemWord(value) {
  const base = normalise(value);
  for (const suffix of SUFFIXES) {
    if (base.length - suffix.length >= 4 && base.endsWith(suffix)) return base.slice(0, -suffix.length);
  }
  return base;
}

// The words a declared name offers up as candidates for a piece. "billing module charges cards" offers
// four, and a directory called `billing` answers to the first. Stopwords are the nouns people use to say
// "this is a component", which match nothing and would match everything if they were allowed to try.
const STOPWORDS = new Set([
  'module', 'modules', 'service', 'services', 'layer', 'layers', 'component', 'components', 'piece',
  'pieces', 'part', 'parts', 'system', 'systems', 'app', 'code', 'side', 'thing', 'things', 'front',
  'back', 'door', 'doors', 'nightly', 'daily', 'hourly', 'main', 'core', 'simple', 'small', 'big',
]);

// A piece name is a short noun phrase. Beyond the first two words you are reading a SENTENCE, and
// letting every word of a sentence offer itself as a piece name is how "The billing module charges
// cards" claimed to name a `cards/` directory and a `charges/` directory it has nothing to do with.
//
// Two words is enough for every shape that matters: "nightly worker" and "scoring worker" both offer
// `worker`, "billing module" offers `billing`, and "billing module charges cards" offers only `billing`
// because `charges` and `cards` are the third and fourth words.
const NAME_WORDS_CONSIDERED = 2;

function candidateTokens(name) {
  const whole = normalise(name);
  const words = String(name)
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .slice(0, NAME_WORDS_CONSIDERED)
    .filter((word) => !STOPWORDS.has(word.toLowerCase()));

  return [...new Set([whole, ...words.map((word) => normalise(word))])].filter((token) => token.length >= 3);
}

// Does a declared name answer to a code piece? Exact first, then one stem apart.
function namesTheSameThing(declaredName, codePiece) {
  const target = normalise(codePiece);
  const targetStem = stemWord(codePiece);

  for (const token of candidateTokens(declaredName)) {
    if (token === target) return true;
    if (stemWord(token) === targetStem && targetStem.length >= 4) return true;
  }
  return false;
}

function stem(modulePath) {
  const base = modulePath.slice(modulePath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}

// Which declared pieces answer to which code pieces. A declared piece matches on a path it cites,
// on its own name, or on the name of any module inside the piece, because a hand-written map says
// "the worker" and demanding a backticked path would teach people to write maps the tool's way.
function matchPieces(declaredPieces, modules, pieceOf) {
  const codePieces = new Map();
  for (const module of modules) {
    const piece = pieceOf(module.path);
    if (!codePieces.has(piece)) codePieces.set(piece, []);
    codePieces.get(piece).push(module.path);
  }

  const namedBy = new Map();
  const declaredToCode = new Map();

  for (const declared of declaredPieces) {
    const wanted = normalise(declared.name);
    const declaredRoots = new Set(declared.paths.map((path) => pieceOf(path.replace(/^\.\//, '').replace(/\/$/, ''))));
    // A map that names a piece by its own name (`packages/api`) rather than by a file inside it.
    const declaredAsPiece = normalise(declared.name);

    for (const [piece, paths] of codePieces) {
      const matches =
        declaredRoots.has(piece) ||
        normalise(piece) === wanted ||
        normalise(piece) === declaredAsPiece ||
        paths.some((path) => normalise(stem(path)) === wanted) ||
        // A prose name. "The nightly worker, in Python" answers to `worker`, and so does any module
        // inside the piece whose own name it names.
        namesTheSameThing(declared.name, piece) ||
        paths.some((path) => namesTheSameThing(declared.name, stem(path)));

      if (!matches) continue;

      if (!namedBy.has(piece)) namedBy.set(piece, []);
      namedBy.get(piece).push(declared.name);
      if (!declaredToCode.has(declared.name)) declaredToCode.set(declared.name, new Set());
      declaredToCode.get(declared.name).add(piece);
    }
  }

  return { codePieces, namedBy, declaredToCode };
}

function unnamedPieces(codePieces, namedBy) {
  const findings = [];

  for (const [piece, paths] of [...codePieces.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (namedBy.has(piece)) continue;
    findings.push({
      id: piece,
      cite: `${paths.sort()[0]}:1`,
      detail: `${paths.length} file${paths.length === 1 ? '' : 's'} the declared map never names, so nothing says what this piece is for`,
    });
  }

  return findings;
}

function undeclaredEdges(scan, declared, namedBy, declaredToCode, pieceOf, codeMembers) {
  // The declared edge set, as pairs of CODE pieces. An endpoint resolves through the declared piece it
  // names when there is one, and otherwise directly against the code pieces, tolerantly — a map that
  // says "The API calls the store" never spells `src` or `store` as a piece heading, and demanding that
  // it does is how four false findings landed against a document that was right.
  const codePieces = [...namedBy.keys()];
  const endpointToPieces = (endpoint) => {
    const viaDeclared = declaredToCode.get(endpoint);
    if (viaDeclared !== undefined && viaDeclared.size > 0) return [...viaDeclared];

    const direct = codePieces.filter((piece) => namesTheSameThing(endpoint, piece));
    if (direct.length > 0) return direct;

    // The endpoint may name a MODULE inside a piece rather than the piece.
    return codePieces.filter((piece) =>
      (codeMembers.get(piece) ?? []).some((path) => namesTheSameThing(endpoint, stem(path))),
    );
  };

  const allowed = new Set();
  for (const edge of declared.edges) {
    for (const from of endpointToPieces(edge.from)) {
      for (const to of endpointToPieces(edge.to)) allowed.add(JSON.stringify([from, to]));
    }
  }

  const findings = new Map();

  for (const edge of scan.edges) {
    if (edge.external === true || edge.to === null || edge.to === undefined) continue;

    const from = pieceOf(edge.from);
    const to = pieceOf(edge.to);
    if (from === to) continue;

    // An edge touching a piece the map never names belongs to section 1. Reporting it here too
    // would make the reader read one problem twice under two headings.
    if (!namedBy.has(from) || !namedBy.has(to)) continue;
    if (allowed.has(JSON.stringify([from, to]))) continue;

    const id = `${from} -> ${to}`;
    if (findings.has(id)) continue;
    findings.set(id, {
      id,
      cite: edge.cite,
      detail: `the code connects these two pieces and the declared map draws no line between them`,
    });
  }

  return [...findings.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function undeclaredEnv(scan, declared) {
  const listed = new Set(declared.doors.envNames.map((name) => name.toUpperCase()));

  return scan.env
    .filter((entry) => !listed.has(entry.name.toUpperCase()))
    .map((entry) => ({
      id: entry.name,
      cite: entry.cite,
      secretish: entry.secretish === true,
      detail: entry.secretish === true
        ? 'read by the code and never named in the doors-and-keys section, and its name says it is a credential'
        : 'read by the code and never named in the doors-and-keys section',
    }))
    .sort((a, b) => Number(b.secretish) - Number(a.secretish) || a.id.localeCompare(b.id));
}

function mentions(names, candidate) {
  const wanted = normalise(candidate);
  return names.some((name) => {
    const seen = normalise(name);
    return seen === wanted || seen.includes(wanted) || wanted.includes(seen);
  });
}

function unpricedClients(scan, declared) {
  return scan.clients
    .filter((client) => client.categories.includes('metered'))
    .filter((client) => !mentions(declared.bill.names, client.name))
    .map((client) => ({
      id: client.name,
      cite: client.cite,
      detail: `${client.note}, and the bill section does not price it`,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function vanishedSurfaces(scan, declared, delta, systemPath) {
  const findings = [];

  // Present in the code's own vocabulary. This list has to cover everything `derive` is capable of
  // writing into the 2am answer, or the tool reports its own sentences back as findings: schedules
  // were missing, so `crontab`, `github-actions` and `setInterval` came back as alert surfaces that
  // had vanished. docs/SPEC.md §4 records the rule — section 5's vocabulary is whatever section 5 of a
  // derived draft can contain.
  const present = [
    ...scan.observability.map((surface) => surface.name),
    ...scan.clients.map((client) => client.name),
    ...scan.routes.map((route) => route.path),
    ...scan.routes.map((route) => `${route.method} ${route.path}`),
    ...scan.schedules.map((schedule) => schedule.kind),
    ...scan.schedules.map((schedule) => schedule.detail),
  ];

  for (const entry of declared.watch.cited) {
    if (mentions(present, entry.name)) continue;
    findings.push({
      // The finding is about the declared document, so the declared document is what it cites.
      id: entry.name,
      cite: `${systemPath}:${entry.line}`,
      detail: 'the 2am answer names this surface and the scan found nothing in the code that answers to it',
    });
  }

  for (const entry of delta?.observability.removed ?? []) {
    findings.push({
      id: entry.id,
      cite: entry.cite,
      detail: 'the committed baseline had this surface and this scan does not, so something that used to tell you stopped',
    });
  }

  return findings.sort((a, b) => a.id.localeCompare(b.id));
}

function driftFindings(delta) {
  if (delta === null) return [];
  const findings = [];

  for (const kind of DELTA_KINDS) {
    for (const [direction, entries] of [['added', delta[kind].added], ['removed', delta[kind].removed]]) {
      for (const entry of entries) {
        findings.push({
          id: `${kind} ${direction}: ${entry.id}`,
          cite: entry.cite,
          detail: direction === 'added'
            ? 'present in this scan and absent from the committed baseline'
            : 'present in the committed baseline and absent from this scan',
        });
      }
    }
  }

  return findings;
}

const EMPTY_DECLARED = {
  sections: {},
  pieces: [],
  edges: [],
  unparsed: [],
  doors: { envNames: [], names: [], cited: [] },
  bill: { names: [], cited: [] },
  watch: { names: [], cited: [] },
  state: { names: [], cited: [] },
  allBackticked: [],
  sectionsFound: [],
  parsedAnything: false,
};

export function reconcile({ scan, declaredText, committedBaseline, now = new Date().toISOString(), systemPath = '.vibecodepm/system.md', baselinePath = '.system-map/baseline.json', inputs = [] }) {
  const gaps = [...(scan.gaps ?? [])];
  const limits = [];

  // --- the three things that can make the whole run untrustworthy ----------------------------
  let declared = EMPTY_DECLARED;
  let declaredUsable = false;

  if (declaredText === null || declaredText === undefined) {
    gaps.push({
      tier: 'BLOCKING',
      code: 'SYSTEM_MD_ABSENT',
      path: systemPath,
      cite: systemPath,
      // I9: flow.md promises the recovery path names the verb. It named the file and left the reader
      // to guess the command.
      detail: `there is no declared design at ${systemPath}, so there is nothing to reconcile against and a clean report would mean nothing. Run \`system-map derive\` to draft one, confirm it, and save it there`,
    });
  } else {
    declared = parseDeclared(declaredText);
    if (!declared.parsedAnything) {
      gaps.push({
        tier: 'BLOCKING',
        code: 'SYSTEM_MD_UNPARSEABLE',
        path: systemPath,
        cite: systemPath,
        detail: `${systemPath} exists but no section of it could be read, so every section below would be empty for the wrong reason. Compare it against \`system-map derive\` output, whose headings this parser always reads`,
      });
    } else {
      declaredUsable = true;
    }
  }

  let delta = null;
  if (committedBaseline === null || committedBaseline === undefined) {
    gaps.push({
      tier: 'BLOCKING',
      code: 'BASELINE_ABSENT',
      path: baselinePath,
      cite: baselinePath,
      detail: `there is no committed baseline at ${baselinePath}, so nothing here can say what moved since the design was agreed. Run \`system-map scan\` and commit the result`,
    });
  } else if (committedBaseline.schema !== BASELINE_SCHEMA) {
    gaps.push({
      tier: 'BLOCKING',
      code: 'BASELINE_SCHEMA_UNKNOWN',
      path: baselinePath,
      cite: baselinePath,
      detail: `the committed baseline says schema "${committedBaseline.schema}" and this build reads "${BASELINE_SCHEMA}", so a diff between them would compare two different shapes. Run \`system-map scan --reagree\` to write a fresh one`,
    });
  } else {
    delta = computeDelta(committedBaseline, scan);
  }

  // --- the six sections ------------------------------------------------------------------------
  const pieceOf = pieceResolver(scan);
  const { codePieces, namedBy, declaredToCode } = matchPieces(declared.pieces, scan.modules ?? [], pieceOf);

  const sections = {
    unnamedPieces: declaredUsable ? unnamedPieces(codePieces, namedBy) : [],
    undeclaredEdges: declaredUsable ? undeclaredEdges(scan, declared, namedBy, declaredToCode, pieceOf, codePieces) : [],
    undeclaredEnv: declaredUsable ? undeclaredEnv(scan, declared) : [],
    unpricedClients: declaredUsable ? unpricedClients(scan, declared) : [],
    vanishedSurfaces: declaredUsable ? vanishedSurfaces(scan, declared, delta, systemPath) : [],
    drift: driftFindings(delta),
  };

  // --- what the run could not see, beyond the gap list -----------------------------------------
  if (declaredUsable) {
    for (const piece of declared.pieces) {
      if ((declaredToCode.get(piece.name) ?? new Set()).size > 0) continue;
      limits.push(
        `the map names **${piece.name}**${piece.paths.length > 0 ? ` (\`${piece.paths.join('`, `')}\`)` : ''} and no file in this repo answers to it, so nothing here confirms or denies it`,
      );
    }

    for (const entry of declared.unparsed) {
      limits.push(`line ${entry.line} of the declared map could not be read: "${entry.text}" — ${entry.reason}`);
    }

    for (const key of ['map', 'state', 'doors', 'bill', 'watch', 'blast']) {
      if (declared.sectionsFound.includes(key)) continue;
      limits.push(`the declared document has no section this parser recognised as "${key}", so anything that section would have covered is unchecked`);
    }
  }

  const blocking = gaps.filter((gap) => gap.tier === 'BLOCKING');
  const findings = Object.values(sections).reduce((total, list) => total + list.length, 0);

  const exitCode = blocking.length > 0 ? 3 : findings > 0 ? 1 : 0;
  const verdict = exitCode === 3 ? 'cannot-judge' : exitCode === 1 ? 'drift' : 'clean';

  const outcome = {
    inputs,
    sections,
    gaps: gaps.sort((a, b) => a.tier.localeCompare(b.tier) || a.code.localeCompare(b.code) || String(a.cite).localeCompare(String(b.cite))),
    limits,
    findings,
    exitCode,
    verdict,
  };

  outcome.report = renderReconcile(outcome, { now });
  return outcome;
}
