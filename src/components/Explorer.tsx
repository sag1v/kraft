import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { FileIcon } from './FileIcon';
import { IconButton } from './IconButton';
import type { DirEntry } from '../types';

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  onFileClick: (path: string) => void;
  collapseKey: number;
}

function TreeNode({ entry, depth, onFileClick, collapseKey }: TreeNodeProps) {
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

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${!entry.isDirectory ? 'tree-row-file' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={toggleOpen}
      >
        <FileIcon name={entry.name} isDirectory={entry.isDirectory} isOpen={isOpen} />
        <span className="tree-name">{entry.name}</span>
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
  const { homeDir, setOpenFilePath, setPanelVisibility } = useUIContext();
  const {
    cwd,
    explorerRoot,
    setExplorerRoot,
    explorerOutOfSync,
    activeSessionId,
    updateSessionCwd,
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
    setLoading(true);
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
      }, 300);
    });

    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      window.api.unwatchDirectory(explorerRoot);
      unsubscribe();
    };
  }, [explorerRoot, loadFolder]);

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
    if (explorerRoot) loadFolder(explorerRoot, true);
  }, [explorerRoot, loadFolder]);

  const handleSyncToCwd = useCallback(async () => {
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

  const handleFileClick = useCallback(
    (path: string) => {
      setOpenFilePath(path);
    },
    [setOpenFilePath]
  );

  const displayRoot = explorerRoot
    ? homeDir
      ? explorerRoot.replace(homeDir, '~')
      : explorerRoot
    : '';

  const shortRoot = explorerRoot ? explorerRoot.split('/').pop() || explorerRoot : '';

  if (!explorerRoot) {
    return (
      <div className="panel explorer-panel">
        <div className="panel-header">
          <span className="panel-title">Explorer</span>
          <IconButton
            className="panel-minimize-btn"
            tooltip="Minimize panel"
            onMouseDown={e => e.stopPropagation()}
            onClick={() => setPanelVisibility('explorer', false)}
          >
            &#x2212;
          </IconButton>
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
              {cwd && homeDir ? cwd.replace(homeDir, '~') : cwd}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel explorer-panel">
      <div className="panel-header">
        <span className="panel-title" data-tooltip={displayRoot} data-tooltip-pos="bottom">
          {shortRoot}
        </span>
        <div className="explorer-actions">
          {explorerOutOfSync && (
            <IconButton
              className="explorer-action-btn explorer-sync-btn"
              tooltip="Sync to terminal directory"
              tooltipPos="bottom"
              onClick={handleSyncToCwd}
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
          <IconButton
            className="panel-minimize-btn"
            tooltip="Minimize panel"
            onMouseDown={e => e.stopPropagation()}
            onClick={() => setPanelVisibility('explorer', false)}
          >
            &#x2212;
          </IconButton>
        </div>
      </div>
      {explorerOutOfSync && (
        <div className="explorer-sync-bar" onClick={handleSyncToCwd}>
          <span>Terminal moved to </span>
          <span className="explorer-sync-path">
            {homeDir ? cwd.replace(homeDir, '~') : cwd}
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
            />
          ))
        )}
      </div>
    </div>
  );
}
