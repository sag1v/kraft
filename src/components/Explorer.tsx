import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { VscFolderOpened } from 'react-icons/vsc';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { FileIcon } from './FileIcon';
import { IconButton, PanelMinimizeButton } from './IconButton';
import { shortenPath, normPath, isPathWithinRoot } from '../utils';
import type { DirEntry, GitFileStatus, AgentContextDir } from '../types';

const STATUS_COLOR_VAR: Record<string, string> = {
  modified: 'var(--git-modified)',
  added: 'var(--git-added)',
  deleted: 'var(--git-deleted)',
  untracked: 'var(--git-untracked)',
  renamed: 'var(--git-modified)',
  conflict: 'var(--git-conflict)',
};

const STATUS_LABEL: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  untracked: 'U',
  renamed: 'R',
  conflict: '!',
};

function getFolderStatus(
  folderPath: string,
  gitStatus: Record<string, GitFileStatus>,
): GitFileStatus | null {
  const prefix = folderPath.endsWith('/') ? folderPath : folderPath + '/';
  const priorities: GitFileStatus[] = ['conflict', 'modified', 'added', 'untracked', 'renamed', 'deleted'];
  const found = new Set<GitFileStatus>();

  for (const [filePath, status] of Object.entries(gitStatus)) {
    if (filePath.startsWith(prefix)) {
      found.add(status);
    }
  }

  for (const p of priorities) {
    if (found.has(p)) return p;
  }
  return null;
}

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  collapseKey: number;
  gitStatus: Record<string, GitFileStatus>;
  syncedRevealFile: string | null;
  revealGeneration: number;
}

