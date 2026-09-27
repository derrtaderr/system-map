// Doors and keys, the extraction half. docs/SPEC.md §3B and §3F.
//
// Question 3 of the architect's six is the one the skill calls "the giant", and the two things a
// text scan can honestly contribute to it are: every secret the code reads, and every place a
// check happens. Both as a table, both cited.

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractEnv, SECRETISH } from '../src/extract/env.mjs';
import { extractAuthChecks } from '../src/extract/auth.mjs';

function envRows(path, text) {
  return extractEnv(path, text).env.map((entry) => `${entry.name} ${entry.how} ${entry.cite}`);
}

function authRows(path, text) {
  return extractAuthChecks(path, text).checks.map((check) => `${check.name} ${check.cite}`);
}

// --- node env reads -------------------------------------------------------------------------

test('process.env.NAME is a read, cited at its line', () => {
  assert.deepEqual(envRows('src/a.mjs', 'const key = process.env.STRIPE_KEY;\n'), [
    'STRIPE_KEY process.env src/a.mjs:1',
  ]);
});

test('process.env with bracket notation is the same read', () => {
  assert.deepEqual(envRows('src/a.mjs', "const k = process.env['SK_EXAMPLE'];\n"), [
    'SK_EXAMPLE process.env src/a.mjs:1',
  ]);
});

test('a destructured read names every variable it takes', () => {
  assert.deepEqual(envRows('src/a.mjs', 'const { ONE, TWO } = process.env;\n'), [
    'ONE process.env src/a.mjs:1',
    'TWO process.env src/a.mjs:1',
  ]);
});

test('two reads on one line are two entries', () => {
  assert.deepEqual(envRows('src/a.mjs', 'if (process.env.A && process.env.B) {}\n'), [
    'A process.env src/a.mjs:1',
    'B process.env src/a.mjs:1',
  ]);
});

test('the same variable read twice in a file is reported once, at its first citation', () => {
  // A report that lists PORT eleven times is a report nobody reads to the end.
  assert.deepEqual(envRows('src/a.mjs', 'process.env.PORT;\nprocess.env.PORT;\n'), ['PORT process.env src/a.mjs:1']);
});

test('a lowercase or mixed-case property of process.env still counts', () => {
  // Naming style is not evidence. A key called nodeEnv is still a key.
  assert.deepEqual(envRows('src/a.mjs', 'process.env.nodeEnv;\n'), ['nodeEnv process.env src/a.mjs:1']);
});

test('a commented-out env read is not a read', () => {
  assert.deepEqual(envRows('src/a.mjs', '// process.env.GHOST_KEY\n'), []);
});

// --- python env reads -----------------------------------------------------------------------

test('os.environ subscript, os.environ.get and os.getenv are all reads', () => {
  const text = [
    "token = os.environ['WORKER_TOKEN']",
    "host = os.environ.get('DB_HOST')",
    "level = os.getenv('LOG_LEVEL', 'info')",
    '',
  ].join('\n');

  assert.deepEqual(envRows('worker/run.py', text), [
    'WORKER_TOKEN os.environ worker/run.py:1',
    'DB_HOST os.environ.get worker/run.py:2',
    'LOG_LEVEL os.getenv worker/run.py:3',
  ]);
});

test('environ imported bare from os is still a read', () => {
  assert.deepEqual(envRows('worker/run.py', "key = environ['SK_EXAMPLE']\n"), [
    'SK_EXAMPLE os.environ worker/run.py:1',
  ]);
});

test('a commented-out python env read is not a read', () => {
  assert.deepEqual(envRows('worker/run.py', "# os.getenv('GHOST')\n"), []);
});

// --- .env.example ----------------------------------------------------------------------------

test('every key in a .env.example is a declared variable, cited at its line', () => {
  const text = ['# the worker needs these', 'SK_EXAMPLE=', 'DB_HOST=db.example.com', '', 'LOG_LEVEL=info', ''].join('\n');

  assert.deepEqual(envRows('.env.example', text), [
    'SK_EXAMPLE .env.example .env.example:2',
    'DB_HOST .env.example .env.example:3',
    'LOG_LEVEL .env.example .env.example:5',
  ]);
});

test('an export prefix and surrounding whitespace do not become part of the name', () => {
  assert.deepEqual(envRows('.env.sample', 'export  PORT = 8080\n'), ['PORT .env.example .env.sample:1']);
});

test('a .env.example comment is not a variable', () => {
  assert.deepEqual(envRows('.env.example', '# NOT_A_VAR=1\n'), []);
});

test('a real .env is never read, because a scanner that reads your secrets is the wrong tool', () => {
  // The guard is the path, not the content. `.env` is where the live values are.
  assert.deepEqual(envRows('.env', 'LIVE_KEY=abc123\n'), []);
  assert.deepEqual(envRows('config/.env.local', 'LIVE_KEY=abc123\n'), []);
});

// --- the secret-ish judgement ---------------------------------------------------------------

test('SECRETISH names the shapes that read as a credential, and PORT is not one of them', () => {
  for (const name of ['STRIPE_KEY', 'SK_EXAMPLE', 'DB_PASSWORD', 'AUTH_TOKEN', 'SESSION_SECRET', 'API_CREDENTIALS', 'GH_PAT']) {
    assert.ok(SECRETISH.test(name), name);
  }
  for (const name of ['PORT', 'LOG_LEVEL', 'NODE_ENV', 'DB_HOST']) {
    assert.ok(!SECRETISH.test(name), name);
  }
});

test('the entry carries the secretish flag, so derive can separate keys from settings', () => {
  const { env } = extractEnv('src/a.mjs', 'process.env.SESSION_SECRET;\nprocess.env.PORT;\n');
  assert.deepEqual(
    env.map((entry) => `${entry.name} ${entry.secretish}`),
    ['SESSION_SECRET true', 'PORT false'],
  );
});

// --- auth checks -----------------------------------------------------------------------------

test('the named middleware shapes are checks, cited where they appear', () => {
  const text = ["app.get('/admin', requireAuth, handler);", 'router.use(isAuthenticated);', ''].join('\n');
  assert.deepEqual(authRows('src/api.mjs', text), ['requireAuth src/api.mjs:1', 'isAuthenticated src/api.mjs:2']);
});

test('a python decorator check is a check', () => {
  const text = ['@login_required', 'def admin():', '    pass', ''].join('\n');
  assert.deepEqual(authRows('worker/admin.py', text), ['login_required worker/admin.py:1']);
});

test('a FastAPI dependency that names auth is a check', () => {
  assert.deepEqual(authRows('worker/api.py', 'def read(user = Depends(get_current_user)):\n'), [
    'Depends(get_current_user) worker/api.py:1',
  ]);
});

test('reading the Authorization header is a check, because it is where the rule gets applied', () => {
  assert.deepEqual(authRows('src/api.mjs', 'const bearer = req.headers.authorization;\n'), [
    'req.headers.authorization src/api.mjs:1',
  ]);
});

test('a commented-out check is not a check, which is the whole point of naming this one', () => {
  // A check somebody disabled in a hurry is exactly the drift this tool is for. Counting it
  // as present would hide it.
  assert.deepEqual(authRows('src/api.mjs', '// app.use(requireAuth);\n'), []);
});

test('a file with no check at all reports none, and says so by being empty', () => {
  assert.deepEqual(authRows('src/api.mjs', "app.get('/admin', handler);\n"), []);
});

test('the same check twice in a file is reported once', () => {
  assert.deepEqual(authRows('src/api.mjs', 'requireAuth;\nrequireAuth;\n'), ['requireAuth src/api.mjs:1']);
});
