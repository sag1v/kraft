import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { VscFolderOpened, VscFiles, VscSourceControl } from 'react-icons/vsc';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { FileIcon } from './FileIcon';
import { IconButton, PanelMinimizeButton } from './IconButton';
import { shortenPath, normPath, isPathWithinRoot } from '../utils';
import type { DirEntry, GitFileStatus, AgentContextDir } from '../types';
import { tooltipWithShortcut } from '../shortcuts';

type ExplorerView = 'files' | 'source-control';

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

/* ── Source Control View: repo-first grouping ── */

interface SourceControlViewProps {
  gitStatus: Record<string, GitFileStatus>;
  gitStagedStatus: Record<string, GitFileStatus>;
  allRoots: string[];
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onStageAll: (repoRoot?: string) => void;
  onUnstageAll: (repoRoot?: string) => void;
}

interface RepoChanges {
  rootPath: string;
  rootName: string;
  staged: [string, GitFileStatus][];
  unstaged: [string, GitFileStatus][];
}

function buildRepoGroups(
  gitStatus: Record<string, GitFileStatus>,
  gitStagedStatus: Record<string, GitFileStatus>,
  allRoots: string[],
): RepoChanges[] {
  const statusOrder: Record<string, number> = { conflict: 0, modified: 1, added: 2, renamed: 3, untracked: 4, deleted: 5 };
  const sortFiles = (entries: [string, GitFileStatus][]) =>
    entries.sort(([, a], [, b]) => (statusOrder[a] ?? 99) - (statusOrder[b] ?? 99));

  const repoMap = new Map<string, RepoChanges>();
  const assignedUnstaged = new Set<string>();
  const assignedStaged = new Set<string>();

  for (const root of allRoots) {
    const prefix = root.endsWith('/') ? root : root + '/';
    const rootName = root.split('/').pop() || root;
    const staged: [string, GitFileStatus][] = [];
    const unstaged: [string, GitFileStatus][] = [];

    for (const [fp, st] of Object.entries(gitStagedStatus)) {
      if (fp.startsWith(prefix)) { staged.push([fp, st]); assignedStaged.add(fp); }
    }
    for (const [fp, st] of Object.entries(gitStatus)) {
      if (fp.startsWith(prefix)) { unstaged.push([fp, st]); assignedUnstaged.add(fp); }
    }

    if (staged.length > 0 || unstaged.length > 0) {
      repoMap.set(root, { rootPath: root, rootName, staged: sortFiles(staged), unstaged: sortFiles(unstaged) });
    }
  }

  const otherStaged: [string, GitFileStatus][] = [];
  const otherUnstaged: [string, GitFileStatus][] = [];
  for (const [fp, st] of Object.entries(gitStagedStatus)) {
    if (!assignedStaged.has(fp)) otherStaged.push([fp, st]);
  }
  for (const [fp, st] of Object.entries(gitStatus)) {
    if (!assignedUnstaged.has(fp)) otherUnstaged.push([fp, st]);
  }
  if (otherStaged.length > 0 || otherUnstaged.length > 0) {
    repoMap.set('__other', { rootPath: '', rootName: 'Other', staged: sortFiles(otherStaged), unstaged: sortFiles(otherUnstaged) });
  }

  return Array.from(repoMap.values());
}

function ChangeFileRow({ filePath, status, rootPrefix, onFileClick, onFileDoubleClick, onAction, actionIcon, actionTooltip }: {
  filePath: string;
  status: GitFileStatus;
  rootPrefix: string;
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  onAction?: (path: string) => void;
  actionIcon?: string;
  actionTooltip?: string;
}) {
  const name = filePath.split('/').pop() || filePath;
  const relativePath = filePath.startsWith(rootPrefix) ? filePath.slice(rootPrefix.length) : filePath;
  const dir = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
  const color = STATUS_COLOR_VAR[status];

  return (
    <div
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
      <span className="explorer-change-badge" style={{ color }}>{STATUS_LABEL[status]}</span>
      {onAction && (
        <button
          className="explorer-change-action"
          data-tooltip={actionTooltip}
          data-tooltip-pos="left"
          onClick={(e) => { e.stopPropagation(); onAction(filePath); }}
        >
          {actionIcon}
        </button>
      )}
    </div>
  );
}

