// `derive`: the six architect answers, pre-filled from the scan. docs/SPEC.md §3F.
//
// Two rules from the architect skill govern every line in this file, and they are the reason this
// repo exists rather than another component-map generator:
//
//   "every derived answer cites its source, the file and the line, so the user can check it instead
//   of trusting it. A cited answer next to a bare gap reads honestly. An uncited one reads as the
//   user's decision when it isn't."
//
//   "a derived answer is a draft, not a decision."
//
// So every bullet this module emits ends in `(path:line)` or begins with `Unknown:`. There is no
// third option, and test/derive.test.mjs walks the output to enforce it. When the scan found
// nothing, the honest output is a page of Unknowns, not a page of plausible sentences.

import { piecesOf, pieceResolver } from './pieces.mjs';
import { ARCHITECT_HEADINGS as HEADINGS, GAP_HEADING, DRAFT_TITLE } from './headings.mjs';

// Re-exported, not redeclared. The parser reads the same table, and that is the whole point of
// src/headings.mjs.
export { ARCHITECT_HEADINGS } from './headings.mjs';

// The two line shapes. Nothing else may reach the page.
//
// A note that begins "registry:" is a claim from src/registry.mjs, not something the cited line shows.
// The cited line shows an IMPORT; "charges per API call and settles real money" is a judgement written
// down once in the table, and printing it bare at the import citation made the citation look like its
// evidence. docs/SPEC.md §4A row M8.
const cited = (text, cite) => `- ${text} (${cite})`;
const unknown = (text) => `- Unknown: ${text}`;

const HEALTH_ROUTE = /(health|healthz|livez|readyz|ping|status)\b/i;
const CONNECTION_ENV = /DATABASE|_DSN|CONNECTION|POSTGRES|MYSQL|MONGO|REDIS|SUPABASE|SQL|_URI$|BUCKET|S3_/i;



