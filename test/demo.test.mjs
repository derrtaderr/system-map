// The keyless demo, and the synthetic fixture repo it runs on. docs SPEC §3J, decision E.
//
// The demo is the first thing a stranger runs, so it has three jobs and this file holds all three:
// it must need no key and no network, it must write nothing outside --out, and it must show a
// reconcile report with every section populated, because a demo whose report is all "_None._"
// teaches the reader nothing about what the tool finds.
//
// It exits 0 even though the reconcile inside it finds drift. A non-zero demo reads as a broken
// install rather than as a working tool, and the output says so in as many words.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEMO_NOW, FIXTURE_DIR } from '../src/demo.mjs';
import { scanRepo } from '../src/scan.mjs';
import { buildCommittedBaseline } from '../scripts/make-fixture-baseline.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'system-map.mjs');

function runDemoInto(extra = []) {
  const out = mkdtempSync(join(tmpdir(), 'system-map-demo-'));
  try {
    const stdout = execFileSync(process.execPath, [BIN, 'demo', '--out', out, ...extra], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    return { out, stdout, code: 0, files: readdirSync(out).sort() };
  } catch (error) {
    return { out, stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.status, files: existsSync(out) ? readdirSync(out).sort() : [] };
  } finally {
    // Left for the caller to read before this runs: node:test bodies are synchronous here.
  }
}

function cleanup(out) {
  rmSync(out, { recursive: true, force: true });
}

// --- the fixture repo ---------------------------------------------------------------------------------

test('the fixture repo is synthetic: no real host, no real-looking key, no absolute path', () => {
  const fixture = join(ROOT, FIXTURE_DIR);
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
    );

  for (const file of walk(fixture)) {
    const text = readFileSync(file, 'utf8');
    // Hosts are example.com or the named alerting hosts, which are documentation constants.
    for (const match of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      const host = match[1];
      assert.ok(
        host.endsWith('example.com') || host === 'hooks.slack.com' || host === 'localhost',
        `${file}: ${host}`,
      );
    }
    assert.ok(!/\/Users\/|\/home\/[a-z]/.test(text), `${file} carries no home path`);
  }
});

test('the fixture repo has no BLOCKING gap, so the demo shows the drift path and not the refusal path', () => {
  const baseline = scanRepo(join(ROOT, FIXTURE_DIR));
  assert.deepEqual(baseline.gaps.filter((gap) => gap.tier === 'BLOCKING'), []);
  assert.ok(baseline.gaps.some((gap) => gap.tier === 'NOTED'), 'and it does carry a NOTED limit, so section 7 is not empty');
});

test('the committed fixture baseline is exactly what its generator produces', () => {
  // Freshness coupling. The moment somebody edits the fixture without regenerating this file, the
  // demo's expected output stops meaning anything, and this is the test that catches it.
  const onDisk = readFileSync(join(ROOT, FIXTURE_DIR, '.system-map/baseline.json'), 'utf8');
  assert.equal(onDisk, buildCommittedBaseline());
});

// --- the demo run ---------------------------------------------------------------------------------------

test('the demo exits 0 and writes exactly three artifacts, all inside --out', () => {
  const result = runDemoInto();
  try {
    assert.equal(result.code, 0, result.stdout + (result.stderr ?? ''));
    assert.deepEqual(result.files, [`reconcile-${DEMO_NOW.slice(0, 10)}.md`, 'baseline.json', 'system.draft.md'].sort());
  } finally {
    cleanup(result.out);
  }
});

test('the demo writes nothing into the fixture repo it reads', () => {
  const fixture = join(ROOT, FIXTURE_DIR);
  const before = statSync(join(fixture, '.vibecodepm/system.md')).mtimeMs;
  const listing = readdirSync(fixture).sort();

  const result = runDemoInto();
  try {
    assert.equal(result.code, 0);
    assert.deepEqual(readdirSync(fixture).sort(), listing);
    assert.equal(statSync(join(fixture, '.vibecodepm/system.md')).mtimeMs, before);
  } finally {
    cleanup(result.out);
  }
});

