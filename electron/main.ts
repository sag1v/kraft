import { app, BrowserWindow, ipcMain, shell, Menu, nativeImage, dialog, clipboard, webContents as electronWebContents } from 'electron';
import type { WebContents } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AgentManager } from './agent-providers';
import { UpdateChecker } from './update-checker';

const execFileAsync = promisify(execFile);
const pty = require('node-pty');

// Wrapper that injects the user's full shell environment (PATH, nvm, etc.) so
// that hooks and tools like npx/node are always resolvable in headless execs.
async function shellExec(
  cmd: string,
  args: string[],
  opts: { cwd?: string; encoding?: BufferEncoding | 'utf-8'; timeout?: number; maxBuffer?: number }
) {
  const env = await getShellEnv();
  return execFileAsync(cmd, args, { ...opts, env } as any);
}

let mainWindow: BrowserWindow | null = null;
const agentManager = new AgentManager();
const updateChecker = new UpdateChecker();

interface PtyInstance {
  process: any;
  pid: number;
  shell: string;
  webContentsId: number;
  /** cwd last reported via OSC 7 — avoids lsof on every poll */
  trackedCwd?: string;
  /** cleanup fn to remove the ZDOTDIR temp dir, if one was created */
  zdotdirCleanup?: () => void;
}

/**
 * Creates a temporary ZDOTDIR for zsh that sources the user's original config
 * files and adds an OSC 7 (cwd notification) hook.  This gives instant cwd
 * detection without any lsof calls.
 *
 * Handles all zsh startup files so user config is unaffected:
 *   .zshenv / .zprofile / .zshrc / .zlogin
 */
async function createZshIntegration(): Promise<{ extraEnv: Record<string, string>; cleanup: () => void } | null> {
  try {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kraft-zsh-'));
    const home = os.homedir();

    // Stub that sources the corresponding home-dir file if it exists
    const stub = (dotfile: string) =>
      `[[ -f "${home}/${dotfile}" ]] && builtin source "${home}/${dotfile}"\n`;

    await fs.promises.writeFile(path.join(tempDir, '.zshenv'), stub('.zshenv'));
    await fs.promises.writeFile(path.join(tempDir, '.zprofile'), stub('.zprofile'));
    await fs.promises.writeFile(path.join(tempDir, '.zlogin'), stub('.zlogin'));

    const zshrc = stub('.zshrc') + `
# Kraft shell integration — emit OSC 7 on every directory change
__kraft_osc7() {
  printf '\\033]7;file://%s%s\\033\\\\' "\${HOST:-\$(hostname -s 2>/dev/null || echo localhost)}" "\${PWD}"
}
# chpwd fires immediately on cd (before the prompt), precmd is the safety net
autoload -Uz add-zsh-hook 2>/dev/null
add-zsh-hook chpwd  __kraft_osc7 2>/dev/null
add-zsh-hook precmd __kraft_osc7 2>/dev/null
# Emit once at startup so the explorer knows the initial cwd
__kraft_osc7
`;
    await fs.promises.writeFile(path.join(tempDir, '.zshrc'), zshrc);

    const cleanup = () => {
      fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    };

    return { extraEnv: { ZDOTDIR: tempDir }, cleanup };
  } catch {
    return null;
  }
}

const ptyInstances = new Map<string, PtyInstance>();
let terminalIdCounter = 0;

// Serialize git index operations per repo to prevent index.lock conflicts
const gitQueues = new Map<string, Promise<void>>();
function enqueueGitOp<T>(repoRoot: string, op: () => Promise<T>): Promise<T> {
  const prev = gitQueues.get(repoRoot) ?? Promise.resolve();
  let settle!: () => void;
  const queued = new Promise<void>(r => { settle = r; });
  gitQueues.set(repoRoot, queued);
  return prev.then(op).finally(settle);
}

interface DirCacheEntry {
  entries: any[];
  totalCount: number;
  timestamp: number;
}
const dirCache = new Map<string, DirCacheEntry>();
const DIR_CACHE_TTL = 5000;

interface ActiveWatcherEntry { watcher: fs.FSWatcher; webContentsId: number; }
interface GitWatcherEntry { watchers: fs.FSWatcher[]; webContentsId: number; }
interface FileWatcherEntry { listener: (curr: fs.Stats, prev: fs.Stats) => void; webContentsId: number; }

const activeWatchers = new Map<string, ActiveWatcherEntry>();
const gitWatchers = new Map<string, GitWatcherEntry>();
const fileWatchers = new Map<string, FileWatcherEntry>();

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  try {
    const { shell } = os.userInfo();
    if (shell) return shell;
  } catch { /* ignore */ }
  return process.platform === 'darwin'
    ? (process.env.SHELL || '/bin/zsh')
    : (process.env.SHELL || '/bin/sh');
}

const IDE_ENV_PREFIXES = ['VSCODE_', 'CURSOR_', 'CLAUDE_CODE_'];
const IDE_ENV_KEYS = new Set([
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'ORIGINAL_XDG_CURRENT_DESKTOP',
  'GIT_ASKPASS',
  'ELECTRON_RUN_AS_NODE',
  '__CFBundleIdentifier',
]);

function stripIdeEnv(env: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(env)) {
    if (IDE_ENV_KEYS.has(key)) continue;
    if (IDE_ENV_PREFIXES.some(p => key.startsWith(p))) continue;
    clean[key] = val;
  }
  clean.TERM_PROGRAM = 'kraft';
  return clean;
}

const ENV_DELIMITER = '_KRAFT_ENV_DELIMITER_';

let cachedShellEnv: Record<string, string> | null = null;
let shellEnvPromise: Promise<Record<string, string>> | null = null;
let shellEnvFailed = false;

