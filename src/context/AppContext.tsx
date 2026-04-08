import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Theme, LayoutPreset, AppSettings, GitInfo, GitFileStatus, TerminalSession, PanelId, PanelVisibility, AgentContextDir } from '../types';
import { getThemeById, kraftDark } from '../themes';
import { AGENT_AUTO_TAB_ICON_ID, pickRandomColor } from '../terminalIcons';

const GET_SHIT_DONE_LAYOUT: PanelId[][] = [['terminal']];
const WATCH_SHIT_DONE_LAYOUT: PanelId[][] = [['explorer', 'terminal'], ['explorer', 'viewer']];
const WHY_LAYOUT: PanelId[][] = [['explorer', 'viewer', 'terminal']];
const REALLY_LAYOUT: PanelId[][] = [['explorer'], ['viewer'], ['terminal']];
const MY_LAYOUT_DEFAULT: PanelId[][] = [['explorer', 'terminal'], ['viewer', 'terminal']];

const ALL_PANELS: PanelId[] = ['explorer', 'viewer', 'terminal'];

const PRESET_LAYOUTS: Partial<Record<LayoutPreset, PanelId[][]>> = {
  'get-shit-done': GET_SHIT_DONE_LAYOUT,
  'watch-shit-done': WATCH_SHIT_DONE_LAYOUT,
  'why': WHY_LAYOUT,
  'really': REALLY_LAYOUT,
};

function normalizePanelLayout(raw: unknown): PanelId[][] {
  if (!Array.isArray(raw) || raw.length === 0) return WATCH_SHIT_DONE_LAYOUT.map(r => [...r]);

  const validIds = new Set<string>(ALL_PANELS);
  const result: PanelId[][] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length === 0) continue;
    const validRow: PanelId[] = [];
    for (const id of row) {
      if (validIds.has(id as string)) validRow.push(id as PanelId);
    }
    if (validRow.length > 0) result.push(validRow);
  }
  if (result.length === 0) return WATCH_SHIT_DONE_LAYOUT.map(r => [...r]);

  const maxCols = Math.max(...result.map(r => r.length));
  for (const row of result) {
    while (row.length < maxCols) row.push(row[row.length - 1]);
  }

  const present = new Set(result.flat());
  const missing = ALL_PANELS.filter(id => !present.has(id));
  if (missing.length > 0) {
    const lastRow = result[result.length - 1];
    for (const m of missing) lastRow[lastRow.length - 1] = m;
  }

  return result;
}

function panelLayoutsEqual(a: PanelId[][], b: PanelId[][]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, i) =>
    row.length === b[i].length && row.every((id, j) => id === b[i][j])
  );
}

function layoutToPreset(layout: PanelId[][]): LayoutPreset {
  if (panelLayoutsEqual(layout, GET_SHIT_DONE_LAYOUT)) return 'get-shit-done';
  if (panelLayoutsEqual(layout, WATCH_SHIT_DONE_LAYOUT)) return 'watch-shit-done';
  if (panelLayoutsEqual(layout, WHY_LAYOUT)) return 'why';
  if (panelLayoutsEqual(layout, REALLY_LAYOUT)) return 'really';
  return 'custom';
}

interface UIContextValue {
  theme: Theme;
  setThemeId: (id: string) => void;
  layout: LayoutPreset;
  setLayout: (preset: LayoutPreset) => void;
  panelLayout: PanelId[][];
  setPanelLayout: (layout: PanelId[][]) => void;
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  homeDir: string;
  openFilePath: string | null;
  setOpenFilePath: (path: string | null) => void;
  openFiles: string[];
  closeFileTab: (path: string) => void;
  closeOtherFileTabs: (keepPath: string) => void;
  closeAllFileTabs: () => void;
  setActiveFileTab: (path: string) => void;
  reorderFileTabs: (fromIndex: number, toIndex: number) => void;
  settingsLoaded: boolean;
  panelVisibility: { explorer: boolean; viewer: boolean; terminal: boolean };
  setPanelVisibility: (panel: 'explorer' | 'viewer' | 'terminal', visible: boolean) => void;
  diffFilePath: string | null;
  setDiffFilePath: (path: string | null) => void;
}