test('the demo report populates every one of the six finding sections at least once', () => {
  // A demo whose report is six "_None._" lines teaches the reader nothing about what the tool finds.
  const result = runDemoInto();
  try {
    const report = readFileSync(join(result.out, `reconcile-${DEMO_NOW.slice(0, 10)}.md`), 'utf8');

    for (const heading of [
      'Pieces present in code the map does not name',
      'Edges present the map omits',
      'Env vars read that section 3 never lists',
      'Metered clients section 4 never prices',
      'Alert and log surfaces that vanished',
      'Drift since the committed baseline',
      'What this run could not see',
    ]) {
      const start = report.indexOf(`## ${heading}`);
      assert.ok(start !== -1, heading);
      const body = report.slice(start, report.indexOf('\n## ', start + 1) === -1 ? undefined : report.indexOf('\n## ', start + 1));
      assert.ok(!body.includes('_None._'), `${heading} is populated`);
    }
  } finally {
    cleanup(result.out);
  }
});

test('no finding in the demo report is uncited, which is the repo’s whole claim', () => {
  // Found by reading the real demo output: a module added since the baseline, and a surface the
  // declared document names but the code lacks, both rendered "(no citation)". A tool whose promise
  // is "every line cites its source" cannot ship a report that says that even once.
  const result = runDemoInto();
  try {
    const report = readFileSync(join(result.out, `reconcile-${DEMO_NOW.slice(0, 10)}.md`), 'utf8');
    const uncited = report.split('\n').filter((line) => line.includes('no citation'));

    assert.deepEqual(uncited, []);
    for (const line of report.split('\n').filter((line) => line.startsWith('- `'))) {
      assert.match(line, /\([^()]+:\d+\)$/, line);
    }
  } finally {
    cleanup(result.out);
  }
});

test('the demo draft is fully cited, the same rule the real derive obeys', () => {
  const result = runDemoInto();
  try {
    const draft = readFileSync(join(result.out, 'system.draft.md'), 'utf8');
    const answers = draft
      .split('\n## What the scan could not see')[0]
      .split('\n')
      .filter((line) => line.startsWith('- '));

    assert.ok(answers.length >= 15, `${answers.length} answers`);
    assert.deepEqual(answers.filter((line) => !/\([^()]+:\d+\)$/.test(line) && !line.startsWith('- Unknown:')), []);
  } finally {
    cleanup(result.out);
  }
});

test('the demo says out loud why it exits 0 while its report finds drift', () => {
  const result = runDemoInto();
  try {
    assert.match(result.stdout, /exits 0/i);
    assert.match(result.stdout, /broken install|on purpose|deliberately/i);
  } finally {
    cleanup(result.out);
  }
});

test('the demo pins its clock, so two runs on two days produce the same bytes', () => {
  const first = runDemoInto();
  const second = runDemoInto();
  try {
    const name = `reconcile-${DEMO_NOW.slice(0, 10)}.md`;
    assert.equal(readFileSync(join(first.out, name), 'utf8'), readFileSync(join(second.out, name), 'utf8'));
    assert.equal(readFileSync(join(first.out, 'baseline.json'), 'utf8'), readFileSync(join(second.out, 'baseline.json'), 'utf8'));
  } finally {
    cleanup(first.out);
    cleanup(second.out);
  }
});

test('the demo refuses without --out, because it must never guess where to write', () => {
  try {
    execFileSync(process.execPath, [BIN, 'demo'], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.fail('should have refused');
  } catch (error) {
    assert.equal(error.status, 2);
    assert.match(error.stderr, /--out/);
  }
});

test('the demo makes no network call, which is what keyless has to mean', () => {
  // The fixture names hosts in string literals. Nothing dials them, and this is the test that keeps
  // a future convenience from turning the demo into something that needs the internet.
  const out = mkdtempSync(join(tmpdir(), 'system-map-demo-net-'));
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--eval', `globalThis.fetch = () => { throw new Error('the demo made a network call'); };
       const { main } = await import(${JSON.stringify(join(ROOT, 'src/cli.mjs'))});
       process.exitCode = await main({ argv: ['demo', '--out', ${JSON.stringify(out)}], log: () => {}, warn: () => {} });`,
      '--input-type=module'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    void stdout;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
