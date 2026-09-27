// The CLI. docs/SPEC.md §3H and §3K.
//
// The exit code is the part that matters most, because this runs from /weekly and from CI, where
// nobody reads the prose. And §3K is the property that makes the dogfood runs read-only by
// construction: `--out` resolves against the working directory, never against the repo being
// scanned, so pointing the tool at somebody else's repo cannot write into it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { USAGE } from '../src/cli.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'system-map.mjs');
const NOW = '2026-09-27T12:00:00.000Z';

function sandbox(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'system-map-cli-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

// Run the bin the way a reader would, and return both the code and the output rather than throwing,
// because a non-zero exit is the normal case for a tool whose job is to find things.
function run(argv, { cwd }) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...argv], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH } });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

function withSandbox(files, body) {
  const root = sandbox(files);
  try {
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const A_REPO = {
  'package.json': JSON.stringify({ name: 'demo', dependencies: { stripe: '^14' } }),
  'src/api.mjs': "import Stripe from 'stripe';\nprocess.env.STRIPE_SECRET;\napp.get('/health', h);\n",
};

const DECLARED = ['## 1. The map', '', '- **API** (`src/api.mjs`) — answers requests.', '', '## 3. Doors and keys', '', '`STRIPE_SECRET` only.', '', '## 4. The bill', '', '`stripe` charges.', ''].join('\n');

// --- usage and refusals ---------------------------------------------------------------------------

test('a bare invocation prints usage and refuses, rather than guessing a verb', () => {
  withSandbox({}, (root) => {
    const result = run([], { cwd: root });
    assert.equal(result.code, 2);
    assert.match(result.stderr + result.stdout, /Usage/);
  });
});

test('--help exits 0 and prints the usage the README is checked against', () => {
  withSandbox({}, (root) => {
    const result = run(['--help'], { cwd: root });
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes('system-map'));
  });
});

test('every verb the usage documents is one the CLI accepts, and no other', () => {
  for (const verb of ['scan', 'derive', 'reconcile', 'demo']) {
    assert.ok(USAGE.includes(`system-map.mjs ${verb}`), verb);
  }
  withSandbox({}, (root) => {
    assert.equal(run(['decisions'], { cwd: root }).code, 2, 'the phase 2 verb is refused, not stubbed');
  });
});

test('an unknown flag is refused rather than ignored', () => {
  withSandbox(A_REPO, (root) => {
    const result = run(['scan', '--verbose'], { cwd: root });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /unknown flag/i);
  });
});

test('a flag written with an equals sign is refused, naming the spelling that works', () => {
  withSandbox(A_REPO, (root) => {
    const result = run(['scan', '--out=baseline.json'], { cwd: root });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /--out baseline\.json/);
  });
});

test('a flag given twice is refused, so no invocation quietly becomes a different one', () => {
  withSandbox(A_REPO, (root) => {
    const result = run(['scan', '--out', 'a.json', '--out', 'b.json'], { cwd: root });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /twice/);
  });
});

test('a path that does not exist is a refusal, not an empty scan', () => {
  withSandbox({}, (root) => {
    const result = run(['scan', 'nowhere'], { cwd: root });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /nowhere/);
  });
});

// --- scan -------------------------------------------------------------------------------------------

test('scan writes a baseline at the default path and stamps it', () => {
  withSandbox(A_REPO, (root) => {
    const result = run(['scan', '--now', NOW], { cwd: root });
    assert.equal(result.code, 0);

    const baseline = JSON.parse(readFileSync(join(root, '.system-map/baseline.json'), 'utf8'));
    assert.equal(baseline.generated_at, NOW);
    assert.equal(baseline.counts.modules, 1);
    assert.match(result.stdout, /baseline/);
  });
});

test('scan exits 3 when it could not read something, and still writes what it did read', () => {
  withSandbox({ 'README.md': '# nothing' }, (root) => {
    const result = run(['scan', '--now', NOW], { cwd: root });
    assert.equal(result.code, 3);
    assert.ok(existsSync(join(root, '.system-map/baseline.json')), 'the file is still written');
    assert.match(result.stdout + result.stderr, /EMPTY_REPO/);
  });
});

test('scan writes where --out says, resolved against the working directory and not the scanned repo', () => {
  // §3K, and the reason the dogfood runs cannot touch the repos they read.
  withSandbox({}, (out) => {
    withSandbox(A_REPO, (repo) => {
      const result = run(['scan', repo, '--out', 'elsewhere/baseline.json', '--now', NOW], { cwd: out });
      assert.equal(result.code, 0);
      assert.ok(existsSync(join(out, 'elsewhere/baseline.json')), 'written beside the working directory');
      assert.ok(!existsSync(join(repo, '.system-map')), 'and nothing was written into the scanned repo');
    });
  });
});

