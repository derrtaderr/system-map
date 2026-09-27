// HTTP routes. docs/SPEC.md §3B.
//
// Routes are the doors a system exposes, so they carry weight in three of the six architect
// answers at once: the map (a piece that serves HTTP), doors and keys (what is reachable), and
// how you find out it broke (a health route is the cheapest possible answer to the 2am question).
//
// Three conventions, because they cover what an agent-built repo actually contains: the
// method-call frameworks, the Python decorators, and Next.js, where the route is the file path
// and no call expresses it at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractRoutes } from '../src/extract/routes.mjs';

function rows(path, text) {
  return extractRoutes(path, text).routes.map((route) => `${route.method} ${route.path} ${route.framework} ${route.cite}`);
}

// --- the method-call frameworks ---------------------------------------------------------------

test('an express-shaped get is a route', () => {
  assert.deepEqual(rows('src/api.mjs', "app.get('/health', handler);\n"), ['GET /health app.get src/api.mjs:1']);
});

test('every method in the set is recognised, and the method is upper-cased', () => {
  const text = [
    "app.post('/score', h);",
    "app.put('/lead/:id', h);",
    "app.patch('/lead/:id', h);",
    "app.delete('/lead/:id', h);",
    "app.all('/any', h);",
    '',
  ].join('\n');

  assert.deepEqual(rows('src/api.mjs', text), [
    'POST /score app.post src/api.mjs:1',
    'PUT /lead/:id app.put src/api.mjs:2',
    'PATCH /lead/:id app.patch src/api.mjs:3',
    'DELETE /lead/:id app.delete src/api.mjs:4',
    'ALL /any app.all src/api.mjs:5',
  ]);
});

test('router, server and fastify receivers all count, and the receiver is kept in the framework label', () => {
  const text = ["router.get('/a', h);", "server.post('/b', h);", "fastify.get('/c', h);", ''].join('\n');
  assert.deepEqual(rows('src/api.mjs', text), [
    'GET /a router.get src/api.mjs:1',
    'POST /b server.post src/api.mjs:2',
    'GET /c fastify.get src/api.mjs:3',
  ]);
});

test('a route path that is not a literal is not invented', () => {
  // A path built from a variable is a NOTED limit of text extraction, and inventing a name for
  // it would put an uncited line in the map.
  assert.deepEqual(rows('src/api.mjs', 'app.get(prefix + "/x", h);\n'), []);
});

test('a method call that is not a route does not become one', () => {
  for (const line of ['client.get(url);\n', 'map.get(key);\n', "cache.delete('k');\n"]) {
    assert.deepEqual(rows('src/a.mjs', line), [], line.trim());
  }
});

test('a commented-out route is not a route', () => {
  assert.deepEqual(rows('src/api.mjs', "// app.get('/gone', h);\n"), []);
});

// --- python decorators --------------------------------------------------------------------------

test('a FastAPI decorator is a route', () => {
  assert.deepEqual(rows('worker/api.py', '@app.get("/health")\ndef health():\n    pass\n'), [
    'GET /health @app.get worker/api.py:1',
  ]);
});

test('a router decorator is a route', () => {
  assert.deepEqual(rows('worker/api.py', '@router.post("/score")\n'), ['POST /score @router.post worker/api.py:1']);
});

test('a Flask route decorator names every method it declares', () => {
  assert.deepEqual(rows('worker/api.py', '@app.route("/lead", methods=["GET", "POST"])\n'), [
    'GET /lead @app.route worker/api.py:1',
    'POST /lead @app.route worker/api.py:1',
  ]);
});

test('a Flask route with no methods argument is a GET, which is what Flask does', () => {
  assert.deepEqual(rows('worker/api.py', '@bp.route("/ping")\n'), ['GET /ping @bp.route worker/api.py:1']);
});

test('a commented-out python decorator is not a route', () => {
  assert.deepEqual(rows('worker/api.py', '# @app.get("/gone")\n'), []);
});

// --- next.js, where the path is the file and no call says so -------------------------------------

test('an app-router route file takes its path from its directory and its methods from its exports', () => {
  const text = ['export async function GET(request) {}', 'export async function POST(request) {}', ''].join('\n');
  assert.deepEqual(rows('app/api/health/route.ts', text), [
    'GET /api/health next-app-router app/api/health/route.ts:1',
    'POST /api/health next-app-router app/api/health/route.ts:2',
  ]);
});

test('an app-router route file with no recognised export is still a route, method unknown', () => {
  // The file existing IS the door. Reporting nothing because the export shape was unfamiliar
  // would hide a reachable endpoint.
  assert.deepEqual(rows('app/api/webhook/route.js', 'const handler = () => {};\nexport default handler;\n'), [
    'UNKNOWN /api/webhook next-app-router app/api/webhook/route.js:1',
  ]);
});

test('a dynamic segment keeps its brackets, because that is what the path really is', () => {
  assert.deepEqual(rows('app/api/lead/[id]/route.ts', 'export async function GET() {}\n'), [
    'GET /api/lead/[id] next-app-router app/api/lead/[id]/route.ts:1',
  ]);
});

test('a pages-api file is a route named by its filename', () => {
  assert.deepEqual(rows('pages/api/score.ts', 'export default function handler() {}\n'), [
    'ANY /api/score next-pages-api pages/api/score.ts:1',
  ]);
});

test('a pages-api index file is the directory it sits in', () => {
  assert.deepEqual(rows('pages/api/leads/index.ts', 'export default function handler() {}\n'), [
    'ANY /api/leads next-pages-api pages/api/leads/index.ts:1',
  ]);
});

test('a route group in parentheses is not part of the url, because Next.js does not serve it', () => {
  assert.deepEqual(rows('app/(internal)/api/ops/route.ts', 'export async function GET() {}\n'), [
    'GET /api/ops next-app-router app/(internal)/api/ops/route.ts:1',
  ]);
});

test('a page component is not a route, only a route file and an api file are', () => {
  assert.deepEqual(rows('app/dashboard/page.tsx', 'export default function Page() {}\n'), []);
});

// --- ordering and determinism ---------------------------------------------------------------------

test('routes come out sorted, so two runs over one file are byte identical', () => {
  const text = ["app.post('/b', h);\napp.get('/a', h);\n"].join('');
  assert.deepEqual(rows('src/api.mjs', text), ['POST /b app.post src/api.mjs:1', 'GET /a app.get src/api.mjs:2']);
  assert.deepEqual(extractRoutes('src/api.mjs', text), extractRoutes('src/api.mjs', text));
});
