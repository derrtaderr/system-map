// The one table both ends of the round trip read.
//
// `derive` writes these headings. `declared` parses them. Until this file existed each end had its own
// idea of what a section was called, and they disagreed in two places that no test covered:
//
//   `## 4. What bills per use` — derive's own heading — did not match a parser pattern looking for the
//   word "bill", so every metered client came back unpriced.
//
//   `# System map, derived` — derive's own H1 — matched the parser's map keyword and claimed the map
//   section, so the real `## 1. The map` was dropped as a duplicate and every piece came back unnamed.
//
// Both were invisible because derive was only ever tested against its own output and the parser only
// ever against hand-written documents. Nothing exercised the join. test/round-trip.test.mjs does, and
// the last test in it asserts every heading below classifies to the key beside it, so the two halves
// cannot drift apart again without a red suite.

export const ARCHITECT_HEADINGS = [
  '1. The map',
  '2. Where state lives',
  '3. Doors and keys',
  '4. What bills per use',
  '5. How you find out it broke',
  '6. Blast radius per piece',
];

// heading -> section key. The canonical pass. A document that uses these exact words needs no
// guessing, and the tool's own output always does.
export const SECTION_OF_HEADING = new Map([
  [ARCHITECT_HEADINGS[0], 'map'],
  [ARCHITECT_HEADINGS[1], 'state'],
  [ARCHITECT_HEADINGS[2], 'doors'],
  [ARCHITECT_HEADINGS[3], 'bill'],
  [ARCHITECT_HEADINGS[4], 'watch'],
  [ARCHITECT_HEADINGS[5], 'blast'],
]);

// The title derive puts at the top of a draft. It is a title, not a section, and it is listed here so
// the parser can say so rather than inferring it from the heading level alone.
export const DRAFT_TITLE = 'System map, derived';

export const GAP_HEADING = 'What the scan could not see';

// Normalised for comparison: a leading number, punctuation and case are not part of what a heading
// means. `## 4. What bills per use`, `#### what bills per use` and `4 — What Bills Per Use` are one
// heading.
export function normaliseHeading(heading) {
  return String(heading)
    .replace(/^\s*\d+\s*[.)—–-]?\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const CANONICAL_BY_NORMALISED = new Map(
  [...SECTION_OF_HEADING.entries()].map(([heading, key]) => [normaliseHeading(heading), key]),
);

// The key a heading names exactly, or null. Case, numbering and punctuation do not matter; the words do.
export function canonicalSection(heading) {
  return CANONICAL_BY_NORMALISED.get(normaliseHeading(heading)) ?? null;
}

export function isDraftTitle(heading) {
  return normaliseHeading(heading) === normaliseHeading(DRAFT_TITLE);
}
