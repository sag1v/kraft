import { contextBridge, ipcRenderer } from 'electron';

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

export interface DirReadResult {
  entries: DirEntry[];
  truncated: boolean;
  totalCount: number;
}

export interface FileResult {
  error: string | null;
  content: string | null;
}

export interface GitInfo {
  branch: string | null;
  repoName: string | null;
  isGitRepo: boolean;
}

export interface TerminalInfo {
  id: string;
  pid: number;
}

const api = {
  getDefaultShell: (): Promise<string> => ipcRenderer.invoke('get-default-shell'),
  getHomeDir: (): Promise<string> => ipcRenderer.invoke('get-home-dir'),

  readDirectory: (dirPath: string, skipCache?: boolean, maxEntries?: number, showHiddenFiles?: boolean): Promise<DirReadResult> => ipcRenderer.invoke('read-directory', dirPath, skipCache, maxEntries, showHiddenFiles),
  readFile: (filePath: string): Promise<FileResult> => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath: string, content: string): Promise<{ error: string | null }> => ipcRenderer.invoke('write-file', filePath, content),
  searchFiles: (rootDir: string, query: string): Promise<Array<{ path: string; isDirectory: boolean }>> => ipcRenderer.invoke('search-files', rootDir, query),
  getGitInfo: (dirPath: string): Promise<GitInfo> => ipcRenderer.invoke('get-git-info', dirPath),
  getGitStatus: (dirPath: string): Promise<{ files: Record<string, string>; staged: Record<string, string>; repoRoot: string | null; ignored: string[] }> =>
    ipcRenderer.invoke('get-git-status', dirPath),
  getGitDiff: (filePath: string, repoRoot: string): Promise<{ diff: string | null; isNew: boolean; content: string | null }> =>
    ipcRenderer.invoke('get-git-diff', filePath, repoRoot),
  gitStage: (filePaths: string[], repoRoot: string): Promise<boolean> =>
    ipcRenderer.invoke('git-stage', filePaths, repoRoot),
  gitUnstage: (filePaths: string[], repoRoot: string): Promise<boolean> =>
    ipcRenderer.invoke('git-unstage', filePaths, repoRoot),
  gitDiscardChanges: (trackedPaths: string[], untrackedPaths: string[], repoRoot: string): Promise<boolean> =>
    ipcRenderer.invoke('git-discard-changes', trackedPaths, untrackedPaths, repoRoot),
  gitStash: (repoRoot: string, message?: string, includeUntracked?: boolean): Promise<boolean> =>
    ipcRenderer.invoke('git-stash', repoRoot, message, includeUntracked),
  gitStashPop: (repoRoot: string): Promise<boolean> =>
    ipcRenderer.invoke('git-stash-pop', repoRoot),
  gitCommit: (repoRoot: string, message: string): Promise<boolean> =>
    ipcRenderer.invoke('git-commit', repoRoot, message),
  gitCommitAll: (repoRoot: string, message: string): Promise<boolean> =>
    ipcRenderer.invoke('git-commit-all', repoRoot, message),
  gitUndoCommit: (repoRoot: string): Promise<boolean> =>
    ipcRenderer.invoke('git-undo-commit', repoRoot),

  createTerminal: (options: {
    cwd?: string;
    shell?: string;
    cols?: number;
    rows?: number;
  }): Promise<TerminalInfo> => ipcRenderer.invoke('create-terminal', options),

  writeTerminal: (id: string, data: string): void => {
    ipcRenderer.send('terminal-write', id, data);
  },

  resizeTerminal: (id: string, cols: number, rows: number): void => {
    ipcRenderer.send('terminal-resize', id, cols, rows);
  },

  getTerminalCwd: (id: string): Promise<string | null> => ipcRenderer.invoke('terminal-get-cwd', id),

  resolveFilePath: (rawPath: string, cwd?: string): Promise<string | null> =>
    ipcRenderer.invoke('resolve-file-path', rawPath, cwd),

  destroyTerminal: (id: string): void => {
    ipcRenderer.send('terminal-destroy', id);
  },

  onTerminalData: (callback: (id: string, data: string) => void): (() => void) => {
    const handler = (_event: any, id: string, data: string) => callback(id, data);
    ipcRenderer.on('terminal-data', handler);
    return () => ipcRenderer.removeListener('terminal-data', handler);
  },

  onTerminalExit: (callback: (id: string, exitCode: number) => void): (() => void) => {
    const handler = (_event: any, id: string, exitCode: number) => callback(id, exitCode);
    ipcRenderer.on('terminal-exit', handler);
    return () => ipcRenderer.removeListener('terminal-exit', handler);
  },

  getAgentContextDirs: (terminalId: string): Promise<Array<{ path: string; name: string }>> =>
    ipcRenderer.invoke('get-agent-context-dirs', terminalId),

  onAgentContextDirsChanged: (
    callback: (terminalId: string, dirs: Array<{ path: string; name: string }>) => void
  ): (() => void) => {
    const handler = (_event: any, terminalId: string, dirs: Array<{ path: string; name: string }>) =>
      callback(terminalId, dirs);
    ipcRenderer.on('agent-context-dirs-changed', handler);
    return () => ipcRenderer.removeListener('agent-context-dirs-changed', handler);
  },

  onAgentDetected: (
    callback: (terminalId: string, agentId: string) => void
  ): (() => void) => {
    const handler = (_event: any, terminalId: string, agentId: string) =>
      callback(terminalId, agentId);
    ipcRenderer.on('agent-detected', handler);
    return () => ipcRenderer.removeListener('agent-detected', handler);
  },

  onAgentExited: (
    callback: (terminalId: string) => void
  ): (() => void) => {
    const handler = (_event: any, terminalId: string) =>
      callback(terminalId);
    ipcRenderer.on('agent-exited', handler);
    return () => ipcRenderer.removeListener('agent-exited', handler);
  },

  onOpenSettings: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('open-settings', handler);
    return () => ipcRenderer.removeListener('open-settings', handler);
  },

  getSettings: (): Promise<Record<string, any>> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Record<string, any>): Promise<boolean> => ipcRenderer.invoke('save-settings', settings),

  getZoomLevel: (): Promise<number> => ipcRenderer.invoke('get-zoom-level'),
  setZoomLevel: (level: number): Promise<number> => ipcRenderer.invoke('set-zoom-level', level),
  onZoomLevelChanged: (callback: (level: number) => void): (() => void) => {
    const handler = (_event: any, level: number) => callback(level);
    ipcRenderer.on('zoom-level-changed', handler);
    return () => ipcRenderer.removeListener('zoom-level-changed', handler);
  },

  toggleDevTools: (): void => {
    ipcRenderer.send('toggle-devtools');
  },

  reloadWindow: (): void => {
    ipcRenderer.send('reload-window');
  },

  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getPlatform: (): Promise<string> => ipcRenderer.invoke('get-platform'),
  showItemInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke('show-item-in-folder', filePath),
  checkForUpdates: (): Promise<boolean> => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('download-update'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (callback: (info: { version: string; releaseDate: string; releaseName: string }) => void): (() => void) => {
    const handler = (_event: any, info: any) => callback(info);
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },
  onUpdateDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void): (() => void) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on('update-download-progress', handler);
    return () => ipcRenderer.removeListener('update-download-progress', handler);
  },
  onUpdateDownloaded: (callback: (info: { version: string; releaseDate: string; releaseName: string }) => void): (() => void) => {
    const handler = (_event: any, info: any) => callback(info);
    ipcRenderer.on('update-downloaded', handler);
    return () => ipcRenderer.removeListener('update-downloaded', handler);
  },
  onUpdateError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: any, error: string) => callback(error);
    ipcRenderer.on('update-error', handler);
    return () => ipcRenderer.removeListener('update-error', handler);
  },

  watchDirectory: (dirPath: string): void => {
    ipcRenderer.send('watch-directory', dirPath);
  },
  unwatchDirectory: (dirPath: string): void => {
    ipcRenderer.send('unwatch-directory', dirPath);
  },
  watchGitRepo: (repoRoot: string): void => {
    ipcRenderer.send('watch-git-repo', repoRoot);
  },
  unwatchGitRepo: (repoRoot: string): void => {
    ipcRenderer.send('unwatch-git-repo', repoRoot);
  },
  onGitChanged: (callback: (repoRoot: string) => void): (() => void) => {
    const handler = (_event: any, repoRoot: string) => callback(repoRoot);
    ipcRenderer.on('git-changed', handler);
    return () => ipcRenderer.removeListener('git-changed', handler);
  },
  onDirectoryChanged: (
    callback: (dirPath: string, eventType: string, filename: string | null) => void
  ): (() => void) => {
    const handler = (_event: any, dirPath: string, eventType: string, filename: string | null) =>
      callback(dirPath, eventType, filename);
    ipcRenderer.on('directory-changed', handler);
    return () => ipcRenderer.removeListener('directory-changed', handler);
  },
  watchFile: (filePath: string): void => {
    ipcRenderer.send('watch-file', filePath);
  },
  unwatchFile: (filePath: string): void => {
    ipcRenderer.send('unwatch-file', filePath);
  },
  onFileChanged: (callback: (filePath: string) => void): (() => void) => {
    const handler = (_event: any, filePath: string) => callback(filePath);
    ipcRenderer.on('file-changed', handler);
    return () => ipcRenderer.removeListener('file-changed', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
