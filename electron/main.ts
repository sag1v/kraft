import { app, BrowserWindow, ipcMain, shell, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const pty = require('node-pty');

let mainWindow: BrowserWindow | null = null;

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

function getDefaultShell(): string {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return process.env.SHELL || '/bin/zsh';
  }
  return 'powershell.exe';
}

let cachedShellEnv: Record<string, string> | null = null;
let shellEnvPromise: Promise<Record<string, string>> | null = null;

async function getShellEnv(): Promise<Record<string, string>> {
  if (cachedShellEnv) return cachedShellEnv;
  if (shellEnvPromise) return shellEnvPromise;

  shellEnvPromise = (async () => {
    const defaultShell = getDefaultShell();
    try {
      const { stdout } = await execFileAsync(defaultShell, ['-ilc', 'env'], {
        encoding: 'utf-8',
        timeout: 5000,
        env: { ...process.env },
      });
      const env: Record<string, string> = {};
      for (const line of stdout.split('\n')) {
        const idx = line.indexOf('=');
        if (idx > 0) {
          env[line.substring(0, idx)] = line.substring(idx + 1);
        }
      }
      cachedShellEnv = { ...process.env, ...env } as Record<string, string>;
    } catch {
      cachedShellEnv = process.env as Record<string, string>;
    }
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

function createWindow() {
  mainWindow = new BrowserWindow({
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
      label: app.name,
      submenu: [
        { role: 'about' },
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
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'close' },
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

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard'],
        { cwd: rootDir, maxBuffer: 1024 * 1024 }
      );
      const files = stdout.split('\n').filter(Boolean);
      const results: string[] = [];
      for (const file of files) {
        const name = file.split('/').pop() || file;
        if (name.toLowerCase().includes(lowerQuery)) {
          results.push(path.join(rootDir, file));
          if (results.length >= maxResults) break;
        }
      }
      if (results.length > 0) return results;
    } catch {}

    const results: string[] = [];
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
            if (entry.isFile() && entry.name.toLowerCase().includes(lowerQuery)) {
              results.push(fullPath);
              if (results.length >= maxResults) break;
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

  ipcMain.on('terminal-destroy', (_event, id: string) => {
    const instance = ptyInstances.get(id);
    if (instance) {
      instance.process.kill();
      ptyInstances.delete(id);
    }
  });

  ipcMain.handle('get-settings', () => loadSettings());
  ipcMain.handle('save-settings', (_event, settings: Record<string, any>) => {
    saveSettings(settings);
    return true;
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

  ipcMain.on('toggle-devtools', () => {
    mainWindow?.webContents.toggleDevTools();
  });

  ipcMain.on('reload-window', () => {
    mainWindow?.webContents.reloadIgnoringCache();
  });
}

app.whenReady().then(() => {
  getShellEnv();
  setupIPC();
  createWindow();
});

app.on('window-all-closed', () => {
  for (const [, instance] of ptyInstances) {
    instance.process.kill();
  }
  ptyInstances.clear();
  for (const [, watcher] of activeWatchers) {
    watcher.close();
  }
  activeWatchers.clear();
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
