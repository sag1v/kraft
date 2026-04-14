export interface GitResult {
  success: boolean;
  error: string | null;
}

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

export interface SearchFileResult {
  path: string;
  isDirectory: boolean;
}

export interface GitInfo {
  branch: string | null;
  repoName: string | null;
  isGitRepo: boolean;
  aheadCount: number;
}

export interface TerminalInfo {
  id: string;
  pid: number;
}

export interface AgentContextDir {
  path: string;
  name: string;
}

export interface TerminalPane {
  id: string;  // PTY terminal ID
  cwd: string;
}

export interface TerminalGroup {
  id: string;
  label: string;
  customLabel?: string;
  icon?: string;
  iconColor?: string;
  /** True when the icon was auto-set by agent detection (not manually chosen). */
  autoIcon?: boolean;
  /** True when the color was auto-set by agent detection (not manually chosen). */
  autoIconColor?: boolean;
  panes: TerminalPane[];
  focusedPaneId: string;      // which pane has keyboard focus
  splitPcts: number[];        // flex percentage for each pane (length === panes.length)
}

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseName: string;
}

export interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflict';

export interface GitStatusResult {
  files: Record<string, GitFileStatus>;
  staged: Record<string, GitFileStatus>;
  repoRoot: string | null;
}

export interface GitDiffResult {
  diff: string | null;
  isNew: boolean;
  content: string | null;
}

export interface Theme {
  id: string;
  name: string;
  type: 'dark' | 'light';
  dot: string;
  colors: {
    bg: string;
    bgSecondary: string;
    bgTertiary: string;
    fg: string;
    fgMuted: string;
    fgDim: string;
    accent: string;
    accentSecondary: string;
    accentTertiary: string;
    border: string;
    selection: string;
    scrollbar: string;
    scrollbarHover: string;
    agentAccent: string;
    diffAdd: string;
    diffRemove: string;
    terminalBg: string;
    terminalFg: string;
    terminalCursor: string;
    terminalSelection: string;
    ansi: {
      black: string;
      red: string;
      green: string;
      yellow: string;
      blue: string;
      magenta: string;
      cyan: string;
      white: string;
      brightBlack: string;
      brightRed: string;
      brightGreen: string;
      brightYellow: string;
      brightBlue: string;
      brightMagenta: string;
      brightCyan: string;
      brightWhite: string;
    };
  };
}

export type LayoutPreset =
  | 'get-shit-done'
  | 'watch-shit-done'
  | 'why'
  | 'really'
  | 'custom';

export type PanelId = 'explorer' | 'viewer' | 'terminal';

export type PanelVisibility = { explorer: boolean; viewer: boolean; terminal: boolean };

export interface PersistedPane {
  cwd: string;
}

export interface PersistedGroup {
  customLabel?: string;
  icon?: string;
  iconColor?: string;
  panes: PersistedPane[];
  focusedPaneIndex: number;
  splitPcts: number[];
  explorerRoot?: string | null;
  panelVisibility?: PanelVisibility;
  panelLayout?: PanelId[][];
}

export interface PersistedSession {
  running: boolean;
  savedAt: string;
  groups: PersistedGroup[];
  activeGroupIndex: number;
}

export interface SavedWorkspace {
  version: 1;
  name: string;
  createdAt: string;
  groups: PersistedGroup[];
  activeGroupIndex: number;
}

export interface SavedWorkspaceMeta {
  name: string;
  filename: string;
  createdAt: string;
}

export interface AppSettings {
  shellOverride: string | null;
  defaultLayout: LayoutPreset;
  panelLayout: PanelId[][];
  savedCustomLayout: PanelId[][] | null;
  customPanelVisibility: PanelVisibility | null;
  theme: string;
  autoLoadExplorer: boolean;
  syncLayoutAcrossTabs: boolean;
  showHiddenFiles: boolean;
  newTabUsePreviousCwd: boolean;
  keybindingPreset: 'vscode' | 'intellij' | 'custom';
  customKeybindings: Partial<Record<string, string>>;
  defaultWorkspace: string | null;
}

