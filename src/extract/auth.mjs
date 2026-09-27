// Where a check happens. docs/SPEC.md §3B and §3F question 3.
//
// A text scan cannot tell you whether an access rule is CORRECT. It can tell you whether there
// is one, and where, and that is the answer the architect skill actually asks for: "somewhere the
// user can't reach around, or somewhere they can". An empty result here is a finding, not a
// silence, which is why derive writes it as `Unknown: no authorization check was found`.
//
// The one rule worth stating out loud: a commented-out check is not a check. A guard somebody
// disabled in a hurry is exactly the drift this tool exists to surface, so counting it as present
// would hide the thing we are looking for.

import { languageOf, maskComments } from './text.mjs';

// Named shapes, not a general notion of security. Every entry is a convention wide enough that
// seeing it in a file means somebody meant to check something.
const NAMED = [
  'requireAuth',
  'require_auth',
  'requireUser',
  'requireSession',
  'isAuthenticated',
  'ensureAuthenticated',
  'ensureAuth',
  'authenticate',
  'authorize',
  'authGuard',
  'withAuth',
  'verifyToken',
  'verify_token',
  'verifyJwt',
  'checkAuth',
  'check_auth',
  'checkPermission',
  'check_permission',
  'getServerSession',
  'currentUser',
  'get_current_user',
  'login_required',
  'jwt_required',
  'permission_required',
  'token_required',
  'admin_required',
];

const PATTERNS = [
  // A FastAPI dependency whose name says it is about identity. `Depends(get_db)` is not a check.
  /\bDepends\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)/g,
  new RegExp(`\\b(?:${NAMED.join('|')})\\b`, 'g'),
  /\b[A-Za-z_$][A-Za-z0-9_$]*\.headers\.authorization\b/gi,
  /\bheaders\.get\(\s*(['"])authorization\1\s*\)/gi,
  /(['"])[Aa]uthorization\1\s*:/g,
];

const DEPENDS_IS_IDENTITY = /auth|user|token|session|login|current|principal/i;

export function extractAuthChecks(path, text) {
  const language = languageOf(path);
  if (language === null) return { checks: [] };

  const lines = maskComments(text, language).split('\n');
  const found = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const spans = [];

    for (const pattern of PATTERNS) {
      for (const match of line.matchAll(pattern)) {
        if (match[0].startsWith('Depends(') && !DEPENDS_IS_IDENTITY.test(match[0])) continue;
        spans.push({ start: match.index, end: match.index + match[0].length, name: match[0] });
      }
    }

    // `Depends(get_current_user)` contains `get_current_user`, which is also a named shape. One
    // check, so the longer span wins and the contained one is dropped.
    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    const kept = [];
    for (const span of spans) {
      if (kept.some((other) => span.start >= other.start && span.end <= other.end)) continue;
      kept.push(span);
    }

    for (const span of kept) found.push({ name: span.name, line: index + 1, path });
  }

  // First citation wins, same rule as env: one row per distinct check.
  const first = new Map();
  for (const check of found) {
    if (first.has(check.name)) continue;
    first.set(check.name, { ...check, cite: `${path}:${check.line}` });
  }

  return { checks: [...first.values()] };
}