async function getShellEnv(): Promise<Record<string, string>> {
  if (cachedShellEnv) return cachedShellEnv;
  if (shellEnvPromise) return shellEnvPromise;

  shellEnvPromise = (async () => {
    if (process.platform === 'win32') {
      cachedShellEnv = stripIdeEnv(process.env as Record<string, string>);
      return cachedShellEnv;
    }

    const defaultShell = getDefaultShell();
    const args = ['-ilc', `echo -n "${ENV_DELIMITER}"; command env; echo -n "${ENV_DELIMITER}"; exit`];
    const spawnEnv = stripIdeEnv(process.env as Record<string, string>);
    spawnEnv.DISABLE_AUTO_UPDATE = 'true';
    spawnEnv.ZSH_TMUX_AUTOSTART = 'false';

    const shells = [defaultShell, '/bin/zsh', '/bin/bash', '/bin/sh']
      .filter((s, i, arr) => arr.indexOf(s) === i);

    for (const shell of shells) {
      try {
        const { stdout } = await execFileAsync(shell, args, {
          encoding: 'utf-8',
          timeout: 5000,
          env: spawnEnv,
        });
        const delimited = stdout.split(ENV_DELIMITER)[1];
        if (!delimited) continue;

        const env: Record<string, string> = {};
        for (const line of delimited.split('\n').filter(Boolean)) {
          const idx = line.indexOf('=');
          if (idx > 0) {
            env[line.substring(0, idx)] = line.substring(idx + 1);
          }
        }
        env.TERM_PROGRAM = 'kraft';
        cachedShellEnv = env;
        return cachedShellEnv;
      } catch {
        continue;
      }
    }

    console.error('[Kraft] Failed to load shell environment from any shell');
    shellEnvFailed = true;
    cachedShellEnv = stripIdeEnv(process.env as Record<string, string>);
    return cachedShellEnv;
  })();

  return shellEnvPromise;
}

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getSessionPath(): string {
  return path.join(app.getPath('userData'), 'session.json');
}

function getWorkspacesDir(): string {
  return path.join(app.getPath('userData'), 'workspaces');
}

let pendingWorkspace: string | null = null;

// Tracks which workspace filename is currently loaded in each renderer window.
// webContentsId → workspace filename
const windowActiveWorkspace = new Map<number, string>();

async function rebuildDockMenu(): Promise<void> {
  if (process.platform !== 'darwin') return;
  const dir = getWorkspacesDir();
  let workspaces: { name: string; filename: string }[] = [];
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const files = await fs.promises.readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = await fs.promises.readFile(path.join(dir, file), 'utf-8');
        const ws = JSON.parse(data);
        workspaces.push({ name: ws.name || file.replace('.json', ''), filename: file });
      } catch {}
    }
    // Newest first (filenames contain timestamp)
    workspaces.sort((a, b) => b.filename.localeCompare(a.filename));
    workspaces = workspaces.slice(0, 8);
  } catch {}

  const template: Electron.MenuItemConstructorOptions[] = [
    { label: 'New Window', click: () => createWindow() },
  ];

  if (workspaces.length > 0) {
    template.push({ type: 'separator' });
    for (const ws of workspaces) {
      const filename = ws.filename;
      template.push({
        label: ws.name,
        click: () => {
          // If this workspace is already open in a window, just focus it
          const wins = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
          const existing = wins.find(w => windowActiveWorkspace.get(w.webContents.id) === filename);
          if (existing) {
            if (existing.isMinimized()) existing.restore();
            existing.show();
            existing.focus();
            return;
          }
          // Not open anywhere — create a new window and load the workspace into it
          pendingWorkspace = filename;
          createWindow();
        },
      });
    }
  }

  app.dock.setMenu(Menu.buildFromTemplate(template));
}

interface PersistedSession {
  savedAt: string;
  groups: any[];
  activeGroupIndex: number;
}

let isQuitting = false;