function RepoSection({ repo, onFileClick, onFileDoubleClick, onStageFile, onUnstageFile, onStageAll, onUnstageAll, defaultOpen }: {
  repo: RepoChanges;
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onStageAll: (repoRoot?: string) => void;
  onUnstageAll: (repoRoot?: string) => void;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? true);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const totalCount = repo.staged.length + repo.unstaged.length;
  const prefix = repo.rootPath ? (repo.rootPath.endsWith('/') ? repo.rootPath : repo.rootPath + '/') : '';

  return (
    <div className="sc-repo">
      <div className="sc-repo-header" onClick={() => setIsOpen(prev => !prev)}>
        <span className="explorer-changes-chevron">{isOpen ? '▾' : '▸'}</span>
        <span className="sc-repo-name">{repo.rootName}</span>
        <span className="explorer-changes-count">{totalCount}</span>
      </div>
      {isOpen && (
        <div className="sc-repo-body">
          {repo.staged.length > 0 && (
            <div className="sc-category">
              <div className="sc-category-header" onClick={() => setStagedOpen(prev => !prev)}>
                <span className="explorer-changes-chevron">{stagedOpen ? '▾' : '▸'}</span>
                <span className="sc-category-title">Staged Changes</span>
                <span className="explorer-changes-count">{repo.staged.length}</span>
                <button
                  className="explorer-changes-section-action"
                  data-tooltip="Unstage All"
                  data-tooltip-pos="left"
                  onClick={(e) => { e.stopPropagation(); onUnstageAll(repo.rootPath || undefined); }}
                >
                  −
                </button>
              </div>
              {stagedOpen && repo.staged.map(([fp, st]) => (
                <ChangeFileRow
                  key={fp}
                  filePath={fp}
                  status={st}
                  rootPrefix={prefix}
                  onFileClick={onFileClick}
                  onFileDoubleClick={onFileDoubleClick}
                  onAction={onUnstageFile}
                  actionIcon="−"
                  actionTooltip="Unstage"
                />
              ))}
            </div>
          )}
          {repo.unstaged.length > 0 && (
            <div className="sc-category">
              <div className="sc-category-header" onClick={() => setUnstagedOpen(prev => !prev)}>
                <span className="explorer-changes-chevron">{unstagedOpen ? '▾' : '▸'}</span>
                <span className="sc-category-title">Changes</span>
                <span className="explorer-changes-count">{repo.unstaged.length}</span>
                <button
                  className="explorer-changes-section-action"
                  data-tooltip="Stage All"
                  data-tooltip-pos="left"
                  onClick={(e) => { e.stopPropagation(); onStageAll(repo.rootPath || undefined); }}
                >
                  +
                </button>
              </div>
              {unstagedOpen && repo.unstaged.map(([fp, st]) => (
                <ChangeFileRow
                  key={fp}
                  filePath={fp}
                  status={st}
                  rootPrefix={prefix}
                  onFileClick={onFileClick}
                  onFileDoubleClick={onFileDoubleClick}
                  onAction={onStageFile}
                  actionIcon="+"
                  actionTooltip="Stage"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SourceControlView({ gitStatus, gitStagedStatus, allRoots, onFileClick, onFileDoubleClick, onStageFile, onUnstageFile, onStageAll, onUnstageAll }: SourceControlViewProps) {
  const repos = useMemo(
    () => buildRepoGroups(gitStatus, gitStagedStatus, allRoots),
    [gitStatus, gitStagedStatus, allRoots],
  );

  const totalCount = useMemo(
    () => Object.keys(gitStatus).length + Object.keys(gitStagedStatus).length,
    [gitStatus, gitStagedStatus],
  );

  if (totalCount === 0) {
    return (
      <div className="sc-empty">
        <span className="sc-empty-text">No changes detected</span>
      </div>
    );
  }

  const singleRepo = repos.length === 1;

  return (
    <div className="sc-view">
      {repos.map((repo) => (
        singleRepo ? (
          <div key={repo.rootPath || '__other'} className="sc-single-repo">
            {repo.staged.length > 0 && (
              <StagedSection
                files={repo.staged}
                rootPrefix={repo.rootPath ? (repo.rootPath.endsWith('/') ? repo.rootPath : repo.rootPath + '/') : ''}
                onFileClick={onFileClick}
                onFileDoubleClick={onFileDoubleClick}
                onUnstageFile={onUnstageFile}
                onUnstageAll={() => onUnstageAll(repo.rootPath || undefined)}
              />
            )}
            {repo.unstaged.length > 0 && (
              <UnstagedSection
                files={repo.unstaged}
                rootPrefix={repo.rootPath ? (repo.rootPath.endsWith('/') ? repo.rootPath : repo.rootPath + '/') : ''}
                onFileClick={onFileClick}
                onFileDoubleClick={onFileDoubleClick}
                onStageFile={onStageFile}
                onStageAll={() => onStageAll(repo.rootPath || undefined)}
              />
            )}
          </div>
        ) : (
          <RepoSection
            key={repo.rootPath || '__other'}
            repo={repo}
            onFileClick={onFileClick}
            onFileDoubleClick={onFileDoubleClick}
            onStageFile={onStageFile}
            onUnstageFile={onUnstageFile}
            onStageAll={onStageAll}
            onUnstageAll={onUnstageAll}
          />
        )
      ))}
    </div>
  );
}

function StagedSection({ files, rootPrefix, onFileClick, onFileDoubleClick, onUnstageFile, onUnstageAll }: {
  files: [string, GitFileStatus][];
  rootPrefix: string;
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  onUnstageFile: (path: string) => void;
  onUnstageAll: () => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="sc-category">
      <div className="sc-category-header" onClick={() => setIsOpen(prev => !prev)}>
        <span className="explorer-changes-chevron">{isOpen ? '▾' : '▸'}</span>
        <span className="sc-category-title">Staged Changes</span>
        <span className="explorer-changes-count">{files.length}</span>
        <button
          className="explorer-changes-section-action"
          data-tooltip="Unstage All"
          data-tooltip-pos="left"
          onClick={(e) => { e.stopPropagation(); onUnstageAll(); }}
        >
          −
        </button>
      </div>
      {isOpen && files.map(([fp, st]) => (
        <ChangeFileRow key={fp} filePath={fp} status={st} rootPrefix={rootPrefix}
          onFileClick={onFileClick} onFileDoubleClick={onFileDoubleClick}
          onAction={onUnstageFile} actionIcon="−" actionTooltip="Unstage" />
      ))}
    </div>
  );
}

function UnstagedSection({ files, rootPrefix, onFileClick, onFileDoubleClick, onStageFile, onStageAll }: {
  files: [string, GitFileStatus][];
  rootPrefix: string;
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  onStageFile: (path: string) => void;
  onStageAll: () => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="sc-category">
      <div className="sc-category-header" onClick={() => setIsOpen(prev => !prev)}>
        <span className="explorer-changes-chevron">{isOpen ? '▾' : '▸'}</span>
        <span className="sc-category-title">Changes</span>
        <span className="explorer-changes-count">{files.length}</span>
        <button
          className="explorer-changes-section-action"
          data-tooltip="Stage All"
          data-tooltip-pos="left"
          onClick={(e) => { e.stopPropagation(); onStageAll(); }}
        >
          +
        </button>
      </div>
      {isOpen && files.map(([fp, st]) => (
        <ChangeFileRow key={fp} filePath={fp} status={st} rootPrefix={rootPrefix}
          onFileClick={onFileClick} onFileDoubleClick={onFileDoubleClick}
          onAction={onStageFile} actionIcon="+" actionTooltip="Stage" />
      ))}
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
    gitStagedStatus,
    refreshGitStatus,
    stageFiles,
    unstageFiles,
    agentContextDirs,
  } = useSessionContext();

  const [activeView, setActiveView] = useState<ExplorerView>('files');
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

  const handleStageAll = useCallback((repoRoot?: string) => {
    if (repoRoot) {
      const prefix = repoRoot.endsWith('/') ? repoRoot : repoRoot + '/';
      const paths = Object.keys(gitStatus).filter(fp => fp.startsWith(prefix));
      if (paths.length > 0) stageFiles(paths);
    } else {
      stageFiles(Object.keys(gitStatus));
    }
  }, [gitStatus, stageFiles]);

  const handleUnstageAll = useCallback((repoRoot?: string) => {
    if (repoRoot) {
      const prefix = repoRoot.endsWith('/') ? repoRoot : repoRoot + '/';
      const paths = Object.keys(gitStagedStatus).filter(fp => fp.startsWith(prefix));
      if (paths.length > 0) unstageFiles(paths);
    } else {
      unstageFiles(Object.keys(gitStagedStatus));
    }
  }, [gitStagedStatus, unstageFiles]);

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

  const combinedGitStatus = useMemo(() => {
    if (Object.keys(gitStagedStatus).length === 0) return gitStatus;
    return { ...gitStagedStatus, ...gitStatus };
  }, [gitStatus, gitStagedStatus]);

  const changesCount = Object.keys(gitStatus).length + Object.keys(gitStagedStatus).length;

  if (!explorerRoot) {
    return (
      <div className="panel explorer-panel">
        <div className="panel-header">
          <span className="panel-title panel-icon explorer-icon" data-tooltip="Explorer - drag to reorder" data-tooltip-pos="bottom"><VscFolderOpened size={16} /></span>
          <PanelMinimizeButton onMinimize={() => setPanelVisibility('explorer', false)} tooltip={tooltipWithShortcut('Hide Explorer', 'toggle-explorer')} />
        </div>
        <div className="panel-body explorer-tree">
          <div className="explorer-prompt">
            <div className="viewer-empty-icon">~</div>
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
  const rootFolderStatus = getFolderStatus(explorerRoot, combinedGitStatus);
  const rootNameColor = rootFolderStatus ? STATUS_COLOR_VAR[rootFolderStatus] : undefined;

  return (
    <div className="panel explorer-panel">
      <div className="panel-header">
        <span className="panel-title panel-icon explorer-icon" data-tooltip={`${displayRoot} - drag to reorder`} data-tooltip-pos="bottom"><VscFolderOpened size={16} /></span>
        <div className="explorer-actions">
          {activeView === 'files' && explorerOutOfSync && (
            <IconButton
              className="explorer-action-btn explorer-sync-btn"
              tooltip="Sync to terminal directory"
              tooltipPos="bottom"
              onClick={handleLoadCwd}
            >
              ↻
            </IconButton>
          )}
          {activeView === 'files' && (
            <>
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
            </>
          )}
          {activeView === 'source-control' && (
            <IconButton
              className="explorer-action-btn"
              tooltip="Refresh"
              tooltipPos="bottom"
              onClick={refreshGitStatus}
            >
              ⟳
            </IconButton>
          )}
          <PanelMinimizeButton onMinimize={() => setPanelVisibility('explorer', false)} tooltip={tooltipWithShortcut('Hide Explorer', 'toggle-explorer')} />
        </div>
      </div>
      <div className="explorer-view-tabs">
        <button
          className={`explorer-view-tab ${activeView === 'files' ? 'explorer-view-tab-active' : ''}`}
          onClick={() => setActiveView('files')}
          data-tooltip="Explorer"
          data-tooltip-pos="bottom"
        >
          <VscFiles size={16} />
        </button>
        <button
          className={`explorer-view-tab ${activeView === 'source-control' ? 'explorer-view-tab-active' : ''}`}
          onClick={() => setActiveView('source-control')}
          data-tooltip="Source Control"
          data-tooltip-pos="bottom"
        >
          <VscSourceControl size={16} />
          {changesCount > 0 && <span className="explorer-view-tab-badge">{changesCount}</span>}
        </button>
      </div>
      {activeView === 'files' && explorerOutOfSync && (
        <div className="explorer-sync-bar" onClick={handleLoadCwd}>
          <span>Terminal moved to </span>
          <span className="explorer-sync-path">
            {shortenPath(cwd, homeDir)}
          </span>
          <span> - click to follow</span>
        </div>
      )}
      <div className="panel-body explorer-body">
        {activeView === 'files' ? (
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
                    gitStatus={combinedGitStatus}
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
                gitStatus={combinedGitStatus}
                syncedRevealFile={syncedRevealFile}
                revealGeneration={revealGeneration}
              />
            ))}
          </div>
        ) : (
          <SourceControlView
            gitStatus={gitStatus}
            gitStagedStatus={gitStagedStatus}
            allRoots={allRoots}
            onFileClick={handleChangeFileClick}
            onFileDoubleClick={showViewerPanel}
            onStageFile={(path) => stageFiles([path])}
            onUnstageFile={(path) => unstageFiles([path])}
            onStageAll={handleStageAll}
            onUnstageAll={handleUnstageAll}
          />
        )}
      </div>
    </div>
  );
}
