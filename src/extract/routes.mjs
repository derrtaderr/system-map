// HTTP routes. docs/SPEC.md §3B.
//
// Three conventions, chosen because they are what an agent-built repo actually contains:
//
//   the method-call frameworks   app.get('/x', h)        express, fastify, hono
//   the Python decorators        @app.get("/x")          FastAPI, Flask
//   Next.js                      app/**/route.*          the path IS the file, no call says so
//
// The receiver list is a closed set on purpose. `client.get(url)` and `map.get(key)` are the two
// most common false routes in any regex-based scanner, and both are excluded by requiring a
// receiver that names a server and a first argument that is a literal path.

import { languageOf, maskComments } from './text.mjs';

const METHODS = 'get|post|put|patch|delete|options|head|all';
const RECEIVERS = 'app|router|server|fastify|hono|api|instance|srv';

const NODE_ROUTE = new RegExp(`\\b(${RECEIVERS})\\.(${METHODS})\\(\\s*(['"])(\\/[^'"\\n]*)\\3`, 'g');
const PY_DECORATOR = new RegExp(`^\\s*@\\s*([A-Za-z_][A-Za-z0-9_]*)\\.(${METHODS}|route)\\(\\s*(['"])(\\/[^'"\\n]*)\\3([^\\n]*)`);
const PY_RECEIVERS = new Set(['app', 'router', 'bp', 'blueprint', 'api', 'server']);

const NEXT_APP_ROUTE = /(?:^|\/)app\/(.*)\/route\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const NEXT_PAGES_API = /(?:^|\/)pages\/api\/(.*)\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const NEXT_EXPORTED_METHOD = /^export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/;

function nodeRoutes(path, masked) {
  const routes = [];
  const lines = masked.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(NODE_ROUTE)) {
      routes.push({
        method: match[2].toUpperCase(),
        path: match[4],
        framework: `${match[1]}.${match[2]}`,
        line: index + 1,
      });
    }
  }

  return routes;
}

// `APIRouter(prefix="/api/v2")` means every route on that router serves a path the decorator does not
// spell. A map that printed `/leads` names a path nobody can call.
function routerPrefixes(lines) {
  const prefixes = new Map();

  for (const line of lines) {
    const match = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:APIRouter|Blueprint)\s*\(([^)]*)\)/.exec(line);
    if (match === null) continue;

    const prefix = /prefix\s*=\s*(['"])([^'"]*)\1/.exec(match[2]);
    if (prefix !== null && prefix[2] !== '') prefixes.set(match[1], prefix[2].replace(/\/$/, ''));
  }

  return prefixes;
}

function pythonRoutes(path, masked) {
  const routes = [];
  const lines = masked.split('\n');
  const prefixes = routerPrefixes(lines);

  for (let index = 0; index < lines.length; index += 1) {
    const match = PY_DECORATOR.exec(lines[index]);
    if (match === null) continue;

    const [, receiver, verb, , routePath, tail] = match;
    if (!PY_RECEIVERS.has(receiver)) continue;

    const framework = `@${receiver}.${verb}`;
    const full = `${prefixes.get(receiver) ?? ''}${routePath}`;

    if (verb !== 'route') {
      routes.push({ method: verb.toUpperCase(), path: full, framework, line: index + 1 });
      continue;
    }

    // Flask: methods are an argument, and their absence means GET, which is what Flask does.
    const declared = /methods\s*=\s*[[(]([^\])]*)[\])]/.exec(tail);
    const methods = declared === null
      ? ['GET']
      : [...declared[1].matchAll(/['"]([A-Za-z]+)['"]/g)].map((entry) => entry[1].toUpperCase());

    for (const method of methods.length === 0 ? ['GET'] : methods) {
      routes.push({ method, path: full, framework, line: index + 1 });
    }
  }

  return routes;
}

// A Next.js route group is a directory in parentheses. It organises files and never appears in
// the URL, so a map that printed it would be naming a path nobody can call.
function withoutRouteGroups(segments) {
  return segments.filter((segment) => segment !== '' && !(segment.startsWith('(') && segment.endsWith(')')));
}

function nextRoutes(path, text) {
  const appRouter = NEXT_APP_ROUTE.exec(path);
  if (appRouter !== null) {
    const routePath = `/${withoutRouteGroups(appRouter[1].split('/')).join('/')}`;
    const lines = text.split('\n');
    const found = [];

    for (let index = 0; index < lines.length; index += 1) {
      const match = NEXT_EXPORTED_METHOD.exec(lines[index]);
      if (match !== null) found.push({ method: match[1], path: routePath, framework: 'next-app-router', line: index + 1 });
    }

    // The file existing IS the door. An unfamiliar export shape must not hide a reachable
    // endpoint, so the route is still reported with its method unknown.
    if (found.length === 0) return [{ method: 'UNKNOWN', path: routePath, framework: 'next-app-router', line: 1 }];
    return found;
  }

  const pagesApi = NEXT_PAGES_API.exec(path);
  if (pagesApi !== null) {
    const segments = withoutRouteGroups(pagesApi[1].split('/'));
    if (segments[segments.length - 1] === 'index') segments.pop();
    return [{ method: 'ANY', path: `/api${segments.length === 0 ? '' : `/${segments.join('/')}`}`, framework: 'next-pages-api', line: 1 }];
  }

  return [];
}

export function extractRoutes(path, text) {
  const language = languageOf(path);
  if (language === null) return { routes: [] };

  const masked = maskComments(text, language);
  const routes = [
    ...(language === 'python' ? pythonRoutes(path, masked) : nodeRoutes(path, masked)),
    ...(language === 'python' ? [] : nextRoutes(path, masked)),
  ];

  const seen = new Set();
  const unique = [];
  for (const route of routes.sort(
    (a, b) => a.line - b.line || a.method.localeCompare(b.method) || a.path.localeCompare(b.path),
  )) {
    const key = JSON.stringify([route.line, route.method, route.path]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...route, from: path, cite: `${path}:${route.line}` });
  }

  return { routes: unique };
}
