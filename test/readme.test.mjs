// README freshness. docs/SPEC.md §6.
//
// Every console block marked with a `verified-block` comment is executed here and compared with the
// real output, byte for byte. A README that goes stale fails the suite in the commit that staled it,
// rather than three months later in front of the person deciding whether this repo is real.
//
// Precedent: signal-desk's readme-examples test and landed's readme test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { USAGE } from '../src/cli.mjs';
import { DEMO_NOW } from '../src/demo.mjs';
import { CATEGORIES } from '../src/registry.mjs';
import { SECTION_ORDER, LIMITS_HEADING } from '../src/report.mjs';
import { ARCHITECT_HEADINGS } from '../src/derive.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'system-map.mjs');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

// The demo's out directory for the README's examples. Outside the checkout on purpose, so running
// the documented command never leaves anything in a clone.
const DEMO_OUT = join('/tmp', 'system-map-demo');

function verifiedBlocks() {
  const pattern = /<!-- verified-block: ([a-z0-9-]+) -->\n```console\n([\s\S]*?)```/g;
  const blocks = new Map();

  for (const match of README.matchAll(pattern)) {
    const [, name, body] = match;
    const lines = body.split('\n');
    assert.ok(lines[0].startsWith('$ '), `block ${name} starts with a $ command line`);
    blocks.set(name, {
      argv: lines[0].slice(2).trim().split(/\s+/),
      expected: lines.slice(1).join('\n').replace(/\n$/, ''),
    });
  }

  return blocks;
}

const blocks = verifiedBlocks();

function runBlock(name) {
  const block = blocks.get(name);
  assert.ok(block !== undefined, `the README declares a ${name} block`);

  try {
    return execFileSync(process.execPath, [BIN, ...block.argv.slice(2)], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    }).replace(/\n$/, '');
  } catch (error) {
    // A documented command that exits non-zero still has stdout worth comparing, and `reconcile`
    // exits 1 whenever it finds anything, which on the fixture is always.
    if (error.stdout === undefined) throw error;
    return error.stdout.replace(/\n$/, '');
  }
}

test('the README declares exactly the verified blocks this test knows how to check', () => {
  assert.deepEqual([...blocks.keys()].sort(), ['demo', 'reconcile', 'scan']);
});

test('every verified block invokes the real bin path, not an installed copy', () => {
  for (const [name, block] of blocks) {
    assert.deepEqual(block.argv.slice(0, 2), ['node', 'bin/system-map.mjs'], `block ${name}`);
  }
});

test('every verified block writes only outside the checkout', () => {
  for (const [name, block] of blocks) {
    const out = block.argv[block.argv.indexOf('--out') + 1];
    assert.ok(out !== undefined && out.startsWith('/tmp/'), `${name} writes to ${out}`);
  }
});

test('README: the demo example matches the real output', () => {
  rmSync(DEMO_OUT, { recursive: true, force: true });
  try {
    assert.equal(runBlock('demo'), blocks.get('demo').expected);
  } finally {
    rmSync(DEMO_OUT, { recursive: true, force: true });
  }
});

test('README: the scan example matches the real output', () => {
  rmSync(DEMO_OUT, { recursive: true, force: true });
  try {
    assert.equal(runBlock('scan'), blocks.get('scan').expected);
  } finally {
    rmSync(DEMO_OUT, { recursive: true, force: true });
  }
});

test('README: the reconcile example matches the real output', () => {
  rmSync(DEMO_OUT, { recursive: true, force: true });
  try {
    runBlock('scan');
    assert.equal(runBlock('reconcile'), blocks.get('reconcile').expected);
  } finally {
    rmSync(DEMO_OUT, { recursive: true, force: true });
  }
});

// --- claims the README makes that the code has to keep --------------------------------------------

test('the README names the Node version package.json requires', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const major = pkg.engines.node.replace(/[^0-9]/g, '');
  assert.ok(README.includes(`Node ${major}`), `README names Node ${major}`);
});

test('the README clone line points at this repository', () => {
  assert.match(README, /git clone https:\/\/github\.com\/derrtaderr\/system-map\.git/);
});

test('every verb the README shows is one the CLI documents, and the other way round', () => {
  for (const verb of ['scan', 'derive', 'reconcile', 'demo']) {
    assert.ok(README.includes(`bin/system-map.mjs ${verb}`), `README shows ${verb}`);
    assert.ok(USAGE.includes(`system-map.mjs ${verb}`), `usage documents ${verb}`);
  }
});

test('the README advertises no verb this phase has not built', () => {
  // The phase 2 verb and the things a reader might reasonably assume a drift tool does.
  for (const verb of ['decisions', 'fix', 'watch', 'serve', 'diagram', 'explain']) {
    assert.ok(!README.includes(`bin/system-map.mjs ${verb}`), `README does not show ${verb}`);
    assert.ok(!USAGE.includes(`system-map.mjs ${verb}`), `usage does not show ${verb}`);
  }
});

test('the README states all four exit codes the CLI returns', () => {
  for (const code of ['0', '1', '2', '3']) {
    assert.ok(README.includes(`| \`${code}\` |`), `exit code ${code} is documented`);
  }
  assert.match(README, /outranks/i, 'and the rule that 3 outranks 1');
});

test('the README names every report section, in the order the report writes them', () => {
  let cursor = 0;
  for (const [, heading] of SECTION_ORDER) {
    const at = README.indexOf(heading, cursor);
    assert.ok(at !== -1, `README names "${heading}"`);
    cursor = at;
  }
  assert.ok(README.includes(LIMITS_HEADING), LIMITS_HEADING);
});

test('the README names all six architect questions derive fills', () => {
  for (const heading of ARCHITECT_HEADINGS) {
    const question = heading.replace(/^\d+\.\s*/, '');
    assert.ok(README.includes(question), question);
  }
});

test('the README lists every BLOCKING gap code the false-green table enforces', () => {
  for (const code of [
    'EMPTY_REPO',
    'UNREADABLE_FILE',
    'MANIFEST_UNPARSED',
    'SYSTEM_MD_ABSENT',
    'SYSTEM_MD_UNPARSEABLE',
    'BASELINE_ABSENT',
    'BASELINE_SCHEMA_UNKNOWN',
  ]) {
    assert.ok(README.includes(code), code);
  }
});

test('the README names the four registry categories', () => {
  for (const category of CATEGORIES) assert.ok(README.includes(`\`${category}\``), category);
});

test('the README says what the tool cannot see, and points at the page that says it in full', () => {
  // The honesty claim. A README that only lists capabilities is a README that oversells a heuristic.
  assert.match(README, /cannot see/i);
  assert.ok(README.includes('docs/DESIGN.md'));
  assert.ok(README.includes('docs/SPEC.md'));
});

test('the README says there is no model and no dependency, which two tests elsewhere enforce', () => {
  assert.match(README, /no model|no LLM/i);
  assert.match(README, /zero dependencies|no dependency|no dependencies/i);
});

test('the npm scripts the README tells you to run exist', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const script of ['test', 'privacy']) {
    assert.ok(pkg.scripts[script], `package.json defines ${script}`);
    assert.ok(README.includes(`npm run ${script}`) || README.includes(`npm ${script}`), script);
  }
});

test('the README’s dated example agrees with the demo’s pinned clock', () => {
  assert.ok(README.includes(DEMO_NOW.slice(0, 10)), DEMO_NOW.slice(0, 10));
});