function TreeNode({ entry, depth, onFileClick, onFileDoubleClick, collapseKey, gitStatus, syncedRevealFile, revealGeneration }: TreeNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsOpen(false);
  }, [collapseKey]);

  useEffect(() => {
    if (!entry.isDirectory || !syncedRevealFile) return;
    const d = normPath(entry.path);
    const t = normPath(syncedRevealFile);
    if (t === d || !t.startsWith(d + '/')) return;
    setIsOpen(true);
    if (children !== null) return;
    let cancelled = false;
    setLoading(true);
    window.api.readDirectory(entry.path)
      .then((list) => {
        if (!cancelled) setChildren(list);
      })
      .catch(() => {
        if (!cancelled) setChildren([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.isDirectory, entry.path, syncedRevealFile, revealGeneration, children]);

  useEffect(() => {
    if (entry.isDirectory || !syncedRevealFile) return;
    if (normPath(syncedRevealFile) !== normPath(entry.path)) return;
    const id = requestAnimationFrame(() => {
      fileRowRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [entry.isDirectory, entry.path, syncedRevealFile, revealGeneration]);

  const toggleOpen = useCallback(async () => {
    if (!entry.isDirectory) {
      onFileClick(entry.path);
      return;
    }

    if (!isOpen && children === null) {
      setLoading(true);
      try {
        const entries = await window.api.readDirectory(entry.path);
        setChildren(entries);
      } catch {
        setChildren([]);
      }
      setLoading(false);
    }
    setIsOpen((prev) => !prev);
  }, [entry, isOpen, children, onFileClick]);

  const fileStatus = entry.isDirectory
    ? getFolderStatus(entry.path, gitStatus)
    : (gitStatus[entry.path] as GitFileStatus | undefined) ?? null;

  const nameColor = fileStatus ? STATUS_COLOR_VAR[fileStatus] : undefined;
  const isExplorerActive = !entry.isDirectory && syncedRevealFile && normPath(syncedRevealFile) === normPath(entry.path);

  return (
    <div className="tree-node">
      <div
        ref={entry.isDirectory ? undefined : fileRowRef}
        className={`tree-row ${!entry.isDirectory ? 'tree-row-file' : ''} ${isExplorerActive ? 'tree-row-explorer-active' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={toggleOpen}
        onDoubleClick={!entry.isDirectory ? (e) => { e.stopPropagation(); onFileDoubleClick(); } : undefined}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData('application/x-kraft-file-path', entry.path);
          e.dataTransfer.effectAllowed = 'copy';
        }}
      >
        <FileIcon name={entry.name} isDirectory={entry.isDirectory} isOpen={isOpen} />
        <span className="tree-name" style={nameColor ? { color: nameColor } : undefined}>
          {entry.name}
        </span>
        {fileStatus && !entry.isDirectory && (
          <span className="tree-git-badge" style={{ color: nameColor }}>
            {STATUS_LABEL[fileStatus]}
          </span>
        )}
        {loading && <span className="tree-loading">...</span>}
      </div>
      {isOpen && children && (
        <div className="tree-children">
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onFileClick={onFileClick}
              onFileDoubleClick={onFileDoubleClick}
              collapseKey={collapseKey}
              gitStatus={gitStatus}
              syncedRevealFile={syncedRevealFile}
              revealGeneration={revealGeneration}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const CHANGES_HEADER_HEIGHT = 28;
const CHANGES_MIN_HEIGHT = CHANGES_HEADER_HEIGHT;
const CHANGES_DEFAULT_HEIGHT = 180;

interface ChangesListProps {
  gitStatus: Record<string, GitFileStatus>;
  allRoots: string[];
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
}

interface ChangesGroupProps {
  rootPath: string;
  rootName: string;
  files: [string, GitFileStatus][];
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  showRootHeader: boolean;
}

function ChangesGroup({ rootPath, rootName, files, onFileClick, onFileDoubleClick, showRootHeader }: ChangesGroupProps) {
  const [groupOpen, setGroupOpen] = useState(true);

  if (files.length === 0) return null;

  const prefix = rootPath.endsWith('/') ? rootPath : rootPath + '/';

  return (
    <div className="explorer-changes-group">
      {showRootHeader && (
        <div className="explorer-changes-group-header" onClick={() => setGroupOpen(prev => !prev)}>
          <span className="explorer-changes-chevron">{groupOpen ? '▾' : '▸'}</span>
          <span className="explorer-changes-group-name">{rootName}</span>
          <span className="explorer-changes-count">{files.length}</span>
        </div>
      )}
      {groupOpen && files.map(([filePath, status]) => {
        const name = filePath.split('/').pop() || filePath;
        const relativePath = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
        const dir = relativePath.includes('/')
          ? relativePath.slice(0, relativePath.lastIndexOf('/'))
          : '';
        const color = STATUS_COLOR_VAR[status];
        return (
          <div
            key={filePath}
            className="explorer-change-item"
            onClick={() => onFileClick(filePath)}
            onDoubleClick={(e) => { e.stopPropagation(); onFileDoubleClick(); }}
            data-tooltip={relativePath}
            data-tooltip-pos="bottom"
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.setData('application/x-kraft-file-path', filePath);
              e.dataTransfer.effectAllowed = 'copy';
            }}
          >
            <FileIcon name={name} isDirectory={false} />
            <span className="explorer-change-name" style={{ color }}>{name}</span>
            {dir && <span className="explorer-change-dir">{dir}</span>}
            <span className="explorer-change-badge" style={{ color }}>
              {STATUS_LABEL[status]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ChangesList({ gitStatus, allRoots, onFileClick, onFileDoubleClick }: ChangesListProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [height, setHeight] = useState(CHANGES_DEFAULT_HEIGHT);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heightBeforeCollapseRef = useRef(CHANGES_DEFAULT_HEIGHT);

  const groupedChanges = useMemo(() => {
    const statusOrder: Record<string, number> = { conflict: 0, modified: 1, added: 2, renamed: 3, untracked: 4, deleted: 5 };
    const sortFiles = (entries: [string, GitFileStatus][]) =>
      entries.sort(([, a], [, b]) => (statusOrder[a] ?? 99) - (statusOrder[b] ?? 99));

    const groups: { rootPath: string; rootName: string; files: [string, GitFileStatus][] }[] = [];
    const assigned = new Set<string>();

    for (const root of allRoots) {
      const prefix = root.endsWith('/') ? root : root + '/';
      const rootName = root.split('/').pop() || root;
      const files: [string, GitFileStatus][] = [];
      for (const [filePath, status] of Object.entries(gitStatus)) {
        if (filePath.startsWith(prefix)) {
          files.push([filePath, status]);
          assigned.add(filePath);
        }
      }
      if (files.length > 0) {
        groups.push({ rootPath: root, rootName, files: sortFiles(files) });
      }
    }

    const unmatched: [string, GitFileStatus][] = [];
    for (const [filePath, status] of Object.entries(gitStatus)) {
      if (!assigned.has(filePath)) {
        unmatched.push([filePath, status]);
      }
    }
    if (unmatched.length > 0) {
      groups.push({ rootPath: '', rootName: 'Other', files: sortFiles(unmatched) });
    }

    return groups;
  }, [gitStatus, allRoots]);

  const totalCount = useMemo(
    () => groupedChanges.reduce((sum, g) => sum + g.files.length, 0),
    [groupedChanges],
  );

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startY: e.clientY, startHeight: height };
    let lastHeight = height;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      const newHeight = Math.max(CHANGES_MIN_HEIGHT, dragRef.current.startHeight + delta);
      lastHeight = newHeight;
      setHeight(newHeight);
      setIsOpen(newHeight > CHANGES_MIN_HEIGHT + 4);
    };

    const onMouseUp = () => {
      if (lastHeight > CHANGES_MIN_HEIGHT + 4) {
        heightBeforeCollapseRef.current = lastHeight;
      }
      dragRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [height]);

  const toggleOpen = useCallback(() => {
    if (isOpen) {
      heightBeforeCollapseRef.current = height;
      setHeight(CHANGES_MIN_HEIGHT);
      setIsOpen(false);
    } else {
      setHeight(heightBeforeCollapseRef.current);
      setIsOpen(true);
    }
  }, [isOpen, height]);

  if (totalCount === 0) return null;

  const showRootHeaders = groupedChanges.length > 1;

  return (
    <div
      ref={containerRef}
      className="explorer-changes"
      style={{ height: isOpen ? height : CHANGES_MIN_HEIGHT, minHeight: CHANGES_MIN_HEIGHT }}
    >
      <div className="explorer-changes-resize-handle" onMouseDown={onResizeStart} />
      <div className="explorer-changes-header" onClick={toggleOpen}>
        <span className="explorer-changes-chevron">{isOpen ? '▾' : '▸'}</span>
        <span className="explorer-changes-title">Changes</span>
        <span className="explorer-changes-count">{totalCount}</span>
      </div>
      {isOpen && (
        <div className="explorer-changes-list">
          {groupedChanges.map((group) => (
            <ChangesGroup
              key={group.rootPath || '__other'}
              rootPath={group.rootPath}
              rootName={group.rootName}
              files={group.files}
              onFileClick={onFileClick}
              onFileDoubleClick={onFileDoubleClick}
              showRootHeader={showRootHeaders}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ContextDirSectionProps {
  dir: AgentContextDir;
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  collapseKey: number;
  gitStatus: Record<string, GitFileStatus>;
  syncedRevealFile: string | null;
  revealGeneration: number;
}

function ContextDirSection({ dir, onFileClick, onFileDoubleClick, collapseKey, gitStatus, syncedRevealFile, revealGeneration }: ContextDirSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || entries !== null) return;
    setLoading(true);
    window.api.readDirectory(dir.path)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [isOpen, entries, dir.path]);

  useEffect(() => {
    setIsOpen(false);
  }, [collapseKey]);

  useEffect(() => {
    if (!syncedRevealFile) return;
    if (!isPathWithinRoot(syncedRevealFile, dir.path)) return;
    setIsOpen(true);
  }, [syncedRevealFile, revealGeneration, dir.path]);

  const folderStatus = getFolderStatus(dir.path, gitStatus);
  const nameColor = folderStatus ? STATUS_COLOR_VAR[folderStatus] : undefined;

  return (
    <div className="explorer-context-dir">
      <div
        className="explorer-context-dir-header"
        onClick={() => setIsOpen(prev => !prev)}
        data-tooltip={dir.path}
        data-tooltip-pos="bottom"
      >
        <FileIcon name={dir.name} isDirectory isOpen={isOpen} />
        <span className="explorer-context-dir-name" style={nameColor ? { color: nameColor } : undefined}>
          {dir.name}
        </span>
        <span className="explorer-context-dir-badge">context</span>
        {loading && <span className="tree-loading">...</span>}
      </div>
      {isOpen && entries && (
        <div className="tree-children">
          {entries.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={1}
              onFileClick={onFileClick}
              onFileDoubleClick={onFileDoubleClick}
              collapseKey={collapseKey}
              gitStatus={gitStatus}
              syncedRevealFile={syncedRevealFile}
              revealGeneration={revealGeneration}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TreeCache {
  root: string;
  entries: DirEntry[];
}

export function Explorer() {
  const { homeDir, setOpenFilePath, setPanelVisibility, setDiffFilePath, openFilePath } = useUIContext();
  const {
    cwd,
    explorerRoot,
    setExplorerRoot,
    explorerOutOfSync,
    activeSessionId,
    updateSessionCwd,
    gitStatus,
    refreshGitStatus,
    agentContextDirs,
  } = useSessionContext();

  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapseKey, setCollapseKey] = useState(0);
  const loadedRootRef = useRef<string | null>(null);
  const treeCacheRef = useRef<Map<string, TreeCache>>(new Map());
  const prevSessionIdRef = useRef<string | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    if (!activeSessionId) return;
    if (prevSessionIdRef.current === activeSessionId) return;

    if (prevSessionIdRef.current && loadedRootRef.current) {
      treeCacheRef.current.set(prevSessionIdRef.current, {
        root: loadedRootRef.current,
        entries: entriesRef.current,
      });
    }

    prevSessionIdRef.current = activeSessionId;

    const cached = treeCacheRef.current.get(activeSessionId);
    if (cached) {
      loadedRootRef.current = cached.root;
      setEntries(cached.entries);
    } else {
      loadedRootRef.current = null;
      setEntries([]);
    }
  }, [activeSessionId]);

  const loadFolder = useCallback(async (dirPath: string, forceRefresh = false) => {
    if (!window.api?.readDirectory || !activeSessionId) return;

    setExplorerRoot(dirPath);
    loadedRootRef.current = dirPath;
    if (!forceRefresh || entriesRef.current.length === 0) {
      setLoading(true);
    }
    try {
      const result = await window.api.readDirectory(dirPath, forceRefresh);
      if (loadedRootRef.current === dirPath) {
        setEntries(result);
        treeCacheRef.current.set(activeSessionId, { root: dirPath, entries: result });
      }
    } catch {
      if (loadedRootRef.current === dirPath) {
        setEntries([]);
      }
    }
    if (loadedRootRef.current === dirPath) {
      setLoading(false);
    }
  }, [setExplorerRoot, activeSessionId]);

  useEffect(() => {
    if (!explorerRoot || !window.api?.watchDirectory || !window.api?.onDirectoryChanged) return;

    window.api.watchDirectory(explorerRoot);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = window.api.onDirectoryChanged(() => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        loadFolder(explorerRoot, true);
        refreshGitStatus();
      }, 300);
    });

    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      window.api.unwatchDirectory(explorerRoot);
      unsubscribe();
    };
  }, [explorerRoot, loadFolder, refreshGitStatus]);

  useEffect(() => {
    if (agentContextDirs.length === 0 || !window.api?.watchDirectory) return;

    const dirs = agentContextDirs.map(d => d.path);
    for (const dir of dirs) {
      window.api.watchDirectory(dir);
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = window.api.onDirectoryChanged(() => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        refreshGitStatus();
      }, 300);
    });

    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      for (const dir of dirs) {
        window.api.unwatchDirectory(dir);
      }
      unsubscribe();
    };
  }, [agentContextDirs, refreshGitStatus]);

  const handleLoadCwd = useCallback(async () => {
    let dir = cwd;
    if (activeSessionId && window.api?.getTerminalCwd) {
      try {
        const liveCwd = await window.api.getTerminalCwd(activeSessionId);
        if (liveCwd) {
          dir = liveCwd;
          updateSessionCwd(activeSessionId, liveCwd);
        }
      } catch {
        // fall back to context cwd
      }
    }
    if (dir) loadFolder(dir);
  }, [cwd, activeSessionId, updateSessionCwd, loadFolder]);

  const handleRefresh = useCallback(() => {
    if (explorerRoot) {
      loadFolder(explorerRoot, true);
      refreshGitStatus();
    }
  }, [explorerRoot, loadFolder, refreshGitStatus]);

  const handleFileClick = useCallback(
    (path: string) => {
      setDiffFilePath(null);
      setOpenFilePath(path);
    },
    [setOpenFilePath, setDiffFilePath]
  );

  const handleChangeFileClick = useCallback(
    (path: string) => {
      setDiffFilePath(path);
    },
    [setDiffFilePath]
  );

  const showViewerPanel = useCallback(() => {
    setPanelVisibility('viewer', true);
  }, [setPanelVisibility]);

  const [rootOpen, setRootOpen] = useState(true);
  const [revealGeneration, setRevealGeneration] = useState(0);

  const agentContextPathsKey = useMemo(
    () => agentContextDirs.map(d => d.path).join('\0'),
    [agentContextDirs],
  );

  const syncedRevealFile = useMemo(() => {
    if (explorerOutOfSync || !openFilePath) return null;
    if (explorerRoot && isPathWithinRoot(openFilePath, explorerRoot)) return openFilePath;
    for (const d of agentContextDirs) {
      if (isPathWithinRoot(openFilePath, d.path)) return openFilePath;
    }
    return null;
  }, [explorerOutOfSync, openFilePath, explorerRoot, agentContextPathsKey]);

  useEffect(() => {
    if (!syncedRevealFile) return;
    if (explorerRoot && isPathWithinRoot(syncedRevealFile, explorerRoot)) {
      setRootOpen(true);
    }
    setRevealGeneration((g) => g + 1);
  }, [syncedRevealFile, openFilePath, explorerRoot, explorerOutOfSync, agentContextPathsKey]);

  useEffect(() => {
    setRootOpen(true);
  }, [explorerRoot]);

  const displayRoot = explorerRoot ? shortenPath(explorerRoot, homeDir) : '';
  const allRoots = useMemo(() => {
    const roots = explorerRoot ? [explorerRoot] : [];
    return roots.concat(agentContextDirs.map(d => d.path));
  }, [explorerRoot, agentContextDirs]);

  if (!explorerRoot) {
    return (
      <div className="panel explorer-panel">
        <div className="panel-header">
          <span className="panel-title panel-icon explorer-icon" data-tooltip="Explorer - drag to reorder" data-tooltip-pos="bottom"><VscFolderOpened size={16} /></span>
          <PanelMinimizeButton onMinimize={() => setPanelVisibility('explorer', false)} />
        </div>
        <div className="panel-body explorer-tree">
          <div className="explorer-prompt">
            <div className="explorer-prompt-text">
              No folder loaded
            </div>
            <button className="explorer-load-btn" onClick={handleLoadCwd} data-tooltip="Load terminal's current directory" data-tooltip-pos="bottom">
              Load current folder
            </button>
            <div className="explorer-prompt-path" data-tooltip={cwd} data-tooltip-pos="bottom">
              {shortenPath(cwd, homeDir)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const rootFolderName = explorerRoot.split('/').pop() || explorerRoot;
  const rootFolderStatus = getFolderStatus(explorerRoot, gitStatus);
  const rootNameColor = rootFolderStatus ? STATUS_COLOR_VAR[rootFolderStatus] : undefined;

  return (
    <div className="panel explorer-panel">
      <div className="panel-header">
        <span className="panel-title panel-icon explorer-icon" data-tooltip={`${displayRoot} - drag to reorder`} data-tooltip-pos="bottom"><VscFolderOpened size={16} /></span>
        <div className="explorer-actions">
          {explorerOutOfSync && (
            <IconButton
              className="explorer-action-btn explorer-sync-btn"
              tooltip="Sync to terminal directory"
              tooltipPos="bottom"
              onClick={handleLoadCwd}
            >
              ↻
            </IconButton>
          )}
          <IconButton
            className="explorer-action-btn"
            tooltip="Collapse all folders"
            tooltipPos="bottom"
            onClick={(e) => { e.stopPropagation(); setRootOpen(false); setCollapseKey(k => k + 1); }}
          >
            ⊟
          </IconButton>
          <IconButton
            className="explorer-action-btn"
            tooltip="Refresh file tree"
            tooltipPos="bottom"
            onClick={handleRefresh}
          >
            ⟳
          </IconButton>
          <PanelMinimizeButton onMinimize={() => setPanelVisibility('explorer', false)} />
        </div>
      </div>
      {explorerOutOfSync && (
        <div className="explorer-sync-bar" onClick={handleLoadCwd}>
          <span>Terminal moved to </span>
          <span className="explorer-sync-path">
            {shortenPath(cwd, homeDir)}
          </span>
          <span> - click to follow</span>
        </div>
      )}
      <div className="panel-body explorer-body">
        <div className="explorer-tree">
          <div
            className="explorer-root-label"
            data-tooltip={explorerRoot}
            data-tooltip-pos="bottom"
            onClick={() => setRootOpen(prev => !prev)}
          >
            <FileIcon name={rootFolderName} isDirectory isOpen={rootOpen} />
            <span className="explorer-root-name" style={rootNameColor ? { color: rootNameColor } : undefined}>
              {rootFolderName}
            </span>
          </div>
          {rootOpen && (
            loading ? (
              <div className="explorer-loading">Loading...</div>
            ) : entries.length === 0 ? (
              <div className="explorer-empty">Empty directory</div>
            ) : (
              entries.map((entry) => (
                <TreeNode
                  key={entry.path}
                  entry={entry}
                  depth={1}
                  onFileClick={handleFileClick}
                  onFileDoubleClick={showViewerPanel}
                  collapseKey={collapseKey}
                  gitStatus={gitStatus}
                  syncedRevealFile={syncedRevealFile}
                  revealGeneration={revealGeneration}
                />
              ))
            )
          )}
          {agentContextDirs.map((dir) => (
            <ContextDirSection
              key={dir.path}
              dir={dir}
              onFileClick={handleFileClick}
              onFileDoubleClick={showViewerPanel}
              collapseKey={collapseKey}
              gitStatus={gitStatus}
              syncedRevealFile={syncedRevealFile}
              revealGeneration={revealGeneration}
            />
          ))}
        </div>
        {allRoots.length > 0 && Object.keys(gitStatus).length > 0 && (
          <ChangesList
            gitStatus={gitStatus}
            allRoots={allRoots}
            onFileClick={handleChangeFileClick}
            onFileDoubleClick={showViewerPanel}
          />
        )}
      </div>
    </div>
  );
}
