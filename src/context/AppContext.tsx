import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Theme, LayoutPreset, AppSettings, GitInfo, GitFileStatus, TerminalPane, TerminalGroup, PanelId, PanelVisibility, AgentContextDir, PersistedSession, PersistedGroup, SavedWorkspace, SavedWorkspaceMeta } from '../types';
import { getThemeById, kraftDark } from '../themes';
import { AGENT_AUTO_TAB_ICON_ID, pickRandomColor } from '../terminalIcons';

const GET_SHIT_DONE_LAYOUT: PanelId[][] = [['terminal']];
const WATCH_SHIT_DONE_LAYOUT: PanelId[][] = [['explorer', 'terminal'], ['explorer', 'editor']];
const WHY_LAYOUT: PanelId[][] = [['explorer', 'editor', 'terminal']];
const REALLY_LAYOUT: PanelId[][] = [['explorer'], ['editor'], ['terminal']];
const MY_LAYOUT_DEFAULT: PanelId[][] = [['explorer', 'terminal'], ['editor', 'terminal']];

const ALL_PANELS: PanelId[] = ['explorer', 'editor', 'terminal'];

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
  panelVisibility: { explorer: boolean; editor: boolean; terminal: boolean };
  setPanelVisibility: (panel: 'explorer' | 'editor' | 'terminal', visible: boolean) => void;
  diffFilePath: string | null;
  setDiffFilePath: (path: string | null) => void;
  gitError: string | null;
  clearGitError: () => void;
  gitErrorViewContent: string | null;
  setGitErrorViewContent: (content: string | null) => void;
  errorViewTitle: string;
  setErrorViewTitle: (title: string) => void;
}

interface SessionContextValue {
  cwd: string;
  groups: TerminalGroup[];
  activeGroupId: string | null;
  activeGroup: TerminalGroup | null;
  focusedPaneId: string | null;
  setActiveGroup: (id: string) => void;
  setFocusedPane: (paneId: string) => void;
  createGroup: () => Promise<void>;
  createGroupAtPath: (path: string) => Promise<void>;
  duplicateGroup: (id: string) => Promise<void>;
  destroyGroup: (id: string) => void;
  splitPane: () => Promise<void>;
  closePane: (paneId: string) => void;
  exitSplit: () => void;
  updateGroupSplitPcts: (groupId: string, pcts: number[]) => void;
  updatePaneCwd: (paneId: string, cwd: string) => void;
  renameGroup: (id: string, customLabel: string) => void;
  updateGroupAppearance: (id: string, icon?: string, iconColor?: string) => void;
  reorderGroups: (fromIndex: number, toIndex: number) => void;
  recentlyClosedGroups: { group: TerminalGroup; index: number }[];
  restoreLastClosedGroup: () => Promise<void>;
  explorerRoot: string | null;
  setExplorerRoot: (path: string | null) => void;
  explorerOutOfSync: boolean;
  gitInfo: GitInfo;
  gitStatus: Record<string, GitFileStatus>;
  gitStagedStatus: Record<string, GitFileStatus>;
  gitIgnored: string[];
  gitRepoRoot: string | null;
  getRepoRootForFile: (filePath: string) => string | null;
  refreshGitStatus: () => void;
  stageFiles: (filePaths: string[]) => Promise<void>;
  unstageFiles: (filePaths: string[]) => Promise<void>;
  discardFiles: (filePaths: string[]) => Promise<void>;
  stashChanges: (repoRoot: string, message?: string, includeUntracked?: boolean) => Promise<void>;
  stashPop: (repoRoot: string) => Promise<void>;
  commitStaged: (repoRoot: string, message: string) => Promise<boolean>;
  commitAll: (repoRoot: string, message: string) => Promise<boolean>;
  undoLastCommit: (repoRoot: string) => Promise<void>;
  agentContextDirs: AgentContextDir[];
  activeWorkspaceName: string | null;
  saveWorkspace: (name: string) => Promise<string | null>;
  loadWorkspace: (filename: string) => Promise<void>;
  listWorkspaces: () => Promise<SavedWorkspaceMeta[]>;
  deleteWorkspace: (filename: string) => Promise<void>;
}

const ALL_VISIBLE: PanelVisibility = { explorer: true, editor: true, terminal: true };

const defaultSettings: AppSettings = {
  shellOverride: null,
  defaultLayout: 'watch-shit-done',
  panelLayout: WATCH_SHIT_DONE_LAYOUT.map(r => [...r]),
  savedCustomLayout: null,
  customPanelVisibility: null,
  theme: 'kraft-dark',
  autoLoadExplorer: true,
  syncLayoutAcrossTabs: false,
  showHiddenFiles: true,
  newTabUsePreviousCwd: false,
  keybindingPreset: 'vscode',
  customKeybindings: {},
  defaultWorkspace: null,
  fontFamily: 'JetBrains Mono',
  fontSize: 14,
  syncFontSizes: true,
  editorFontSize: 13,
  explorerFontSize: 13,
};

const defaultGitInfo: GitInfo = { branch: null, repoName: null, isGitRepo: false, aheadCount: 0 };
const EMPTY_CONTEXT_DIRS: AgentContextDir[] = [];

const UIContext = createContext<UIContextValue>(null!);
const SessionContext = createContext<SessionContextValue>(null!);

let groupTabCounter = 0;

