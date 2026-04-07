import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { VscFolderOpened } from 'react-icons/vsc';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { FileIcon } from './FileIcon';
import { IconButton, PanelMinimizeButton } from './IconButton';
import { shortenPath } from '../utils';
import type { DirEntry, GitFileStatus } from '../types';

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
  collapseKey: number;
  gitStatus: Record<string, GitFileStatus>;
}

function TreeNode({ entry, depth, onFileClick, collapseKey, gitStatus }: TreeNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setIsOpen(false);
  }, [collapseKey]);

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

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${!entry.isDirectory ? 'tree-row-file' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={toggleOpen}
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
              collapseKey={collapseKey}
              gitStatus={gitStatus}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ChangesListProps {
  gitStatus: Record<string, GitFileStatus>;
  explorerRoot: string;
  onFileClick: (path: string) => void;
}

function ChangesList({ gitStatus, explorerRoot, onFileClick }: ChangesListProps) {
  const [isOpen, setIsOpen] = useState(true);

  const changedFiles = useMemo(() => {
    const entries = Object.entries(gitStatus).sort(([, a], [, b]) => {
      const order: Record<string, number> = { conflict: 0, modified: 1, added: 2, renamed: 3, untracked: 4, deleted: 5 };
      return (order[a] ?? 99) - (order[b] ?? 99);
    });
    return entries;
  }, [gitStatus]);

  if (changedFiles.length === 0) return null;

  return (
    <div className="explorer-changes">
      <div className="explorer-changes-header" onClick={() => setIsOpen(prev => !prev)}>
        <span className="explorer-changes-chevron">{isOpen ? '▾' : '▸'}</span>
        <span className="explorer-changes-title">Changes</span>
        <span className="explorer-changes-count">{changedFiles.length}</span>
      </div>
      {isOpen && (
        <div className="explorer-changes-list">
          {changedFiles.map(([filePath, status]) => {
            const name = filePath.split('/').pop() || filePath;
            const relativePath = filePath.startsWith(explorerRoot)
              ? filePath.slice(explorerRoot.length + 1)
              : filePath;
            const dir = relativePath.includes('/')
              ? relativePath.slice(0, relativePath.lastIndexOf('/'))
              : '';
            const color = STATUS_COLOR_VAR[status];
            return (
              <div
                key={filePath}
                className="explorer-change-item"
                onClick={() => onFileClick(filePath)}
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
      )}
    </div>
  );
}

interface TreeCache {
  root: string;
  entries: DirEntry[];
}

export function Explorer() {
  const { homeDir, setOpenFilePath, setPanelVisibility, setDiffFilePath } = useUIContext();
  const {
    cwd,
    explorerRoot,
    setExplorerRoot,
    explorerOutOfSync,
    activeSessionId,
    updateSessionCwd,
    gitStatus,
    refreshGitStatus,
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

  const displayRoot = explorerRoot ? shortenPath(explorerRoot, homeDir) : '';

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
            onClick={(e) => { e.stopPropagation(); setCollapseKey(k => k + 1); }}
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
      <div className="panel-body explorer-tree">
        {loading ? (
          <div className="explorer-loading">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="explorer-empty">Empty directory</div>
        ) : (
          entries.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              onFileClick={handleFileClick}
              collapseKey={collapseKey}
              gitStatus={gitStatus}
            />
          ))
        )}
        {explorerRoot && Object.keys(gitStatus).length > 0 && (
          <ChangesList
            gitStatus={gitStatus}
            explorerRoot={explorerRoot}
            onFileClick={handleChangeFileClick}
          />
        )}
      </div>
    </div>
  );
}
