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
  getGitStatus: (dirPath: string): Promise<{ files: Record<string, string>; repoRoot: string | null }> =>
    ipcRenderer.invoke('get-git-status', dirPath),
  getGitDiff: (filePath: string, repoRoot: string): Promise<{ diff: string | null; isNew: boolean; content: string | null }> =>
    ipcRenderer.invoke('get-git-diff', filePath, repoRoot),

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

  getSettings: (): Promise<Record<string, any>> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Record<string, any>): Promise<boolean> => ipcRenderer.invoke('save-settings', settings),

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