function newGroupId() {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normPath(p: string) {
  return p.replace(/\/+$/, '');
}

/** Returns equal percentage flex values that sum to 100 for n panes. */
function equalSplitPcts(n: number): number[] {
  if (n === 0) return [];
  const base = Math.floor(100 / n);
  const remainder = 100 - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === n - 1 ? remainder : 0));
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [theme, setTheme] = useState<Theme>(kraftDark);
  const [layout, setLayoutState] = useState<LayoutPreset>('watch-shit-done');
  const [groups, setGroups] = useState<TerminalGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [explorerRoots, setExplorerRoots] = useState<Record<string, string | null>>({});
  const [openFileTabsMap, setOpenFileTabsMap] = useState<Record<string, { files: string[]; activeFile: string | null }>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [homeDir, setHomeDir] = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [gitCacheVersion, setGitCacheVersion] = useState(0);
  const [panelVisibilityMap, setPanelVisibilityMap] = useState<Record<string, PanelVisibility>>({});
  const [panelLayoutMap, setPanelLayoutMap] = useState<Record<string, PanelId[][]>>({});
  const [gitStatus, setGitStatus] = useState<Record<string, GitFileStatus>>({});
  const [gitStagedStatus, setGitStagedStatus] = useState<Record<string, GitFileStatus>>({});
  const [gitIgnored, setGitIgnored] = useState<string[]>([]);
  const [gitRepoRoot, setGitRepoRoot] = useState<string | null>(null);
  const [gitRepoRootsMap, setGitRepoRootsMap] = useState<Record<string, string>>({});
  const [diffFilePath, setDiffFilePathState] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [gitErrorViewContent, setGitErrorViewContent] = useState<string | null>(null);
  const [errorViewTitle, setErrorViewTitle] = useState<string>('Git Error Output');
  const [agentContextDirsMap, setAgentContextDirsMap] = useState<Record<string, AgentContextDir[]>>({});
  const [recentlyClosedGroups, setRecentlyClosedGroups] = useState<{ group: TerminalGroup; index: number }[]>([]);
  const recentlyClosedGroupsRef = useRef<{ group: TerminalGroup; index: number }[]>([]);
  const [activeWorkspaceName, setActiveWorkspaceName] = useState<string | null>(null);
  // Forward ref so the startup effect can call loadWorkspace before it's defined
  const loadWorkspaceRef = useRef<((filename: string) => Promise<void>) | null>(null);

  const activeGroupIdRef = useRef(activeGroupId);
  activeGroupIdRef.current = activeGroupId;

  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const themeRef = useRef(theme);
  themeRef.current = theme;

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const initialPanelVisibilityRef = useRef<PanelVisibility>({ ...ALL_VISIBLE });
  const panelVisibilityMapRef = useRef(panelVisibilityMap);
  panelVisibilityMapRef.current = panelVisibilityMap;
  const panelVisibility = useMemo(() => {
    if (activeGroupId && panelVisibilityMap[activeGroupId]) {
      return panelVisibilityMap[activeGroupId];
    }
    return initialPanelVisibilityRef.current;
  }, [activeGroupId, panelVisibilityMap]);
  const panelVisibilityRef = useRef(panelVisibility);
  panelVisibilityRef.current = panelVisibility;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const panelLayoutMapRef = useRef(panelLayoutMap);
  panelLayoutMapRef.current = panelLayoutMap;
  const panelLayout = useMemo(() => {
    if (activeGroupId && panelLayoutMap[activeGroupId]) {
      return panelLayoutMap[activeGroupId];
    }
    return settings.panelLayout;
  }, [activeGroupId, panelLayoutMap, settings.panelLayout]);

  const activeGroup = groups.find(g => g.id === activeGroupId) || null;
  const focusedPaneId = activeGroup ? activeGroup.focusedPaneId : null;
  const focusedPane = activeGroup
    ? (activeGroup.panes.find(p => p.id === activeGroup.focusedPaneId) ?? activeGroup.panes[0] ?? null)
    : null;
  const cwd = focusedPane?.cwd || homeDir || '';
  const explorerRoot = activeGroupId ? explorerRoots[activeGroupId] ?? null : null;
  const explorerOutOfSync = !!(explorerRoot && cwd && normPath(explorerRoot) !== normPath(cwd));
  const agentContextDirs = (focusedPaneId && agentContextDirsMap[focusedPaneId]) || EMPTY_CONTEXT_DIRS;

  const gitCacheRef = useRef<Map<string, GitInfo>>(new Map());
  const prevGitInfoRef = useRef<GitInfo>(defaultGitInfo);

  const cachedGit = cwd ? gitCacheRef.current.get(cwd) : undefined;
  if (cachedGit) {
    if (
      prevGitInfoRef.current.branch !== cachedGit.branch ||
      prevGitInfoRef.current.repoName !== cachedGit.repoName ||
      prevGitInfoRef.current.isGitRepo !== cachedGit.isGitRepo ||
      prevGitInfoRef.current.aheadCount !== cachedGit.aheadCount
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
            initialPanelVisibilityRef.current = { ...merged.customPanelVisibility };
          }
          if (Array.isArray((saved as any).recentlyClosedGroups)) {
            // Migrate old format (plain TerminalGroup[]) to new { group, index } format
            const loaded = ((saved as any).recentlyClosedGroups as any[])
              .filter((item: any) => item && typeof item === 'object')
              .map((item: any) =>
                item.group && typeof item.index === 'number'
                  ? item
                  : { group: item, index: 0 }
              );
            recentlyClosedGroupsRef.current = loaded;
            setRecentlyClosedGroups(loaded);
          }
        }
        // Check for pending workspace (from dock menu)
        if (window.api?.getSession) {
          const { pendingWorkspace } = await window.api.getSession();
          if (pendingWorkspace) {
            const pw = pendingWorkspace;
            setTimeout(() => loadWorkspaceRef.current?.(pw), 0);
          } else {
            const defaultWs = (saved as any).defaultWorkspace as string | null | undefined;
            if (defaultWs) {
              setTimeout(() => loadWorkspaceRef.current?.(defaultWs), 0);
            }
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
      // terminalId is a pane (PTY) id — find the group containing it
      setGroups(prev =>
        prev.map(g => {
          if (!g.panes.some(p => p.id === terminalId)) return g;
          if (g.icon !== undefined) return g;
          const setColor = g.iconColor === undefined;
          return {
            ...g,
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
      // terminalId is a pane (PTY) id — find the group containing it
      setGroups(prev =>
        prev.map(g => {
          if (!g.panes.some(p => p.id === terminalId)) return g;
          if (!g.autoIcon) return g;
          return {
            ...g,
            icon: undefined,
            autoIcon: undefined,
            ...(g.autoIconColor ? { iconColor: undefined, autoIconColor: undefined } : {}),
          };
        })
      );
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const accent = theme.colors.agentAccent;
    setGroups(prev => {
      let changed = false;
      const next = prev.map(g => {
        if (!g.autoIconColor) return g;
        if (g.iconColor === accent) return g;
        changed = true;
        return { ...g, iconColor: accent };
      });
      return changed ? next : prev;
    });
  }, [theme]);

  // Internal: add a fully-constructed group and make it active.
  // Pass atIndex to insert at a specific position instead of appending.
  const addGroup = useCallback((group: TerminalGroup, atIndex?: number) => {
    const prevId = activeGroupIdRef.current;

    setGroups(prev => {
      if (prev.length === 0) return [...prev, group];
      const usedColors = prev.map(g => g.iconColor).filter(Boolean) as string[];
      const color = group.iconColor || pickRandomColor(usedColors);
      const groupWithColor = { ...group, iconColor: color };
      if (atIndex !== undefined) {
        const clamped = Math.max(0, Math.min(atIndex, prev.length));
        const next = [...prev];
        next.splice(clamped, 0, groupWithColor);
        return next;
      }
      return [...prev, groupWithColor];
    });

    setPanelVisibilityMap(prev => ({
      ...prev,
      [group.id]: { ...initialPanelVisibilityRef.current },
    }));

    // If the previous group's explorer was synced with its cwd, auto-load
    // the new group's explorer with its cwd so the user doesn't have to.
    if (prevId && group.panes[0]?.cwd) {
      setExplorerRoots(prev => {
        const prevRoot = prev[prevId];
        if (!prevRoot) return prev;
        const prevGroup = groupsRef.current.find(g => g.id === prevId);
        const prevFocusedPane = prevGroup
          ? (prevGroup.panes.find(p => p.id === prevGroup.focusedPaneId) ?? prevGroup.panes[0])
          : null;
        if (!prevFocusedPane?.cwd) return prev;
        if (normPath(prevRoot) !== normPath(prevFocusedPane.cwd)) return prev;
        return { ...prev, [group.id]: normPath(group.panes[0].cwd) };
      });
    }

    setActiveGroupId(group.id);
  }, []);

  // Internal: remove a group and clean up associated state
  const removeGroup = useCallback((id: string) => {
    setGroups(prev => {
      const next = prev.filter(g => g.id !== id);
      if (activeGroupIdRef.current === id && next.length > 0) {
        setActiveGroupId(next[next.length - 1].id);
      } else if (next.length === 0) {
        setActiveGroupId(null);
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
    setPanelVisibilityMap(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setPanelLayoutMap(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const createGroup = useCallback(async () => {
    if (!window.api?.createTerminal) return;
    const activeGrp = groupsRef.current.find(g => g.id === activeGroupIdRef.current);
    const focusedPane = activeGrp
      ? (activeGrp.panes.find(p => p.id === activeGrp.focusedPaneId) ?? activeGrp.panes[0])
      : null;
    const startCwd = settingsRef.current.newTabUsePreviousCwd
      ? (focusedPane?.cwd || homeDir || undefined)
      : (homeDir || undefined);
    const shell = settingsRef.current.shellOverride || undefined;
    try {
      const { id: paneId } = await window.api.createTerminal({ cwd: startCwd, shell, cols: 80, rows: 24 });
      groupTabCounter++;
      addGroup({
        id: newGroupId(),
        label: `Terminal ${groupTabCounter}`,
        panes: [{ id: paneId, cwd: startCwd || '' }],
        focusedPaneId: paneId,
        splitPcts: [100],
      });
    } catch (err) {
      console.error('Failed to create terminal:', err);
    }
  }, [homeDir, addGroup]);

  const createGroupAtPath = useCallback(async (path: string) => {
    if (!window.api?.createTerminal) return;
    const shell = settingsRef.current.shellOverride || undefined;
    try {
      const { id: paneId } = await window.api.createTerminal({ cwd: path, shell, cols: 80, rows: 24 });
      groupTabCounter++;
      addGroup({
        id: newGroupId(),
        label: `Terminal ${groupTabCounter}`,
        panes: [{ id: paneId, cwd: path }],
        focusedPaneId: paneId,
        splitPcts: [100],
      });
    } catch (err) {
      console.error('Failed to create terminal:', err);
    }
  }, [addGroup]);

  const duplicateGroup = useCallback(async (sourceId: string) => {
    if (!window.api?.createTerminal) return;
    const sourceGrp = groupsRef.current.find(g => g.id === sourceId);
    const sourceFocusedPane = sourceGrp
      ? (sourceGrp.panes.find(p => p.id === sourceGrp.focusedPaneId) ?? sourceGrp.panes[0])
      : null;
    const startCwd = sourceFocusedPane?.cwd || homeDir || undefined;
    const shell = settingsRef.current.shellOverride || undefined;
    try {
      const { id: paneId } = await window.api.createTerminal({ cwd: startCwd, shell, cols: 80, rows: 24 });
      groupTabCounter++;
      addGroup({
        id: newGroupId(),
        label: `Terminal ${groupTabCounter}`,
        panes: [{ id: paneId, cwd: startCwd || '' }],
        focusedPaneId: paneId,
        splitPcts: [100],
      });
    } catch (err) {
      console.error('Failed to duplicate terminal:', err);
    }
  }, [homeDir, addGroup]);

  const destroyGroup = useCallback((id: string) => {
    if (groupsRef.current.length <= 1) return;
    const grp = groupsRef.current.find(g => g.id === id);
    if (grp) {
      // Save a snapshot for recent-closed restore (pane IDs are now stale but metadata is valid)
      const snapshot: TerminalGroup = {
        ...grp,
        autoIcon: undefined,
        autoIconColor: undefined,
        icon: grp.autoIcon ? undefined : grp.icon,
        iconColor: grp.autoIconColor ? undefined : grp.iconColor,
      };
      const closedAtIndex = groupsRef.current.findIndex(g => g.id === id);
      const closed = [{ group: snapshot, index: closedAtIndex }, ...recentlyClosedGroupsRef.current].slice(0, 10);
      recentlyClosedGroupsRef.current = closed;
      setRecentlyClosedGroups(closed);
      window.api?.saveSettings({ ...settingsRef.current, recentlyClosedGroups: closed });
      // Destroy all PTYs in the group
      for (const pane of grp.panes) {
        try { window.api?.destroyTerminal(pane.id); } catch {}
      }
    }
    removeGroup(id);
  }, [removeGroup]);

  const restoreLastClosedGroup = useCallback(async () => {
    const queue = recentlyClosedGroupsRef.current;
    if (queue.length === 0) return;
    const [{ group: toRestore, index: restoreIndex }, ...remaining] = queue;
    recentlyClosedGroupsRef.current = remaining;
    setRecentlyClosedGroups(remaining);
    window.api?.saveSettings({ ...settingsRef.current, recentlyClosedGroups: remaining });
    if (!window.api?.createTerminal) return;
    const shell = settingsRef.current.shellOverride || undefined;
    try {
      // Restore all panes of the closed group
      const newPanes: TerminalPane[] = [];
      for (const oldPane of toRestore.panes) {
        const { id: paneId } = await window.api.createTerminal({ cwd: oldPane.cwd || undefined, shell, cols: 80, rows: 24 });
        newPanes.push({ id: paneId, cwd: oldPane.cwd });
      }
      if (newPanes.length === 0) return;
      groupTabCounter++;
      addGroup({
        ...toRestore,
        id: newGroupId(),
        panes: newPanes,
        focusedPaneId: newPanes[0].id,
        splitPcts: equalSplitPcts(newPanes.length),
      }, restoreIndex);
    } catch (err) {
      console.error('Failed to restore terminal:', err);
    }
  }, [addGroup]);

  const setActiveGroup = useCallback((id: string) => {
    setActiveGroupId(id);
  }, []);

  const setFocusedPane = useCallback((paneId: string) => {
    setGroups(prev => prev.map(g => {
      if (!g.panes.some(p => p.id === paneId)) return g;
      return { ...g, focusedPaneId: paneId };
    }));
  }, []);

  const splitPane = useCallback(async () => {
    if (!window.api?.createTerminal) return;
    const activeGrp = groupsRef.current.find(g => g.id === activeGroupIdRef.current);
    if (!activeGrp) return;
    const currentPane = activeGrp.panes.find(p => p.id === activeGrp.focusedPaneId) ?? activeGrp.panes[0];
    // Splits always inherit the focused pane's cwd (independent of newTabUsePreviousCwd setting).
    const startCwd = currentPane?.cwd || homeDir || undefined;
    const shell = settingsRef.current.shellOverride || undefined;
    try {
      const { id: paneId } = await window.api.createTerminal({ cwd: startCwd, shell, cols: 80, rows: 24 });
      const newPane: TerminalPane = { id: paneId, cwd: startCwd || '' };
      setGroups(prev => prev.map(g => {
        if (g.id !== activeGroupIdRef.current) return g;
        const newPanes = [...g.panes, newPane];
        return { ...g, panes: newPanes, focusedPaneId: paneId, splitPcts: equalSplitPcts(newPanes.length) };
      }));
    } catch (err) {
      console.error('Failed to split pane:', err);
    }
  }, [homeDir]);

  const closePane = useCallback((paneId: string) => {
    setGroups(prev => prev.map(g => {
      if (!g.panes.some(p => p.id === paneId)) return g;
      const newPanes = g.panes.filter(p => p.id !== paneId);
      const newFocusedId = g.focusedPaneId === paneId
        ? (newPanes[0]?.id ?? '')
        : g.focusedPaneId;
      return { ...g, panes: newPanes, focusedPaneId: newFocusedId, splitPcts: equalSplitPcts(newPanes.length) };
    }));
    try { window.api?.destroyTerminal(paneId); } catch {}
    setAgentContextDirsMap(prev => {
      const next = { ...prev };
      delete next[paneId];
      return next;
    });
  }, []);

  /** Close all panes except the focused one, collapsing split mode. */
  const exitSplit = useCallback(() => {
    const grp = groupsRef.current.find(g => g.id === activeGroupIdRef.current);
    if (!grp || grp.panes.length < 2) return;
    const panestoClose = grp.panes.filter(p => p.id !== grp.focusedPaneId);
    for (const pane of panestoClose) {
      try { window.api?.destroyTerminal(pane.id); } catch {}
    }
    setAgentContextDirsMap(prev => {
      const next = { ...prev };
      for (const pane of panestoClose) delete next[pane.id];
      return next;
    });
    setGroups(prev => prev.map(g => {
      if (g.id !== activeGroupIdRef.current) return g;
      const focused = g.panes.find(p => p.id === g.focusedPaneId);
      if (!focused) return g;
      return { ...g, panes: [focused], splitPcts: [100] };
    }));
  }, []);

  const updateGroupSplitPcts = useCallback((groupId: string, pcts: number[]) => {
    setGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      return { ...g, splitPcts: pcts };
    }));
  }, []);

  const updatePaneCwd = useCallback((paneId: string, newCwd: string) => {
    if (!newCwd) return;
    const normalized = normPath(newCwd);
    setGroups(prev => prev.map(g => {
      const paneIdx = g.panes.findIndex(p => p.id === paneId);
      if (paneIdx === -1 || g.panes[paneIdx].cwd === normalized) return g;
      const newPanes = [...g.panes];
      newPanes[paneIdx] = { ...g.panes[paneIdx], cwd: normalized };
      return { ...g, panes: newPanes };
    }));
  }, []);

  const renameGroup = useCallback((id: string, customLabel: string) => {
    setGroups(prev => {
      const idx = prev.findIndex(g => g.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...prev[idx], customLabel: customLabel || undefined };
      return next;
    });
  }, []);

  const updateGroupAppearance = useCallback((id: string, icon?: string, iconColor?: string) => {
    setGroups(prev => {
      const idx = prev.findIndex(g => g.id === id);
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

  const reorderGroups = useCallback((fromIndex: number, toIndex: number) => {
    setGroups(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const setExplorerRoot = useCallback((path: string | null) => {
    const gid = activeGroupIdRef.current;
    if (!gid) return;
    setExplorerRoots(prev => ({ ...prev, [gid]: path }));
  }, []);

  const sessionTabs = activeGroupId ? openFileTabsMap[activeGroupId] : undefined;
  const openFiles = sessionTabs?.files ?? [];
  const openFilePath = sessionTabs?.activeFile ?? null;

  const setOpenFilePath = useCallback((path: string | null) => {
    const gid = activeGroupIdRef.current;
    if (!gid) return;
    setOpenFileTabsMap(prev => {
      const entry = prev[gid] ?? { files: [], activeFile: null };
      if (!path) {
        return { ...prev, [gid]: { ...entry, activeFile: null } };
      }
      const files = entry.files.includes(path) ? entry.files : [...entry.files, path];
      return { ...prev, [gid]: { files, activeFile: path } };
    });
  }, []);

  const closeFileTab = useCallback((path: string) => {
    const gid = activeGroupIdRef.current;
    if (!gid) return;
    setDiffFilePathState(prev => (prev === path ? null : prev));
    setOpenFileTabsMap(prev => {
      const entry = prev[gid];
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
      return { ...prev, [gid]: { files, activeFile } };
    });
  }, []);

  const closeOtherFileTabs = useCallback((keepPath: string) => {
    const gid = activeGroupIdRef.current;
    if (!gid) return;
    setOpenFileTabsMap(prev => {
      const entry = prev[gid];
      if (!entry || !entry.files.includes(keepPath)) return prev;
      return { ...prev, [gid]: { files: [keepPath], activeFile: keepPath } };
    });
    setDiffFilePathState(prev => (prev && prev !== keepPath ? null : prev));
  }, []);

  const closeAllFileTabs = useCallback(() => {
    const gid = activeGroupIdRef.current;
    if (!gid) return;
    setOpenFileTabsMap(prev => {
      const entry = prev[gid];
      if (!entry || entry.files.length === 0) return prev;
      return { ...prev, [gid]: { files: [], activeFile: null } };
    });
    setDiffFilePathState(null);
  }, []);

  const setActiveFileTab = useCallback((path: string) => {
    const gid = activeGroupIdRef.current;
    if (!gid) return;
    setOpenFileTabsMap(prev => {
      const entry = prev[gid];
      if (!entry || !entry.files.includes(path)) return prev;
      return { ...prev, [gid]: { ...entry, activeFile: path } };
    });
  }, []);

  const reorderFileTabs = useCallback((fromIndex: number, toIndex: number) => {
    const gid = activeGroupIdRef.current;
    if (!gid) return;
    setOpenFileTabsMap(prev => {
      const entry = prev[gid];
      if (!entry) return prev;
      const files = [...entry.files];
      const [moved] = files.splice(fromIndex, 1);
      files.splice(toIndex, 0, moved);
      return { ...prev, [gid]: { ...entry, files } };
    });
  }, []);

  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  const fetchGitInfo = useCallback((dirPath: string) => {
    (async () => {
      try {
        const info = await window.api.getGitInfo(dirPath);
        const current = gitCacheRef.current.get(dirPath);
        if (!current || current.branch !== info.branch || current.repoName !== info.repoName || current.isGitRepo !== info.isGitRepo || current.aheadCount !== info.aheadCount) {
          gitCacheRef.current.set(dirPath, info);
          setGitCacheVersion(v => v + 1);
        }
      } catch {
        gitCacheRef.current.set(dirPath, defaultGitInfo);
        setGitCacheVersion(v => v + 1);
      }
    })();
  }, []);

  const refreshGitInfo = useCallback(() => {
    const dir = cwdRef.current;
    if (dir) fetchGitInfo(dir);
  }, [fetchGitInfo]);

  const refreshGitInfoRef = useRef(refreshGitInfo);
  refreshGitInfoRef.current = refreshGitInfo;

  useEffect(() => {
    if (!cwd) return;
    const timer = setTimeout(() => fetchGitInfo(cwd), 300);
    return () => clearTimeout(timer);
  }, [cwd, fetchGitInfo]);

  const fetchGitStatus = useCallback(async (dirs: string[]) => {
    if (!window.api?.getGitStatus || dirs.length === 0) return;
    try {
      const results = await Promise.all(dirs.map(d => window.api.getGitStatus(d)));
      const mergedFiles: Record<string, GitFileStatus> = {};
      const mergedStaged: Record<string, GitFileStatus> = {};
      const mergedIgnored: string[] = [];
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
        if (result.ignored) {
          mergedIgnored.push(...result.ignored as string[]);
        }
      }
      setGitStatus(mergedFiles);
      setGitStagedStatus(mergedStaged);
      setGitIgnored(mergedIgnored);
      setGitRepoRoot(primaryRepoRoot);
      setGitRepoRootsMap(rootsMap);
    } catch {
      setGitStatus({});
      setGitStagedStatus({});
      setGitIgnored([]);
      setGitRepoRoot(null);
      setGitRepoRootsMap({});
    }
  }, []);

  useEffect(() => {
    const allRoots = [explorerRoot, ...agentContextDirs.map(d => d.path)].filter(Boolean) as string[];
    if (allRoots.length === 0) {
      setGitStatus({});
      setGitStagedStatus({});
      setGitIgnored([]);
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
        refreshGitInfoRef.current();
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
  const gitStatusRef = useRef(gitStatus);
  gitStatusRef.current = gitStatus;

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

  const reportGitError = useCallback((result: { success: boolean; error: string | null }) => {
    if (!result.success && result.error) setGitError(result.error);
  }, []);

  const stageFiles = useCallback(async (filePaths: string[]) => {
    if (!window.api?.gitStage || filePaths.length === 0) return;
    const repoRoot = getRepoRootForFile(filePaths[0]);
    if (!repoRoot) return;
    reportGitError(await window.api.gitStage(filePaths, repoRoot));
    refreshGitStatus();
  }, [getRepoRootForFile, refreshGitStatus, reportGitError]);

  const unstageFiles = useCallback(async (filePaths: string[]) => {
    if (!window.api?.gitUnstage || filePaths.length === 0) return;
    const repoRoot = getRepoRootForFile(filePaths[0]);
    if (!repoRoot) return;
    reportGitError(await window.api.gitUnstage(filePaths, repoRoot));
    refreshGitStatus();
  }, [getRepoRootForFile, refreshGitStatus, reportGitError]);

  const discardFiles = useCallback(async (filePaths: string[]) => {
    if (!window.api?.gitDiscardChanges || filePaths.length === 0) return;
    const repoRoot = getRepoRootForFile(filePaths[0]);
    if (!repoRoot) return;
    const status = gitStatusRef.current;
    const tracked = filePaths.filter(fp => status[fp] !== 'untracked');
    const untracked = filePaths.filter(fp => status[fp] === 'untracked');
    reportGitError(await window.api.gitDiscardChanges(tracked, untracked, repoRoot));
    refreshGitStatus();
  }, [getRepoRootForFile, refreshGitStatus, reportGitError]);

  const stashChanges = useCallback(async (repoRoot: string, message?: string, includeUntracked?: boolean) => {
    if (!window.api?.gitStash) return;
    reportGitError(await window.api.gitStash(repoRoot, message, includeUntracked));
    refreshGitStatus();
  }, [refreshGitStatus, reportGitError]);

  const stashPop = useCallback(async (repoRoot: string) => {
    if (!window.api?.gitStashPop) return;
    reportGitError(await window.api.gitStashPop(repoRoot));
    refreshGitStatus();
  }, [refreshGitStatus, reportGitError]);

  const commitStaged = useCallback(async (repoRoot: string, message: string): Promise<boolean> => {
    if (!window.api?.gitCommit) return false;
    const result = await window.api.gitCommit(repoRoot, message);
    reportGitError(result);
    refreshGitStatus();
    return result.success;
  }, [refreshGitStatus, reportGitError]);

  const commitAll = useCallback(async (repoRoot: string, message: string): Promise<boolean> => {
    if (!window.api?.gitCommitAll) return false;
    const result = await window.api.gitCommitAll(repoRoot, message);
    reportGitError(result);
    refreshGitStatus();
    return result.success;
  }, [refreshGitStatus, reportGitError]);

  const undoLastCommit = useCallback(async (repoRoot: string) => {
    if (!window.api?.gitUndoCommit) return;
    reportGitError(await window.api.gitUndoCommit(repoRoot));
    refreshGitStatus();
  }, [refreshGitStatus, reportGitError]);

  const setDiffFilePath = useCallback((path: string | null) => {
    setDiffFilePathState(path);
    if (path) {
      const gid = activeGroupIdRef.current;
      if (!gid) return;
      setOpenFileTabsMap(prev => {
        const entry = prev[gid] ?? { files: [], activeFile: null };
        const files = entry.files.includes(path) ? entry.files : [...entry.files, path];
        return { ...prev, [gid]: { files, activeFile: path } };
      });
    }
  }, []);

  // ── Session serialization helpers ─────────────────────────────────────────

  const serializeGroups = useCallback((): PersistedGroup[] => {
    return groupsRef.current.map(g => {
      const focusedIndex = Math.max(0, g.panes.findIndex(p => p.id === g.focusedPaneId));
      return {
        customLabel: g.customLabel,
        icon: g.autoIcon ? undefined : g.icon,
        iconColor: g.autoIconColor ? undefined : g.iconColor,
        panes: g.panes.map(p => ({ cwd: p.cwd })),
        focusedPaneIndex: focusedIndex,
        splitPcts: g.splitPcts,
        explorerRoot: explorerRoots[g.id] ?? null,
        panelVisibility: panelVisibilityMapRef.current[g.id],
        panelLayout: panelLayoutMapRef.current[g.id],
      };
    });
  }, [explorerRoots]);

  const buildSessionPayload = useCallback((): PersistedSession => {
    const gs = groupsRef.current;
    const activeIndex = Math.max(0, gs.findIndex(g => g.id === activeGroupIdRef.current));
    return {
      savedAt: new Date().toISOString(),
      groups: serializeGroups(),
      activeGroupIndex: activeIndex,
    };
  }, [serializeGroups]);

  // Debounced session auto-save
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSessionSave = useCallback(() => {
    if (!window.api?.saveSession) return;
    if (sessionSaveTimerRef.current !== null) clearTimeout(sessionSaveTimerRef.current);
    sessionSaveTimerRef.current = setTimeout(() => {
      sessionSaveTimerRef.current = null;
      if (groupsRef.current.length === 0) return;
      window.api.saveSession(buildSessionPayload());
    }, 500);
  }, [buildSessionPayload]);

  // Save on every structural change
  useEffect(() => {
    scheduleSessionSave();
  }, [groups, explorerRoots, panelVisibilityMap, panelLayoutMap, activeGroupId, scheduleSessionSave]);

  // Internal: restore a list of persisted groups as new tabs (replaces all current groups)
  const restorePersistedGroups = useCallback(async (persistedGroups: PersistedGroup[], activeGroupIndex: number) => {
    if (!window.api?.createTerminal) return;
    const shell = settingsRef.current.shellOverride || undefined;

    const newGroups: TerminalGroup[] = [];
    const newExplorerRoots: Record<string, string | null> = {};
    const newPanelVisMap: Record<string, PanelVisibility> = {};
    const newPanelLayoutMap: Record<string, PanelId[][]> = {};

    for (const pg of persistedGroups) {
      try {
        const newPanes: TerminalPane[] = [];
        for (const pp of pg.panes) {
          const { id: paneId } = await window.api.createTerminal({ cwd: pp.cwd || undefined, shell, cols: 80, rows: 24 });
          newPanes.push({ id: paneId, cwd: pp.cwd });
        }
        if (newPanes.length === 0) continue;

        groupTabCounter++;
        const gid = newGroupId();
        const focusedPaneId = newPanes[Math.min(pg.focusedPaneIndex ?? 0, newPanes.length - 1)].id;
        newGroups.push({
          id: gid,
          label: `Terminal ${groupTabCounter}`,
          customLabel: pg.customLabel,
          icon: pg.icon,
          iconColor: pg.iconColor,
          panes: newPanes,
          focusedPaneId,
          splitPcts: pg.splitPcts?.length === newPanes.length ? pg.splitPcts : equalSplitPcts(newPanes.length),
        });

        if (pg.explorerRoot != null) newExplorerRoots[gid] = pg.explorerRoot;
        if (pg.panelVisibility) newPanelVisMap[gid] = pg.panelVisibility;
        if (pg.panelLayout) newPanelLayoutMap[gid] = pg.panelLayout;
      } catch (err) {
        console.error('Failed to restore group:', err);
      }
    }

    if (newGroups.length === 0) return;

    setGroups(newGroups);
    setExplorerRoots(prev => ({ ...prev, ...newExplorerRoots }));
    setPanelVisibilityMap(prev => ({ ...prev, ...newPanelVisMap }));
    setPanelLayoutMap(prev => ({ ...prev, ...newPanelLayoutMap }));
    const activeId = newGroups[Math.min(activeGroupIndex, newGroups.length - 1)]?.id ?? newGroups[0].id;
    setActiveGroupId(activeId);
  }, []);

  // ── Named workspaces ──────────────────────────────────────────────────────

  const saveWorkspace = useCallback(async (name: string): Promise<string | null> => {
    if (!window.api?.saveWorkspace) return null;
    const workspace: SavedWorkspace = {
      version: 1,
      name,
      createdAt: new Date().toISOString(),
      groups: serializeGroups(),
      activeGroupIndex: Math.max(0, groupsRef.current.findIndex(g => g.id === activeGroupIdRef.current)),
    };
    const { filename } = await window.api.saveWorkspace(workspace);
    return filename;
  }, [serializeGroups]);

  const loadWorkspace = useCallback(async (filename: string) => {
    if (!window.api?.loadWorkspace) return;
    const workspace: SavedWorkspace | null = await window.api.loadWorkspace(filename);
    if (!workspace || !Array.isArray(workspace.groups)) return;
    // Destroy all current PTYs before replacing
    for (const g of groupsRef.current) {
      for (const p of g.panes) {
        try { window.api?.destroyTerminal(p.id); } catch {}
      }
    }
    setGroups([]);
    setExplorerRoots({});
    setOpenFileTabsMap({});
    setPanelVisibilityMap({});
    setPanelLayoutMap({});
    setActiveGroupId(null);
    await restorePersistedGroups(workspace.groups, workspace.activeGroupIndex);
    setActiveWorkspaceName(workspace.name);
    // Tell main process which workspace this window has loaded (for dock menu focus behavior)
    window.api?.setActiveWorkspace?.(filename);
  }, [restorePersistedGroups]);

  loadWorkspaceRef.current = loadWorkspace;

  const listWorkspaces = useCallback(async (): Promise<SavedWorkspaceMeta[]> => {
    if (!window.api?.listWorkspaces) return [];
    return window.api.listWorkspaces();
  }, []);

  const deleteWorkspace = useCallback(async (filename: string) => {
    if (!window.api?.deleteWorkspace) return;
    await window.api.deleteWorkspace(filename);
  }, []);

  // Listen for dock-menu-triggered workspace loads
  useEffect(() => {
    if (!window.api?.onLoadWorkspace) return;
    return window.api.onLoadWorkspace((filename) => {
      loadWorkspace(filename);
    });
  }, [loadWorkspace]);

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
    const vis = preset === 'custom'
      ? { ...(settingsRef.current.customPanelVisibility ?? ALL_VISIBLE) }
      : { ...ALL_VISIBLE };
    initialPanelVisibilityRef.current = vis;
    setPanelVisibilityMap(prev => {
      const next: Record<string, PanelVisibility> = {};
      for (const gid of Object.keys(prev)) {
        next[gid] = { ...vis };
      }
      return next;
    });
    setPanelLayoutMap({});
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
    const gid = activeGroupIdRef.current;
    if (!gid) return;
    const normalized = normalizePanelLayout(newLayout);
    setLayoutState('custom');
    if (settingsRef.current.syncLayoutAcrossTabs) {
      setPanelLayoutMap(prev => {
        const next: Record<string, PanelId[][]> = {};
        for (const g of Object.keys(prev)) {
          next[g] = normalized.map(r => [...r]);
        }
        return next;
      });
    } else {
      setPanelLayoutMap(prev => ({ ...prev, [gid]: normalized }));
    }
    setSettings(prev => {
      const next: AppSettings = {
        ...prev,
        panelLayout: normalized,
        savedCustomLayout: normalized.map(r => [...r]),
        customPanelVisibility: { ...panelVisibilityRef.current },
      };
      window.api?.saveSettings(next);
      return next;
    });
  }, []);

  const setPanelVisibility = useCallback((panel: 'explorer' | 'editor' | 'terminal', visible: boolean) => {
    const gid = activeGroupIdRef.current;
    if (!gid) return;
    const current = panelVisibilityMapRef.current[gid] ?? { ...initialPanelVisibilityRef.current };
    const next = { ...current, [panel]: visible };
    if (settingsRef.current.syncLayoutAcrossTabs) {
      setPanelVisibilityMap(prev => {
        const updated: Record<string, PanelVisibility> = {};
        for (const g of Object.keys(prev)) {
          updated[g] = { ...next };
        }
        return updated;
      });
    } else {
      setPanelVisibilityMap(prev => ({ ...prev, [gid]: next }));
    }
    setLayoutState('custom');
    setSettings(prev => {
      const updated = { ...prev, customPanelVisibility: { ...next } };
      window.api?.saveSettings(updated);
      return updated;
    });
  }, []);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    let newVis: PanelVisibility | null = null;
    setSettings(prev => {
      let next: AppSettings = { ...prev, ...partial };
      if (partial.defaultLayout != null) {
        const presetLayout = PRESET_LAYOUTS[partial.defaultLayout];
        if (presetLayout) {
          next = { ...next, panelLayout: presetLayout.map(r => [...r]) };
          newVis = { ...ALL_VISIBLE };
        } else if (partial.defaultLayout === 'custom') {
          if (prev.savedCustomLayout) {
            next = { ...next, panelLayout: prev.savedCustomLayout.map(r => [...r]) };
          } else {
            const initial = MY_LAYOUT_DEFAULT.map(r => [...r]);
            const defaultVis: PanelVisibility = { explorer: true, editor: false, terminal: true };
            next = { ...next, panelLayout: initial, savedCustomLayout: initial.map(r => [...r]), customPanelVisibility: defaultVis };
          }
          const savedVis = next.customPanelVisibility;
          newVis = savedVis ? { ...savedVis } : { ...ALL_VISIBLE };
        } else {
          newVis = { ...ALL_VISIBLE };
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
    if (newVis) {
      initialPanelVisibilityRef.current = newVis;
      const vis: PanelVisibility = newVis;
      setPanelVisibilityMap(prev => {
        const next: Record<string, PanelVisibility> = {};
        for (const gid of Object.keys(prev)) {
          next[gid] = { ...vis };
        }
        return next;
      });
      setPanelLayoutMap({});
    }
  }, []);

  const uiValue = useMemo<UIContextValue>(() => ({
    theme,
    setThemeId,
    layout,
    setLayout,
    panelLayout,
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
    gitError,
    clearGitError: () => setGitError(null),
    gitErrorViewContent,
    setGitErrorViewContent,
    errorViewTitle,
    setErrorViewTitle,
  }), [theme, layout, panelLayout, settings, settingsOpen, homeDir, openFilePath, openFiles, settingsLoaded, panelVisibility, diffFilePath, gitError, gitErrorViewContent, errorViewTitle,
       setThemeId, setLayout, setPanelLayout, updateSettings, setPanelVisibility, setOpenFilePath, closeFileTab, closeOtherFileTabs, closeAllFileTabs, setActiveFileTab, reorderFileTabs, setDiffFilePath]);

  const sessionValue = useMemo<SessionContextValue>(() => ({
    cwd,
    groups,
    activeGroupId,
    activeGroup,
    focusedPaneId,
    setActiveGroup,
    setFocusedPane,
    createGroup,
    createGroupAtPath,
    duplicateGroup,
    destroyGroup,
    splitPane,
    closePane,
    updatePaneCwd,
    renameGroup,
    updateGroupAppearance,
    reorderGroups,
    recentlyClosedGroups,
    restoreLastClosedGroup,
    explorerRoot,
    setExplorerRoot,
    explorerOutOfSync,
    gitInfo,
    gitStatus,
    gitStagedStatus,
    gitIgnored,
    gitRepoRoot,
    getRepoRootForFile,
    refreshGitStatus,
    stageFiles,
    unstageFiles,
    discardFiles,
    stashChanges,
    stashPop,
    commitStaged,
    commitAll,
    undoLastCommit,
    agentContextDirs,
    exitSplit,
    updateGroupSplitPcts,
    activeWorkspaceName,
    saveWorkspace,
    loadWorkspace,
    listWorkspaces,
    deleteWorkspace,
  }), [cwd, groups, activeGroupId, activeGroup, focusedPaneId, explorerRoot, explorerOutOfSync, gitInfo, gitStatus, gitStagedStatus, gitIgnored, gitRepoRoot, agentContextDirs, recentlyClosedGroups, activeWorkspaceName,
       setActiveGroup, setFocusedPane, createGroup, createGroupAtPath, duplicateGroup, destroyGroup, splitPane, closePane, exitSplit, updateGroupSplitPcts, updatePaneCwd, renameGroup, updateGroupAppearance, reorderGroups, restoreLastClosedGroup, setExplorerRoot, refreshGitStatus, stageFiles, unstageFiles, discardFiles, stashChanges, stashPop, commitStaged, commitAll, undoLastCommit, getRepoRootForFile, saveWorkspace, loadWorkspace, listWorkspaces, deleteWorkspace]);

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
