// The CLI. docs/SPEC.md §3H and §3K.
//
// Four verbs, and the exit code is the part that matters most, because this runs from a weekly
// command and from CI where nobody reads the prose:
//
//   0  the run read what it needed and found no drift
//   1  drift found, and the run was trustworthy
//   2  a refusal: a flag that makes no sense, a path that is not there, a file it will not overwrite
//   3  it could not read enough to judge. 3 OUTRANKS 1
//
// §3K is the other load-bearing rule in this file: `--out` resolves against the working directory,
// never against the repo being scanned. That is what makes pointing the tool at somebody else's
// repository read-only by construction, rather than by good intentions.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { scanRepo, BASELINE_SCHEMA } from './scan.mjs';
import { deriveDraft } from './derive.mjs';
import { reconcile } from './reconcile.mjs';
import { runDemo, DEMO_NOW } from './demo.mjs';

export const USAGE = `system-map — derive a cited system.md from a repo, and reconcile the declared
design against the code. Deterministic text extraction. No model, no network, no dependency.

Usage:
  node bin/system-map.mjs scan [path]       Write .system-map/baseline.json, the committed reference
  node bin/system-map.mjs derive [path]     Write a draft system.md, every line cited or Unknown
  node bin/system-map.mjs reconcile [path]  Diff the code against the declared design and the baseline
  node bin/system-map.mjs demo              Run all three on a synthetic fixture repo, keyless

[path] defaults to the working directory. Flags, per verb. Anything else is refused rather than
ignored, so no invocation can quietly become a different one than you typed. Write them as
"--flag value", never "--flag=value".

  scan       --out <file>   default .system-map/baseline.json
             --now <ISO>    pin the clock, so a byte-comparing test means the same thing every day
  derive     --out <file>   default .vibecodepm/system.draft.md
             --force        overwrite an existing --out. Never overwrites a file named system.md
             --now <ISO>
  reconcile  --system <file>    default .vibecodepm/system.md
             --baseline <file>  default .system-map/baseline.json
             --out <dir>        default .system-map, where reconcile-YYYY-MM-DD.md is written
             --now <ISO>
  demo       --out <dir>    required, and nothing is ever written outside it
             --now <ISO>

EVERY --out RESOLVES AGAINST THE WORKING DIRECTORY, never against [path]. Scanning somebody
else's repository cannot write into it.

Exit codes, because this runs unattended and the exit code is the only thing a scheduler reads:

  0  the run read what it needed and found no drift
  1  drift found, and the run was trustworthy
  2  a refusal: a flag that makes no sense, a path that is not there, a file it will not overwrite
  3  it could not read enough to judge, and that OUTRANKS 1

Exit 3 is the fail-closed case. An unreadable file, an unparsed manifest, a missing or unreadable
system.md and a missing baseline all produce it, because a clean report over something the tool
never read would be worse than no report.

derive never overwrites .vibecodepm/system.md. The confirmed document is a human's; the draft
lands beside it.
`;

const FLAG_SPEC = {
  scan: { '--out': 'value', '--now': 'value' },
  derive: { '--out': 'value', '--now': 'value', '--force': 'boolean' },
  reconcile: { '--system': 'value', '--baseline': 'value', '--out': 'value', '--now': 'value' },
  demo: { '--out': 'value', '--now': 'value' },
};

class Refusal extends Error {}
class HelpRequested extends Error {}

