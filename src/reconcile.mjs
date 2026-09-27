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

// A code piece is the top-level directory a module sits in, or the file itself when it sits at the
// root. Reporting every unnamed MODULE in a two-hundred-file repo is noise nobody reads; reporting
// every unnamed top-level group is a list somebody acts on.
export function pieceOf(modulePath) {
  const slash = modulePath.indexOf('/');
  return slash === -1 ? modulePath : modulePath.slice(0, slash);
}

function normalise(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stem(modulePath) {
  const base = modulePath.slice(modulePath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}

// Which declared pieces answer to which code pieces. A declared piece matches on a path it cites,
// on its own name, or on the name of any module inside the piece, because a hand-written map says
// "the worker" and demanding a backticked path would teach people to write maps the tool's way.
function matchPieces(declaredPieces, modules) {
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

    for (const [piece, paths] of codePieces) {
      const matches =
        declaredRoots.has(piece) ||
        normalise(piece) === wanted ||
        paths.some((path) => normalise(stem(path)) === wanted);

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

function undeclaredEdges(scan, declared, namedBy, declaredToCode) {
  // The declared edge set, as pairs of CODE pieces.
  const allowed = new Set();
  for (const edge of declared.edges) {
    for (const from of declaredToCode.get(edge.from) ?? []) {
      for (const to of declaredToCode.get(edge.to) ?? []) allowed.add(JSON.stringify([from, to]));
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
  const { codePieces, namedBy, declaredToCode } = matchPieces(declared.pieces, scan.modules ?? []);

  const sections = {
    unnamedPieces: declaredUsable ? unnamedPieces(codePieces, namedBy) : [],
    undeclaredEdges: declaredUsable ? undeclaredEdges(scan, declared, namedBy, declaredToCode) : [],
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
