export interface AgentContextDir {
  path: string;
  name: string;
}

export interface AgentDetectionResult {
  agentId: string;
  displayName: string;
}

export interface AgentSessionWatcher {
  onContextDirsChanged: (callback: (dirs: AgentContextDir[]) => void) => void;
  onSessionEnded: (callback: () => void) => void;
  getContextDirs: () => AgentContextDir[];
  stop: () => void;
}

export interface AgentProvider {
  readonly id: string;
  readonly displayName: string;

  detect(terminalPid: number, cwd: string): Promise<AgentDetectionResult | null>;

  watchSession(terminalPid: number, cwd: string): Promise<AgentSessionWatcher | null>;
}
