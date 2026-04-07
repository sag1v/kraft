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

export interface TerminalSession {
  id: string;
  label: string;
  cwd: string;
}

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflict';

export interface GitStatusResult {
  files: Record<string, GitFileStatus>;
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
  | 'standard'
  | 'terminal-focus'
  | 'split'
  | 'stacked'
  | 'editor-focus'
  | 'custom';

export type PanelId = 'explorer' | 'viewer' | 'terminal';

export interface AppSettings {
  shellOverride: string | null;
  defaultLayout: LayoutPreset;
  panelLayout: PanelId[][];
  savedCustomLayout: PanelId[][] | null;
  fontSize: number;
  theme: string;
}

export interface ElectronAPI {
  getDefaultShell: () => Promise<string>;
  getHomeDir: () => Promise<string>;
  readDirectory: (dirPath: string, skipCache?: boolean) => Promise<DirEntry[]>;
  readFile: (filePath: string) => Promise<FileResult>;
  searchFiles: (rootDir: string, query: string) => Promise<string[]>;
  getGitInfo: (dirPath: string) => Promise<GitInfo>;
  getGitStatus: (dirPath: string) => Promise<GitStatusResult>;
  getGitDiff: (filePath: string, repoRoot: string) => Promise<GitDiffResult>;
  createTerminal: (options: { cwd?: string; shell?: string; cols?: number; rows?: number }) => Promise<TerminalInfo>;
  writeTerminal: (id: string, data: string) => void;
  resizeTerminal: (id: string, cols: number, rows: number) => void;
  getTerminalCwd: (id: string) => Promise<string | null>;
  destroyTerminal: (id: string) => void;
  onTerminalData: (callback: (id: string, data: string) => void) => () => void;
  onTerminalExit: (callback: (id: string, exitCode: number) => void) => () => void;
  getSettings: () => Promise<Record<string, any>>;
  saveSettings: (settings: Record<string, any>) => Promise<boolean>;
  toggleDevTools: () => void;
  reloadWindow: () => void;
  watchDirectory: (dirPath: string) => void;
  unwatchDirectory: (dirPath: string) => void;
  onDirectoryChanged: (
    callback: (dirPath: string, eventType: string, filename: string | null) => void
  ) => () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
