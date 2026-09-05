import path from "node:path";

export function isPathWithin(root, candidate, paths = path) {
  const local = paths.relative(paths.resolve(root), paths.resolve(candidate));
  return !paths.isAbsolute(local) && local !== ".." && !local.startsWith(`..${paths.sep}`);
}
