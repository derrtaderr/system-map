// Three extraction rules the first build was missing, each one measured on real repos before it was
// written. docs/SPEC.md §4A rows D1, D2 and D3.
//
// All three came out of the same observation: on all three dogfood repos, `derive` said "Unknown: no
// database or storage client was found" and "nothing here bills per use" about systems that keep state
// on disk and shell out to `gh`. The answers were not wrong so much as blind, and §3F had already
// promised two of them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractWrites } from '../src/extract/writes.mjs';
import { extractShellOuts } from '../src/extract/shell.mjs';
import { extractEnv } from '../src/extract/env.mjs';

const rows = (fn) => (path, text) => fn(path, text).map((entry) => `${entry.target} ${entry.cite}`);

// --- D1: local file writes are where state lives ---------------------------------------------------------

const writeRows = (path, text) => extractWrites(path, text).writes.map((entry) => `${entry.call} ${entry.target} ${entry.cite}`);
const writeTargets = (path, text) => extractWrites(path, text).writes.flatMap((entry) => entry.targets);

test('ONE row per module, at the first write, counting the rest', () => {
  // The unit a reader acts on is the module: a module that writes in six branches is one place state
  // lives, not six. Measured on the three dogfood repos, a row per module gives 2, 10 and 5 rows where
  // a row per CALL gave 4, 17 and 8, and section 2 stops being read somewhere in between.
  const text = [
    "writeFileSync(join(dir, 'receipt.json'), body);",
    "appendFileSync('ledger.jsonl', line);",
    'await writeFile(outPath, body);',
    '',
  ].join('\n');

  assert.deepEqual(writeRows('src/receipts.mjs', text), [
    "writeFileSync join(dir, 'receipt.json') src/receipts.mjs:1",
  ]);
  assert.equal(extractWrites('src/receipts.mjs', text).writes[0].alsoWrites, 2);
});

test('every documented Node write call is recognised, and a nested path expression survives whole', () => {
  const text = [
    "writeFileSync(join(dir, 'receipt.json'), body);",
    "appendFileSync('ledger.jsonl', line);",
    'await writeFile(outPath, body);',
    "const stream = createWriteStream('out.csv');",
    '',
  ].join('\n');

  assert.deepEqual(writeTargets('src/receipts.mjs', text), [
    "join(dir, 'receipt.json')",
    "'ledger.jsonl'",
    'outPath',
    "'out.csv'",
  ]);
});

test('a Python method write cites its RECEIVER, because that is the path', () => {
  // `Path(path).write_text(json.dumps(state))` writes to `path`. Reading the first argument cited
  // `json.dumps(state, indent=1, sort_keys=True)` as the place state lives, which is the content.
  assert.deepEqual(writeRows('engine/state.py', 'Path(path).write_text(json.dumps(state) + "\\n")\n'), [
    'write_text path engine/state.py:1',
  ]);
  assert.deepEqual(writeRows('engine/report.py', 'path.write_text(report)\n'), ['write_text path engine/report.py:1']);
});

test('every documented Python write call is recognised', () => {
  const text = [
    "conn = sqlite3.connect('radar.db')",
    "frame.to_csv('rows.csv')",
    "with open('state.json', 'w') as handle:",
    'out.write_bytes(blob)',
    '',
  ].join('\n');

  const calls = extractWrites('engine/state.py', text).writes;
  assert.equal(calls.length, 1, 'one row per module');
  assert.deepEqual(calls[0].targets.sort(), ["'radar.db'", "'rows.csv'", "'state.json'", 'out']);
});

test('json.dump is NOT a write row, because the path is not on that line', () => {
  // The open(..., 'w') that produced the handle is the row. Reading json.dump's first argument named the
  // serialised object as the place state lives.
  assert.deepEqual(writeRows('engine/a.py', 'json.dump(state, handle)\n'), []);
});

test('mkdirSync is NOT a write row, because a directory is not state', () => {
  // The file written into it is, and that write is already a row. Including mkdirSync doubled every row
  // on the dogfood repos.
  assert.deepEqual(writeRows('src/a.mjs', 'mkdirSync(dir, { recursive: true });\n'), []);
});

test('a read is not a write', () => {
  for (const line of ["readFileSync('a.json');\n", "open('a.json')\n", "open('a.json', 'r')\n", "json.load(handle)\n"]) {
    assert.deepEqual(writeRows('src/a.mjs', line), [], line.trim());
  }
});

test('a write under a temp directory is not where state lives', () => {
  // Scratch is not state. This is the rule that keeps the section short enough to read.
  for (const line of [
    "writeFileSync('/tmp/scratch.json', body);\n",
    'writeFileSync(join(tmpdir(), name), body);\n',
    "writeFileSync(mkdtempSync('x') + '/a', body);\n",
  ]) {
    assert.deepEqual(writeRows('src/a.mjs', line), [], line.trim());
  }
});

test('a write in a test file is not where the system keeps state', () => {
  assert.deepEqual(writeRows('test/a.test.mjs', "writeFileSync('fixture.json', body);\n"), []);
});

test('the same call twice in one module is one row', () => {
  const text = 'writeFileSync(p, a);\nwriteFileSync(p, b);\n';
  assert.equal(extractWrites('src/a.mjs', text).writes.length, 1);
});

