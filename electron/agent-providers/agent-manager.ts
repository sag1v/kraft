import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AgentProvider, AgentSessionWatcher, AgentContextDir } from './types';
import { ClaudeCodeProvider } from './claude-code';

const execFileAsync = promisify(execFile);

interface TrackedTerminal {
  terminalPid: number;
  cwd: string;
  watcher: AgentSessionWatcher | null;
  detectedAgent: string | null;
  pollTimer: ReturnType<typeof setInterval> | null;
}

export class AgentManager {
  private providers: AgentProvider[] = [];
  private terminals = new Map<string, TrackedTerminal>();
  private onDirsChanged: ((terminalId: string, dirs: AgentContextDir[]) => void) | null = null;

  constructor() {
    this.providers.push(new ClaudeCodeProvider());
  }

  setOnContextDirsChanged(callback: (terminalId: string, dirs: AgentContextDir[]) => void) {
    this.onDirsChanged = callback;
  }

  registerTerminal(terminalId: string, terminalPid: number, cwd: string) {
    const tracked: TrackedTerminal = {
      terminalPid,
      cwd,
      watcher: null,
      detectedAgent: null,
      pollTimer: null,
    };

    tracked.pollTimer = setInterval(() => {
      this.tryDetectAgent(terminalId, tracked);
    }, 3000);

    this.terminals.set(terminalId, tracked);
  }

  unregisterTerminal(terminalId: string) {
    const tracked = this.terminals.get(terminalId);
    if (!tracked) return;

    if (tracked.pollTimer) clearInterval(tracked.pollTimer);
    tracked.watcher?.stop();
    this.terminals.delete(terminalId);
  }

  getContextDirs(terminalId: string): AgentContextDir[] {
    return this.terminals.get(terminalId)?.watcher?.getContextDirs() ?? [];
  }

  private async tryDetectAgent(terminalId: string, tracked: TrackedTerminal) {
    if (tracked.watcher) return;

    const descendantPids = await this.getDescendantPids(tracked.terminalPid);
    const pidsToCheck = [tracked.terminalPid, ...descendantPids];

    for (const provider of this.providers) {
      for (const pid of pidsToCheck) {
        try {
          const result = await provider.detect(pid, tracked.cwd);
          if (!result) continue;

          console.log(`[Kraft] Agent detected: ${result.displayName} (pid=${pid}) for terminal ${terminalId}`);
          tracked.detectedAgent = result.agentId;

          const watcher = await provider.watchSession(pid, tracked.cwd);
          if (watcher) {
            console.log(`[Kraft] Session watcher started for ${result.displayName}`);
            tracked.watcher = watcher;
            if (tracked.pollTimer) {
              clearInterval(tracked.pollTimer);
              tracked.pollTimer = null;
            }

            watcher.onContextDirsChanged((dirs) => {
              console.log(`[Kraft] Context dirs changed for ${terminalId}:`, dirs);
              this.onDirsChanged?.(terminalId, dirs);
            });

            const initialDirs = watcher.getContextDirs();
            if (initialDirs.length > 0) {
              console.log(`[Kraft] Initial context dirs for ${terminalId}:`, initialDirs);
              this.onDirsChanged?.(terminalId, initialDirs);
            }
          } else {
            console.log(`[Kraft] Agent detected but JSONL not ready yet, will keep polling (pid=${pid})`);
          }
          return;
        } catch (e) {
          console.log(`[Kraft] Provider ${provider.id} error for pid ${pid}:`, e);
        }
      }
    }
  }

  private async getDescendantPids(parentPid: number): Promise<number[]> {
    const all: number[] = [];
    const queue = [parentPid];
    const visited = new Set<number>();

    while (queue.length > 0) {
      const pid = queue.shift()!;
      if (visited.has(pid)) continue;
      visited.add(pid);

      try {
        const { stdout } = await execFileAsync('pgrep', ['-P', String(pid)], {
          encoding: 'utf-8',
          timeout: 2000,
        });
        const children = stdout.split('\n').filter(Boolean).map(Number).filter(n => !isNaN(n));
        for (const child of children) {
          all.push(child);
          queue.push(child);
        }
      } catch { /* no children */ }
    }
    return all;
  }

  stopAll() {
    for (const [id] of this.terminals) {
      this.unregisterTerminal(id);
    }
  }
}
