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
export const DELTA_KINDS = ['modules', 'edges', 'env', 'routes', 'clients', 'hosts', 'schedules', 'observability', 'authChecks'];

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

export function computeDelta(before, after) {
  const delta = {};
  let count = 0;

  for (const kind of DELTA_KINDS) {
    const left = index(before, kind);
    const right = index(after, kind);

    const added = [...right.entries()]
      .filter(([id]) => !left.has(id))
      .map(([id, entry]) => ({ id, entry, cite: entry.cite ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id));

    const removed = [...left.entries()]
      .filter(([id]) => !right.has(id))
      .map(([id, entry]) => ({ id, entry, cite: entry.cite ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id));

    delta[kind] = { added, removed };
    count += added.length + removed.length;
  }

  delta.count = count;
  delta.empty = count === 0;
  return delta;
}