export interface ElectronAPI {
  getDefaultShell: () => Promise<string>;
  getHomeDir: () => Promise<string>;
  readDirectory: (dirPath: string, skipCache?: boolean, maxEntries?: number, showHiddenFiles?: boolean) => Promise<DirReadResult>;
  readFile: (filePath: string) => Promise<FileResult>;
  writeFile: (filePath: string, content: string) => Promise<{ error: string | null }>;
  createFile: (filePath: string) => Promise<{ error: string | null }>;
  createDirectory: (dirPath: string) => Promise<{ error: string | null }>;
  trashPath: (targetPath: string) => Promise<{ error: string | null }>;
  searchFiles: (rootDir: string, query: string) => Promise<SearchFileResult[]>;
  getGitInfo: (dirPath: string) => Promise<GitInfo>;
  getGitStatus: (dirPath: string) => Promise<GitStatusResult>;
  getGitDiff: (filePath: string, repoRoot: string) => Promise<GitDiffResult>;
  gitStage: (filePaths: string[], repoRoot: string) => Promise<GitResult>;
  gitUnstage: (filePaths: string[], repoRoot: string) => Promise<GitResult>;
  gitDiscardChanges: (trackedPaths: string[], untrackedPaths: string[], repoRoot: string) => Promise<GitResult>;
  gitStash: (repoRoot: string, message?: string, includeUntracked?: boolean) => Promise<GitResult>;
  gitStashPop: (repoRoot: string) => Promise<GitResult>;
  gitCommit: (repoRoot: string, message: string) => Promise<GitResult>;
  gitCommitAll: (repoRoot: string, message: string) => Promise<GitResult>;
  gitUndoCommit: (repoRoot: string) => Promise<GitResult>;
  createTerminal: (options: { cwd?: string; shell?: string; cols?: number; rows?: number }) => Promise<TerminalInfo>;
  writeTerminal: (id: string, data: string) => void;
  resizeTerminal: (id: string, cols: number, rows: number) => void;
  getTerminalCwd: (id: string) => Promise<string | null>;
  resolveFilePath: (rawPath: string, cwd?: string) => Promise<string | null>;
  destroyTerminal: (id: string) => void;
  onTerminalData: (callback: (id: string, data: string) => void) => () => void;
  onTerminalExit: (callback: (id: string, exitCode: number) => void) => () => void;
  getAgentContextDirs: (terminalId: string) => Promise<AgentContextDir[]>;
  onAgentContextDirsChanged: (callback: (terminalId: string, dirs: AgentContextDir[]) => void) => () => void;
  onAgentDetected: (callback: (terminalId: string, agentId: string) => void) => () => void;
  onAgentExited: (callback: (terminalId: string) => void) => () => void;
  getSettings: () => Promise<Record<string, any>>;
  saveSettings: (settings: Record<string, any>) => Promise<boolean>;
  getZoomLevel: () => Promise<number>;
  setZoomLevel: (level: number) => Promise<number>;
  onZoomLevelChanged: (callback: (level: number) => void) => () => void;
  onOpenSettings: (callback: () => void) => () => void;
  toggleDevTools: () => void;
  reloadWindow: () => void;
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  showItemInFolder: (filePath: string) => Promise<void>;
  checkForUpdates: () => Promise<boolean>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
  onUpdateDownloaded: (callback: (info: UpdateInfo, filePath: string) => void) => () => void;
  onUpdateError: (callback: (error: string) => void) => () => void;
  watchDirectory: (dirPath: string) => void;
  unwatchDirectory: (dirPath: string) => void;
  onDirectoryChanged: (
    callback: (dirPath: string, eventType: string, filename: string | null) => void
  ) => () => void;
  watchGitRepo: (repoRoot: string) => void;
  unwatchGitRepo: (repoRoot: string) => void;
  onGitChanged: (callback: (repoRoot: string) => void) => () => void;
  watchFile: (filePath: string) => void;
  unwatchFile: (filePath: string) => void;
  onFileChanged: (callback: (filePath: string) => void) => () => void;
  saveSession: (session: PersistedSession) => Promise<boolean>;
  getSession: () => Promise<{ session: PersistedSession | null; wasCrash: boolean; pendingWorkspace?: string | null }>;
  clearCrashFlag: () => Promise<boolean>;
  saveWorkspace: (workspace: SavedWorkspace) => Promise<{ filename: string }>;
  loadWorkspace: (filename: string) => Promise<SavedWorkspace | null>;
  listWorkspaces: () => Promise<SavedWorkspaceMeta[]>;
  deleteWorkspace: (filename: string) => Promise<boolean>;
  refreshDockMenu: () => void;
  setActiveWorkspace: (filename: string | null) => void;
  onLoadWorkspace: (callback: (filename: string) => void) => () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