test('a commented-out write is not a write', () => {
  assert.deepEqual(writeRows('src/a.mjs', "// writeFileSync('a.json', body);\n"), []);
});

// --- D2: shelling out is an external dependency ------------------------------------------------------------

const shellRows = rows((path, text) => extractShellOuts(path, text).shells);

test('a literal first argument to each documented spawn call is an external system', () => {
  const text = [
    "execFileSync('gh', ['pr', 'view']);",
    "execFile('git', args, cb);",
    "spawn('docker', ['ps']);",
    "exec('ls -la');",
    '',
  ].join('\n');

  assert.deepEqual(shellRows('src/adapters/github.mjs', text), [
    'gh src/adapters/github.mjs:1',
    'git src/adapters/github.mjs:2',
    'docker src/adapters/github.mjs:3',
    'ls src/adapters/github.mjs:4',
  ]);
});

test('a python subprocess call is an external system', () => {
  const text = ["subprocess.run(['git', 'rev-parse', 'HEAD'])", "subprocess.check_output('gh api', shell=True)", ''].join('\n');
  assert.deepEqual(shellRows('tools/sync.py', text), ['git tools/sync.py:1', 'gh tools/sync.py:2']);
});

test('a computed command is not invented', () => {
  assert.deepEqual(shellRows('src/a.mjs', 'execFile(binary, args);\n'), []);
});

test('node itself is still reported, because running your own interpreter is still a process boundary', () => {
  assert.deepEqual(shellRows('src/a.mjs', "execFileSync(process.execPath, ['--check', file]);\n"), []);
  assert.deepEqual(shellRows('src/a.mjs', "execFileSync('node', ['--check']);\n"), ['node src/a.mjs:1']);
});

test('a shell-out in a test file is not part of the system', () => {
  assert.deepEqual(shellRows('test/a.test.mjs', "execFileSync('gh', []);\n"), []);
});

test('a commented-out shell-out is not one', () => {
  assert.deepEqual(shellRows('src/a.mjs', "// execFileSync('gh', []);\n"), []);
});

// --- D3: an injected environment counts -----------------------------------------------------------------------

const envRows = (path, text) => extractEnv(path, text).env.map((entry) => `${entry.name} ${entry.how}`);

test('a variable read off an injected env object is an env read', () => {
  // The reviewer measured the feared false positive at 0 hits across three real repos, so the noise
  // argument the first build recorded in DESIGN.md was asserted rather than measured.
  assert.deepEqual(envRows('src/host.mjs', 'if (env.LANDED_N8N_API_KEY !== undefined) {}\n'), [
    'LANDED_N8N_API_KEY via an injected env object',
  ]);
});

test('an injected read is labelled differently from a direct one, so a reader can tell', () => {
  const { env } = extractEnv('src/host.mjs', 'const a = process.env.DIRECT_KEY;\nconst b = env.INJECTED_KEY;\n');
  assert.deepEqual(env.map((entry) => `${entry.name} ${entry.how}`), [
    'DIRECT_KEY process.env',
    'INJECTED_KEY via an injected env object',
  ]);
});

test('import.meta.env counts, because that is how a bundler injects one', () => {
  assert.deepEqual(envRows('src/a.mjs', 'const k = import.meta.env.VITE_PUBLIC_KEY;\n'), ['VITE_PUBLIC_KEY process.env']);
});

test('a bare environ read counts in Python', () => {
  assert.deepEqual(envRows('w/a.py', "k = environ.get('WORKER_TOKEN')\n"), ['WORKER_TOKEN os.environ.get']);
});

test('the rule needs SCREAMING_SNAKE, so an ordinary property is not a variable', () => {
  // The whole reason the rule is safe: `env.mode`, `env.NODE` and `env.X` are not credential shapes.
  for (const line of ['env.mode;\n', 'env.Production;\n', 'env.X;\n', 'env.ab;\n', 'thing.Name;\n']) {
    assert.deepEqual(envRows('src/a.mjs', line), [], line.trim());
  }
});

test('a SCREAMING_SNAKE property of something that is not an env object is not an env read', () => {
  for (const line of ['CONSTANTS.MAX_RETRIES;\n', 'this.DEFAULT_PORT;\n', 'Config.API_BASE;\n']) {
    assert.deepEqual(envRows('src/a.mjs', line), [], line.trim());
  }
});

// --- M5: a string is not a read --------------------------------------------------------------------------------

test('process.env.X inside a string or a template literal is not an env read', () => {
  // M5. The masker blanked comments only, so documentation of an env read counted as one.
  for (const line of [
    "console.log('set process.env.GHOST_KEY first');\n",
    'const help = `pass process.env.GHOST_KEY`;\n',
    'const doc = "process.env.GHOST_KEY";\n',
  ]) {
    assert.deepEqual(envRows('src/a.mjs', line), [], line.trim());
  }
});

test('a real read on the same line as a string mentioning one still counts', () => {
  assert.deepEqual(envRows('src/a.mjs', "log('process.env.GHOST');\nconst k = process.env.REAL;\n"), ['REAL process.env']);
});
