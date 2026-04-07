import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AgentProvider, AgentDetectionResult, AgentSessionWatcher, AgentContextDir } from './types';

const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const CLAUDE_SESSIONS_DIR = path.join(CLAUDE_HOME, 'sessions');
const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_HOME, 'projects');

function cwdToProjectSlug(cwd: string): string {
  const withoutLeadingSlash = cwd.startsWith('/') ? cwd.slice(1) : cwd;
  return '-' + withoutLeadingSlash.replace(/[/_]/g, '-');
}

function findSessionFile(pid: number): { sessionId: string; cwd: string } | null {
  try {
    const sessionPath = path.join(CLAUDE_SESSIONS_DIR, `${pid}.json`);
    const data = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    if (data.sessionId && data.cwd) {
      return { sessionId: data.sessionId, cwd: data.cwd };
    }
  } catch { /* not found or invalid */ }
  return null;
}

function getProjectJsonlPath(cwd: string, sessionId: string): string {
  const slug = cwdToProjectSlug(cwd);
  return path.join(CLAUDE_PROJECTS_DIR, slug, `${sessionId}.jsonl`);
}

function parseAddDirFromLine(line: string): string | null {
  try {
    const entry = JSON.parse(line);
    if (entry.type !== 'user') return null;
    const content: string = entry.message?.content || '';
    if (!content.includes('<local-command-stdout>')) return null;
    const match = content.match(/Added\s+(?:\x1b\[\d+m)?(.+?)(?:\x1b\[\d+m)?\s+as a working directory/);
    if (match) return match[1].trim();
  } catch { /* invalid JSON line */ }
  return null;
}

function parseIsCancelledAddDir(line: string): boolean {
  try {
    const entry = JSON.parse(line);
    if (entry.type !== 'user') return false;
    const content: string = entry.message?.content || '';
    return content.includes('<command-name>/add-dir</command-name>') && content.includes('cancelled');
  } catch { /* invalid JSON line */ }
  return false;
}

function scanJsonlForContextDirs(filePath: string): AgentContextDir[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const dirs: AgentContextDir[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
      if (parseIsCancelledAddDir(line)) continue;
      const dirPath = parseAddDirFromLine(line);
      if (dirPath && !seen.has(dirPath)) {
        seen.add(dirPath);
        dirs.push({ path: dirPath, name: path.basename(dirPath) });
      }
    }
    return dirs;
  } catch { return []; }
}

/** JSONL often has no add-dir lines early on; use the session project cwd so the UI can react immediately. */
function contextDirsFromJsonlOrCwd(jsonlPath: string, projectCwd: string): AgentContextDir[] {
  const fromJsonl = scanJsonlForContextDirs(jsonlPath);
  if (fromJsonl.length > 0) return fromJsonl;
  if (projectCwd) {
    return [{ path: projectCwd, name: path.basename(projectCwd) }];
  }
  return [];
}

class ClaudeCodeSessionWatcher implements AgentSessionWatcher {
  private watcher: fs.FSWatcher | null = null;
  private contextDirs: AgentContextDir[] = [];
  private callback: ((dirs: AgentContextDir[]) => void) | null = null;
  private jsonlPath: string;
  private projectCwd: string;
  private lastSize = 0;

  constructor(jsonlPath: string, projectCwd: string) {
    this.jsonlPath = jsonlPath;
    this.projectCwd = projectCwd;
    this.contextDirs = contextDirsFromJsonlOrCwd(jsonlPath, projectCwd);
    this.lastSize = this.getFileSize();
    this.startWatching();
  }

  private getFileSize(): number {
    try { return fs.statSync(this.jsonlPath).size; } catch { return 0; }
  }

  private startWatching() {
    try {
      const dir = path.dirname(this.jsonlPath);
      const basename = path.basename(this.jsonlPath);
      this.watcher = fs.watch(dir, (eventType, filename) => {
        if (filename !== basename) return;
        this.onFileChanged();
      });
    } catch { /* directory doesn't exist yet, will be retried */ }
  }

  private onFileChanged() {
    const newSize = this.getFileSize();
    if (newSize <= this.lastSize) return;

    const newDirs = contextDirsFromJsonlOrCwd(this.jsonlPath, this.projectCwd);
    this.lastSize = newSize;

    if (this.dirsChanged(newDirs)) {
      this.contextDirs = newDirs;
      this.callback?.(this.contextDirs);
    }
  }

  private dirsChanged(newDirs: AgentContextDir[]): boolean {
    if (newDirs.length !== this.contextDirs.length) return true;
    const oldPaths = new Set(this.contextDirs.map(d => d.path));
    return newDirs.some(d => !oldPaths.has(d.path));
  }

  onContextDirsChanged(callback: (dirs: AgentContextDir[]) => void) {
    this.callback = callback;
  }

  getContextDirs(): AgentContextDir[] {
    return this.contextDirs;
  }

  stop() {
    this.watcher?.close();
    this.watcher = null;
    this.callback = null;
  }
}

export class ClaudeCodeProvider implements AgentProvider {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';

  async detect(terminalPid: number, _cwd: string): Promise<AgentDetectionResult | null> {
    const session = findSessionFile(terminalPid);
    if (session) {
      return { agentId: this.id, displayName: this.displayName };
    }
    return null;
  }

  async watchSession(terminalPid: number, cwd: string): Promise<AgentSessionWatcher | null> {
    const session = findSessionFile(terminalPid);
    if (!session) return null;

    const jsonlPath = getProjectJsonlPath(session.cwd, session.sessionId);
    console.log(`[Kraft] Claude Code session: cwd=${session.cwd} sessionId=${session.sessionId}`);
    console.log(`[Kraft] Claude Code JSONL path: ${jsonlPath}`);
    try {
      await fs.promises.access(jsonlPath);
    } catch {
      console.log(`[Kraft] Claude Code JSONL file not found: ${jsonlPath}`);
      return null;
    }

    return new ClaudeCodeSessionWatcher(jsonlPath, session.cwd);
  }
}
