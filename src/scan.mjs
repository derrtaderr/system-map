// The scan. docs/SPEC.md §3A, §3B, §3I.
//
// One pass over a repo, every extractor's output under its own key, every entry carrying
// file:line, and nothing in the file that would make two runs on two machines differ. That last
// property is the reason `generated_at` is stamped by the CLI when it WRITES a baseline and is not
// part of the scan: a timestamp inside the scan would make every diff dirty and the baseline
// worthless as a reference point.

import { readRepo } from './walk.mjs';
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

export const BASELINE_SCHEMA = 'system-map/baseline@1';

const byCite = (a, b) => String(a.cite).localeCompare(String(b.cite));

export function scanRepo(root) {
  const { files, contents, gaps: readGaps } = readRepo(root);
  const fileSet = new Set(files);

  const modules = [];
  const rawEdges = [];
  const manifests = [];
  const env = [];
  const routes = [];
  const hosts = [];
  const schedules = [];
  const observability = [];
  const authChecks = [];
  const gaps = [...readGaps];

  for (const path of files) {
    const language = languageOf(path);
    // A module is a code file, whether or not we could open it. The file existing is a fact about
    // the repo; failing to read it is a separate, already-reported gap.
    if (language !== null) modules.push({ path, language });

    const text = contents.get(path);
    if (text === undefined) continue;

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
      detail: 'no source file was found under the scanned path, so nothing here can be judged against a declared design',
    });
  }

  const clients = clientsFromEdges(resolved.edges);

  const baseline = {
    schema: BASELINE_SCHEMA,
    modules,
    edges: resolved.edges.sort((a, b) => byCite(a, b) || String(a.specifier).localeCompare(String(b.specifier))),
    manifests: manifests.sort((a, b) => a.path.localeCompare(b.path)),
    env: env.sort(byCite),
    routes: routes.sort(byCite),
    clients,
    hosts: hosts.sort(byCite),
    schedules: schedules.sort(byCite),
    observability: observability.sort(byCite),
    authChecks: authChecks.sort(byCite),
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
