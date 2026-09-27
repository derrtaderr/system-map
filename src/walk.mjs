// The walk. docs/SPEC.md §3A.
//
// Two jobs, and the second one is the reason this is its own module: enumerate the files that are
// part of the system, and record every file it decided to open but could not. An unread file is
// not an empty file, and the difference is BLOCKING.

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { isIgnoredPath, isManifestPath, IGNORED_SEGMENTS } from './extract/manifests.mjs';
import { isEnvExample, isLiveEnvFile } from './extract/env.mjs';
import { languageOf } from './extract/text.mjs';

// Test shapes. docs/SPEC.md §4A row D4. Anchored to a whole path segment or a whole filename part, so
// `latest.mjs`, `contest.mjs` and `attestation.py` are not tests. `specs/` is deliberately absent:
// `specs/openapi.mjs` is a schema, and only the singular `spec/` is a test convention.
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'testing']);
const TEST_FILENAMES = [
  /\.test\.[a-z]+$/i,
  /\.spec\.[a-z]+$/i,
  /^test_[^/]*\.py$/i,
  /_test\.py$/i,
];

export function isTestPath(path) {
  const segments = path.split('/');
  if (segments.slice(0, -1).some((segment) => TEST_DIRS.has(segment))) return true;
  const base = segments[segments.length - 1];
  return TEST_FILENAMES.some((pattern) => pattern.test(base));
}

const WORKFLOW = /(?:^|\/)\.github\/workflows\/[^/]+\.(?:yml|yaml)$/;
const PLIST = /\.plist$/;

// Dot directories are skipped wholesale except the ones that carry the system's own configuration.
const DOT_DIRS_KEPT = new Set(['.github', '.vibecodepm', '.system-map']);

// A source file this big is generated, minified or vendored, whatever directory it sits in. A 21.7 MB
// bundle outside `dist/` became a module, a piece, and a 3.4 second scan.
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function shouldRead(path) {
  if (isIgnoredPath(path)) return false;
  if (isLiveEnvFile(path) && !isEnvExample(path)) return false;
  if (languageOf(path) !== null) return true;
  if (isManifestPath(path)) return true;
  if (isEnvExample(path)) return true;
  if (WORKFLOW.test(path)) return true;
  if (PLIST.test(path)) return true;
  return false;
}

const noted = (code, path, detail) => ({ tier: 'NOTED', code, path, line: 1, cite: path, detail });

export function walkFiles(root) {
  const files = [];
  const gaps = [];

  // Resolved once: a repo reached through a symlink (a worktree, /tmp on macOS) would otherwise make
  // every file inside it look like it resolves outside.
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = root;
  }

  // Every directory is walked once, by its real path. Without this a symlink to a parent directory
  // inside the repo was descended until ELOOP: 4 modules became 66 and every edge appeared 33 times
  // (ship-check N2).
  const visited = new Set([realRoot]);
  const descend = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      // A directory we could not LIST is not an empty directory. This used to return silently, and
      // `chmod 000 src/hidden` with a baseline scanned in the same state reported "No drift" and
      // exited 0 — the eighth row of the false-green table, found by a ship-check rather than by the
      // table itself.
      const rel = relative(root, dir).split(sep).join('/') || '.';
      gaps.push({
        tier: 'BLOCKING',
        code: 'UNREADABLE_DIR',
        path: rel,
        line: 1,
        cite: rel,
        detail: `the directory could not be listed (${error.code ?? error.message}), so anything inside it is missing from this run and nothing here can say what`,
      });
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join('/');

      if (entry.isDirectory()) {
        if (IGNORED_SEGMENTS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && !DOT_DIRS_KEPT.has(entry.name)) continue;
        let real = full;
        try { real = realpathSync(full); } catch {}
        if (visited.has(real)) continue;
        visited.add(real);
        descend(full);
        continue;
      }

      // A file outside the repo is not part of the repo, whatever a link inside it says. The scan read
      // `src/passwd.mjs -> /etc/passwd` and listed it as a module.
      if (entry.isSymbolicLink()) {
        let resolved;
        try {
          resolved = realpathSync(full);
        } catch {
          gaps.push(noted('SYMLINK_OUTSIDE_REPO', rel, `the symlink at ${rel} resolves to nothing, so it was skipped`));
          continue;
        }

        const inside = relative(realRoot, resolved).split(sep).join('/');
        if (inside.startsWith('..') || inside === '') {
          gaps.push(noted('SYMLINK_OUTSIDE_REPO', rel, `${rel} is a symlink resolving outside this repository, so it was skipped rather than read as part of the system`));
          continue;
        }

        try {
          if (statSync(full).isDirectory()) {
            if (visited.has(resolved)) {
              gaps.push(noted('SYMLINK_LOOP', rel, `${rel} is a symlink to a directory this scan already walked, so it was not walked again`));
              continue;
            }
            visited.add(resolved);
            descend(full);
            continue;
          }
        } catch {
          continue;
        }
      }

      try {
        if (statSync(full).size > MAX_FILE_BYTES) {
          gaps.push(noted('FILE_TOO_LARGE', rel, `${rel} is larger than ${MAX_FILE_BYTES} bytes, so it was skipped: a source file that big is generated, minified or vendored`));
          continue;
        }
      } catch {
        // An unstattable file is reported when the read fails, which is the next thing that happens.
      }

      files.push(rel);
    }
  };

  descend(root);
  return { files: files.sort(), gaps };
}

// Read every file worth reading, and turn a failure into a BLOCKING gap rather than a silence.
export function readRepo(root) {
  const contents = new Map();
  const { files, gaps } = walkFiles(root);

  for (const path of files) {
    if (!shouldRead(path)) continue;
    try {
      contents.set(path, readFileSync(join(root, path), 'utf8'));
    } catch (error) {
      gaps.push({
        tier: 'BLOCKING',
        code: 'UNREADABLE_FILE',
        path,
        line: 1,
        cite: `${path}:1`,
        detail: `the file could not be read (${error.code ?? error.message}), so whatever it declares is missing from this run`,
      });
    }
  }

  return { files, contents, gaps };
}
