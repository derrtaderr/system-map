// The privacy guard, and the rules it enforces on the tracked tree. docs/SPEC.md §3J.
//
// This file and scripts/privacy-guard.mjs are the only two paths the guard skips, because both have
// to contain the very strings it refuses. That skip list is asserted below so it cannot grow quietly,
// which is the only thing that would make the guard meaningless.
//
// Precedent: landed's guard, same three rules. The HOME_PATH rule is a scar from a prior lane in this
// vault that shipped personal paths into a public tree.

import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanText, scan, SKIPPED_PATHS, SYNTHETIC_DOMAINS } from '../scripts/privacy-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Assembled from parts, so this file's own samples are not mistaken for the real thing by a human
// skim, and so the patterns below are the guard's rather than copies of them.
const REAL_EMAIL = ['dana.ruiz', '@', 'acmerobotics', '.com'].join('');
const PHONE = ['555', '-', '018', '-', '4477'].join('');
const HOME_PATH = ['/User', 's/', 'someone', '/Projects/thing'].join('');

test('the skip list is exactly the guard and its own test', () => {
  assert.deepEqual([...SKIPPED_PATHS].sort(), ['scripts/privacy-guard.mjs', 'test/privacy-guard.test.mjs']);
});

test('the synthetic allowlist is the documented set and nothing else', () => {
  assert.deepEqual([...SYNTHETIC_DOMAINS].sort(), ['example.com', 'example.net', 'example.org', 'invalid', 'localhost', 'test']);
});

// --- emails ---------------------------------------------------------------------------------------

test('an email at a real-looking domain is refused anywhere, fixtures included', () => {
  // A fixture is supposed to be invented, so a real-looking address in one is the finding, not the
  // exception.
  const findings = scanText('fixtures/whatever.json', `{"to":"${REAL_EMAIL}"}`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'EMAIL');
});

test('an email at a synthetic domain passes', () => {
  for (const domain of ['example.com', 'example.org', 'example.net', 'acme.test', 'nothing.invalid', 'localhost']) {
    assert.deepEqual(scanText('fixtures/x.json', `{"to":"someone@${domain}"}`), [], domain);
  }
});

// --- phone numbers --------------------------------------------------------------------------------

test('a phone-shaped string outside fixtures is refused', () => {
  const findings = scanText('README.md', `call ${PHONE} for details`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'PHONE');
});

test('the same string inside fixtures is allowed, because a fixture is synthetic by rule', () => {
  assert.deepEqual(scanText('fixtures/leads.json', `{"phone":"${PHONE}"}`), []);
});

test('a timestamp, a version and a cron string are not phone numbers', () => {
  // A guard that cries wolf on this repo's own fixtures is a guard somebody turns off, and this repo
  // is full of dates and cron strings.
  for (const sample of ['2026-09-27T09:00:00.000Z', '2026-09-27', '0 9 * * *', '1758888000000', 'exit 127']) {
    assert.deepEqual(scanText('README.md', sample), [], sample);
  }
});

// --- home paths -----------------------------------------------------------------------------------

test('an absolute home path is refused anywhere', () => {
  const findings = scanText('docs/SPEC.md', `the worktree lives at ${HOME_PATH}`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'HOME_PATH');
});

test('a linux home path is refused too', () => {
  assert.equal(scanText('README.md', ['/hom', 'e/', 'someone', '/repo'].join(''))[0].rule, 'HOME_PATH');
});

test('a relative path that merely mentions users is not a home path', () => {
  assert.deepEqual(scanText('README.md', 'see docs/users.md and /usr/local/bin/node'), []);
});

// --- the real tree --------------------------------------------------------------------------------

test('the tracked tree is clean, which is the gate this repo actually ships behind', () => {
  assert.deepEqual(
    scan(ROOT).map((finding) => `${finding.path}:${finding.line} ${finding.rule}`),
    [],
  );
});

test('the scan covers a meaningful number of files, so a clean result is not an empty scan', () => {
  const { scanned } = scan(ROOT, { withCount: true });
  assert.ok(scanned >= 25, `scanned ${scanned} files`);
});
