import { app, BrowserWindow, ipcMain, shell, Menu, nativeImage, dialog, clipboard } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AgentManager } from './agent-providers';

const execFileAsync = promisify(execFile);
const pty = require('node-pty');

let mainWindow: BrowserWindow | null = null;
const agentManager = new AgentManager();

interface PtyInstance {
  process: any;
  pid: number;
  shell: string;
}

const ptyInstances = new Map<string, PtyInstance>();
let terminalIdCounter = 0;

interface DirCacheEntry {
  entries: any[];
  timestamp: number;
}
const dirCache = new Map<string, DirCacheEntry>();
const DIR_CACHE_TTL = 5000;

const activeWatchers = new Map<string, fs.FSWatcher>();
const gitWatchers = new Map<string, fs.FSWatcher[]>();

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

function applyZoomLevel(level: number) {
  if (!mainWindow) return;
  const clamped = Math.max(-3, Math.min(5, level));
  mainWindow.webContents.setZoomLevel(clamped);
  mainWindow.webContents.send('zoom-level-changed', clamped);
  const saved = loadSettings();
  saved.zoomLevel = clamped;
  saveSettings(saved);
}

function applyZoomDelta(delta: number) {
  if (!mainWindow) return;
  applyZoomLevel(mainWindow.webContents.getZoomLevel() + delta);
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  if (process.platform === 'darwin') {
    app.dock.setIcon(icon);
  }

  mainWindow = new BrowserWindow({
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

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = ['LOG', 'WARN', 'ERROR'][level] || 'INFO';
    console.log(`[Renderer ${tag}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[RENDERER CRASHED]', details);
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.meta && input.alt && input.key === 'i') {
      mainWindow?.webContents.toggleDevTools();
    }
  });

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

            const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
            const result = dialog.showMessageBoxSync(mainWindow!, {
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
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'CommandOrControl+,',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('open-settings');
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
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    const saved = loadSettings();
    if (saved.zoomLevel != null) {
      mainWindow?.webContents.setZoomLevel(saved.zoomLevel);
    }
  });

  mainWindow.webContents.on('zoom-changed', (_event, direction) => {
    applyZoomDelta(direction === 'in' ? 0.5 : -0.5);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
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

  ipcMain.handle('read-directory', async (_event, dirPath: string, skipCache?: boolean) => {
    if (!skipCache) {
      const cached = dirCache.get(dirPath);
      if (cached && Date.now() - cached.timestamp < DIR_CACHE_TTL) {
        return cached.entries;
      }
    }

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const result = entries
        .filter((e) => !e.name.startsWith('.'))
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

      dirCache.set(dirPath, { entries: result, timestamp: Date.now() });

      if (dirCache.size > 200) {
        const oldest = [...dirCache.entries()]
          .sort((a, b) => a[1].timestamp - b[1].timestamp)
          .slice(0, 50);
        for (const [key] of oldest) dirCache.delete(key);
      }

      return result;
    } catch {
      return [];
    }
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
        execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: dirPath,
          encoding: 'utf-8',
          timeout: 3000,
        }),
        execFileAsync('git', ['rev-parse', '--show-toplevel'], {
          cwd: dirPath,
          encoding: 'utf-8',
          timeout: 3000,
        }),
      ]);
      const branch = branchResult.stdout.trim();
      const repoName = path.basename(rootResult.stdout.trim());
      return { branch, repoName, isGitRepo: true };
    } catch {
      return { branch: null, repoName: null, isGitRepo: false };
    }
  });

  ipcMain.handle('get-git-status', async (_event, dirPath: string) => {
    try {
      const { stdout: rootStdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 3000,
      });
      const repoRoot = rootStdout.trim();

      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
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

      return { files, staged, repoRoot };
    } catch {
      return { files: {}, staged: {}, repoRoot: null };
    }
  });

  ipcMain.handle('git-stage', async (_event, filePaths: string[], repoRoot: string) => {
    try {
      await execFileAsync('git', ['add', '--', ...filePaths], {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('git-unstage', async (_event, filePaths: string[], repoRoot: string) => {
    try {
      await execFileAsync('git', ['reset', 'HEAD', '--', ...filePaths], {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('get-git-diff', async (_event, filePath: string, repoRoot: string) => {
    try {
      try {
        await execFileAsync('git', ['ls-files', '--error-unmatch', filePath], {
          cwd: repoRoot,
          encoding: 'utf-8',
          timeout: 3000,
        });
      } catch {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return { diff: null, isNew: true, content };
      }

      const { stdout } = await execFileAsync('git', ['diff', 'HEAD', '--', filePath], {
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

  ipcMain.handle('create-terminal', async (_event, options: { cwd?: string; shell?: string; cols?: number; rows?: number }) => {
    const id = `term-${++terminalIdCounter}`;
    const shellPath = options.shell || getDefaultShell();
    const shellArgs = shellPath.includes('zsh') ? ['--login'] : shellPath.includes('bash') ? ['--login'] : [];
    const env = await getShellEnv();

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
    });

    agentManager.registerTerminal(id, ptyProcess.pid, options.cwd || os.homedir());

    ptyProcess.onData((data: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-data', id, data);
      }
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      ptyInstances.delete(id);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-exit', id, exitCode);
      }
    });

    if (shellEnvFailed && mainWindow && !mainWindow.isDestroyed()) {
      const warn = '\x1b[33m[Kraft] Warning: Could not load shell environment. '
        + 'Some tools may not be found. Check your shell config.\x1b[0m\r\n';
      mainWindow.webContents.send('terminal-data', id, warn);
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

  ipcMain.handle('get-zoom-level', () => {
    return mainWindow?.webContents.getZoomLevel() ?? 0;
  });

  ipcMain.handle('set-zoom-level', (_event, level: number) => {
    applyZoomLevel(level);
    return mainWindow?.webContents.getZoomLevel() ?? 0;
  });

  ipcMain.on('watch-directory', (_event, dirPath: string) => {
    if (activeWatchers.has(dirPath)) return;
    try {
      const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('directory-changed', dirPath, eventType, filename);
        }
      });
      activeWatchers.set(dirPath, watcher);
    } catch {
      // directory not watchable
    }
  });

  ipcMain.on('unwatch-directory', (_event, dirPath: string) => {
    const watcher = activeWatchers.get(dirPath);
    if (watcher) {
      watcher.close();
      activeWatchers.delete(dirPath);
    }
  });

  ipcMain.on('watch-git-repo', (_event, repoRoot: string) => {
    if (gitWatchers.has(repoRoot)) return;
    const gitDir = path.join(repoRoot, '.git');
    const watchers: fs.FSWatcher[] = [];

    const notify = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git-changed', repoRoot);
      }
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

    try {
      const refsDir = path.join(gitDir, 'refs');
      const w = fs.watch(refsDir, { recursive: true }, debouncedNotify);
      watchers.push(w);
    } catch {
      // refs dir may not exist
    }

    if (watchers.length > 0) {
      gitWatchers.set(repoRoot, watchers);
    }
  });

  ipcMain.on('unwatch-git-repo', (_event, repoRoot: string) => {
    const watchers = gitWatchers.get(repoRoot);
    if (watchers) {
      for (const w of watchers) w.close();
      gitWatchers.delete(repoRoot);
    }
  });

  ipcMain.on('toggle-devtools', () => {
    mainWindow?.webContents.toggleDevTools();
  });

  ipcMain.on('reload-window', () => {
    mainWindow?.webContents.reloadIgnoringCache();
  });
}

agentManager.setOnContextDirsChanged((terminalId, dirs) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent-context-dirs-changed', terminalId, dirs);
  }
});

agentManager.setOnAgentDetected((terminalId, agentId) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent-detected', terminalId, agentId);
  }
});

agentManager.setOnAgentExited((terminalId) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent-exited', terminalId);
  }
});

app.setName('Kraft');

app.whenReady().then(() => {
  getShellEnv();
  setupIPC();
  createWindow();
});

app.on('window-all-closed', () => {
  agentManager.stopAll();
  for (const [, instance] of ptyInstances) {
    instance.process.kill();
  }
  ptyInstances.clear();
  for (const [, watcher] of activeWatchers) {
    watcher.close();
  }
  activeWatchers.clear();
  for (const [, watchers] of gitWatchers) {
    for (const w of watchers) w.close();
  }
  gitWatchers.clear();
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
