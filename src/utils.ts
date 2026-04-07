export function normPath(p: string) {
  return p.replace(/\/+$/, '');
}

export function isPathWithinRoot(filePath: string, root: string): boolean {
  const f = normPath(filePath);
  const r = normPath(root);
  return f === r || f.startsWith(r + '/');
}

export function shortenPath(path: string, homeDir: string): string {
  if (!path) return path;
  return homeDir ? path.replace(homeDir, '~') : path;
}
