// The keyless demo. docs/SPEC.md decision E.
//
// This is the first thing a stranger runs, so it has to be true without qualification: no key, no
// network, nothing written outside `--out`, and the same bytes on every machine. The clock is
// pinned for that last reason. A report whose filename carries today's date is a report a
// byte-comparing test cannot check, and an example in a README that cannot be checked is an example
// that goes stale in silence.
//
// It exits 0 even though the reconcile inside it finds drift, on purpose. A non-zero demo reads as a
// broken install rather than as a working tool, and the output says so in as many words.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { scanRepo } from './scan.mjs';
import { deriveDraft } from './derive.mjs';
import { reconcile } from './reconcile.mjs';

// The corpus date. The fixture is a recording, so its report is dated when the recording was made.
export const DEMO_NOW = '2026-09-27T09:00:00.000Z';

export const FIXTURE_DIR = 'fixtures/demo-repo';

const fixtureRoot = () => fileURLToPath(new URL(`../${FIXTURE_DIR}/`, import.meta.url));

export function runDemo({ out, requested, now = DEMO_NOW, log }) {
  const root = fixtureRoot();
  mkdirSync(out, { recursive: true });

  // 1. scan
  const scan = scanRepo(root);
  writeFileSync(join(out, 'baseline.json'), `${JSON.stringify({ ...scan, generated_at: now }, null, 2)}\n`);

  // 2. derive
  const draft = deriveDraft(scan, { now, repoName: 'the kiteline fixture' });
  writeFileSync(join(out, 'system.draft.md'), `${draft}\n`);

  // 3. reconcile, against the fixture's own deliberately stale declared design and its committed
  //    baseline, both of which ship in the repo so the result is a recording rather than a surprise.
  const declaredText = readFileSync(join(root, '.vibecodepm/system.md'), 'utf8');
  const committedBaseline = JSON.parse(readFileSync(join(root, '.system-map/baseline.json'), 'utf8'));

  const outcome = reconcile({
    scan,
    declaredText,
    committedBaseline,
    now,
    systemPath: `${FIXTURE_DIR}/.vibecodepm/system.md`,
    baselinePath: `${FIXTURE_DIR}/.system-map/baseline.json`,
  });

  const reportName = `reconcile-${now.slice(0, 10)}.md`;
  writeFileSync(join(out, reportName), `${outcome.report}\n`);

  const answers = draft.split('\n## What the scan could not see')[0].split('\n').filter((line) => line.startsWith('- '));
  const unknowns = answers.filter((line) => line.startsWith('- Unknown:')).length;

  log('system-map demo');
  log('');
  log(`  Scanned an invented Node service and an invented Python worker: ${scan.counts.modules} modules,`);
  log(`  ${scan.counts.edges} edges, ${scan.counts.routes} routes, ${scan.counts.clients} known clients, ${scan.counts.env} environment variables.`);
  log('  No key, no network call, and nothing written outside --out.');
  log('');
  log(`  derive  ${answers.length} answers across the six architect questions`);
  log(`          ${answers.length - unknowns} read out of the code and cited at file:line`);
  log(`          ${unknowns} written as Unknown, naming what the scan could not see`);
  log('');
  log(`  reconcile  ${outcome.findings} findings against a declared map that is deliberately out of date`);
  for (const [key, heading] of [
    ['unnamedPieces', 'pieces the map does not name'],
    ['undeclaredEdges', 'edges the map omits'],
    ['undeclaredEnv', 'env vars section 3 never lists'],
    ['unpricedClients', 'metered clients section 4 never prices'],
    ['vanishedSurfaces', 'alert or log surfaces that vanished'],
    ['drift', 'changes since the committed baseline'],
  ]) {
    log(`      ${String(outcome.sections[key].length).padStart(3)}  ${heading}`);
  }
  log('');
  log(`  baseline   ${join(requested, 'baseline.json')}`);
  log(`  draft      ${join(requested, 'system.draft.md')}`);
  log(`  report     ${join(requested, reportName)}`);
  log('');
  log(`  The report inside exits ${outcome.exitCode}, because the fixture disagrees with its own map on`);
  log('  purpose. The demo itself exits 0: a non-zero demo reads as a broken install rather');
  log('  than as a working tool.');

  return 0;
}
