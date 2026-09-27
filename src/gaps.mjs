// The gap codes, in one place. docs/SPEC.md §3D.
//
// This file exists because the same list was written down four times — SPEC, README, DESIGN and the
// code — and the four disagreed. SPEC called six of them exhaustive while README and DESIGN listed
// seven, and fix wave 1 added an eighth. test/spec-claims.test.mjs now checks every one of those
// places against this list, and checks this list against what the code actually emits.
//
// The two tiers are the load-bearing part, and the reason is in SPEC §3D: if every gap were blocking,
// every real repo's one dynamic import would make `reconcile` exit 3 forever and nobody would run it
// twice. If none were, a reconcile against a `system.md` nobody could read would find nothing and exit
// clean.

// BLOCKING: the run could not read enough to judge. Exit 3, and 3 outranks 1.
export const BLOCKING_CODES = [
  'EMPTY_REPO',
  'UNREADABLE_FILE',
  'UNREADABLE_DIR',
  'MANIFEST_UNPARSED',
  'SYSTEM_MD_ABSENT',
  'SYSTEM_MD_UNPARSEABLE',
  'BASELINE_ABSENT',
  'BASELINE_SCHEMA_UNKNOWN',
];

// NOTED: a structural limit of reading a repo as text, known in advance. Never changes the exit code.
export const NOTED_CODES = [
  'DYNAMIC_SPECIFIER',
  'UNRESOLVED_SPECIFIER',
  'DYNAMIC_IMPORT_MODULE',
  'SYMLINK_OUTSIDE_REPO',
  'SYMLINK_LOOP',
  'FILE_TOO_LARGE',
];

export const ALL_GAP_CODES = [...BLOCKING_CODES, ...NOTED_CODES];

// Throws on a code nobody declared, rather than defaulting. A typo that silently downgraded a blocking
// gap to noted would turn a fail-closed tool into one that exits 0 on an unread repo.
export function isBlockingCode(code) {
  if (BLOCKING_CODES.includes(code)) return true;
  if (NOTED_CODES.includes(code)) return false;
  throw new Error(`unknown gap code: ${code}. Declare it in src/gaps.mjs with its tier before emitting it.`);
}