function loadSettings(): Record<string, any> {
  try {
    const data = fs.readFileSync(getSettingsPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveSettings(settings: Record<string, any>): void {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

function sendToWebContents(id: number, channel: string, ...args: any[]) {
  const wc = electronWebContents.fromId(id);
  if (wc && !wc.isDestroyed()) {
    wc.send(channel, ...args);
  }
}

function broadcastToAllWindows(channel: string, ...args: any[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}

function applyZoomLevel(level: number, wc?: WebContents) {
  const target = wc ?? BrowserWindow.getFocusedWindow()?.webContents;
  if (!target || target.isDestroyed()) return;
  const clamped = Math.max(-3, Math.min(5, level));
  target.setZoomLevel(clamped);
  target.send('zoom-level-changed', clamped);
  const saved = loadSettings();
  saved.zoomLevel = clamped;
  saveSettings(saved);
}

function applyZoomDelta(delta: number, wc?: WebContents) {
  const target = wc ?? BrowserWindow.getFocusedWindow()?.webContents;
  if (!target || target.isDestroyed()) return;
  applyZoomLevel(target.getZoomLevel() + delta, target);
}

function setupMenu() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Kraft',
      submenu: [
        {
          label: 'About Kraft',
          click: () => {
            const electronVersion = process.versions.electron;
            const chromeVersion = process.versions.chrome;
            const nodeVersion = process.versions.node;
            const v8Version = process.versions.v8;
            const osInfo = `${os.type()} ${os.arch()} ${os.release()}`;
            const info = [
              `Version: ${app.getVersion()}`,
              `Electron: ${electronVersion}`,
              `Chromium: ${chromeVersion}`,
              `Node.js: ${nodeVersion}`,
              `V8: ${v8Version}`,
              `OS: ${osInfo}`,
            ].join('\n');

            const parentWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
            const result = dialog.showMessageBoxSync(parentWin, {
              type: 'info',
              icon: nativeImage.createFromPath(iconPath),
              title: 'About Kraft',
              message: 'Kraft',
              detail: info,
              buttons: ['OK', 'Copy'],
              defaultId: 0,
            });
            if (result === 1) {
              clipboard.writeText(info);
            }
          },
        },
        {
          label: 'Check for Updates...',
          click: async () => {
            const hasUpdate = await updateChecker.check();
            if (!hasUpdate) {
              const parentWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
              dialog.showMessageBox(parentWin, {
                type: 'info',
                title: 'No Updates',
                message: 'You are running the latest version of Kraft.',
                buttons: ['OK'],
              });
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'CommandOrControl+,',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('open-settings');
            }
          },
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CommandOrControl+=',
          click: () => applyZoomDelta(0.5),
        },
        {
          label: 'Zoom In (Numpad)',
          accelerator: 'CommandOrControl+numadd',
          click: () => applyZoomDelta(0.5),
          visible: false,
        },
        {
          label: 'Zoom Out',
          accelerator: 'CommandOrControl+-',
          click: () => applyZoomDelta(-0.5),
        },
        {
          label: 'Zoom Out (Numpad)',
          accelerator: 'CommandOrControl+numsub',
          click: () => applyZoomDelta(-0.5),
          visible: false,
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CommandOrControl+0',
          click: () => applyZoomLevel(0),
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CommandOrControl+N',
          click: () => createWindow(),
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  if (process.platform === 'darwin') {
    app.dock.setIcon(icon);
  }

  const win = new BrowserWindow({
    title: 'Kraft',
    icon,
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;
  // Capture webContents ID now, before the window can be destroyed
  const winWebContentsId = win.webContents.id;

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = ['LOG', 'WARN', 'ERROR'][level] || 'INFO';
    console.log(`[Renderer ${tag}] ${message} (${sourceId}:${line})`);
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[RENDERER CRASHED]', details);
  });

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.meta && input.alt && input.key === 'i') {
      win.webContents.toggleDevTools();
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.webContents.on('did-finish-load', () => {
    const saved = loadSettings();
    if (saved.zoomLevel != null) {
      win.webContents.setZoomLevel(saved.zoomLevel);
    }
  });

  win.webContents.on('zoom-changed', (_event, direction) => {
    applyZoomDelta(direction === 'in' ? 0.5 : -0.5, win.webContents);
  });

  win.on('focus', () => {
    mainWindow = win;
  });

  win.on('closed', () => {
    windowActiveWorkspace.delete(winWebContentsId);
    // Clean up PTY instances owned by this window
    for (const [id, instance] of ptyInstances) {
      if (instance.webContentsId === winWebContentsId) {
        instance.process.kill();
        ptyInstances.delete(id);
        agentManager.unregisterTerminal(id);
      }
    }
    // Clean up directory watchers owned by this window
    for (const [dirPath, entry] of activeWatchers) {
      if (entry.webContentsId === winWebContentsId) {
        entry.watcher.close();
        activeWatchers.delete(dirPath);
      }
    }
    // Clean up file watchers owned by this window
    for (const [filePath, entry] of fileWatchers) {
      if (entry.webContentsId === winWebContentsId) {
        fs.unwatchFile(filePath, entry.listener);
        fileWatchers.delete(filePath);
      }
    }
    // Clean up git watchers owned by this window
    for (const [repoRoot, entry] of gitWatchers) {
      if (entry.webContentsId === winWebContentsId) {
        for (const w of entry.watchers) w.close();
        gitWatchers.delete(repoRoot);
      }
    }
    // Update mainWindow reference if this was it
    if (mainWindow === win) {
      const remaining = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
      mainWindow = remaining.length > 0 ? remaining[0] : null;
    }
  });
}

function setupIPC() {
  ipcMain.handle('get-default-shell', () => getDefaultShell());
  ipcMain.handle('get-home-dir', () => {
    try {
      return fs.realpathSync(os.homedir());
    } catch {
      return os.homedir();
    }
  });

  ipcMain.handle('read-directory', async (_event, dirPath: string, skipCache?: boolean, maxEntries?: number, showHiddenFiles?: boolean) => {
    const limit = maxEntries ?? 0;

    let allEntries: { name: string; path: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }[];

    if (!skipCache) {
      const cached = dirCache.get(dirPath);
      if (cached && Date.now() - cached.timestamp < DIR_CACHE_TTL) {
        allEntries = cached.entries;
      } else {
        allEntries = null!;
      }
    } else {
      allEntries = null!;
    }

    if (!allEntries) {
      try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        allEntries = entries
          .map((entry) => ({
            name: entry.name,
            path: path.join(dirPath, entry.name),
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile(),
            isSymlink: entry.isSymbolicLink(),
          }))
          .sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
          });

        dirCache.set(dirPath, { entries: allEntries, totalCount: allEntries.length, timestamp: Date.now() });

        if (dirCache.size > 200) {
          const oldest = [...dirCache.entries()]
            .sort((a, b) => a[1].timestamp - b[1].timestamp)
            .slice(0, 50);
          for (const [key] of oldest) dirCache.delete(key);
        }
      } catch {
        return { entries: [], truncated: false, totalCount: 0 };
      }
    }

    const result = showHiddenFiles ? allEntries : allEntries.filter((e) => !e.name.startsWith('.'));
    const totalCount = result.length;
    const sliced = limit > 0 ? result.slice(0, limit) : result;
    return { entries: sliced, truncated: limit > 0 && totalCount > limit, totalCount };
  });

  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > 2 * 1024 * 1024) {
        return { error: 'File too large (> 2MB)', content: null };
      }
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return { error: null, content };
    } catch (e: any) {
      return { error: e.message, content: null };
    }
  });

  ipcMain.handle('write-file', async (_event, filePath: string, content: string) => {
    try {
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return { error: null };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('create-file', async (_event, filePath: string) => {
    try {
      await fs.promises.writeFile(filePath, '', { flag: 'wx', encoding: 'utf-8' });
      return { error: null };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('create-directory', async (_event, dirPath: string) => {
    try {
      await fs.promises.mkdir(dirPath);
      return { error: null };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('trash-path', async (_event, targetPath: string) => {
    try {
      await shell.trashItem(targetPath);
      return { error: null };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('search-files', async (_event, rootDir: string, query: string) => {
    const maxResults = 50;
    const lowerQuery = query.toLowerCase();
    const isPathQuery = query.includes('/');

    if (isPathQuery) {
      const dirQuery = query.replace(/\/+$/, '');
      const targetDir = path.resolve(rootDir, dirQuery);
      try {
        const stat = await fs.promises.stat(targetDir);
        if (stat.isDirectory()) {
          const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
          const dirs: { path: string; isDirectory: boolean }[] = [];
          const files: { path: string; isDirectory: boolean }[] = [];
          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const item = { path: path.join(targetDir, entry.name), isDirectory: entry.isDirectory() };
            if (entry.isDirectory()) dirs.push(item);
            else files.push(item);
          }
          return [...dirs, ...files].slice(0, maxResults);
        }
      } catch {}
    }

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard'],
        { cwd: rootDir, maxBuffer: 1024 * 1024 }
      );
      const files = stdout.split('\n').filter(Boolean);
      const results: { path: string; isDirectory: boolean }[] = [];
      for (const file of files) {
        const matchTarget = isPathQuery
          ? file.toLowerCase()
          : (file.split('/').pop() || file).toLowerCase();
        if (matchTarget.includes(lowerQuery)) {
          results.push({ path: path.join(rootDir, file), isDirectory: false });
          if (results.length >= maxResults) break;
        }
      }
      if (results.length > 0) return results;
    } catch {}

    const results: { path: string; isDirectory: boolean }[] = [];
    const SKIP_DIRS = new Set([
      'node_modules', '__pycache__', '.next', '.nuxt',
      'coverage', '.cache', '.turbo', '.svn',
    ]);

    function shouldSkipDir(name: string): boolean {
      return name.startsWith('.') || name.endsWith('.git') || SKIP_DIRS.has(name);
    }

    let queue = [rootDir];
    while (queue.length > 0 && results.length < maxResults) {
      const nextQueue: string[] = [];
      for (const dir of queue) {
        if (results.length >= maxResults) break;
        try {
          const entries = await fs.promises.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile()) {
              const matchTarget = isPathQuery
                ? path.relative(rootDir, fullPath).toLowerCase()
                : entry.name.toLowerCase();
              if (matchTarget.includes(lowerQuery)) {
                results.push({ path: fullPath, isDirectory: false });
                if (results.length >= maxResults) break;
              }
            } else if (entry.isDirectory() && !shouldSkipDir(entry.name)) {
              nextQueue.push(fullPath);
            }
          }
        } catch {}
      }
      queue = nextQueue;
    }

    return results;
  });

  ipcMain.handle('search-content', async (_event, rootDir: string, query: string, options: {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    useRegex?: boolean;
    includePattern?: string;
    excludePattern?: string;
  } = {}) => {
    if (!query || !query.trim()) return [];

    const MAX_FILES = 100;
    const MAX_MATCHES_PER_FILE = 50;
    const MAX_FILE_SIZE = 512 * 1024; // 512 KB

    const { caseSensitive = false, wholeWord = false, useRegex = false, includePattern, excludePattern } = options;

    let lineRegex: RegExp;
    try {
      let pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (wholeWord) pattern = `\\b${pattern}\\b`;
      lineRegex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    } catch {
      return [];
    }

    interface MatchEntry {
      lineNumber: number;
      lineContent: string;
      matchStart: number;
      matchEnd: number;
    }

    interface FileResult {
      path: string;
      matches: MatchEntry[];
    }

    function getFirstMatchPos(content: string): { start: number; end: number } | null {
      lineRegex.lastIndex = 0;
      const m = lineRegex.exec(content);
      return m ? { start: m.index, end: m.index + m[0].length } : null;
    }

    const fileMap = new Map<string, FileResult>();

    function processGrepOutput(stdout: string, isAbsolute: boolean): void {
      for (const line of stdout.split('\n')) {
        if (!line) continue;

        const firstColon = line.indexOf(':');
        if (firstColon === -1) continue;
        const secondColon = line.indexOf(':', firstColon + 1);
        if (secondColon === -1) continue;

        const filePart = line.slice(0, firstColon);
        const lineNumStr = line.slice(firstColon + 1, secondColon);
        const content = line.slice(secondColon + 1);
        const lineNum = parseInt(lineNumStr, 10);

        if (isNaN(lineNum) || lineNum < 1) continue;

        const filePath = isAbsolute ? filePart : path.join(rootDir, filePart);

        if (!fileMap.has(filePath)) {
          if (fileMap.size >= MAX_FILES) continue;
          fileMap.set(filePath, { path: filePath, matches: [] });
        }

        const fileResult = fileMap.get(filePath)!;
        if (fileResult.matches.length >= MAX_MATCHES_PER_FILE) continue;

        const matchPos = getFirstMatchPos(content);
        if (matchPos) {
          fileResult.matches.push({
            lineNumber: lineNum,
            lineContent: content.trimEnd(),
            matchStart: matchPos.start,
            matchEnd: matchPos.end,
          });
        }
      }
    }

    // Try git grep first (respects .gitignore, fast for large repos)
    let didUseGitGrep = false;
    try {
      const gitArgs: string[] = ['grep', '-n', '--untracked'];
      if (!caseSensitive) gitArgs.push('-i');
      if (wholeWord) gitArgs.push('-w');
      if (useRegex) gitArgs.push('-E'); else gitArgs.push('-F');

      if (includePattern) {
        gitArgs.push('--', query, `*${includePattern}`);
      } else {
        gitArgs.push('--', query);
      }

      const result = await shellExec('git', gitArgs, {
        cwd: rootDir,
        encoding: 'utf-8',
        timeout: 15000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const stdout = result.stdout as unknown as string;

      if (stdout) processGrepOutput(stdout, false);
      didUseGitGrep = true;
    } catch (e: any) {
      // exit code 1 = no matches (git grep convention, not an error)
      if (e?.code === 1) {
        didUseGitGrep = true;
      }
      // Otherwise: not a git repo or git unavailable — fall through
    }

    // Fallback: Node.js directory traversal
    if (!didUseGitGrep) {
      const SKIP_DIRS = new Set([
        'node_modules', '.git', '__pycache__', '.next', '.nuxt',
        'coverage', '.cache', '.turbo', 'dist', 'build', '.svn', '.hg',
      ]);
      const BINARY_EXTS = new Set([
        '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp',
        '.mp4', '.mp3', '.wav', '.pdf', '.zip', '.tar', '.gz', '.7z',
        '.exe', '.dylib', '.so', '.dll', '.wasm',
        '.ttf', '.otf', '.woff', '.woff2', '.eot',
        '.class', '.pyc', '.pyo', '.o', '.a',
      ]);

      const inclRe = includePattern
        ? new RegExp('^' + includePattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
        : null;
      const exclRe = excludePattern
        ? new RegExp('^' + excludePattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
        : null;

      let queue = [rootDir];
      while (queue.length > 0 && fileMap.size < MAX_FILES) {
        const nextQueue: string[] = [];
        for (const dir of queue) {
          if (fileMap.size >= MAX_FILES) break;
          let dirEntries: fs.Dirent[];
          try {
            dirEntries = await fs.promises.readdir(dir, { withFileTypes: true });
          } catch {
            continue;
          }

          for (const entry of dirEntries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                nextQueue.push(fullPath);
              }
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase();
              if (BINARY_EXTS.has(ext)) continue;
              if (inclRe && !inclRe.test(entry.name)) continue;
              if (exclRe && exclRe.test(entry.name)) continue;

              try {
                const stat = await fs.promises.stat(fullPath);
                if (stat.size > MAX_FILE_SIZE) continue;

                const content = await fs.promises.readFile(fullPath, 'utf-8');
                if (content.includes('\0')) continue; // binary file guard

                const lines = content.split('\n');
                const fileMatches: MatchEntry[] = [];

                for (let i = 0; i < lines.length && fileMatches.length < MAX_MATCHES_PER_FILE; i++) {
                  const matchPos = getFirstMatchPos(lines[i]);
                  if (matchPos) {
                    fileMatches.push({
                      lineNumber: i + 1,
                      lineContent: lines[i].trimEnd(),
                      matchStart: matchPos.start,
                      matchEnd: matchPos.end,
                    });
                  }
                }

                if (fileMatches.length > 0 && fileMap.size < MAX_FILES) {
                  fileMap.set(fullPath, { path: fullPath, matches: fileMatches });
                }
              } catch {
                // unreadable file, skip
              }
            }
          }
        }
        queue = nextQueue;
      }
    }

    return Array.from(fileMap.values());
  });

  ipcMain.handle('get-git-info', async (_event, dirPath: string) => {
    try {
      const [branchResult, rootResult] = await Promise.all([
        shellExec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: dirPath,
          encoding: 'utf-8',
          timeout: 3000,
        }),
        shellExec('git', ['rev-parse', '--show-toplevel'], {
          cwd: dirPath,
          encoding: 'utf-8',
          timeout: 3000,
        }),
      ]);
      const branch = branchResult.stdout.trim();
      const repoName = path.basename(rootResult.stdout.trim());

      let aheadCount = 0;
      try {
        const aheadResult = await shellExec('git', ['rev-list', '--count', '@{u}..HEAD'], {
          cwd: dirPath,
          encoding: 'utf-8',
          timeout: 3000,
        });
        aheadCount = parseInt(aheadResult.stdout.trim(), 10) || 0;
      } catch {
        // No upstream tracking branch or other error — aheadCount stays 0
      }

      return { branch, repoName, isGitRepo: true, aheadCount };
    } catch {
      return { branch: null, repoName: null, isGitRepo: false, aheadCount: 0 };
    }
  });

  ipcMain.handle('get-git-status', async (_event, dirPath: string) => {
    let repoRoot: string;
    try {
      const { stdout: rootStdout } = await shellExec('git', ['rev-parse', '--show-toplevel'], {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 3000,
      });
      repoRoot = rootStdout.trim();
    } catch {
      return { files: {}, staged: {}, repoRoot: null, ignored: [] };
    }
    return enqueueGitOp(repoRoot, async () => {
    try {

      const { stdout } = await shellExec('git', ['status', '--porcelain'], {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });

      const files: Record<string, string> = {};
      const staged: Record<string, string> = {};

      const simplifyStatus = (code: string): string => {
        if (code === 'M') return 'modified';
        if (code === 'A') return 'added';
        if (code === 'D') return 'deleted';
        if (code === 'R') return 'renamed';
        if (code === 'U') return 'conflict';
        return 'modified';
      };

      for (const line of stdout.split('\n').filter(Boolean)) {
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        let filePath = line.substring(3);
        if (filePath.includes(' -> ')) {
          filePath = filePath.split(' -> ')[1];
        }
        const fullPath = path.join(repoRoot, filePath);

        if (indexStatus === '?' && workTreeStatus === '?') {
          files[fullPath] = 'untracked';
          continue;
        }

        if (indexStatus === 'U' || workTreeStatus === 'U' ||
            (indexStatus === 'A' && workTreeStatus === 'A') ||
            (indexStatus === 'D' && workTreeStatus === 'D')) {
          files[fullPath] = 'conflict';
          continue;
        }

        if (indexStatus !== ' ' && indexStatus !== '?') {
          staged[fullPath] = simplifyStatus(indexStatus);
        }

        if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
          files[fullPath] = simplifyStatus(workTreeStatus);
        }
      }

      let ignored: string[] = [];
      try {
        const { stdout: ignoredStdout } = await shellExec(
          'git',
          ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
          { cwd: repoRoot, encoding: 'utf-8', timeout: 5000, maxBuffer: 1024 * 1024 },
        );
        ignored = ignoredStdout
          .split('\n')
          .filter(Boolean)
          .map((p) => path.join(repoRoot, p.endsWith('/') ? p.slice(0, -1) : p));
      } catch { /* ignore errors — ignored list is best-effort */ }

      return { files, staged, repoRoot, ignored };
    } catch {
      return { files: {}, staged: {}, repoRoot: null, ignored: [] };
    }
    });
  });

  const gitResult = (err?: unknown): { success: false; error: string } => {
    const e = err as any;
    const stderr = (e?.stderr as string | undefined)?.trim() ?? '';
    const stdout = (e?.stdout as string | undefined)?.trim() ?? '';
    const combined = [stderr, stdout].filter(Boolean).join('\n').trim();
    return { success: false, error: combined || 'Unknown git error' };
  };

  ipcMain.handle('git-stage', (_event, filePaths: string[], repoRoot: string) =>
    enqueueGitOp(repoRoot, async () => {
      try {
        await shellExec('git', ['add', '--', ...filePaths], { cwd: repoRoot, encoding: 'utf-8', timeout: 5000 });
        return { success: true, error: null };
      } catch (e) { return gitResult(e); }
    })
  );

  ipcMain.handle('git-unstage', (_event, filePaths: string[], repoRoot: string) =>
    enqueueGitOp(repoRoot, async () => {
      try {
        await shellExec('git', ['reset', 'HEAD', '--', ...filePaths], { cwd: repoRoot, encoding: 'utf-8', timeout: 5000 });
        return { success: true, error: null };
      } catch (e) { return gitResult(e); }
    })
  );

  ipcMain.handle('git-discard-changes', (_event, trackedPaths: string[], untrackedPaths: string[], repoRoot: string) =>
    enqueueGitOp(repoRoot, async () => {
      try {
        if (trackedPaths.length > 0) {
          await shellExec('git', ['restore', '--', ...trackedPaths], { cwd: repoRoot, encoding: 'utf-8', timeout: 10000 });
        }
        if (untrackedPaths.length > 0) {
          await Promise.all(untrackedPaths.map(fp => fs.promises.unlink(fp).catch(() => {})));
        }
        return { success: true, error: null };
      } catch (e) { return gitResult(e); }
    })
  );

  ipcMain.handle('git-stash', (_event, repoRoot: string, message?: string, includeUntracked?: boolean) =>
    enqueueGitOp(repoRoot, async () => {
      try {
        const args = ['stash', 'push'];
        if (includeUntracked) args.push('--include-untracked');
        if (message) args.push('-m', message);
        await shellExec('git', args, { cwd: repoRoot, encoding: 'utf-8', timeout: 10000 });
        return { success: true, error: null };
      } catch (e) { return gitResult(e); }
    })
  );

  ipcMain.handle('git-stash-pop', (_event, repoRoot: string) =>
    enqueueGitOp(repoRoot, async () => {
      try {
        await shellExec('git', ['stash', 'pop'], { cwd: repoRoot, encoding: 'utf-8', timeout: 10000 });
        return { success: true, error: null };
      } catch (e) { return gitResult(e); }
    })
  );

  ipcMain.handle('git-commit', (_event, repoRoot: string, message: string) =>
    enqueueGitOp(repoRoot, async () => {
      const lockPath = path.join(repoRoot, '.git', 'index.lock');
      const tryCommit = async () => {
        await shellExec('git', ['commit', '-m', message], { cwd: repoRoot, encoding: 'utf-8', timeout: 15000 });
        return { success: true, error: null };
      };
      try {
        return await tryCommit();
      } catch (e: any) {
        if ((e?.stderr as string | undefined)?.includes('index.lock')) {
          try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
          try { return await tryCommit(); } catch (e2) { return gitResult(e2); }
        }
        return gitResult(e);
      }
    })
  );

  ipcMain.handle('git-commit-all', (_event, repoRoot: string, message: string) =>
    enqueueGitOp(repoRoot, async () => {
      const lockPath = path.join(repoRoot, '.git', 'index.lock');
      const tryCommitAll = async () => {
        await shellExec('git', ['add', '-A'], { cwd: repoRoot, encoding: 'utf-8', timeout: 10000 });
        await shellExec('git', ['commit', '-m', message], { cwd: repoRoot, encoding: 'utf-8', timeout: 15000 });
        return { success: true, error: null };
      };
      try {
        return await tryCommitAll();
      } catch (e: any) {
        if ((e?.stderr as string | undefined)?.includes('index.lock')) {
          try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
          try { return await tryCommitAll(); } catch (e2) { return gitResult(e2); }
        }
        return gitResult(e);
      }
    })
  );

  ipcMain.handle('git-undo-commit', (_event, repoRoot: string) =>
    enqueueGitOp(repoRoot, async () => {
      try {
        await shellExec('git', ['reset', 'HEAD~1', '--soft'], { cwd: repoRoot, encoding: 'utf-8', timeout: 10000 });
        return { success: true, error: null };
      } catch (e) { return gitResult(e); }
    })
  );

  ipcMain.handle('get-git-diff', async (_event, filePath: string, repoRoot: string) => {
    try {
      try {
        await shellExec('git', ['ls-files', '--error-unmatch', filePath], {
          cwd: repoRoot,
          encoding: 'utf-8',
          timeout: 3000,
        });
      } catch {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return { diff: null, isNew: true, content };
      }

      const { stdout } = await shellExec('git', ['diff', 'HEAD', '--', filePath], {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
      });

      return { diff: stdout, isNew: false, content: null };
    } catch {
      return { diff: null, isNew: false, content: null };
    }
  });

  ipcMain.handle('create-terminal', async (event, options: { cwd?: string; shell?: string; cols?: number; rows?: number }) => {
    const id = `term-${++terminalIdCounter}`;
    const shellPath = options.shell || getDefaultShell();
    const isZsh = /\bzsh$/.test(shellPath);
    const shellArgs = isZsh ? ['--login'] : shellPath.includes('bash') ? ['--login'] : [];
    const baseEnv = await getShellEnv();
    const webContentsId = event.sender.id;

    // Inject zsh shell integration (OSC 7 on every cd) via a temp ZDOTDIR
    const zshIntegration = isZsh ? await createZshIntegration() : null;
    const env = zshIntegration
      ? { ...baseEnv, ...zshIntegration.extraEnv }
      : baseEnv;

    const ptyProcess = pty.spawn(shellPath, shellArgs, {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd || os.homedir(),
      env,
    });

    ptyInstances.set(id, {
      process: ptyProcess,
      pid: ptyProcess.pid,
      shell: shellPath,
      webContentsId,
      zdotdirCleanup: zshIntegration?.cleanup,
    });

    agentManager.registerTerminal(id, ptyProcess.pid, options.cwd || os.homedir());

    // OSC 7 regex: \e]7;url\e\\ or \e]7;url\a
    const osc7Re = /\x1b\]7;(file:\/\/[^\x07\x1b]*?)(?:\x07|\x1b\\)/g;

    ptyProcess.onData((data: string) => {
      sendToWebContents(webContentsId, 'terminal-data', id, data);
      // Track cwd from OSC 7 sequences so getTerminalCwd can skip lsof
      let m: RegExpExecArray | null;
      osc7Re.lastIndex = 0;
      while ((m = osc7Re.exec(data)) !== null) {
        try {
          const url = new URL(m[1]);
          const cwd = decodeURIComponent(url.pathname);
          if (cwd) {
            const inst = ptyInstances.get(id);
            if (inst) inst.trackedCwd = cwd;
          }
        } catch { /* invalid URL, ignore */ }
      }
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      const inst = ptyInstances.get(id);
      inst?.zdotdirCleanup?.();
      ptyInstances.delete(id);
      sendToWebContents(webContentsId, 'terminal-exit', id, exitCode);
    });

    if (shellEnvFailed) {
      const warn = '\x1b[33m[Kraft] Warning: Could not load shell environment. '
        + 'Some tools may not be found. Check your shell config.\x1b[0m\r\n';
      sendToWebContents(webContentsId, 'terminal-data', id, warn);
    }

    return { id, pid: ptyProcess.pid };
  });

  ipcMain.on('terminal-write', (_event, id: string, data: string) => {
    const instance = ptyInstances.get(id);
    if (instance) {
      instance.process.write(data);
    }
  });

  ipcMain.on('terminal-resize', (_event, id: string, cols: number, rows: number) => {
    const instance = ptyInstances.get(id);
    if (instance) {
      instance.process.resize(cols, rows);
    }
  });

  ipcMain.handle('terminal-get-cwd', async (_event, id: string) => {
    const instance = ptyInstances.get(id);
    if (!instance) return null;

    // Fast path: OSC 7 already told us the cwd — no lsof needed
    if (instance.trackedCwd) return instance.trackedCwd;

    // Slow path: ask the OS (used by shells without OSC 7 support)
    try {
      let rawPath: string | null = null;
      if (process.platform === 'darwin') {
        const { stdout } = await execFileAsync('lsof', ['-a', '-p', String(instance.pid), '-d', 'cwd', '-Fn'], {
          encoding: 'utf-8',
          timeout: 2000,
        });
        const lines = (stdout as unknown as string).split('\n');
        const nLine = lines.find((l: string) => l.startsWith('n'));
        rawPath = nLine ? nLine.slice(1) : null;
      } else if (process.platform === 'linux') {
        rawPath = await fs.promises.readlink(`/proc/${instance.pid}/cwd`);
      }
      if (!rawPath) return null;
      try {
        return fs.realpathSync(rawPath);
      } catch {
        return rawPath;
      }
    } catch {
      return null;
    }
  });

  ipcMain.handle('resolve-file-path', async (_event, rawPath: string, cwd?: string) => {
    try {
      let resolved = rawPath;
      if (resolved.startsWith('~/')) {
        resolved = path.join(os.homedir(), resolved.slice(2));
      } else if (!path.isAbsolute(resolved)) {
        resolved = path.resolve(cwd || os.homedir(), resolved);
      }
      const stat = await fs.promises.stat(resolved);
      if (stat.isFile()) return resolved;
      return null;
    } catch {
      return null;
    }
  });

  ipcMain.on('terminal-destroy', (_event, id: string) => {
    const instance = ptyInstances.get(id);
    if (instance) {
      instance.process.kill();
      ptyInstances.delete(id);
    }
    agentManager.unregisterTerminal(id);
  });

  ipcMain.handle('get-agent-context-dirs', (_event, terminalId: string) => {
    return agentManager.getContextDirs(terminalId);
  });

  ipcMain.handle('get-settings', () => loadSettings());
  ipcMain.handle('save-settings', (_event, settings: Record<string, any>) => {
    saveSettings(settings);
    return true;
  });

  ipcMain.handle('get-session', () => {
    const result: { pendingWorkspace: string | null } = {
      pendingWorkspace,
    };
    pendingWorkspace = null; // consume it - only deliver once
    return result;
  });

  ipcMain.handle('save-session', (_event, session: PersistedSession) => {
    if (isQuitting) return false;
    try {
      fs.writeFileSync(getSessionPath(), JSON.stringify(session, null, 2));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('list-workspaces', async () => {
    const dir = getWorkspacesDir();
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const files = await fs.promises.readdir(dir);
      const result: { name: string; filename: string; createdAt: string }[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await fs.promises.readFile(path.join(dir, file), 'utf-8');
          const ws = JSON.parse(data);
          result.push({
            name: ws.name || file.replace('.json', ''),
            filename: file,
            createdAt: ws.createdAt || '',
          });
        } catch {
          // skip corrupted files
        }
      }
      return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  });

  ipcMain.handle('save-workspace', async (_event, workspace: any) => {
    const dir = getWorkspacesDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const safeName = (workspace.name as string)
      .replace(/[^a-z0-9_\- ]/gi, '_')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 50);
    const filename = `${safeName}-${Date.now()}.json`;
    await fs.promises.writeFile(path.join(dir, filename), JSON.stringify(workspace, null, 2));
    rebuildDockMenu();
    return { filename };
  });

  ipcMain.handle('load-workspace', async (_event, filename: string) => {
    try {
      const data = await fs.promises.readFile(
        path.join(getWorkspacesDir(), path.basename(filename)),
        'utf-8'
      );
      return JSON.parse(data);
    } catch {
      return null;
    }
  });

  ipcMain.handle('delete-workspace', async (_event, filename: string) => {
    try {
      await fs.promises.unlink(path.join(getWorkspacesDir(), path.basename(filename)));
      rebuildDockMenu();
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.on('refresh-dock-menu', () => {
    rebuildDockMenu();
  });

  ipcMain.on('set-active-workspace', (event, filename: string | null) => {
    if (filename) {
      windowActiveWorkspace.set(event.sender.id, filename);
    } else {
      windowActiveWorkspace.delete(event.sender.id);
    }
  });

  ipcMain.handle('get-zoom-level', (event) => {
    return event.sender.getZoomLevel();
  });

  ipcMain.handle('set-zoom-level', (event, level: number) => {
    applyZoomLevel(level, event.sender);
    return event.sender.getZoomLevel();
  });

  ipcMain.on('watch-directory', (event, dirPath: string) => {
    if (activeWatchers.has(dirPath)) return;
    const webContentsId = event.sender.id;
    try {
      const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
        sendToWebContents(webContentsId, 'directory-changed', dirPath, eventType, filename);
      });
      activeWatchers.set(dirPath, { watcher, webContentsId });
    } catch {
      // directory not watchable
    }
  });

  ipcMain.on('unwatch-directory', (_event, dirPath: string) => {
    const entry = activeWatchers.get(dirPath);
    if (entry) {
      entry.watcher.close();
      activeWatchers.delete(dirPath);
    }
  });

  ipcMain.on('watch-file', (event, filePath: string) => {
    if (fileWatchers.has(filePath)) return;
    const webContentsId = event.sender.id;
    const listener = (curr: fs.Stats, prev: fs.Stats) => {
      if (curr.mtimeMs !== prev.mtimeMs) {
        sendToWebContents(webContentsId, 'file-changed', filePath);
      }
    };
    fs.watchFile(filePath, { interval: 500, persistent: false }, listener);
    fileWatchers.set(filePath, { listener, webContentsId });
  });

  ipcMain.on('unwatch-file', (_event, filePath: string) => {
    const entry = fileWatchers.get(filePath);
    if (entry) {
      fs.unwatchFile(filePath, entry.listener);
      fileWatchers.delete(filePath);
    }
  });

  ipcMain.on('watch-git-repo', (event, repoRoot: string) => {
    if (gitWatchers.has(repoRoot)) return;
    const webContentsId = event.sender.id;
    const gitDir = path.join(repoRoot, '.git');
    const watchers: fs.FSWatcher[] = [];

    const notify = () => {
      sendToWebContents(webContentsId, 'git-changed', repoRoot);
    };

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedNotify = () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(notify, 150);
    };

    const tryWatch = (target: string) => {
      try {
        const w = fs.watch(target, { recursive: false }, debouncedNotify);
        watchers.push(w);
      } catch {
        // target may not exist yet
      }
    };

    tryWatch(path.join(gitDir, 'index'));
    tryWatch(path.join(gitDir, 'HEAD'));
    tryWatch(path.join(gitDir, 'packed-refs'));

    try {
      const refsDir = path.join(gitDir, 'refs');
      const w = fs.watch(refsDir, { recursive: true }, debouncedNotify);
      watchers.push(w);
    } catch {
      // refs dir may not exist
    }

    if (watchers.length > 0) {
      gitWatchers.set(repoRoot, { watchers, webContentsId });
    }
  });

  ipcMain.on('unwatch-git-repo', (_event, repoRoot: string) => {
    const entry = gitWatchers.get(repoRoot);
    if (entry) {
      for (const w of entry.watchers) w.close();
      gitWatchers.delete(repoRoot);
    }
  });

  ipcMain.on('toggle-devtools', (event) => {
    event.sender.toggleDevTools();
  });

  ipcMain.on('reload-window', (event) => {
    event.sender.reloadIgnoringCache();
  });

  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('get-platform', () => process.platform);
  ipcMain.handle('show-item-in-folder', (_event, filePath: string) => shell.showItemInFolder(filePath));

  ipcMain.handle('check-for-updates', async () => {
    return updateChecker.check();
  });

  ipcMain.handle('download-update', async () => {
    return updateChecker.downloadUpdate();
  });

  ipcMain.handle('install-update', () => {
    updateChecker.installUpdate();
  });
}

agentManager.setOnContextDirsChanged((terminalId, dirs) => {
  const inst = ptyInstances.get(terminalId);
  if (inst) sendToWebContents(inst.webContentsId, 'agent-context-dirs-changed', terminalId, dirs);
});

agentManager.setOnAgentDetected((terminalId, agentId) => {
  const inst = ptyInstances.get(terminalId);
  if (inst) sendToWebContents(inst.webContentsId, 'agent-detected', terminalId, agentId);
});

agentManager.setOnAgentExited((terminalId) => {
  const inst = ptyInstances.get(terminalId);
  if (inst) sendToWebContents(inst.webContentsId, 'agent-exited', terminalId);
});

app.setName('Kraft');

app.whenReady().then(() => {
  getShellEnv();
  setupIPC();
  setupMenu();
  createWindow();

  rebuildDockMenu();

  updateChecker.onUpdateAvailable((info) => {
    broadcastToAllWindows('update-available', info);
  });

  updateChecker.onProgress((progress) => {
    broadcastToAllWindows('update-download-progress', progress);
  });

  updateChecker.onDownloaded((info, filePath) => {
    broadcastToAllWindows('update-downloaded', info, filePath);
  });

  updateChecker.onError((error) => {
    broadcastToAllWindows('update-error', error);
  });

  updateChecker.start();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  agentManager.stopAll();
  for (const [, instance] of ptyInstances) {
    instance.process.kill();
  }
  ptyInstances.clear();
  for (const [, entry] of activeWatchers) {
    entry.watcher.close();
  }
  activeWatchers.clear();
  for (const [, entry] of gitWatchers) {
    for (const w of entry.watchers) w.close();
  }
  gitWatchers.clear();
  for (const [filePath, entry] of fileWatchers) {
    fs.unwatchFile(filePath, entry.listener);
  }
  fileWatchers.clear();
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
