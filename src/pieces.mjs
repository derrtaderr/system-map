// What counts as a piece. docs/SPEC.md §4A row D5.
//
// A piece is the unit the map names, the unit blast radius is measured in, and the unit report section
// 1 reports. The first build made it "the top-level directory", which is right for a repo shaped like
// `src/ bin/ scripts/` and wrong for the two shapes a ship-check found on real repos:
//
//   `packages/{api,worker,shared}` derived to ONE piece called `packages`, zero internal edges, and a
//   blast radius of "nothing in this repo imports it" for the entire system.
//
// The rule: a piece is the top-level directory, EXCEPT that when a directory contains only
// directories and no files of its own, its children are the pieces instead. One level of descent, not
// unlimited — unlimited descent is just the directory tree again, and the whole value of a piece is
// that there are three to five of them.

// The piece a module belongs to, given the set of directories that split. Exported for the callers that
// have already computed `splitDirs` and are classifying one path at a time.
export function pieceOfPath(modulePath, splitDirs) {
  const slash = modulePath.indexOf('/');
  if (slash === -1) return modulePath;

  const top = modulePath.slice(0, slash);
  if (!splitDirs.has(top)) return top;

  const rest = modulePath.slice(slash + 1);
  const second = rest.indexOf('/');
  return second === -1 ? `${top}/${rest}` : `${top}/${rest.slice(0, second)}`;
}

// Which top-level directories hold no files of their own and so hand their name to their children.
export function splittableDirs(modulePaths) {
  const hasOwnFile = new Set();
  const hasChildDir = new Set();

  for (const path of modulePaths) {
    const slash = path.indexOf('/');
    if (slash === -1) continue;

    const top = path.slice(0, slash);
    const rest = path.slice(slash + 1);
    if (rest.includes('/')) hasChildDir.add(top);
    else hasOwnFile.add(top);
  }

  const split = new Set();
  for (const dir of hasChildDir) {
    if (!hasOwnFile.has(dir)) split.add(dir);
  }
  return split;
}

// piece -> its module paths, sorted, with the pieces themselves in a stable order.
export function piecesOf(scan) {
  const paths = (scan.modules ?? []).map((module) => module.path);
  const split = splittableDirs(paths);

  const pieces = new Map();
  for (const path of paths) {
    const piece = pieceOfPath(path, split);
    if (!pieces.has(piece)) pieces.set(piece, []);
    pieces.get(piece).push(path);
  }

  return new Map(
    [...pieces.entries()]
      .map(([piece, members]) => [piece, members.sort()])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}

// The same classifier, bound to one scan, for callers that walk edges rather than modules.
export function pieceResolver(scan) {
  const split = splittableDirs((scan.modules ?? []).map((module) => module.path));
  return (modulePath) => pieceOfPath(modulePath, split);
}