interface SessionContextValue {
  cwd: string;
  sessions: TerminalSession[];
  activeSessionId: string | null;
  addSession: (session: TerminalSession) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  updateSessionCwd: (id: string, cwd: string) => void;
  renameSession: (id: string, customLabel: string) => void;
  updateSessionAppearance: (id: string, icon?: string, iconColor?: string) => void;
  reorderSessions: (fromIndex: number, toIndex: number) => void;
  explorerRoot: string | null;
  setExplorerRoot: (path: string | null) => void;
  explorerOutOfSync: boolean;
  gitInfo: GitInfo;
  gitStatus: Record<string, GitFileStatus>;
  gitStagedStatus: Record<string, GitFileStatus>;
  gitRepoRoot: string | null;
  getRepoRootForFile: (filePath: string) => string | null;
  refreshGitStatus: () => void;
  stageFiles: (filePaths: string[]) => Promise<void>;
  unstageFiles: (filePaths: string[]) => Promise<void>;
  agentContextDirs: AgentContextDir[];
}

const ALL_VISIBLE: PanelVisibility = { explorer: true, viewer: true, terminal: true };

const defaultSettings: AppSettings = {
  shellOverride: null,
  defaultLayout: 'watch-shit-done',
  panelLayout: WATCH_SHIT_DONE_LAYOUT.map(r => [...r]),
  savedCustomLayout: null,
  customPanelVisibility: null,
  theme: 'kraft-dark',
};

const defaultGitInfo: GitInfo = { branch: null, repoName: null, isGitRepo: false };
const EMPTY_CONTEXT_DIRS: AgentContextDir[] = [];

const UIContext = createContext<UIContextValue>(null!);
const SessionContext = createContext<SessionContextValue>(null!);

