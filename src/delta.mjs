// A committed baseline against a fresh scan. docs/SPEC.md decision D.
//
// This is its own module with its own tests because phase 2's ADR drafter consumes it. A diff
// engine that only ever ran inside a report is a diff engine nobody can reuse, and the ADR verb is
// exactly the caller that needs "what moved" without needing "what the report said about it".
// Phase 1 exposes no verb for it: section 6 of the reconcile report is its only caller today.
//
// One judgement carries the whole module: identity is WHAT a thing is, never where it sits. A
// function that moved from line 12 to line 30 is not architectural drift. A tool that called it
// drift would train its reader to skim the report, and a report that gets skimmed is the failure
// mode this repo was built to fix.

// Manifests are deliberately absent. A dependency appearing in package.json without an import is
// a packaging change, not an architectural one, and the import it eventually grows shows up here as
// an edge and a client on the run that introduces it.
export const DELTA_KINDS = ['modules', 'edges', 'env', 'routes', 'clients', 'hosts', 'schedules', 'observability', 'authChecks', 'writes', 'shells'];

// The identity of each kind. Every one of these deliberately excludes the citation.
const IDENTITY = {
  modules: (entry) => entry.path,
  edges: (entry) => `${entry.from} -> ${entry.to ?? entry.specifier}`,
  env: (entry) => entry.name,
  routes: (entry) => `${entry.method} ${entry.path}`,
  clients: (entry) => entry.name,
  hosts: (entry) => entry.host,
  schedules: (entry) => `${entry.kind} ${entry.detail}`,
  observability: (entry) => `${entry.kind} ${entry.name}`,
  authChecks: (entry) => entry.name,
  writes: (entry) => `${entry.call} ${entry.target}`,
  shells: (entry) => entry.target,
};

function list(baseline, kind) {
  const value = baseline?.[kind];
  return Array.isArray(value) ? value : [];
}

function index(baseline, kind) {
  const identify = IDENTITY[kind];
  const out = new Map();
  for (const entry of list(baseline, kind)) {
    const id = identify(entry);
    if (!out.has(id)) out.set(id, entry);
  }
  return out;
}

// A rename used to be four rows: module added, module removed, edge added, edge removed. On a report whose
// entire value is that a reader finishes it, one file moving is one fact. docs/SPEC.md §4A row M9.
//
// Content identity is what makes this safe. A path that disappeared and a path that appeared with the SAME
// content hash, one of each, is a rename. Two files that share content while both still existing is a
// copy, and a file whose content changed is a genuine add and remove.
function pairRenames(added, removed) {
  const renamed = [];
  const byHash = new Map();

  for (const entry of removed) {
    const hash = entry.entry.contentHash;
    if (hash === undefined || hash === null) continue;
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(entry);
  }

  const claimedRemovals = new Set();
  const survivingAdds = [];

  for (const entry of added) {
    const hash = entry.entry.contentHash;
    const candidates = hash === undefined || hash === null ? [] : (byHash.get(hash) ?? []).filter((candidate) => !claimedRemovals.has(candidate.id));

    // Exactly one candidate, or the pairing is a guess.
    if (candidates.length !== 1) {
      survivingAdds.push(entry);
      continue;
    }

    claimedRemovals.add(candidates[0].id);
    renamed.push({
      id: `renamed ${candidates[0].id} → ${entry.id}`,
      entry: entry.entry,
      cite: entry.cite ?? candidates[0].cite ?? null,
      from: candidates[0].id,
      to: entry.id,
    });
  }

  return {
    renamed: renamed.sort((a, b) => a.id.localeCompare(b.id)),
    added: survivingAdds,
    removed: removed.filter((entry) => !claimedRemovals.has(entry.id)),
  };
}

export function computeDelta(before, after) {
  const delta = {};
  let count = 0;

  for (const kind of DELTA_KINDS) {
    const left = index(before, kind);
    const right = index(after, kind);

    const rawAdded = [...right.entries()]
      .filter(([id]) => !left.has(id))
      .map(([id, entry]) => ({ id, entry, cite: entry.cite ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id));

    const rawRemoved = [...left.entries()]
      .filter(([id]) => !right.has(id))
      .map(([id, entry]) => ({ id, entry, cite: entry.cite ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id));

    // Only modules carry a content hash, so only modules can be paired.
    const { renamed, added, removed } = kind === 'modules'
      ? pairRenames(rawAdded, rawRemoved)
      : { renamed: [], added: rawAdded, removed: rawRemoved };

    delta[kind] = { added, removed, renamed };
    count += added.length + removed.length + renamed.length;
  }

  delta.count = count;
  delta.empty = count === 0;
  return delta;
}
