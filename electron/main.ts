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
          label: 'Zoom Out',
          accelerator: 'CommandOrControl+-',
          click: () => applyZoomDelta(-0.5),
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
    const shellArgs = shellPath.includes('zsh') ? ['--login'] : shellPath.includes('bash') ? ['--login'] : [];
    const env = await getShellEnv();
    const webContentsId = event.sender.id;

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
    });

    agentManager.registerTerminal(id, ptyProcess.pid, options.cwd || os.homedir());

    ptyProcess.onData((data: string) => {
      sendToWebContents(webContentsId, 'terminal-data', id, data);
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
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
    try {
      let rawPath: string | null = null;
      if (process.platform === 'darwin') {
        const { stdout } = await execFileAsync('lsof', ['-a', '-p', String(instance.pid), '-d', 'cwd', '-Fn'], {
          encoding: 'utf-8',
          timeout: 2000,
        });
        const lines = stdout.split('\n');
        const nLine = lines.find(l => l.startsWith('n'));
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

  if (process.platform === 'darwin') {
    app.dock.setMenu(Menu.buildFromTemplate([
      { label: 'New Window', click: () => createWindow() },
    ]));
  }

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
