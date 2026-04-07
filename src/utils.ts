export function shortenPath(path: string, homeDir: string): string {
  if (!path) return path;
  return homeDir ? path.replace(homeDir, '~') : path;
}
