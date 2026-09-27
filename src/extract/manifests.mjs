// Manifests: the one place a repo states its dependencies out loud. docs/SPEC.md §3B, and the
// MANIFEST_UNPARSED row of the false-green table in §3E.
//
// A manifest the scan could not read is BLOCKING rather than noted, and the reason is specific.
// Every other extractor can miss something and still leave a usable map. A dependency list that
// silently came back empty makes the bill answer AND the state answer look clean for the wrong
// reason, which is the exact false green this repo is built to refuse.
//
// The distinction that keeps that honest is `declaresNothing`. A zero-dependency repo is a real
// answer (this repo is one). "I could not read the file" is a different answer, and the two must
// never render the same way.

export const IGNORED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  'venv',
  '.venv',
  'env',
  'site-packages',
  'vendor',
  'target',
  '.terraform',
  '.tox',
  '.cache',
]);

const MANIFEST_NAMES = new Map([
  ['package.json', 'package.json'],
  ['requirements.txt', 'requirements.txt'],
  ['pyproject.toml', 'pyproject.toml'],
]);

function basename(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function isIgnoredPath(path) {
  return path.split('/').some((segment) => IGNORED_SEGMENTS.has(segment));
}

export function isManifestPath(path) {
  if (isIgnoredPath(path)) return false;
  return MANIFEST_NAMES.has(basename(path));
}

function blocking(path, detail) {
  return [{ tier: 'BLOCKING', code: 'MANIFEST_UNPARSED', path, line: 1, cite: `${path}:1`, detail }];
}

function fromPackageJson(path, text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { manifest: null, gaps: blocking(path, `not valid JSON: ${error.message}`) };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { manifest: null, gaps: blocking(path, 'valid JSON, but not an object, so it is not a package manifest') };
  }

  const names = (field) => (parsed[field] === null || typeof parsed[field] !== 'object' ? [] : Object.keys(parsed[field]).sort());
  const deps = names('dependencies');
  const devDeps = names('devDependencies');
  const peerDeps = names('peerDependencies');
  const scripts = names('scripts');

  return {
    manifest: {
      path,
      kind: 'package.json',
      deps: [...new Set([...deps, ...peerDeps])].sort(),
      devDeps,
      scripts,
      declaresNothing: deps.length === 0 && peerDeps.length === 0,
      cite: `${path}:1`,
    },
    gaps: [],
  };
}

// A requirement line, minus its version specifier, its extras and its environment markers.
function requirementName(line) {
  const withoutComment = line.replace(/#.*$/, '').trim();
  if (withoutComment === '' || withoutComment.startsWith('-')) return null;
  const match = /^([A-Za-z0-9._-]+)/.exec(withoutComment);
  return match === null ? null : match[1];
}

function fromRequirements(path, text) {
  const deps = new Set();
  for (const line of text.split('\n')) {
    const name = requirementName(line);
    if (name !== null) deps.add(name);
  }

  const sorted = [...deps].sort();
  return {
    manifest: {
      path,
      kind: 'requirements.txt',
      deps: sorted,
      devDeps: [],
      scripts: [],
      declaresNothing: sorted.length === 0,
      cite: `${path}:1`,
    },
    gaps: [],
  };
}

// A deliberately small TOML reading: the two places a Python project states dependencies. Not a
// TOML parser, and it does not pretend to be one. The BLOCKING check below is what keeps the
// shortfall honest: a file with no table header at all is not TOML this code understood, so the
// empty dependency list it would produce is refused rather than reported.
function fromPyproject(path, text) {
  const lines = text.split('\n');
  if (!lines.some((line) => /^\s*\[/.test(line))) {
    return { manifest: null, gaps: blocking(path, 'no TOML table header found, so the file is either not TOML or truncated') };
  }

  const deps = new Set();
  let section = '';
  let inArray = false;

  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');

    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header !== null) {
      section = header[1].trim();
      inArray = false;
      continue;
    }

    // PEP 621: dependencies = ["requests>=2.31", ...], possibly spread over lines.
    if (/^\s*(?:dependencies|optional-dependencies)\s*=/.test(line)) inArray = true;

    if (inArray) {
      for (const match of line.matchAll(/(['"])([A-Za-z0-9._-]+)[^'"]*\1/g)) deps.add(match[2]);
      if (line.includes(']')) inArray = false;
      continue;
    }

    // Poetry: a table of name = constraint. `python` is the interpreter, not a piece of the system.
    if (/^tool\.poetry(\.[a-z-]+)?\.dependencies$/.test(section) || section === 'tool.poetry.dependencies') {
      const entry = /^\s*([A-Za-z0-9._-]+)\s*=/.exec(line);
      if (entry !== null && entry[1] !== 'python') deps.add(entry[1]);
    }
  }

  const sorted = [...deps].sort();
  return {
    manifest: {
      path,
      kind: 'pyproject.toml',
      deps: sorted,
      devDeps: [],
      scripts: [],
      declaresNothing: sorted.length === 0,
      cite: `${path}:1`,
    },
    gaps: [],
  };
}

export function extractManifest(path, text) {
  switch (MANIFEST_NAMES.get(basename(path))) {
    case 'package.json':
      return fromPackageJson(path, text);
    case 'requirements.txt':
      return fromRequirements(path, text);
    case 'pyproject.toml':
      return fromPyproject(path, text);
    default:
      return { manifest: null, gaps: [] };
  }
}