test('the baseline scan writes is the one reconcile reads back', () => {
  withSandbox(A_REPO, (root) => {
    assert.equal(run(['scan', '--now', NOW], { cwd: root }).code, 0);
    mkdirSync(join(root, '.vibecodepm'), { recursive: true });
    writeFileSync(join(root, '.vibecodepm/system.md'), DECLARED);
    const result = run(['reconcile', '--now', NOW], { cwd: root });
    assert.equal(result.code, 0, result.stdout + result.stderr);
  });
});

// --- derive -------------------------------------------------------------------------------------------

test('derive writes a draft at the default path', () => {
  withSandbox(A_REPO, (root) => {
    const result = run(['derive', '--now', NOW], { cwd: root });
    assert.equal(result.code, 0);
    const draft = readFileSync(join(root, '.vibecodepm/system.draft.md'), 'utf8');
    assert.match(draft, /^---\n/);
    assert.match(draft, /1\. The map/);
  });
});

test('derive never overwrites an existing system.md, and says where it put the draft instead', () => {
  withSandbox({ ...A_REPO, '.vibecodepm/system.md': '# the real one, hand written\n' }, (root) => {
    const result = run(['derive', '--now', NOW], { cwd: root });

    assert.equal(result.code, 0);
    assert.equal(readFileSync(join(root, '.vibecodepm/system.md'), 'utf8'), '# the real one, hand written\n');
    assert.ok(existsSync(join(root, '.vibecodepm/system.draft.md')));
    assert.match(result.stdout, /system\.md/, 'and it tells you the confirmed one was left alone');
  });
});

test('derive refuses to write over any existing file, rather than silently replacing work', () => {
  withSandbox({ ...A_REPO, 'draft.md': 'mine\n' }, (root) => {
    const result = run(['derive', '--out', 'draft.md', '--now', NOW], { cwd: root });
    assert.equal(result.code, 2);
    assert.equal(readFileSync(join(root, 'draft.md'), 'utf8'), 'mine\n');
    assert.match(result.stderr, /--force/);
  });
});

test('derive --force overwrites, because a refusal with no way past it is a tool you stop using', () => {
  withSandbox({ ...A_REPO, 'draft.md': 'mine\n' }, (root) => {
    const result = run(['derive', '--out', 'draft.md', '--force', '--now', NOW], { cwd: root });
    assert.equal(result.code, 0);
    assert.match(readFileSync(join(root, 'draft.md'), 'utf8'), /1\. The map/);
  });
});

test('derive refuses to write to a path called system.md, whatever the flags say', () => {
  // The confirmed document is a human's. A tool that can be talked into overwriting it with a
  // derived draft has no business being run unattended.
  withSandbox(A_REPO, (root) => {
    const result = run(['derive', '--out', 'docs/system.md', '--force', '--now', NOW], { cwd: root });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /system\.md/);
  });
});