function parse(argv) {
  if (argv.includes('--help') || argv.includes('-h')) throw new HelpRequested();
  const [verb, ...rest] = argv;

  if (verb === undefined) throw new Refusal('name a verb: scan, derive, reconcile or demo');
  if (FLAG_SPEC[verb] === undefined) {
    throw new Refusal(
      verb === 'decisions'
        ? 'there is no "decisions" verb. Drafting ADRs from the delta is phase 2, and docs/SPEC.md §2 says so on purpose rather than shipping a stub'
        : `unknown verb: ${verb}. The verbs are scan, derive, reconcile and demo`,
    );
  }

  const spec = FLAG_SPEC[verb];
  const flags = {};
  const positional = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    if (token.includes('=')) {
      const [name, ...value] = token.split('=');
      throw new Refusal(`flags are written apart from their values: write "${name} ${value.join('=')}", not "${token}"`);
    }
    if (spec[token] === undefined) throw new Refusal(`unknown flag: ${token}`);
    if (flags[token] !== undefined) throw new Refusal(`${token} given twice; one value per flag`);

    if (spec[token] === 'boolean') {
      flags[token] = true;
      continue;
    }

    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Refusal(`${token} needs a value`);
    flags[token] = value;
    index += 1;
  }

  if (positional.length > 1) throw new Refusal(`one path at a time; got ${positional.length}`);

  const now = flags['--now'] ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(now)) || !/^\d{4}-\d{2}-\d{2}T/.test(now)) {
    throw new Refusal(`--now must be an ISO instant like 2026-09-27T12:00:00.000Z; got "${now}"`);
  }

  return { verb, flags, path: positional[0] ?? '.', now, nowExplicit: flags['--now'] !== undefined };
}

// Everything the CLI writes resolves here, against the working directory. docs/SPEC.md §3K.
function outputPath(value) {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function readRepoRoot(value) {
  const root = outputPath(value);
  if (!existsSync(root)) throw new Refusal(`there is nothing at ${value}`);
  if (!statSync(root).isDirectory()) throw new Refusal(`${value} is not a directory`);
  return root;
}

function write(path, contents) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  } catch (error) {
    throw new Refusal(`could not write ${path}: ${error.message}`);
  }
}

function reportGaps(baseline, log) {
  const blocking = baseline.gaps.filter((gap) => gap.tier === 'BLOCKING');
  for (const gap of blocking) log(`  BLOCKING  ${gap.code}  ${gap.cite ?? gap.path}  ${gap.detail}`);
  return blocking.length;
}

function doScan({ path, flags, now }, log) {
  const root = readRepoRoot(path);
  const baseline = scanRepo(root);
  const out = outputPath(flags['--out'] ?? '.system-map/baseline.json');

  // `generated_at` is stamped here and not in the scan, so the scan itself stays byte-stable and
  // the delta has nothing to ignore.
  write(out, `${JSON.stringify({ ...baseline, generated_at: now }, null, 2)}\n`);

  const counts = baseline.counts;
  log(`system-map scan  ${path}`);
  log('');
  log(`  ${counts.modules} modules, ${counts.edges} edges, ${counts.routes} routes, ${counts.clients} clients`);
  log(`  ${counts.env} env reads, ${counts.authChecks} auth checks, ${counts.schedules} schedules, ${counts.observability} log or alert surfaces`);
  log('');
  log(`  baseline  ${flags['--out'] ?? '.system-map/baseline.json'}`);

  const blocking = reportGaps(baseline, log);
  if (blocking > 0) {
    log('');
    log(`  ${blocking} blocking gap(s). The baseline was still written, and it records them, but it is`);
    log('  an incomplete reference point until they are fixed.');
    return 3;
  }

  return 0;
}

function doDerive({ path, flags, now }, log) {
  const root = readRepoRoot(path);
  const requested = flags['--out'] ?? '.vibecodepm/system.draft.md';
  const out = outputPath(requested);

  // The confirmed document is a human's. A tool that can be talked into overwriting it with a
  // derived draft has no business running unattended, so this refusal has no escape hatch.
  if (/(^|\/)system\.md$/.test(requested.replace(/\\/g, '/'))) {
    throw new Refusal(`--out names a file called system.md. derive never writes one; the confirmed document is yours. Write the draft somewhere else, for example .vibecodepm/system.draft.md`);
  }
  if (existsSync(out) && flags['--force'] !== true) {
    throw new Refusal(`${requested} already exists. Pass --force to overwrite it, or choose another --out`);
  }

  const baseline = scanRepo(root);
  // Never the argv path. A draft is meant to be committed, and echoing an absolute path would carry a
  // home directory into the user's repository — the privacy guard's own HOME_PATH rule, broken in the
  // tool's output instead of in its tree. Found by dogfooding against a repo outside this one.
  write(out, `${deriveDraft(baseline, { now, repoName: basename(root) })}\n`);

  log(`system-map derive  ${path}`);
  log('');
  log(`  draft  ${requested}`);

  const confirmed = outputPath('.vibecodepm/system.md');
  if (existsSync(confirmed)) log('  .vibecodepm/system.md already exists and was not touched. The draft is beside it.');

  log('');
  log('  Every line in the draft cites a file and a line, or is written as an Unknown naming what');
  log('  the scan could not see. It is a draft, not a decision: confirm or correct each answer.');

  const blocking = reportGaps(baseline, log);
  return blocking > 0 ? 3 : 0;
}