function normPath(p: string) {
  return p.replace(/\/+$/, '');
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [theme, setTheme] = useState<Theme>(kraftDark);
  const [layout, setLayoutState] = useState<LayoutPreset>('watch-shit-done');
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [explorerRoots, setExplorerRoots] = useState<Record<string, string | null>>({});
  const [openFileTabsMap, setOpenFileTabsMap] = useState<Record<string, { files: string[]; activeFile: string | null }>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [homeDir, setHomeDir] = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [gitCacheVersion, setGitCacheVersion] = useState(0);
  const [panelVisibility, setPanelVisibilityState] = useState({
    explorer: true,
    viewer: true,
    terminal: true,
  });
  const [gitStatus, setGitStatus] = useState<Record<string, GitFileStatus>>({});
  const [gitStagedStatus, setGitStagedStatus] = useState<Record<string, GitFileStatus>>({});
  const [gitRepoRoot, setGitRepoRoot] = useState<string | null>(null);
  const [gitRepoRootsMap, setGitRepoRootsMap] = useState<Record<string, string>>({});
  const [diffFilePath, setDiffFilePathState] = useState<string | null>(null);
  const [agentContextDirsMap, setAgentContextDirsMap] = useState<Record<string, AgentContextDir[]>>({});

  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const themeRef = useRef(theme);
  themeRef.current = theme;

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const panelVisibilityRef = useRef(panelVisibility);
  panelVisibilityRef.current = panelVisibility;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const activeSession = sessions.find(s => s.id === activeSessionId) || null;
  const cwd = activeSession?.cwd || homeDir || '';
  const explorerRoot = activeSessionId ? explorerRoots[activeSessionId] ?? null : null;
  const explorerOutOfSync = !!(explorerRoot && cwd && normPath(explorerRoot) !== normPath(cwd));
  const agentContextDirs = (activeSessionId && agentContextDirsMap[activeSessionId]) || EMPTY_CONTEXT_DIRS;

  const gitCacheRef = useRef<Map<string, GitInfo>>(new Map());
  const prevGitInfoRef = useRef<GitInfo>(defaultGitInfo);

  const cachedGit = cwd ? gitCacheRef.current.get(cwd) : undefined;
  if (cachedGit) {
    if (
      prevGitInfoRef.current.branch !== cachedGit.branch ||
      prevGitInfoRef.current.repoName !== cachedGit.repoName ||
      prevGitInfoRef.current.isGitRepo !== cachedGit.isGitRepo
    ) {
      prevGitInfoRef.current = cachedGit;
    }
  } else if (prevGitInfoRef.current !== defaultGitInfo && !cwd) {
    prevGitInfoRef.current = defaultGitInfo;
  }
  const gitInfo = prevGitInfoRef.current;

  useEffect(() => {
    (async () => {
      try {
        const home = (await window.api.getHomeDir()).replace(/\/+$/, '');
        setHomeDir(home);

        const saved = await window.api.getSettings();
        if (saved && Object.keys(saved).length > 0) {
          const merged = { ...defaultSettings, ...saved } as AppSettings;
          // Migrate legacy panelOrder -> panelLayout
          if (!merged.panelLayout && (saved as any).panelOrder) {
            merged.panelLayout = [(saved as any).panelOrder as PanelId[]];
          }
          // Migrate old preset names to new ones
          const legacyPreset = merged.defaultLayout as string;
          if (!['get-shit-done', 'watch-shit-done', 'why', 'really', 'custom'].includes(legacyPreset)) {
            if (legacyPreset === 'terminal-focus') {
              merged.defaultLayout = 'get-shit-done';
              merged.panelLayout = GET_SHIT_DONE_LAYOUT.map(r => [...r]);
            } else {
              merged.defaultLayout = 'watch-shit-done';
              merged.panelLayout = WATCH_SHIT_DONE_LAYOUT.map(r => [...r]);
            }
          }
          merged.panelLayout = normalizePanelLayout(merged.panelLayout);
          setSettings(merged);
          setTheme(getThemeById(merged.theme));
          setLayoutState(merged.defaultLayout);
          if (merged.defaultLayout === 'custom' && merged.customPanelVisibility) {
            setPanelVisibilityState({ ...merged.customPanelVisibility });
          }
        }
      } catch {
        // Running outside Electron
      } finally {
        setSettingsLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!window.api?.onAgentDetected) return;
    const unsubscribe = window.api.onAgentDetected((terminalId, _agentId) => {
      const agentTabColor = themeRef.current.colors.agentAccent;
      setSessions(prev =>
        prev.map(s => {
          if (s.id !== terminalId) return s;
          if (s.icon !== undefined) return s;
          const setColor = s.iconColor === undefined;
          return {
            ...s,
            icon: AGENT_AUTO_TAB_ICON_ID,
            autoIcon: true,
            ...(setColor ? { iconColor: agentTabColor, autoIconColor: true } : {}),
          };
        })
      );
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!window.api?.onAgentContextDirsChanged) return;
    const unsubscribe = window.api.onAgentContextDirsChanged((terminalId, dirs) => {
      setAgentContextDirsMap(prev => ({ ...prev, [terminalId]: dirs }));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!window.api?.onAgentExited) return;
    const unsubscribe = window.api.onAgentExited((terminalId) => {
      setAgentContextDirsMap(prev => {
        const next = { ...prev };
        delete next[terminalId];
        return next;
      });
      setSessions(prev =>
        prev.map(s => {
          if (s.id !== terminalId) return s;
          if (!s.autoIcon) return s;
          return {
            ...s,
            icon: undefined,
            autoIcon: undefined,
            ...(s.autoIconColor ? { iconColor: undefined, autoIconColor: undefined } : {}),
          };
        })
      );
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const accent = theme.colors.agentAccent;
    setSessions(prev => {
      let changed = false;
      const next = prev.map(s => {
        if (!s.autoIconColor) return s;
        if (s.iconColor === accent) return s;
        changed = true;
        return { ...s, iconColor: accent };
      });
      return changed ? next : prev;
    });
  }, [theme]);

  const addSession = useCallback((session: TerminalSession) => {
    setSessions(prev => {
      if (prev.length === 0) return [...prev, session];
      const usedColors = prev.map(s => s.iconColor).filter(Boolean) as string[];
      const color = session.iconColor || pickRandomColor(usedColors);
      return [...prev, { ...session, iconColor: color }];
    });
    setActiveSessionId(session.id);
  }, []);

  const removeSession = useCallback((id: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (activeSessionIdRef.current === id && next.length > 0) {
        setActiveSessionId(next[next.length - 1].id);
      } else if (next.length === 0) {
        setActiveSessionId(null);
      }
      return next;
    });
    setExplorerRoots(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setOpenFileTabsMap(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setAgentContextDirsMap(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const setActiveSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const updateSessionCwd = useCallback((id: string, newCwd: string) => {
    if (!newCwd) return;
    const normalized = normPath(newCwd);
    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx === -1 || prev[idx].cwd === normalized) return prev;
      const next = [...prev];
      next[idx] = { ...prev[idx], cwd: normalized };
      return next;
    });
  }, []);

  const renameSession = useCallback((id: string, customLabel: string) => {
    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...prev[idx], customLabel: customLabel || undefined };
      return next;
    });
  }, []);

  const updateSessionAppearance = useCallback((id: string, icon?: string, iconColor?: string) => {
    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = {
        ...prev[idx],
        ...(icon !== undefined ? { icon: icon || undefined, autoIcon: false } : {}),
        ...(iconColor !== undefined ? { iconColor: iconColor || undefined, autoIconColor: false } : {}),
      };
      return next;
    });
  }, []);

  const reorderSessions = useCallback((fromIndex: number, toIndex: number) => {
    setSessions(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const setExplorerRoot = useCallback((path: string | null) => {
    const sid = activeSessionIdRef.current;
    if (!sid) return;
    setExplorerRoots(prev => ({ ...prev, [sid]: path }));
  }, []);

  const sessionTabs = activeSessionId ? openFileTabsMap[activeSessionId] : undefined;
  const openFiles = sessionTabs?.files ?? [];
  const openFilePath = sessionTabs?.activeFile ?? null;

  const setOpenFilePath = useCallback((path: string | null) => {
    const sid = activeSessionIdRef.current;
    if (!sid) return;
    setOpenFileTabsMap(prev => {
      const entry = prev[sid] ?? { files: [], activeFile: null };
      if (!path) {
        return { ...prev, [sid]: { ...entry, activeFile: null } };
      }
      const files = entry.files.includes(path) ? entry.files : [...entry.files, path];
      return { ...prev, [sid]: { files, activeFile: path } };
    });
  }, []);

  const closeFileTab = useCallback((path: string) => {
    const sid = activeSessionIdRef.current;
    if (!sid) return;
    setDiffFilePathState(prev => (prev === path ? null : prev));
    setOpenFileTabsMap(prev => {
      const entry = prev[sid];
      if (!entry) return prev;
      const idx = entry.files.indexOf(path);
      if (idx === -1) return prev;
      const files = entry.files.filter(f => f !== path);
      let activeFile = entry.activeFile;
      if (activeFile === path) {
        if (files.length === 0) {
          activeFile = null;
        } else {
          activeFile = files[Math.min(idx, files.length - 1)];
        }
      }
      return { ...prev, [sid]: { files, activeFile } };
    });
  }, []);

  const closeOtherFileTabs = useCallback((keepPath: string) => {
    const sid = activeSessionIdRef.current;
    if (!sid) return;
    setOpenFileTabsMap(prev => {
      const entry = prev[sid];
      if (!entry || !entry.files.includes(keepPath)) return prev;
      return { ...prev, [sid]: { files: [keepPath], activeFile: keepPath } };
    });
    setDiffFilePathState(prev => (prev && prev !== keepPath ? null : prev));
  }, []);

  const closeAllFileTabs = useCallback(() => {
    const sid = activeSessionIdRef.current;
    if (!sid) return;
    setOpenFileTabsMap(prev => {
      const entry = prev[sid];
      if (!entry || entry.files.length === 0) return prev;
      return { ...prev, [sid]: { files: [], activeFile: null } };
    });
    setDiffFilePathState(null);
  }, []);

  const setActiveFileTab = useCallback((path: string) => {
    const sid = activeSessionIdRef.current;
    if (!sid) return;
    setOpenFileTabsMap(prev => {
      const entry = prev[sid];
      if (!entry || !entry.files.includes(path)) return prev;
      return { ...prev, [sid]: { ...entry, activeFile: path } };
    });
  }, []);

  const reorderFileTabs = useCallback((fromIndex: number, toIndex: number) => {
    const sid = activeSessionIdRef.current;
    if (!sid) return;
    setOpenFileTabsMap(prev => {
      const entry = prev[sid];
      if (!entry) return prev;
      const files = [...entry.files];
      const [moved] = files.splice(fromIndex, 1);
      files.splice(toIndex, 0, moved);
      return { ...prev, [sid]: { ...entry, files } };
    });
  }, []);

  useEffect(() => {
    if (!cwd) return;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const info = await window.api.getGitInfo(cwd);
          const current = gitCacheRef.current.get(cwd);
          if (!current || current.branch !== info.branch || current.repoName !== info.repoName || current.isGitRepo !== info.isGitRepo) {
            gitCacheRef.current.set(cwd, info);
            setGitCacheVersion(v => v + 1);
          }
        } catch {
          gitCacheRef.current.set(cwd, defaultGitInfo);
          setGitCacheVersion(v => v + 1);
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [cwd]);

  const fetchGitStatus = useCallback(async (dirs: string[]) => {
    if (!window.api?.getGitStatus || dirs.length === 0) return;
    try {
      const results = await Promise.all(dirs.map(d => window.api.getGitStatus(d)));
      const mergedFiles: Record<string, GitFileStatus> = {};
      const mergedStaged: Record<string, GitFileStatus> = {};
      let primaryRepoRoot: string | null = null;
      const rootsMap: Record<string, string> = {};
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (!primaryRepoRoot && result.repoRoot) primaryRepoRoot = result.repoRoot;
        if (result.repoRoot) rootsMap[dirs[i]] = result.repoRoot;
        Object.assign(mergedFiles, result.files as Record<string, GitFileStatus>);
        if (result.staged) {
          Object.assign(mergedStaged, result.staged as Record<string, GitFileStatus>);
        }
      }
      setGitStatus(mergedFiles);
      setGitStagedStatus(mergedStaged);
      setGitRepoRoot(primaryRepoRoot);
      setGitRepoRootsMap(rootsMap);
    } catch {
      setGitStatus({});
      setGitStagedStatus({});
      setGitRepoRoot(null);
      setGitRepoRootsMap({});
    }
  }, []);

  useEffect(() => {
    const allRoots = [explorerRoot, ...agentContextDirs.map(d => d.path)].filter(Boolean) as string[];
    if (allRoots.length === 0) {
      setGitStatus({});
      setGitStagedStatus({});
      setGitRepoRoot(null);
      return;
    }
    const timer = setTimeout(() => fetchGitStatus(allRoots), 300);
    return () => clearTimeout(timer);
  }, [explorerRoot, agentContextDirs, fetchGitStatus]);

  const refreshGitStatus = useCallback(() => {
    const allRoots = [explorerRoot, ...agentContextDirs.map(d => d.path)].filter(Boolean) as string[];
    if (allRoots.length > 0) fetchGitStatus(allRoots);
  }, [explorerRoot, agentContextDirs, fetchGitStatus]);

  const refreshGitStatusRef = useRef(refreshGitStatus);
  refreshGitStatusRef.current = refreshGitStatus;

  useEffect(() => {
    if (!window.api?.watchGitRepo || !window.api?.onGitChanged) return;
    const repoRoots = new Set(Object.values(gitRepoRootsMap));
    if (repoRoots.size === 0) return;

    for (const root of repoRoots) {
      window.api.watchGitRepo(root);
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = window.api.onGitChanged(() => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        refreshGitStatusRef.current();
      }, 200);
    });

    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      unsubscribe();
      for (const root of repoRoots) {
        window.api.unwatchGitRepo(root);
      }
    };
  }, [gitRepoRootsMap]);

  const gitRepoRootsMapRef = useRef(gitRepoRootsMap);
  gitRepoRootsMapRef.current = gitRepoRootsMap;
  const gitRepoRootRef = useRef(gitRepoRoot);
  gitRepoRootRef.current = gitRepoRoot;

  const getRepoRootForFile = useCallback((filePath: string): string | null => {
    const map = gitRepoRootsMapRef.current;
    const dirs = Object.keys(map).sort((a, b) => b.length - a.length);
    for (const dir of dirs) {
      const prefix = dir.endsWith('/') ? dir : dir + '/';
      if (filePath.startsWith(prefix) || filePath === dir) {
        return map[dir];
      }
    }
    return gitRepoRootRef.current;
  }, []);

  const stageFiles = useCallback(async (filePaths: string[]) => {
    if (!window.api?.gitStage || filePaths.length === 0) return;
    const repoRoot = getRepoRootForFile(filePaths[0]);
    if (!repoRoot) return;
    await window.api.gitStage(filePaths, repoRoot);
    refreshGitStatus();
  }, [getRepoRootForFile, refreshGitStatus]);

  const unstageFiles = useCallback(async (filePaths: string[]) => {
    if (!window.api?.gitUnstage || filePaths.length === 0) return;
    const repoRoot = getRepoRootForFile(filePaths[0]);
    if (!repoRoot) return;
    await window.api.gitUnstage(filePaths, repoRoot);
    refreshGitStatus();
  }, [getRepoRootForFile, refreshGitStatus]);

  const setDiffFilePath = useCallback((path: string | null) => {
    setDiffFilePathState(path);
    if (path) {
      const sid = activeSessionIdRef.current;
      if (!sid) return;
      setOpenFileTabsMap(prev => {
        const entry = prev[sid] ?? { files: [], activeFile: null };
        const files = entry.files.includes(path) ? entry.files : [...entry.files, path];
        return { ...prev, [sid]: { files, activeFile: path } };
      });
    }
  }, []);

  const setThemeId = useCallback((id: string) => {
    const t = getThemeById(id);
    setTheme(t);
    setSettings(prev => {
      const next = { ...prev, theme: id };
      window.api?.saveSettings(next);
      return next;
    });
  }, []);

  const setLayout = useCallback((preset: LayoutPreset) => {
    setLayoutState(preset);
    if (preset === 'custom') {
      const savedVis = settingsRef.current.customPanelVisibility;
      setPanelVisibilityState(savedVis ? { ...savedVis } : { ...ALL_VISIBLE });
    } else {
      setPanelVisibilityState({ ...ALL_VISIBLE });
    }
    const presetLayout = PRESET_LAYOUTS[preset];
    setSettings(prev => {
      const next: AppSettings = {
        ...prev,
        defaultLayout: preset,
        ...(presetLayout ? { panelLayout: presetLayout.map(r => [...r]) } : {}),
      };
      window.api?.saveSettings(next);
      return next;
    });
  }, []);

  const setPanelLayout = useCallback((newLayout: PanelId[][]) => {
    const normalized = normalizePanelLayout(newLayout);
    const matchedPreset = layoutToPreset(normalized);
    setLayoutState(matchedPreset);
    setSettings(prev => {
      const next: AppSettings = {
        ...prev,
        panelLayout: normalized,
        defaultLayout: matchedPreset,
        ...(matchedPreset === 'custom' ? {
          savedCustomLayout: normalized.map(r => [...r]),
          customPanelVisibility: { ...panelVisibilityRef.current },
        } : {}),
      };
      window.api?.saveSettings(next);
      return next;
    });
  }, []);

  const setPanelVisibility = useCallback((panel: 'explorer' | 'viewer' | 'terminal', visible: boolean) => {
    const next = { ...panelVisibilityRef.current, [panel]: visible };
    setPanelVisibilityState(next);
    if (layoutRef.current === 'custom') {
      setSettings(prev => {
        const updated = { ...prev, customPanelVisibility: { ...next } };
        window.api?.saveSettings(updated);
        return updated;
      });
    }
  }, []);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings(prev => {
      let next: AppSettings = { ...prev, ...partial };
      if (partial.defaultLayout != null) {
        const presetLayout = PRESET_LAYOUTS[partial.defaultLayout];
        if (presetLayout) {
          next = { ...next, panelLayout: presetLayout.map(r => [...r]) };
          setPanelVisibilityState({ ...ALL_VISIBLE });
        } else if (partial.defaultLayout === 'custom') {
          if (prev.savedCustomLayout) {
            next = { ...next, panelLayout: prev.savedCustomLayout.map(r => [...r]) };
          } else {
            const initial = MY_LAYOUT_DEFAULT.map(r => [...r]);
            next = { ...next, panelLayout: initial, savedCustomLayout: initial.map(r => [...r]) };
          }
          const savedVis = next.customPanelVisibility;
          setPanelVisibilityState(savedVis ? { ...savedVis } : { ...ALL_VISIBLE });
        } else {
          setPanelVisibilityState({ ...ALL_VISIBLE });
        }
      }
      if (partial.panelLayout != null) {
        next = { ...next, panelLayout: normalizePanelLayout(partial.panelLayout) };
      }
      if (partial.theme) setTheme(getThemeById(partial.theme));
      if (partial.defaultLayout != null) setLayoutState(partial.defaultLayout);
      window.api?.saveSettings(next);
      return next;
    });
  }, []);

  const uiValue = useMemo<UIContextValue>(() => ({
    theme,
    setThemeId,
    layout,
    setLayout,
    panelLayout: settings.panelLayout,
    setPanelLayout,
    settings,
    updateSettings,
    settingsOpen,
    setSettingsOpen,
    homeDir,
    openFilePath,
    setOpenFilePath,
    openFiles,
    closeFileTab,
    closeOtherFileTabs,
    closeAllFileTabs,
    setActiveFileTab,
    reorderFileTabs,
    settingsLoaded,
    panelVisibility,
    setPanelVisibility,
    diffFilePath,
    setDiffFilePath,
  }), [theme, layout, settings, settingsOpen, homeDir, openFilePath, openFiles, settingsLoaded, panelVisibility, diffFilePath,
       setThemeId, setLayout, setPanelLayout, updateSettings, setPanelVisibility, setOpenFilePath, closeFileTab, closeOtherFileTabs, closeAllFileTabs, setActiveFileTab, reorderFileTabs, setDiffFilePath]);

  const sessionValue = useMemo<SessionContextValue>(() => ({
    cwd,
    sessions,
    activeSessionId,
    addSession,
    removeSession,
    setActiveSession,
    updateSessionCwd,
    renameSession,
    updateSessionAppearance,
    reorderSessions,
    explorerRoot,
    setExplorerRoot,
    explorerOutOfSync,
    gitInfo,
    gitStatus,
    gitStagedStatus,
    gitRepoRoot,
    getRepoRootForFile,
    refreshGitStatus,
    stageFiles,
    unstageFiles,
    agentContextDirs,
  }), [cwd, sessions, activeSessionId, explorerRoot, explorerOutOfSync, gitInfo, gitStatus, gitStagedStatus, gitRepoRoot, agentContextDirs,
       addSession, removeSession, setActiveSession, updateSessionCwd, renameSession, updateSessionAppearance, reorderSessions, setExplorerRoot, refreshGitStatus, stageFiles, unstageFiles, getRepoRootForFile]);

  return (
    <UIContext.Provider value={uiValue}>
      <SessionContext.Provider value={sessionValue}>
        {children}
      </SessionContext.Provider>
    </UIContext.Provider>
  );
}

export function useUIContext() {
  return useContext(UIContext);
}

export function useSessionContext() {
  return useContext(SessionContext);
}

export function useAppContext() {
  const ui = useContext(UIContext);
  const session = useContext(SessionContext);
  return { ...ui, ...session };
}