test('a derived draft carries no absolute path, even when the CLI was given one', () => {
  // Found by dogfooding: `derived_from` echoed the argv path, so a draft derived with an absolute
  // path carried a home directory into a file meant to be committed. That is the guard's own
  // HOME_PATH rule, broken in the tool's output rather than in its tree.
  withSandbox({}, (out) => {
    withSandbox(A_REPO, (repo) => {
      const result = run(['derive', repo, '--out', 'draft.md', '--now', NOW], { cwd: out });
      assert.equal(result.code, 0, result.stderr);

      const draft = readFileSync(join(out, 'draft.md'), 'utf8');
      assert.ok(!draft.includes(repo), 'the absolute path does not appear');
      assert.ok(!/\/Users\/|\/home\/|\/var\/folders\//.test(draft), draft.split('\n').slice(0, 10).join('\n'));
      assert.match(draft, /derived_from: [^/\n]+\n/, 'and it still names the repo by something');
    });
  });
});

// --- reconcile ------------------------------------------------------------------------------------------

test('reconcile writes a dated report and exits 0 on a clean repo', () => {
  withSandbox({ ...A_REPO, '.vibecodepm/system.md': DECLARED }, (root) => {
    assert.equal(run(['scan', '--now', NOW], { cwd: root }).code, 0);
    const result = run(['reconcile', '--now', NOW], { cwd: root });

    assert.equal(result.code, 0, result.stdout + result.stderr);
    const report = readFileSync(join(root, '.system-map/reconcile-2026-09-27.md'), 'utf8');
    assert.match(report, /# system-map reconcile — 2026-09-27/);
  });
});

test('reconcile exits 1 when it finds drift, and names the count on stdout', () => {
  withSandbox({ ...A_REPO, '.vibecodepm/system.md': DECLARED }, (root) => {
    assert.equal(run(['scan', '--now', NOW], { cwd: root }).code, 0);
    mkdirSync(join(root, 'billing'), { recursive: true });
    writeFileSync(join(root, 'billing/charge.mjs'), "import 'openai';\n");

    const result = run(['reconcile', '--now', NOW], { cwd: root });
    assert.equal(result.code, 1);
    assert.match(result.stdout, /finding/);
  });
});

test('reconcile exits 3 when there is no system.md, and says which file it wanted', () => {
  withSandbox(A_REPO, (root) => {
    assert.equal(run(['scan', '--now', NOW], { cwd: root }).code, 0);
    const result = run(['reconcile', '--now', NOW], { cwd: root });

    assert.equal(result.code, 3);
    assert.match(result.stdout + result.stderr, /system\.md/);
  });
});

test('reconcile exits 3 when there is no committed baseline', () => {
  withSandbox({ ...A_REPO, '.vibecodepm/system.md': DECLARED }, (root) => {
    const result = run(['reconcile', '--now', NOW], { cwd: root });
    assert.equal(result.code, 3);
    assert.match(result.stdout + result.stderr, /BASELINE_ABSENT/);
  });
});

test('reconcile exits 2 when the committed baseline is not JSON, because that is a refusal', () => {
  withSandbox({ ...A_REPO, '.vibecodepm/system.md': DECLARED, '.system-map/baseline.json': '{ not json\n' }, (root) => {
    const result = run(['reconcile', '--now', NOW], { cwd: root });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /baseline/);
  });
});

test('reconcile writes the report even when it exits 3, because the gaps are the output', () => {
  withSandbox(A_REPO, (root) => {
    assert.equal(run(['scan', '--now', NOW], { cwd: root }).code, 0);
    assert.equal(run(['reconcile', '--now', NOW], { cwd: root }).code, 3);

    const report = readFileSync(join(root, '.system-map/reconcile-2026-09-27.md'), 'utf8');
    assert.match(report, /SYSTEM_MD_ABSENT/);
  });
});

test('reconcile never writes into the repo it is judging when --out points elsewhere', () => {
  withSandbox({}, (out) => {
    withSandbox({ ...A_REPO, '.vibecodepm/system.md': DECLARED }, (repo) => {
      assert.equal(run(['scan', repo, '--out', 'base.json', '--now', NOW], { cwd: out }).code, 0);
      const result = run(['reconcile', repo, '--system', join(repo, '.vibecodepm/system.md'), '--baseline', 'base.json', '--out', 'reports', '--now', NOW], { cwd: out });

      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.deepEqual(readdirSync(join(out, 'reports')), ['reconcile-2026-09-27.md']);
      assert.ok(!existsSync(join(repo, '.system-map')), 'nothing written into the scanned repo');
    });
  });
});

// --- B5: reconcile reads the repo it was pointed at, and says what it read -------------------------

test('reconcile ../repo reads THAT repo’s system.md and baseline, not the working directory’s', () => {
  // The ship-check's sharpest find. Run from a project that has its own system.md and baseline, this
  // compared repo A's code against project B's design and exited 1 with six plausible findings, naming
  // neither input. A wrong answer that looks right is worse than a refusal.
  withSandbox({
    '.vibecodepm/system.md': ['## 1. The map', '', '- **Elsewhere** (`elsewhere/x.mjs`) — not this repo at all.', ''].join('\n'),
    '.system-map/baseline.json': JSON.stringify({ schema: 'system-map/baseline@1', modules: [{ path: 'elsewhere/x.mjs' }] }),
  }, (other) => {
    withSandbox({ ...A_REPO, '.vibecodepm/system.md': DECLARED }, (repo) => {
      assert.equal(run(['scan', repo, '--out', join(repo, '.system-map/baseline.json'), '--now', NOW], { cwd: other }).code, 0);

      const result = run(['reconcile', repo, '--out', 'reports', '--now', NOW], { cwd: other });
      assert.equal(result.code, 0, `should have read ${repo}'s own inputs and found nothing:\n${result.stdout}${result.stderr}`);
      assert.ok(!result.stdout.includes('Elsewhere'), 'the sibling project’s design was not consulted');
    });
  });
});

test('reconcile names the three inputs it read, on stdout and in the report header', () => {
  withSandbox({ ...A_REPO, '.vibecodepm/system.md': DECLARED }, (root) => {
    assert.equal(run(['scan', '--now', NOW], { cwd: root }).code, 0);
    const result = run(['reconcile', '--now', NOW], { cwd: root });

    assert.equal(result.code, 0, result.stdout + result.stderr);
    for (const label of ['code', 'system.md', 'baseline']) {
      assert.match(result.stdout, new RegExp(label), `stdout names the ${label} input`);
    }

    const report = readFileSync(join(root, '.system-map/reconcile-2026-09-27.md'), 'utf8');
    assert.match(report, /## What this run read/);
    assert.match(report, /system\.md/);
    assert.match(report, /\b\d+ bytes\b/, 'with a size, so two runs on one day are distinguishable');
  });
});

test('an explicit --system still wins over the default, resolved against the working directory', () => {
  withSandbox({}, (out) => {
    withSandbox({ ...A_REPO, '.vibecodepm/system.md': DECLARED }, (repo) => {
      assert.equal(run(['scan', repo, '--out', 'base.json', '--now', NOW], { cwd: out }).code, 0);
      const result = run(
        ['reconcile', repo, '--system', join(repo, '.vibecodepm/system.md'), '--baseline', 'base.json', '--out', 'reports', '--now', NOW],
        { cwd: out },
      );
      assert.equal(result.code, 0, result.stdout + result.stderr);
    });
  });
});

test('the report echoes no absolute path for an explicitly given --system or --baseline', () => {
  // M3, the same class as the derived_from bug: a report meant to be committed must not carry a home
  // directory just because the caller typed one.
  withSandbox({}, (out) => {
    withSandbox({ ...A_REPO, '.vibecodepm/system.md': DECLARED }, (repo) => {
      run(['scan', repo, '--out', 'base.json', '--now', NOW], { cwd: out });
      run(['reconcile', repo, '--system', join(repo, '.vibecodepm/system.md'), '--baseline', 'base.json', '--out', 'reports', '--now', NOW], { cwd: out });

      const report = readFileSync(join(out, 'reports/reconcile-2026-09-27.md'), 'utf8');
      assert.ok(!report.includes(repo), 'the absolute repo path is not echoed');
      assert.ok(!/\/Users\/|\/var\/folders\//.test(report), report.split('\n').slice(0, 14).join('\n'));
    });
  });
});

test('a second reconcile on the same day does not overwrite the first', () => {
  // M4. Two runs on one day silently overwrote each other, so the run that found something could be
  // erased by the run that did not.
  withSandbox({ ...A_REPO, '.vibecodepm/system.md': DECLARED }, (root) => {
    run(['scan', '--now', NOW], { cwd: root });
    assert.equal(run(['reconcile', '--now', NOW], { cwd: root }).code, 0);
    assert.equal(run(['reconcile', '--now', NOW], { cwd: root }).code, 0);

    assert.deepEqual(readdirSync(join(root, '.system-map')).sort(), [
      'baseline.json',
      'reconcile-2026-09-27-2.md',
      'reconcile-2026-09-27.md',
    ]);
  });
});

test('a first-run gap names the command that fixes it', () => {
  // I9, promised by flow.md's "Recovery paths" and absent.
  withSandbox(A_REPO, (root) => {
    const result = run(['reconcile', '--now', NOW], { cwd: root });
    assert.equal(result.code, 3);

    const report = readFileSync(join(root, '.system-map/reconcile-2026-09-27.md'), 'utf8');
    assert.match(report, /system-map derive/, 'the absent system.md names derive');
    assert.match(report, /system-map scan/, 'the absent baseline names scan');
  });
});

test('a refusal prints one sentence and points at --help, not the whole usage', () => {
  // M10. flow.md says one sentence; the stranger got a sentence plus 45 lines.
  withSandbox(A_REPO, (root) => {
    const result = run(['scan', '--verbose'], { cwd: root });
    assert.equal(result.code, 2);

    const lines = result.stderr.trim().split('\n').filter((line) => line !== '');
    assert.ok(lines.length <= 2, `refusal was ${lines.length} lines:\n${result.stderr}`);
    assert.match(result.stderr, /--help/);
  });
});

// --- the clock ---------------------------------------------------------------------------------------------

test('--now must be an ISO instant, because a bad one silently misdates a report', () => {
  withSandbox(A_REPO, (root) => {
    const result = run(['scan', '--now', 'yesterday'], { cwd: root });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /ISO/);
  });
});