function readJson(path, label) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    // A baseline that exists and is corrupt is a refusal, not a missing baseline. Treating it as
    // absent would exit 3 and send the reader looking for a file that is right there.
    throw new Refusal(`the committed ${label} at ${path} is not valid JSON: ${error.message}`);
  }
}

function doReconcile({ path, flags, now }, log) {
  const root = readRepoRoot(path);
  const systemRequested = flags['--system'] ?? '.vibecodepm/system.md';
  const baselineRequested = flags['--baseline'] ?? '.system-map/baseline.json';
  const outDir = flags['--out'] ?? '.system-map';

  const systemPath = outputPath(systemRequested);
  let declaredText = null;
  if (existsSync(systemPath)) {
    try {
      declaredText = readFileSync(systemPath, 'utf8');
    } catch (error) {
      throw new Refusal(`could not read ${systemRequested}: ${error.message}`);
    }
  }

  const committedBaseline = readJson(outputPath(baselineRequested), 'baseline');

  const outcome = reconcile({
    scan: scanRepo(root),
    declaredText,
    committedBaseline,
    now,
    systemPath: systemRequested,
    baselinePath: baselineRequested,
  });

  const filename = `reconcile-${now.slice(0, 10)}.md`;
  write(join(outputPath(outDir), filename), `${outcome.report}\n`);

  log(`system-map reconcile  ${path}`);
  log('');
  if (outcome.verdict === 'cannot-judge') {
    log('  Could not read enough to judge. The report names every gap.');
    for (const gap of outcome.gaps.filter((gap) => gap.tier === 'BLOCKING')) log(`  BLOCKING  ${gap.code}  ${gap.cite ?? gap.path}`);
  } else if (outcome.findings === 0) {
    log('  No drift. The declared design and the code agree, and nothing moved since the baseline.');
  } else {
    log(`  ${outcome.findings} finding${outcome.findings === 1 ? '' : 's'}, every one cited:`);
    for (const [key, heading] of [
      ['unnamedPieces', 'pieces the map does not name'],
      ['undeclaredEdges', 'edges the map omits'],
      ['undeclaredEnv', 'env vars section 3 never lists'],
      ['unpricedClients', 'metered clients section 4 never prices'],
      ['vanishedSurfaces', 'alert or log surfaces that vanished'],
      ['drift', 'changes since the committed baseline'],
    ]) {
      const count = outcome.sections[key].length;
      if (count > 0) log(`    ${String(count).padStart(3)}  ${heading}`);
    }
  }
  log('');
  log(`  report  ${join(outDir, filename)}`);

  return outcome.exitCode;
}

function doDemo({ flags, now, nowExplicit }, log) {
  const requested = flags['--out'];
  if (requested === undefined) throw new Refusal('demo needs --out <dir>, and it writes nothing outside it');
  // The fixture is a recording, so the demo's clock is the corpus date unless the caller pins one.
  return runDemo({ out: outputPath(requested), requested, now: nowExplicit ? now : DEMO_NOW, log });
}

export async function main({ argv, log = console.log, warn = console.error }) {
  let parsed;
  try {
    parsed = parse(argv);
  } catch (error) {
    if (error instanceof HelpRequested) {
      log(USAGE);
      return 0;
    }
    warn(`system-map: ${error.message}`);
    warn('');
    warn(USAGE);
    return 2;
  }

  try {
    switch (parsed.verb) {
      case 'scan':
        return doScan(parsed, log);
      case 'derive':
        return doDerive(parsed, log);
      case 'reconcile':
        return doReconcile(parsed, log);
      default:
        return doDemo(parsed, log);
    }
  } catch (error) {
    if (error instanceof Refusal) {
      warn(`system-map: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

export { BASELINE_SCHEMA };
