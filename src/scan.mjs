// The scan. docs/SPEC.md §3A, §3B, §3I.
//
// One pass over a repo, every extractor's output under its own key, every entry carrying
// file:line, and nothing in the file that would make two runs on two machines differ. That last
// property is the reason `generated_at` is stamped by the CLI when it WRITES a baseline and is not
// part of the scan: a timestamp inside the scan would make every diff dirty and the baseline
// worthless as a reference point.

import { readRepo, isTestPath } from './walk.mjs';
import { resolveEdges } from './resolve.mjs';
import { languageOf } from './extract/text.mjs';
import { extractEdges } from './extract/edges.mjs';
import { extractEnv } from './extract/env.mjs';
import { extractRoutes } from './extract/routes.mjs';
import { extractSchedules } from './extract/schedules.mjs';
import { extractObservability } from './extract/observability.mjs';
import { extractAuthChecks } from './extract/auth.mjs';
import { extractHosts, clientsFromEdges } from './extract/clients.mjs';
import { extractManifest, isManifestPath } from './extract/manifests.mjs';
import { extractWrites } from './extract/writes.mjs';
import { extractShellOuts } from './extract/shell.mjs';

export const BASELINE_SCHEMA = 'system-map/baseline@1';

const byCite = (a, b) => String(a.cite).localeCompare(String(b.cite));

// Each extractor dedupes within one file, which is not enough for a variable. A key read in the
// .env.example and in three modules is ONE key, and listing it four times makes a reader count four
// secrets where there is one. First citation wins; the rest travel as `alsoAt` so nothing is lost.
function dedupeByName(entries) {
  const first = new Map();

  for (const entry of entries.sort(byCite)) {
    const existing = first.get(entry.name);
    if (existing === undefined) {
      first.set(entry.name, { ...entry, alsoAt: [] });
      continue;
    }
    existing.alsoAt.push(entry.cite);
  }

  return [...first.values()].sort(byCite);
}

export function scanRepo(root, { includeTests = false } = {}) {
  const { files, contents, gaps: readGaps } = readRepo(root);
  const fileSet = new Set(files);

  const modules = [];
  const testFiles = [];
  const rawEdges = [];
  const manifests = [];
  const env = [];
  const routes = [];
  const hosts = [];
  const schedules = [];
  const observability = [];
  const authChecks = [];
  const writes = [];
  const shells = [];
  const gaps = [...readGaps];

  for (const path of files) {
    const language = languageOf(path);

    // docs/SPEC.md §4A row D4. A test file is part of the repository and not part of the system: it is
    // counted, so "excluded" never reads as "unread", but it is not a piece, it has no blast radius,
    // and a variable or a route that appears ONLY in a test is not a door the system opens. On one
    // dogfood repo tests were 48 of 80 modules, and two of another's three "environment variables"
    // were PATH read inside a test's env allowlist.
    const isTest = language !== null && !includeTests && isTestPath(path);
    if (isTest) testFiles.push(path);

    if (language !== null && !isTest) modules.push({ path, language, cite: `${path}:1` });

    const text = contents.get(path);
    if (text === undefined || isTest) continue;

    if (isManifestPath(path)) {
      const { manifest, gaps: manifestGaps } = extractManifest(path, text);
      if (manifest !== null) manifests.push(manifest);
      gaps.push(...manifestGaps);
    }

    const edges = extractEdges(path, text);
    rawEdges.push(...edges.edges);
    gaps.push(...edges.gaps);

    env.push(...extractEnv(path, text).env);
    routes.push(...extractRoutes(path, text).routes);
    hosts.push(...extractHosts(path, text).hosts);
    schedules.push(...extractSchedules(path, text).schedules);
    observability.push(...extractObservability(path, text).surfaces);
    authChecks.push(...extractAuthChecks(path, text).checks);
    writes.push(...extractWrites(path, text, { includeTests }).writes);
    shells.push(...extractShellOuts(path, text, { includeTests }).shells);
  }

  const resolved = resolveEdges(rawEdges, fileSet);
  gaps.push(...resolved.gaps);

  // False-green row 1. Zero modules is the state in which every downstream answer looks agreed,
  // because there is nothing left to disagree with.
  if (modules.length === 0) {
    gaps.push({
      tier: 'BLOCKING',
      code: 'EMPTY_REPO',
      path: '.',
      line: 1,
      cite: '.',
      detail: testFiles.length > 0
        ? `the only source files found were ${testFiles.length} test file(s), which are excluded from the system by default, so there is nothing here to judge against a declared design. Pass --include-tests if the tests ARE the subject`
        : 'no source file was found under the scanned path, so nothing here can be judged against a declared design',
    });
  }

  const clients = clientsFromEdges(resolved.edges);

  const baseline = {
    schema: BASELINE_SCHEMA,
    modules,
    edges: resolved.edges.sort((a, b) => byCite(a, b) || String(a.specifier).localeCompare(String(b.specifier))),
    manifests: manifests.sort((a, b) => a.path.localeCompare(b.path)),
    env: dedupeByName(env),
    routes: routes.sort(byCite),
    clients,
    hosts: hosts.sort(byCite),
    schedules: schedules.sort(byCite),
    observability: observability.sort(byCite),
    authChecks: dedupeByName(authChecks),
    writes: writes.sort(byCite),
    shells: shells.sort(byCite),
    testFiles: testFiles.sort(),
    gaps: gaps.sort((a, b) => a.code.localeCompare(b.code) || String(a.cite).localeCompare(String(b.cite))),
  };

  baseline.counts = {
    modules: baseline.modules.length,
    edges: baseline.edges.length,
    manifests: baseline.manifests.length,
    env: baseline.env.length,
    routes: baseline.routes.length,
    clients: baseline.clients.length,
    hosts: baseline.hosts.length,
    schedules: baseline.schedules.length,
    observability: baseline.observability.length,
    authChecks: baseline.authChecks.length,
    writes: baseline.writes.length,
    shells: baseline.shells.length,
    testFiles: baseline.testFiles.length,
    gaps: baseline.gaps.length,
    blockingGaps: baseline.gaps.filter((gap) => gap.tier === 'BLOCKING').length,
  };

  return baseline;
}

// Every BLOCKING gap in one place, because three callers need the same question answered and each
// one of them getting it slightly wrong is how a fail-closed tool quietly starts exiting 0.
export function blockingGaps(collection) {
  return collection.filter((gap) => gap.tier === 'BLOCKING');
}