function theMap(scan) {
  const lines = [];
  const pieces = piecesOf(scan);
  const pieceOf = pieceResolver(scan);

  if (pieces.size === 0) {
    return [unknown('no source file was found under this path, so there is no map to draw. Either the code is somewhere else or the scan was pointed at the wrong directory')];
  }

  for (const [piece, paths] of pieces) {
    const sorted = [...paths].sort();
    const routes = scan.routes.filter((route) => pieceOf(route.from ?? '') === piece).length;
    const detail = routes > 0 ? `${sorted.length} file${sorted.length === 1 ? '' : 's'}, serving ${routes} HTTP route${routes === 1 ? '' : 's'}` : `${sorted.length} file${sorted.length === 1 ? '' : 's'}`;
    lines.push(cited(`**${piece}** — ${detail}`, `${sorted[0]}:1`));
  }

  // Internal edges, between pieces. An edge inside one piece is a detail of that piece.
  const internal = new Map();
  for (const edge of scan.edges) {
    if (edge.external === true || edge.to === null || edge.to === undefined) continue;
    const from = pieceOf(edge.from);
    const to = pieceOf(edge.to);
    if (from === to) continue;
    const key = `${from} → ${to}`;
    if (!internal.has(key)) internal.set(key, edge.cite);
  }
  for (const [key, cite] of [...internal.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(cited(key, cite));
  }

  // External dependencies belong in the map: a piece that calls out is a piece with an outside edge.
  for (const client of scan.clients) {
    lines.push(cited(`${pieceOf(client.cites[0] ?? '')} → \`${client.name}\`, outside this repo — registry: ${client.note}`, client.cite));
  }
  for (const host of scan.hosts) {
    lines.push(cited(`${pieceOf(host.path ?? '')} → \`${host.host}\`, over HTTP via ${host.via}`, host.cite));
  }

  // docs/SPEC.md §4A row D2. A process boundary is a boundary, and it appears in no manifest, which is
  // exactly why the import graph misses it.
  for (const shell of scan.shells ?? []) {
    lines.push(cited(`${pieceOf(shell.path ?? '')} shells out to \`${shell.target}\`, via ${shell.call}`, shell.cite));
  }

  if (internal.size === 0 && scan.clients.length === 0 && scan.hosts.length === 0) {
    lines.push(unknown('no edge between pieces was found. Either the pieces genuinely do not talk, or they talk through something text extraction cannot see, such as a queue or a shared database'));
  }

  // docs/SPEC.md §4A row D4. Counted, named, and not a piece. Silence here would read as a repo with
  // no tests, which is a different and much worse claim.
  const tests = scan.testFiles ?? [];
  if (tests.length > 0) {
    lines.push(cited(`tests: ${tests.length} files, excluded from the map (\`--include-tests\` to include)`, `${tests[0]}:1`));
  }

  return lines;
}

function whereStateLives(scan) {
  const lines = [];

  for (const client of scan.clients.filter((candidate) => candidate.categories.includes('state'))) {
    lines.push(cited(`\`${client.name}\` — registry: ${client.note}`, client.cite));
  }

  for (const entry of scan.env.filter((candidate) => CONNECTION_ENV.test(candidate.name))) {
    lines.push(cited(`\`${entry.name}\` points at a store this code connects to`, entry.cite));
  }

  // docs/SPEC.md §4A row D1, and §3F promised it from the first commit. Every dogfood repo keeps state
  // on disk, and every draft used to say "no storage client was found".
  for (const write of scan.writes ?? []) {
    const more = write.alsoWrites > 0 ? `, and ${write.alsoWrites} more write${write.alsoWrites === 1 ? '' : 's'} in this module` : '';
    lines.push(cited(`state lives in local files: \`${write.target}\`, written with ${write.call}${more}`, write.cite));
  }

  if (lines.length === 0) {
    lines.push(unknown('no database, storage client or local file write was found, so either this system keeps nothing, or it keeps it somewhere text extraction cannot see, such as a service reached by plain HTTP'));
  }

  // Straight from the architect skill, and it can never be answered by reading a repo.
  lines.push(unknown('whether a backup of any of this has ever been restored. No file in a repository can answer that, and a backup nobody has restored is a rumour'));

  return lines;
}

function doorsAndKeys(scan) {
  const lines = [];
  const secrets = scan.env.filter((entry) => entry.secretish);
  const settings = scan.env.filter((entry) => !entry.secretish);

  for (const entry of secrets) {
    lines.push(cited(`\`${entry.name}\` is read from the environment via ${entry.how}, and its name says it is a credential`, entry.cite));
  }

  if (secrets.length === 0) lines.push(unknown('no credential-shaped environment variable was found, so either this system holds no key or a key is arriving by a route the scan cannot see'));

  for (const entry of settings) {
    lines.push(cited(`\`${entry.name}\` is configuration rather than a key, read via ${entry.how}`, entry.cite));
  }

  for (const check of scan.authChecks) {
    lines.push(cited(`the check \`${check.name}\` runs here`, check.cite));
  }

  if (scan.authChecks.length === 0) {
    const reachable = scan.routes.length;
    lines.push(unknown(
      reachable > 0
        ? `no authorization check was found in the scanned files, and ${reachable} HTTP route${reachable === 1 ? ' is' : 's are'} reachable. Either the check is somewhere the scan cannot read it, or there is none`
        : 'no authorization check was found in the scanned files. With no HTTP route either, that may be correct',
    ));
  }

  lines.push(unknown('whether any of these keys is also present in a committed file, a build artifact or a log. The scan reads the repository, not the build output or the running process'));

  return lines;
}

function whatBills(scan) {
  const lines = [];
  const metered = scan.clients.filter((client) => client.categories.includes('metered'));

  for (const client of metered) {
    lines.push(cited(`\`${client.name}\` — registry: ${client.note}`, client.cite));
  }

  for (const host of scan.hosts) {
    lines.push(cited(`\`${host.host}\` is called over HTTP via ${host.via}, and whether it meters is not something this repo records`, host.cite));
  }

  // A shelled-out command is not billed by us, but it is rate-limited by somebody, and question 4 is
  // where a reader looks for "what stops working when we do too much of it".
  for (const shell of scan.shells ?? []) {
    lines.push(cited(`\`${shell.target}\` is run as a subprocess, so whatever it reaches is metered by that system's limits rather than billed here`, shell.cite));
  }

  if (metered.length === 0 && scan.hosts.length === 0 && (scan.shells ?? []).length === 0) {
    lines.push(unknown('nothing in this repo matched a metered client or an external host, so as far as the scan can tell nothing here bills per use. A vendor the registry does not know would look exactly the same'));
  }

  lines.push(unknown('where the cap is set. A ceiling on spend is a setting in a vendor dashboard or a runtime limit, and no file in a repository records it'));

  return lines;
}

function howYouFindOut(scan) {
  const lines = [];
  const records = scan.observability.filter((surface) => surface.kind === 'records');
  const pushes = scan.observability.filter((surface) => surface.kind === 'pushes');

  for (const surface of records) {
    lines.push(cited(`\`${surface.name}\` records a failure here`, surface.cite));
  }

  for (const surface of pushes) {
    lines.push(cited(`\`${surface.name}\` pushes, so this one can reach a person`, surface.cite));
  }

  for (const route of scan.routes.filter((candidate) => HEALTH_ROUTE.test(candidate.path))) {
    lines.push(cited(`\`${route.method} ${route.path}\` looks like a health route, which answers only if something asks it`, route.cite));
  }

  for (const schedule of scan.schedules) {
    lines.push(cited(`\`${schedule.kind}\` runs on a clock (${schedule.detail}), so its silence is itself a signal, if anyone is watching for silence`, schedule.cite));
  }

  if (records.length === 0 && pushes.length === 0) {
    lines.push(unknown('nothing was found that records a failure, which means a failure leaves no trace this scan can see'));
  }

  if (pushes.length === 0) {
    lines.push(unknown('nothing in the code pushes. Every surface found records, and a log nobody opens is not an alert, so as written this system tells you it broke only if you go and look'));
  }

  lines.push(unknown('whether anyone reads what is recorded, and whether an alert route configured outside the repo exists. A dashboard and a paging rule live in a vendor, not in a file'));

  return lines;
}

function blastRadius(scan) {
  const pieces = piecesOf(scan);
  const pieceOf = pieceResolver(scan);
  if (pieces.size === 0) return [unknown('with no module found, nothing can be said about what depends on what')];

  const dependents = new Map([...pieces.keys()].map((piece) => [piece, new Map()]));

  for (const edge of scan.edges) {
    if (edge.external === true || edge.to === null || edge.to === undefined) continue;
    const from = pieceOf(edge.from);
    const to = pieceOf(edge.to);
    if (from === to || !dependents.has(to)) continue;
    if (!dependents.get(to).has(from)) dependents.get(to).set(from, edge.cite);
  }

  const lines = [];
  for (const [piece, paths] of pieces) {
    const importers = dependents.get(piece);
    const count = importers.size;

    if (count === 0) {
      lines.push(cited(`**${piece}** — nothing in this repo imports it, so breaking it breaks only itself, unless it is an entry point`, `${[...paths].sort()[0]}:1`));
      continue;
    }

    const names = [...importers.keys()].sort();
    lines.push(cited(
      `**${piece}** — ${count} other piece${count === 1 ? '' : 's'} import${count === 1 ? 's' : ''} it (${names.join(', ')}), so breaking it breaks ${count === 1 ? 'that one' : 'those'} too`,
      [...importers.values()].sort()[0],
    ));
  }

  return lines;
}

export function deriveSections(scan) {
  return [theMap(scan), whereStateLives(scan), doorsAndKeys(scan), whatBills(scan), howYouFindOut(scan), blastRadius(scan)];
}

// The band metrics.md declares. Below the floor the tool is probably inventing; above the ceiling the
// extractors are too thin to be useful on this repo. Reading your own instrument is the point of having
// one, and the first PR reported the raw counts and never applied the threshold.
export const UNKNOWN_FLOOR = 10;
export const UNKNOWN_CEILING = 40;

export function unknownRatio(draft) {
  const answers = draft
    .split(`\n## ${GAP_HEADING}`)[0]
    .split('\n')
    .filter((line) => line.startsWith('- '));
  const unknown = answers.filter((line) => line.startsWith('- Unknown:')).length;
  const percent = answers.length === 0 ? 0 : Math.round((unknown / answers.length) * 100);

  return {
    answers: answers.length,
    unknown,
    percent,
    verdict: percent > UNKNOWN_CEILING ? 'too-thin' : percent < UNKNOWN_FLOOR ? 'suspiciously-confident' : 'inside-the-band',
  };
}

export function unknownRatioLines(ratio) {
  const lines = [`${ratio.unknown} of ${ratio.answers} answers are Unknown (${ratio.percent}%).`];

  if (ratio.verdict === 'too-thin') {
    lines.push(
      `That is above the ${UNKNOWN_CEILING}% ceiling in .vibecodepm/metrics.md, which reads as too thin to be useful:`,
      'the scan found little enough that most of this page is what it could not see rather than what it read.',
    );
  } else if (ratio.verdict === 'suspiciously-confident') {
    lines.push(
      `That is below the ${UNKNOWN_FLOOR}% floor in .vibecodepm/metrics.md. A page with almost no Unknowns is`,
      'either a very small system or a tool that is guessing; check the citations before trusting it.',
    );
  }

  return lines;
}

export function deriveDraft(scan, { now, repoName }) {
  const sections = deriveSections(scan);
  const blocking = (scan.gaps ?? []).filter((gap) => gap.tier === 'BLOCKING');

  const out = [
    '---',
    'name: System map (draft, derived)',
    'phase: architect',
    'status: draft',
    'read_by: whoever is confirming this system map, and `system-map reconcile` once it is confirmed and saved as .vibecodepm/system.md',
    'derived_by: system-map',
    `derived_at: ${now}`,
    `derived_from: ${repoName}`,
    '---',
    '',
    `# ${DRAFT_TITLE}`,
    '',
    'Every line below was read out of the code and cites the file and line it came from, or is written',
    'as an `Unknown` naming what the scan could not see. **This is a draft, not a decision.** Walk it',
    'question by question and confirm or correct each answer before it stands; the gaps are the part',
    'only you can close.',
    '',
    `Derived from ${scan.counts?.modules ?? scan.modules.length} module${(scan.counts?.modules ?? scan.modules.length) === 1 ? '' : 's'} by deterministic text extraction. No model wrote any of it.`,
    '',
  ];

  if (blocking.length > 0) {
    out.push('> **This scan could not read everything.** The answers below are incomplete for the reasons listed at the end.');
    out.push('');
  }

  for (let index = 0; index < HEADINGS.length; index += 1) {
    out.push(`## ${HEADINGS[index]}`);
    out.push('');
    out.push(...sections[index]);
    out.push('');
  }

  out.push(`## ${GAP_HEADING}`);
  out.push('');
  if ((scan.gaps ?? []).length === 0) {
    out.push('Nothing was refused or unreadable on this run. The structural limits of text extraction still apply: dynamic imports, reflection, generated code, and anything configured outside the repository.');
  } else {
    for (const gap of scan.gaps) out.push(`- \`${gap.tier}\` \`${gap.code}\` — ${gap.detail} (${gap.cite ?? gap.path})`);
  }
  out.push('');

  // The footer reads the page it is part of, so the number can never disagree with the lines above it.
  const draft = out.join('\n');
  const ratio = unknownRatio(draft);

  return [draft, '---', '', ...unknownRatioLines(ratio), ''].join('\n');
}
