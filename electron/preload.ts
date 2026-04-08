import { contextBridge, ipcRenderer } from 'electron';

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
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

  readDirectory: (dirPath: string, skipCache?: boolean): Promise<DirEntry[]> => ipcRenderer.invoke('read-directory', dirPath, skipCache),
  readFile: (filePath: string): Promise<FileResult> => ipcRenderer.invoke('read-file', filePath),
  searchFiles: (rootDir: string, query: string): Promise<Array<{ path: string; isDirectory: boolean }>> => ipcRenderer.invoke('search-files', rootDir, query),
  getGitInfo: (dirPath: string): Promise<GitInfo> => ipcRenderer.invoke('get-git-info', dirPath),
  getGitStatus: (dirPath: string): Promise<{ files: Record<string, string>; staged: Record<string, string>; repoRoot: string | null }> =>
    ipcRenderer.invoke('get-git-status', dirPath),
  getGitDiff: (filePath: string, repoRoot: string): Promise<{ diff: string | null; isNew: boolean; content: string | null }> =>
    ipcRenderer.invoke('get-git-diff', filePath, repoRoot),
  gitStage: (filePaths: string[], repoRoot: string): Promise<boolean> =>
    ipcRenderer.invoke('git-stage', filePaths, repoRoot),
  gitUnstage: (filePaths: string[], repoRoot: string): Promise<boolean> =>
    ipcRenderer.invoke('git-unstage', filePaths, repoRoot),

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

  watchDirectory: (dirPath: string): void => {
    ipcRenderer.send('watch-directory', dirPath);
  },
  unwatchDirectory: (dirPath: string): void => {
    ipcRenderer.send('unwatch-directory', dirPath);
  },
  onDirectoryChanged: (
    callback: (dirPath: string, eventType: string, filename: string | null) => void
  ): (() => void) => {
    const handler = (_event: any, dirPath: string, eventType: string, filename: string | null) =>
      callback(dirPath, eventType, filename);
    ipcRenderer.on('directory-changed', handler);
    return () => ipcRenderer.removeListener('directory-changed', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
