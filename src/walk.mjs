// The walk. docs/SPEC.md §3A.
//
// Two jobs, and the second one is the reason this is its own module: enumerate the files that are
// part of the system, and record every file it decided to open but could not. An unread file is
// not an empty file, and the difference is BLOCKING.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { isIgnoredPath, isManifestPath, IGNORED_SEGMENTS } from './extract/manifests.mjs';
import { isEnvExample, isLiveEnvFile } from './extract/env.mjs';
import { languageOf } from './extract/text.mjs';

const WORKFLOW = /(?:^|\/)\.github\/workflows\/[^/]+\.(?:yml|yaml)$/;
const PLIST = /\.plist$/;

// Dot directories are skipped wholesale except the ones that carry the system's own configuration.
const DOT_DIRS_KEPT = new Set(['.github', '.vibecodepm', '.system-map']);

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

export function walkFiles(root) {
  const files = [];

  const descend = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // A directory we cannot list contributes nothing we could cite, and the files inside it are
      // reported the moment one of them is named by an edge.
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join('/');

      if (entry.isDirectory()) {
        if (IGNORED_SEGMENTS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && !DOT_DIRS_KEPT.has(entry.name)) continue;
        descend(full);
        continue;
      }

      files.push(rel);
    }
  };

  descend(root);
  return files.sort();
}

// Read every file worth reading, and turn a failure into a BLOCKING gap rather than a silence.
export function readRepo(root) {
  const contents = new Map();
  const gaps = [];
  const files = walkFiles(root);

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
