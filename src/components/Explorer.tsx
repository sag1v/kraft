import React, { useState, useEffect, useCallback, useRef, useMemo, useContext, createContext } from 'react';
import { VscFolderOpened, VscFiles, VscSourceControl, VscNewFile, VscNewFolder, VscSearch, VscCollapseAll, VscRefresh } from 'react-icons/vsc';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { FileIcon } from './FileIcon';
import { IconButton, PanelMinimizeButton, PanelMaximizeButton } from './IconButton';
import { shortenPath, normPath, isPathWithinRoot } from '../utils';
import type { DirEntry, GitFileStatus, AgentContextDir, DirReadResult, ContentSearchFileResult } from '../types';
import { tooltipWithShortcut } from '../shortcuts';

const MAX_DIR_ENTRIES = 500;

type ExplorerView = 'files' | 'source-control' | 'search';

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

interface CreateState {
  type: 'file' | 'folder';
  parentPath: string;
  value: string;
}

const CreateCtx = createContext<{
  pending: CreateState | null;
  onChange: (v: string) => void;
  onCancel: () => void;
} | null>(null);

function CreateInputRow({ depth, type, value, onChange, onConfirm, onCancel }: {
  depth: number;
  type: 'file' | 'folder';
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <div className="tree-row" style={{ paddingLeft: `${depth * 16 + 8}px`, gap: 4 }}>
      <FileIcon name={value || (type === 'folder' ? 'newfolder' : 'newfile')} isDirectory={type === 'folder'} isOpen={false} />
      <input
        ref={inputRef}
        className="tree-create-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        onBlur={onCancel}
      />
    </div>
  );
}

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  onFileClick: (path: string, fromMouseClick?: boolean) => void;
  onFileDoubleClick: () => void;
  onContextMenu: (path: string, isDirectory: boolean, e: React.MouseEvent) => void;
  collapseKey: number;
  gitStatus: Record<string, GitFileStatus>;
  gitIgnoredSet: Set<string>;
  showHiddenFiles: boolean;
  parentDimmed?: boolean;
  syncedRevealFile: string | null;
  revealGeneration: number;
}

function TreeNode({ entry, depth, onFileClick, onFileDoubleClick, onContextMenu, collapseKey, gitStatus, gitIgnoredSet, showHiddenFiles, parentDimmed, syncedRevealFile, revealGeneration }: TreeNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRowRef = useRef<HTMLDivElement>(null);
  const createCtx = useContext(CreateCtx);

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
    window.api.readDirectory(entry.path, undefined, undefined, showHiddenFiles)
      .then((res) => {
        if (!cancelled) setChildren(res.entries);
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
  }, [entry.isDirectory, entry.path, syncedRevealFile, revealGeneration, children, showHiddenFiles]);

  const isPendingTarget = entry.isDirectory && createCtx?.pending?.parentPath === entry.path;

  useEffect(() => {
    if (!isPendingTarget) return;
    setIsOpen(true);
    if (children !== null) return;
    let cancelled = false;
    setLoading(true);
    window.api.readDirectory(entry.path, undefined, undefined, showHiddenFiles)
      .then((res) => { if (!cancelled) setChildren(res.entries); })
      .catch(() => { if (!cancelled) setChildren([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isPendingTarget, entry.isDirectory, entry.path, children, showHiddenFiles]);

  useEffect(() => {
    if (entry.isDirectory || !syncedRevealFile) return;
    if (normPath(syncedRevealFile) !== normPath(entry.path)) return;
    const id = requestAnimationFrame(() => {
      fileRowRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [entry.isDirectory, entry.path, syncedRevealFile, revealGeneration]);

  const toggleOpen = useCallback(async (e: React.MouseEvent) => {
    if (!entry.isDirectory) {
      onFileClick(entry.path, e.detail > 0);
      return;
    }

    if (!isOpen && children === null) {
      setLoading(true);
      try {
        const res = await window.api.readDirectory(entry.path, undefined, undefined, showHiddenFiles);
        setChildren(res.entries);
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

  const isIgnored = gitIgnoredSet.has(entry.path);
  const isDimmed = parentDimmed || isIgnored;
  const nameColor = fileStatus ? STATUS_COLOR_VAR[fileStatus] : undefined;
  const isExplorerActive = !entry.isDirectory && syncedRevealFile && normPath(syncedRevealFile) === normPath(entry.path);

  return (
    <div className="tree-node">
      <div
        ref={entry.isDirectory ? undefined : fileRowRef}
        className={`tree-row ${!entry.isDirectory ? 'tree-row-file' : ''} ${isExplorerActive ? 'tree-row-explorer-active' : ''} ${isDimmed ? 'tree-row-ignored' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        data-is-directory={entry.isDirectory ? 'true' : undefined}
        data-path={entry.path}
        onClick={toggleOpen}
        onDoubleClick={!entry.isDirectory ? (e) => { e.stopPropagation(); onFileDoubleClick(); } : undefined}
        onContextMenu={(e) => onContextMenu(entry.path, entry.isDirectory, e)}
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
              onContextMenu={onContextMenu}
              collapseKey={collapseKey}
              gitStatus={gitStatus}
              gitIgnoredSet={gitIgnoredSet}
              showHiddenFiles={showHiddenFiles}
              parentDimmed={isDimmed}
              syncedRevealFile={syncedRevealFile}
              revealGeneration={revealGeneration}
            />
          ))}
          {isPendingTarget && createCtx?.pending && (
            <CreateInputRow
              depth={depth + 1}
              type={createCtx.pending.type}
              value={createCtx.pending.value}
              onChange={createCtx.onChange}
              onConfirm={async () => {
                const name = createCtx.pending!.value.trim();
                if (!name) { createCtx.onCancel(); return; }
                const fullPath = entry.path + '/' + name;
                if (createCtx.pending!.type === 'file') {
                  const result = await window.api.createFile(fullPath);
                  if (!result.error) {
                    const res = await window.api.readDirectory(entry.path, true, undefined, showHiddenFiles);
                    setChildren(res.entries);
                    onFileClick(fullPath, true);
                  }
                } else {
                  const result = await window.api.createDirectory(fullPath);
                  if (!result.error) {
                    const res = await window.api.readDirectory(entry.path, true, undefined, showHiddenFiles);
                    setChildren(res.entries);
                  }
                }
                createCtx.onCancel();
              }}
              onCancel={createCtx.onCancel}
            />
          )}
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
  gitRepoRootsMap: Record<string, string>;
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onStageAll: (repoRoot?: string) => void;
  onUnstageAll: (repoRoot?: string) => void;
  onDiscardFile: (path: string) => void;
  onDiscardAll: (repoRoot?: string) => void;
  onStash: (repoRoot: string, message?: string, includeUntracked?: boolean) => Promise<void>;
  onStashPop: (repoRoot: string) => Promise<void>;
  onCommitStaged: (repoRoot: string, message: string) => Promise<void>;
  onCommitAll: (repoRoot: string, message: string) => Promise<void>;
  onUndoLastCommit: (repoRoot: string) => Promise<void>;
}

type GitActionMode = 'commit-staged' | 'commit-all' | 'stash' | 'stash-untracked';

const GIT_ACTION_LABELS: Record<GitActionMode, string> = {
  'commit-staged': 'Commit Staged',
  'commit-all': 'Commit All',
  'stash': 'Stash',
  'stash-untracked': 'Stash (Include Untracked)',
};

function GitActionPanel({ repoRoot, mode, onCommitStaged, onCommitAll, onStash, onClose }: {
  repoRoot: string;
  mode: GitActionMode;
  onCommitStaged: (repoRoot: string, message: string) => Promise<void>;
  onCommitAll: (repoRoot: string, message: string) => Promise<void>;
  onStash: (repoRoot: string, message?: string, includeUntracked?: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (fn: () => Promise<boolean | void>): Promise<boolean> => {
    setLoading(true);
    try {
      const result = await fn();
      return result !== false;
    } finally {
      setLoading(false);
    }
  }, []);

  const isCommit = mode === 'commit-staged' || mode === 'commit-all';
  const canConfirm = isCommit ? message.trim().length > 0 : true;
  const confirmLabel = isCommit ? 'Commit' : 'Stash';

  const handleConfirm = useCallback(async () => {
    if (!canConfirm || loading) return;
    let success: boolean;
    if (mode === 'commit-staged') success = await run(() => onCommitStaged(repoRoot, message.trim()));
    else if (mode === 'commit-all') success = await run(() => onCommitAll(repoRoot, message.trim()));
    else success = await run(() => onStash(repoRoot, message.trim() || undefined, mode === 'stash-untracked'));
    if (success) onClose();
  }, [canConfirm, loading, mode, message, repoRoot, run, onCommitStaged, onCommitAll, onStash, onClose]);

  return (
    <div className="sc-commit-input">
      <div className="sc-commit-header">
        <span className="sc-commit-label">{GIT_ACTION_LABELS[mode]}</span>
        <button className="sc-commit-close" onClick={onClose} disabled={loading} title="Cancel">×</button>
      </div>
      <textarea
        className="sc-commit-textarea"
        placeholder={isCommit ? 'Commit message (Ctrl+Enter to confirm)' : 'Stash message (optional, Enter to confirm)'}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={loading}
        rows={isCommit ? 3 : 2}
        autoFocus
        onKeyDown={(e) => {
          e.stopPropagation();
          if (isCommit && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            if (canConfirm && !loading) handleConfirm();
          }
          if (!isCommit && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!loading) handleConfirm();
          }
          if (e.key === 'Escape' && !loading) onClose();
        }}
      />
      <div className="sc-commit-actions">
        <button className="sc-commit-btn" onClick={handleConfirm} disabled={!canConfirm || loading}>
          {loading ? '···' : confirmLabel}
        </button>
        <button className="sc-commit-btn-secondary" onClick={onClose} disabled={loading}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function RepoActionsMenu({ repoRoot, onStashPop, onUndoLastCommit, onAction }: {
  repoRoot: string;
  onStashPop: (repoRoot: string) => Promise<void>;
  onUndoLastCommit: (repoRoot: string) => Promise<void>;
  onAction: (mode: GitActionMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        if (loading) return;
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, loading]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setLoading(true);
    try { await fn(); } finally { setLoading(false); setOpen(false); }
  }, []);

  const trigger = (mode: GitActionMode) => { setOpen(false); onAction(mode); };

  return (
    <div className="stash-menu-wrap" ref={containerRef} onClick={(e) => e.stopPropagation()}>
      <button
        className="sc-stash-btn"
        data-tooltip="More Actions..."
        data-tooltip-pos="left"
        onClick={() => setOpen(prev => !prev)}
      >
        ···
      </button>
      {open && (
        <div className="stash-menu">
          <button className="stash-menu-item" disabled={loading} onClick={() => trigger('commit-staged')}>Commit Staged...</button>
          <button className="stash-menu-item" disabled={loading} onClick={() => trigger('commit-all')}>Commit All...</button>
          <button className="stash-menu-item" disabled={loading} onClick={() => run(() => onUndoLastCommit(repoRoot))}>Undo Last Commit</button>
          <div className="stash-menu-divider" />
          <button className="stash-menu-item" disabled={loading} onClick={() => trigger('stash')}>Stash...</button>
          <button className="stash-menu-item" disabled={loading} onClick={() => trigger('stash-untracked')}>Stash (Include Untracked)...</button>
          <button className="stash-menu-item" disabled={loading} onClick={() => run(() => onStashPop(repoRoot))}>Pop Latest Stash</button>
          {loading && <div className="stash-menu-loading">Working···</div>}
        </div>
      )}
    </div>
  );
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
  gitRepoRootsMap: Record<string, string>,
): RepoChanges[] {
  const statusOrder: Record<string, number> = { conflict: 0, modified: 1, added: 2, renamed: 3, untracked: 4, deleted: 5 };
  const sortFiles = (entries: [string, GitFileStatus][]) =>
    entries.sort(([, a], [, b]) => (statusOrder[a] ?? 99) - (statusOrder[b] ?? 99));

  // Deduplicate allRoots by their actual git repo root so that multiple directories
  // inside the same repo are shown as one unified section.
  const seenRepoRoots = new Map<string, string>(); // gitRepoRoot -> effective root path to use
  const effectiveRoots: string[] = [];
  for (const root of allRoots) {
    const repoRoot = gitRepoRootsMap[root] ?? root;
    if (!seenRepoRoots.has(repoRoot)) {
      seenRepoRoots.set(repoRoot, repoRoot);
      effectiveRoots.push(repoRoot);
    }
  }

  const repoMap = new Map<string, RepoChanges>();
  const assignedUnstaged = new Set<string>();
  const assignedStaged = new Set<string>();

  for (const root of effectiveRoots) {
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

interface ChangeAction {
  icon: string;
  tooltip: string;
  handler: (path: string) => void;
}

function ChangeFileRow({ filePath, status, rootPrefix, onFileClick, onFileDoubleClick, actions }: {
  filePath: string;
  status: GitFileStatus;
  rootPrefix: string;
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  actions?: ChangeAction[];
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
      {actions && actions.map((action, i) => (
        <button
          key={i}
          className="explorer-change-action"
          data-tooltip={action.tooltip}
          data-tooltip-pos="left"
          onClick={(e) => { e.stopPropagation(); action.handler(filePath); }}
        >
          {action.icon}
        </button>
      ))}
      <span className="explorer-change-badge" style={{ color }}>{STATUS_LABEL[status]}</span>
    </div>
  );
}

function RepoSection({ repo, onFileClick, onFileDoubleClick, onStageFile, onUnstageFile, onStageAll, onUnstageAll, onDiscardFile, onDiscardAll, onStash, onStashPop, onCommitStaged, onCommitAll, onUndoLastCommit, defaultOpen }: {
  repo: RepoChanges;
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onStageAll: (repoRoot?: string) => void;
  onUnstageAll: (repoRoot?: string) => void;
  onDiscardFile: (path: string) => void;
  onDiscardAll: (repoRoot?: string) => void;
  onStash: (repoRoot: string, message?: string, includeUntracked?: boolean) => Promise<void>;
  onStashPop: (repoRoot: string) => Promise<void>;
  onCommitStaged: (repoRoot: string, message: string) => Promise<void>;
  onCommitAll: (repoRoot: string, message: string) => Promise<void>;
  onUndoLastCommit: (repoRoot: string) => Promise<void>;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? true);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [actionMode, setActionMode] = useState<GitActionMode | null>(null);
  const totalCount = repo.staged.length + repo.unstaged.length;
  const prefix = repo.rootPath ? (repo.rootPath.endsWith('/') ? repo.rootPath : repo.rootPath + '/') : '';

  return (
    <div className="sc-repo">
      <div className="sc-repo-header" onClick={() => setIsOpen(prev => !prev)}>
        <span className="explorer-changes-chevron">{isOpen ? '▾' : '▸'}</span>
        <span className="sc-repo-name">{repo.rootName}</span>
        <span className="explorer-changes-count">{totalCount}</span>
        <RepoActionsMenu repoRoot={repo.rootPath} onStashPop={onStashPop} onUndoLastCommit={onUndoLastCommit} onAction={setActionMode} />
      </div>
      {actionMode && (
        <GitActionPanel repoRoot={repo.rootPath} mode={actionMode} onCommitStaged={onCommitStaged} onCommitAll={onCommitAll} onStash={onStash} onClose={() => setActionMode(null)} />
      )}
      {isOpen && (
        <div className="sc-repo-body">
          {(() => {
            const conflicts = repo.unstaged.filter(([, st]) => st === 'conflict');
            const changes = repo.unstaged.filter(([, st]) => st !== 'conflict');
            return (
              <>
                {conflicts.length > 0 && (
                  <MergeChangesSection
                    files={conflicts}
                    rootPrefix={prefix}
                    onFileClick={onFileClick}
                    onFileDoubleClick={onFileDoubleClick}
                    onMarkResolved={onStageFile}
                  />
                )}
                <div className="sc-category">
                  <div className="sc-category-header" onClick={() => setStagedOpen(prev => !prev)}>
                    <span className="explorer-changes-chevron">{stagedOpen ? '▾' : '▸'}</span>
                    <span className="sc-category-title">Staged Changes</span>
                    <span className="explorer-changes-count">{repo.staged.length}</span>
                    {repo.staged.length > 0 && (
                      <button
                        className="explorer-changes-section-action"
                        data-tooltip="Unstage All"
                        data-tooltip-pos="left"
                        onClick={(e) => { e.stopPropagation(); onUnstageAll(repo.rootPath || undefined); }}
                      >
                        −
                      </button>
                    )}
                  </div>
                  {stagedOpen && repo.staged.map(([fp, st]) => (
                    <ChangeFileRow
                      key={fp}
                      filePath={fp}
                      status={st}
                      rootPrefix={prefix}
                      onFileClick={onFileClick}
                      onFileDoubleClick={onFileDoubleClick}
                      actions={[{ icon: '−', tooltip: 'Unstage', handler: onUnstageFile }]}
                    />
                  ))}
                </div>
                <div className="sc-category">
                  <div className="sc-category-header" onClick={() => setUnstagedOpen(prev => !prev)}>
                    <span className="explorer-changes-chevron">{unstagedOpen ? '▾' : '▸'}</span>
                    <span className="sc-category-title">Changes</span>
                    <span className="explorer-changes-count">{changes.length}</span>
                    {changes.length > 0 && (
                      <>
                        <button
                          className="explorer-changes-section-action"
                          data-tooltip="Discard All Changes"
                          data-tooltip-pos="left"
                          onClick={(e) => { e.stopPropagation(); onDiscardAll(repo.rootPath || undefined); }}
                        >
                          ↺
                        </button>
                        <button
                          className="explorer-changes-section-action"
                          data-tooltip="Stage All"
                          data-tooltip-pos="left"
                          onClick={(e) => { e.stopPropagation(); onStageAll(repo.rootPath || undefined); }}
                        >
                          +
                        </button>
                      </>
                    )}
                  </div>
                  {unstagedOpen && changes.map(([fp, st]) => (
                    <ChangeFileRow
                      key={fp}
                      filePath={fp}
                      status={st}
                      rootPrefix={prefix}
                      onFileClick={onFileClick}
                      onFileDoubleClick={onFileDoubleClick}
                      actions={[
                        { icon: '↩', tooltip: 'Discard Changes', handler: onDiscardFile },
                        { icon: '+', tooltip: 'Stage', handler: onStageFile },
                      ]}
                    />
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function SourceControlView({ gitStatus, gitStagedStatus, allRoots, gitRepoRootsMap, onFileClick, onFileDoubleClick, onStageFile, onUnstageFile, onStageAll, onUnstageAll, onDiscardFile, onDiscardAll, onStash, onStashPop, onCommitStaged, onCommitAll, onUndoLastCommit }: SourceControlViewProps) {
  const repos = useMemo(
    () => buildRepoGroups(gitStatus, gitStagedStatus, allRoots, gitRepoRootsMap),
    [gitStatus, gitStagedStatus, allRoots, gitRepoRootsMap],
  );

  const totalCount = useMemo(
    () => Object.keys(gitStatus).length + Object.keys(gitStagedStatus).length,
    [gitStatus, gitStagedStatus],
  );

  const [singleActionMode, setSingleActionMode] = useState<GitActionMode | null>(null);

  if (totalCount === 0) {
    const emptyRoot = allRoots[0] ?? '';
    const emptyRootName = emptyRoot.split('/').pop() || emptyRoot;
    return (
      <div className="sc-view">
        <div className="sc-single-repo">
          <div className="sc-single-repo-header">
            <span className="sc-single-repo-name">{emptyRootName}</span>
            <RepoActionsMenu repoRoot={emptyRoot} onStashPop={onStashPop} onUndoLastCommit={onUndoLastCommit} onAction={setSingleActionMode} />
          </div>
          {singleActionMode && (
            <GitActionPanel repoRoot={emptyRoot} mode={singleActionMode} onCommitStaged={onCommitStaged} onCommitAll={onCommitAll} onStash={onStash} onClose={() => setSingleActionMode(null)} />
          )}
          <div className="sc-empty">
            <span className="sc-empty-text">No changes detected</span>
          </div>
        </div>
      </div>
    );
  }

  const singleRepo = repos.length === 1;

  return (
    <div className="sc-view">
      {repos.map((repo) => (
        singleRepo ? (
          <div key={repo.rootPath || '__other'} className="sc-single-repo">
            <div className="sc-single-repo-header">
              <span className="sc-single-repo-name">{repo.rootName}</span>
              <RepoActionsMenu repoRoot={repo.rootPath} onStashPop={onStashPop} onUndoLastCommit={onUndoLastCommit} onAction={setSingleActionMode} />
            </div>
            {singleActionMode && (
              <GitActionPanel repoRoot={repo.rootPath} mode={singleActionMode} onCommitStaged={onCommitStaged} onCommitAll={onCommitAll} onStash={onStash} onClose={() => setSingleActionMode(null)} />
            )}
            {(() => {
              const prefix = repo.rootPath ? (repo.rootPath.endsWith('/') ? repo.rootPath : repo.rootPath + '/') : '';
              const conflicts = repo.unstaged.filter(([, st]) => st === 'conflict');
              const changes = repo.unstaged.filter(([, st]) => st !== 'conflict');
              return (
                <>
                  {conflicts.length > 0 && (
                    <MergeChangesSection
                      files={conflicts}
                      rootPrefix={prefix}
                      onFileClick={onFileClick}
                      onFileDoubleClick={onFileDoubleClick}
                      onMarkResolved={onStageFile}
                    />
                  )}
                  <StagedSection
                    files={repo.staged}
                    rootPrefix={prefix}
                    onFileClick={onFileClick}
                    onFileDoubleClick={onFileDoubleClick}
                    onUnstageFile={onUnstageFile}
                    onUnstageAll={() => onUnstageAll(repo.rootPath || undefined)}
                  />
                  <UnstagedSection
                    files={changes}
                    rootPrefix={prefix}
                    onFileClick={onFileClick}
                    onFileDoubleClick={onFileDoubleClick}
                    onStageFile={onStageFile}
                    onStageAll={() => onStageAll(repo.rootPath || undefined)}
                    onDiscardFile={onDiscardFile}
                    onDiscardAll={() => onDiscardAll(repo.rootPath || undefined)}
                  />
                </>
              );
            })()}
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
            onDiscardFile={onDiscardFile}
            onDiscardAll={onDiscardAll}
            onStash={onStash}
            onStashPop={onStashPop}
            onCommitStaged={onCommitStaged}
            onCommitAll={onCommitAll}
            onUndoLastCommit={onUndoLastCommit}
          />
        )
      ))}
    </div>
  );
}

function MergeChangesSection({ files, rootPrefix, onFileClick, onFileDoubleClick, onMarkResolved }: {
  files: [string, GitFileStatus][];
  rootPrefix: string;
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  onMarkResolved: (path: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="sc-category sc-merge-changes">
      <div className="sc-category-header sc-merge-header" onClick={() => setIsOpen((p) => !p)}>
        <span className="explorer-changes-chevron">{isOpen ? '▾' : '▸'}</span>
        <span className="sc-category-title sc-merge-title">Merge Changes</span>
        <span className="explorer-changes-count sc-merge-count">{files.length}</span>
      </div>
      {isOpen && files.map(([fp, st]) => (
        <ChangeFileRow
          key={fp}
          filePath={fp}
          status={st}
          rootPrefix={rootPrefix}
          onFileClick={onFileClick}
          onFileDoubleClick={onFileDoubleClick}
          actions={[{ icon: '✓', tooltip: 'Mark as Resolved', handler: onMarkResolved }]}
        />
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
        {files.length > 0 && (
          <button
            className="explorer-changes-section-action"
            data-tooltip="Unstage All"
            data-tooltip-pos="left"
            onClick={(e) => { e.stopPropagation(); onUnstageAll(); }}
          >
            −
          </button>
        )}
      </div>
      {isOpen && files.map(([fp, st]) => (
        <ChangeFileRow key={fp} filePath={fp} status={st} rootPrefix={rootPrefix}
          onFileClick={onFileClick} onFileDoubleClick={onFileDoubleClick}
          actions={[{ icon: '−', tooltip: 'Unstage', handler: onUnstageFile }]} />
      ))}
    </div>
  );
}

function UnstagedSection({ files, rootPrefix, onFileClick, onFileDoubleClick, onStageFile, onStageAll, onDiscardFile, onDiscardAll }: {
  files: [string, GitFileStatus][];
  rootPrefix: string;
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  onStageFile: (path: string) => void;
  onStageAll: () => void;
  onDiscardFile: (path: string) => void;
  onDiscardAll: () => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="sc-category">
      <div className="sc-category-header" onClick={() => setIsOpen(prev => !prev)}>
        <span className="explorer-changes-chevron">{isOpen ? '▾' : '▸'}</span>
        <span className="sc-category-title">Changes</span>
        <span className="explorer-changes-count">{files.length}</span>
        {files.length > 0 && (
          <>
            <button
              className="explorer-changes-section-action"
              data-tooltip="Discard All Changes"
              data-tooltip-pos="left"
              onClick={(e) => { e.stopPropagation(); onDiscardAll(); }}
            >
              ↺
            </button>
            <button
              className="explorer-changes-section-action"
              data-tooltip="Stage All"
              data-tooltip-pos="left"
              onClick={(e) => { e.stopPropagation(); onStageAll(); }}
            >
              +
            </button>
          </>
        )}
      </div>
      {isOpen && files.map(([fp, st]) => (
        <ChangeFileRow key={fp} filePath={fp} status={st} rootPrefix={rootPrefix}
          onFileClick={onFileClick} onFileDoubleClick={onFileDoubleClick}
          actions={[
            { icon: '↩', tooltip: 'Discard Changes', handler: onDiscardFile },
            { icon: '+', tooltip: 'Stage', handler: onStageFile },
          ]} />
      ))}
    </div>
  );
}

interface ContextDirSectionProps {
  dir: AgentContextDir;
  onFileClick: (path: string) => void;
  onFileDoubleClick: () => void;
  onContextMenu: (path: string, isDirectory: boolean, e: React.MouseEvent) => void;
  collapseKey: number;
  gitStatus: Record<string, GitFileStatus>;
  gitIgnoredSet: Set<string>;
  showHiddenFiles: boolean;
  syncedRevealFile: string | null;
  revealGeneration: number;
}

function ContextDirSection({ dir, onFileClick, onFileDoubleClick, onContextMenu, collapseKey, gitStatus, gitIgnoredSet, showHiddenFiles, syncedRevealFile, revealGeneration }: ContextDirSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || entries !== null) return;
    setLoading(true);
    window.api.readDirectory(dir.path, undefined, undefined, showHiddenFiles)
      .then((res) => setEntries(res.entries))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [isOpen, entries, dir.path, showHiddenFiles]);

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
        onContextMenu={(e) => onContextMenu(dir.path, true, e)}
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
              onContextMenu={onContextMenu}
              collapseKey={collapseKey}
              gitStatus={gitStatus}
              gitIgnoredSet={gitIgnoredSet}
              showHiddenFiles={showHiddenFiles}
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
  truncated?: boolean;
  totalCount?: number;
}

function SearchView({ explorerRoot }: { explorerRoot: string | null }) {
  const { setOpenFilePath, setPanelVisibility } = useUIContext();
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [includePattern, setIncludePattern] = useState('');
  const [excludePattern, setExcludePattern] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<ContentSearchFileResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchCounterRef = useRef(0);

  // Focus input when this view becomes active (kraft:open-search)
  useEffect(() => {
    const handler = () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('kraft:open-search', handler);
    return () => window.removeEventListener('kraft:open-search', handler);
  }, []);

  // Auto-focus on first mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || !explorerRoot) {
      setResults([]);
      setSearchedQuery('');
      return;
    }
    const id = ++searchCounterRef.current;
    setSearching(true);
    try {
      const res = await window.api.searchContent(explorerRoot, q, {
        caseSensitive,
        wholeWord,
        useRegex,
        includePattern: includePattern.trim() || undefined,
        excludePattern: excludePattern.trim() || undefined,
      });
      if (searchCounterRef.current !== id) return;
      setResults(res);
      setSearchedQuery(q);
    } catch {
      if (searchCounterRef.current !== id) return;
      setResults([]);
    } finally {
      if (searchCounterRef.current === id) setSearching(false);
    }
  }, [explorerRoot, caseSensitive, wholeWord, useRegex, includePattern, excludePattern]);

  const scheduleSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 250);
  }, [doSearch]);

  // Re-run search when options change
  useEffect(() => {
    if (query.trim()) scheduleSearch(query);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseSensitive, wholeWord, useRegex, includePattern, excludePattern]);

  const handleOpenMatch = useCallback((filePath: string, lineNumber: number) => {
    setOpenFilePath(filePath);
    setPanelVisibility('editor', true);
    window.dispatchEvent(new CustomEvent('kraft:open-file-at-line', { detail: { path: filePath, line: lineNumber } }));
  }, [setOpenFilePath, setPanelVisibility]);

  function getBasename(p: string) {
    return p.split('/').filter(Boolean).pop() ?? p;
  }

  function getRelativePath(base: string, full: string) {
    const b = base.endsWith('/') ? base : base + '/';
    return full.startsWith(b) ? full.slice(b.length) : full;
  }

  const totalMatches = results.reduce((sum, f) => sum + f.matches.length, 0);

  return (
    <div className="search-view">
      <div className="search-input-row">
        <input
          ref={searchInputRef}
          className="search-input"
          placeholder="Search"
          value={query}
          spellCheck={false}
          onChange={e => {
            setQuery(e.target.value);
            scheduleSearch(e.target.value);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              doSearch(query);
            }
            if (e.key === 'Escape') {
              setQuery('');
              setResults([]);
              setSearchedQuery('');
            }
          }}
        />
        <div className="search-options-row">
          <button
            className={`search-option-btn${caseSensitive ? ' search-option-btn-active' : ''}`}
            title="Match Case"
            onClick={() => setCaseSensitive(v => !v)}
          >Aa</button>
          <button
            className={`search-option-btn${wholeWord ? ' search-option-btn-active' : ''}`}
            title="Match Whole Word"
            onClick={() => setWholeWord(v => !v)}
          >ab</button>
          <button
            className={`search-option-btn${useRegex ? ' search-option-btn-active' : ''}`}
            title="Use Regular Expression"
            onClick={() => setUseRegex(v => !v)}
          >.*</button>
        </div>
      </div>

      <div className="search-filters-section">
        <button
          className="search-filters-toggle"
          onClick={() => setShowFilters(v => !v)}
        >
          <span className="search-filters-chevron">{showFilters ? '▾' : '▸'}</span>
          <span>Files to include/exclude</span>
        </button>
        {showFilters && (
          <div className="search-filter-inputs">
            <input
              className="search-filter-input"
              placeholder="Include (e.g. *.ts)"
              value={includePattern}
              spellCheck={false}
              onChange={e => setIncludePattern(e.target.value)}
            />
            <input
              className="search-filter-input"
              placeholder="Exclude (e.g. *.test.ts)"
              value={excludePattern}
              spellCheck={false}
              onChange={e => setExcludePattern(e.target.value)}
            />
          </div>
        )}
      </div>

      {!explorerRoot && (
        <div className="search-empty-state">Open a folder to search</div>
      )}

      {searching && (
        <div className="search-loading-row">
          <span className="search-loading-dot" />
          <span className="search-loading-dot" />
          <span className="search-loading-dot" />
        </div>
      )}

      {!searching && searchedQuery && results.length === 0 && (
        <div className="search-empty-state">No results for "{searchedQuery}"</div>
      )}

      {!searching && results.length > 0 && (
        <div className="search-results">
          <div className="search-summary">
            {totalMatches} result{totalMatches !== 1 ? 's' : ''} in {results.length} file{results.length !== 1 ? 's' : ''}
          </div>
          {results.map(fileResult => {
            const isCollapsed = collapsedFiles.has(fileResult.path);
            const fileName = getBasename(fileResult.path);
            const relPath = explorerRoot ? getRelativePath(explorerRoot, fileResult.path) : fileResult.path;
            const dirPart = relPath.length > fileName.length
              ? relPath.slice(0, relPath.length - fileName.length - 1)
              : '';
            return (
              <div key={fileResult.path} className="search-file-group">
                <div
                  className="search-file-header"
                  onClick={() => setCollapsedFiles(prev => {
                    const next = new Set(prev);
                    if (next.has(fileResult.path)) next.delete(fileResult.path);
                    else next.add(fileResult.path);
                    return next;
                  })}
                >
                  <span className="search-file-chevron">{isCollapsed ? '▸' : '▾'}</span>
                  <FileIcon name={fileName} isDirectory={false} isOpen={false} />
                  <span className="search-file-name">{fileName}</span>
                  {dirPart && <span className="search-file-dir">{dirPart}</span>}
                  <span className="search-file-count">{fileResult.matches.length}</span>
                </div>
                {!isCollapsed && (
                  <div className="search-file-matches">
                    {fileResult.matches.map((match, i) => (
                      <div
                        key={i}
                        className="search-match-row"
                        onClick={() => handleOpenMatch(fileResult.path, match.lineNumber)}
                      >
                        <span className="search-match-linenum">{match.lineNumber}</span>
                        <span className="search-match-content">
                          {match.lineContent.slice(0, match.matchStart)}
                          <mark className="search-match-highlight">
                            {match.lineContent.slice(match.matchStart, match.matchEnd)}
                          </mark>
                          {match.lineContent.slice(match.matchEnd)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Explorer() {
  const { homeDir, setOpenFilePath, setPanelVisibility, setDiffFilePath, openFilePath, settings, panelVisibility, maximizedPanel, setMaximizedPanel } = useUIContext();
  const {
    cwd,
    explorerRoot,
    setExplorerRoot,
    explorerOutOfSync,
    activeGroupId,
    focusedPaneId,
    updatePaneCwd,
    gitStatus,
    gitStagedStatus,
    gitIgnored,
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
    gitRepoRootsMap,
    lastFetchedDirs,
    createGroupAtPath,
  } = useSessionContext();

  const [activeViewMap, setActiveViewMap] = useState<Record<string, ExplorerView>>({});
  const syncLayout = settings.syncLayoutAcrossTabs;
  const activeView = syncLayout
    ? (activeViewMap['*'] ?? 'files')
    : (activeGroupId ? (activeViewMap[activeGroupId] ?? 'files') : 'files');
  const setActiveView = useCallback((view: ExplorerView) => {
    if (syncLayout) {
      setActiveViewMap(prev => ({ ...prev, '*': view }));
    } else {
      if (!activeGroupId) return;
      setActiveViewMap(prev => ({ ...prev, [activeGroupId]: view }));
    }
  }, [activeGroupId, syncLayout]);

  // Switch to search view when Cmd+Shift+F fires
  useEffect(() => {
    const handler = () => setActiveView('search');
    window.addEventListener('kraft:open-search', handler);
    return () => window.removeEventListener('kraft:open-search', handler);
  }, [setActiveView]);

  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [truncatedInfo, setTruncatedInfo] = useState<{ truncated: boolean; totalCount: number }>({ truncated: false, totalCount: 0 });
  const [loading, setLoading] = useState(false);
  const [collapseKey, setCollapseKey] = useState(0);
  const [platform, setPlatform] = useState('darwin');
  const [pendingCreate, setPendingCreate] = useState<CreateState | null>(null);
  const [fileContextMenu, setFileContextMenu] = useState<{ x: number; y: number; path: string; isDirectory: boolean } | null>(null);
  const fileContextMenuRef = useRef<HTMLDivElement>(null);
  const loadedRootRef = useRef<string | null>(null);
  const treeCacheRef = useRef<Map<string, TreeCache>>(new Map());
  const prevSessionIdRef = useRef<string | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const truncatedInfoRef = useRef(truncatedInfo);
  truncatedInfoRef.current = truncatedInfo;
  const explorerTreeRef = useRef<HTMLDivElement>(null);
  const typeaheadBufferRef = useRef('');
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeaheadFocusedElRef = useRef<Element | null>(null);
  const mouseClickedRowRef = useRef<HTMLElement | null>(null);
  const contextMenuKeyboardRef = useRef(false);

  useEffect(() => {
    window.api.getPlatform?.().then(setPlatform).catch(() => {});
  }, []);

  useEffect(() => {
    if (!fileContextMenu) return;
    const handler = (e: MouseEvent) => {
      if (fileContextMenuRef.current?.contains(e.target as Node)) return;
      setFileContextMenu(null);
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [fileContextMenu]);

  useEffect(() => {
    if (!activeGroupId) return;
    if (prevSessionIdRef.current === activeGroupId) return;

    if (prevSessionIdRef.current && loadedRootRef.current) {
      treeCacheRef.current.set(prevSessionIdRef.current, {
        root: loadedRootRef.current,
        entries: entriesRef.current,
        truncated: truncatedInfoRef.current.truncated,
        totalCount: truncatedInfoRef.current.totalCount,
      });
    }

    prevSessionIdRef.current = activeGroupId;

    const cached = treeCacheRef.current.get(activeGroupId);
    if (cached) {
      loadedRootRef.current = cached.root;
      setEntries(cached.entries);
      setTruncatedInfo({ truncated: cached.truncated ?? false, totalCount: cached.totalCount ?? 0 });
    } else {
      loadedRootRef.current = null;
      setEntries([]);
      setTruncatedInfo({ truncated: false, totalCount: 0 });
    }
  }, [activeGroupId]);

  const loadFolder = useCallback(async (dirPath: string, forceRefresh = false) => {
    if (!window.api?.readDirectory || !activeGroupId) return;

    setExplorerRoot(dirPath);
    loadedRootRef.current = dirPath;
    if (!forceRefresh || entriesRef.current.length === 0) {
      setLoading(true);
    }
    try {
      const result = await window.api.readDirectory(dirPath, forceRefresh, MAX_DIR_ENTRIES, settings.showHiddenFiles);
      if (loadedRootRef.current === dirPath) {
        setEntries(result.entries);
        setTruncatedInfo({ truncated: result.truncated, totalCount: result.totalCount });
        treeCacheRef.current.set(activeGroupId, {
          root: dirPath,
          entries: result.entries,
          truncated: result.truncated,
          totalCount: result.totalCount,
        });
      }
    } catch {
      if (loadedRootRef.current === dirPath) {
        setEntries([]);
        setTruncatedInfo({ truncated: false, totalCount: 0 });
      }
    }
    if (loadedRootRef.current === dirPath) {
      setLoading(false);
    }
  }, [setExplorerRoot, activeGroupId]);

  useEffect(() => {
    if (!explorerRoot || !activeGroupId) return;
    if (loadedRootRef.current === explorerRoot) return;
    loadFolder(explorerRoot);
  }, [explorerRoot, activeGroupId, loadFolder]);

  useEffect(() => {
    if (!settings.autoLoadExplorer || !cwd || !activeGroupId) return;
    const normalizedCwd = normPath(cwd);
    const normalizedRoot = explorerRoot ? normPath(explorerRoot) : null;
    if (normalizedRoot === normalizedCwd) return;
    loadFolder(cwd);
  }, [settings.autoLoadExplorer, cwd, activeGroupId, explorerRoot, loadFolder]);

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
    if (focusedPaneId && window.api?.getTerminalCwd) {
      try {
        const liveCwd = await window.api.getTerminalCwd(focusedPaneId);
        if (liveCwd) {
          dir = liveCwd;
          updatePaneCwd(focusedPaneId, liveCwd);
        }
      } catch {
        // fall back to context cwd
      }
    }
    if (dir) loadFolder(dir);
  }, [cwd, focusedPaneId, updatePaneCwd, loadFolder]);

  const showHiddenFilesRef = useRef(settings.showHiddenFiles);
  useEffect(() => {
    if (showHiddenFilesRef.current === settings.showHiddenFiles) return;
    showHiddenFilesRef.current = settings.showHiddenFiles;
    if (explorerRoot) loadFolder(explorerRoot, true);
  }, [settings.showHiddenFiles, explorerRoot, loadFolder]);

  const handleRefresh = useCallback(() => {
    if (explorerRoot) {
      loadFolder(explorerRoot, true);
      refreshGitStatus();
    }
  }, [explorerRoot, loadFolder, refreshGitStatus]);

  const handleFileContextMenu = useCallback((path: string, isDirectory: boolean, e: React.MouseEvent) => {
    e.preventDefault();
    setFileContextMenu({ x: e.clientX, y: e.clientY, path, isDirectory });
  }, []);

  const clearTypeahead = useCallback(() => {
    typeaheadBufferRef.current = '';
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    typeaheadFocusedElRef.current?.classList.remove('tree-row-typeahead-focused');
    typeaheadFocusedElRef.current = null;
  }, []);

  useEffect(() => clearTypeahead, []);

  useEffect(() => {
    clearTypeahead();
  }, [collapseKey]);

  const handleTreeFocus = useCallback(() => {
    if (!explorerTreeRef.current) return;
    const clickedTarget = mouseClickedRowRef.current;
    mouseClickedRowRef.current = null;
    const target =
      clickedTarget ??
      explorerTreeRef.current.querySelector<HTMLElement>('.tree-row-explorer-active') ??
      explorerTreeRef.current.querySelector<HTMLElement>('.tree-row');
    if (!target) return;
    typeaheadFocusedElRef.current?.classList.remove('tree-row-typeahead-focused');
    target.classList.add('tree-row-typeahead-focused');
    typeaheadFocusedElRef.current = target;
    target.scrollIntoView({ block: 'nearest' });
  }, []);

  const handleTreeMouseDown = useCallback((e: React.MouseEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.tree-row');
    if (!row) return;
    // Store for handleTreeFocus to use when the container is gaining focus for the first time
    mouseClickedRowRef.current = row;
    // When the tree already has focus, onFocus won't fire again, so update the highlight directly
    if (document.activeElement === explorerTreeRef.current) {
      typeaheadFocusedElRef.current?.classList.remove('tree-row-typeahead-focused');
      row.classList.add('tree-row-typeahead-focused');
      typeaheadFocusedElRef.current = row;
    }
  }, []);

  useEffect(() => {
    if (!fileContextMenu) {
      if (contextMenuKeyboardRef.current) {
        contextMenuKeyboardRef.current = false;
        requestAnimationFrame(() => explorerTreeRef.current?.focus());
      }
      return;
    }
    if (!contextMenuKeyboardRef.current) return;
    const id = requestAnimationFrame(() => {
      fileContextMenuRef.current?.querySelector<HTMLElement>('button')?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [fileContextMenu]);

  const handleTreeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!explorerTreeRef.current) return;

    // Context menu via keyboard (Shift+F10 or dedicated ContextMenu key)
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const focused = typeaheadFocusedElRef.current as HTMLElement | null;
      if (!focused) return;
      const path = focused.dataset.path;
      if (!path) return;
      const isDirectory = focused.dataset.isDirectory === 'true';
      const rect = focused.getBoundingClientRect();
      contextMenuKeyboardRef.current = true;
      setFileContextMenu({ x: rect.left + 8, y: rect.bottom, path, isDirectory });
      return;
    }

    const moveFocus = (el: HTMLElement) => {
      typeaheadFocusedElRef.current?.classList.remove('tree-row-typeahead-focused');
      el.classList.add('tree-row-typeahead-focused');
      typeaheadFocusedElRef.current = el;
      el.scrollIntoView({ block: 'nearest' });
    };

    // Arrow / Enter navigation
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      // Clear typeahead buffer on manual navigation
      typeaheadBufferRef.current = '';
      if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);

      const rows = Array.from(explorerTreeRef.current.querySelectorAll<HTMLElement>('.tree-row'));
      if (rows.length === 0) return;

      const focused = typeaheadFocusedElRef.current as HTMLElement | null;
      const idx = focused ? rows.indexOf(focused) : -1;

      if (e.key === 'ArrowDown') {
        moveFocus(idx < 0 ? rows[0] : (rows[idx + 1] ?? rows[idx]));
      } else if (e.key === 'ArrowUp') {
        moveFocus(idx <= 0 ? rows[0] : rows[idx - 1]);
      } else if (e.key === 'Enter') {
        focused?.click();
      } else if (e.key === 'ArrowRight') {
        if (!focused) { moveFocus(rows[0]); return; }
        const isDir = focused.dataset.isDirectory === 'true';
        if (!isDir) return;
        const isExpanded = !!focused.parentElement?.querySelector(':scope > .tree-children');
        if (!isExpanded) {
          focused.click(); // expand
        } else {
          // move into first child
          const next = rows[idx + 1];
          if (next) moveFocus(next);
        }
      } else if (e.key === 'ArrowLeft') {
        if (!focused) return;
        const isDir = focused.dataset.isDirectory === 'true';
        const isExpanded = isDir && !!focused.parentElement?.querySelector(':scope > .tree-children');
        if (isExpanded) {
          focused.click(); // collapse
        } else {
          // move to parent folder row
          const treeNode = focused.parentElement; // .tree-node
          const treeChildren = treeNode?.parentElement; // .tree-children or .explorer-tree
          if (treeChildren?.classList.contains('tree-children')) {
            const parentRow = treeChildren.parentElement?.querySelector<HTMLElement>(':scope > .tree-row');
            if (parentRow) moveFocus(parentRow);
          }
        }
      }
      return;
    }

    // Type-ahead: printable characters only
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;

    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    typeaheadBufferRef.current += e.key.toLowerCase();

    typeaheadTimerRef.current = setTimeout(() => {
      typeaheadBufferRef.current = '';
    }, 800);

    const rows = explorerTreeRef.current.querySelectorAll<HTMLElement>('.tree-row');
    let matched: HTMLElement | null = null;
    for (const row of rows) {
      const nameEl = row.querySelector('.tree-name');
      if (nameEl?.textContent?.toLowerCase().startsWith(typeaheadBufferRef.current)) {
        matched = row;
        break;
      }
    }

    if (matched) {
      typeaheadFocusedElRef.current?.classList.remove('tree-row-typeahead-focused');
      matched.classList.add('tree-row-typeahead-focused');
      typeaheadFocusedElRef.current = matched;
      matched.scrollIntoView({ block: 'nearest' });
    }
  }, [setFileContextMenu]);

  const revealLabel = platform === 'darwin' ? 'Reveal in Finder' : platform === 'win32' ? 'Reveal in Explorer' : 'Open in File Manager';

  const handleFileClick = useCallback(
    (path: string, fromMouseClick?: boolean) => {
      setDiffFilePath(null);
      setOpenFilePath(path);
      if (fromMouseClick && !panelVisibility.editor) {
        setPanelVisibility('editor', true);
      }
    },
    [setOpenFilePath, setDiffFilePath, panelVisibility.editor, setPanelVisibility]
  );

  const handleChangeFileClick = useCallback(
    (path: string) => {
      setDiffFilePath(path);
      if (!panelVisibility.editor) {
        setPanelVisibility('editor', true);
      }
    },
    [setDiffFilePath, panelVisibility.editor, setPanelVisibility]
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

  const showEditorPanel = useCallback(() => {
    setPanelVisibility('editor', true);
  }, [setPanelVisibility]);

  const handleDiscardFile = useCallback((filePath: string) => {
    discardFiles([filePath]);
  }, [discardFiles]);

  const handleDiscardAll = useCallback((repoRoot?: string) => {
    const paths = repoRoot
      ? Object.keys(gitStatus).filter(fp => fp.startsWith(repoRoot.endsWith('/') ? repoRoot : repoRoot + '/'))
      : Object.keys(gitStatus);
    if (paths.length === 0) return;
    if (!window.confirm(`Discard all ${paths.length} change(s)? This cannot be undone.`)) return;
    discardFiles(paths);
  }, [gitStatus, discardFiles]);

  const [rootOpen, setRootOpen] = useState(true);
  const [revealGeneration, setRevealGeneration] = useState(0);

  const startCreate = useCallback((type: 'file' | 'folder', parentPath: string) => {
    setPendingCreate({ type, parentPath, value: '' });
    if (parentPath === explorerRoot) {
      setRootOpen(true);
    }
  }, [explorerRoot]);

  const cancelCreate = useCallback(() => {
    setPendingCreate(null);
  }, []);

  const changeCreateValue = useCallback((v: string) => {
    setPendingCreate(prev => prev ? { ...prev, value: v } : null);
  }, []);

  const agentContextPathsKey = useMemo(
    () => agentContextDirs.map(d => d.path).join('\0'),
    [agentContextDirs],
  );

  const syncedRevealFile = useMemo(() => {
    if (explorerOutOfSync || !openFilePath) return null;
    if (!panelVisibility.editor) return null;
    if (explorerRoot && isPathWithinRoot(openFilePath, explorerRoot)) return openFilePath;
    for (const d of agentContextDirs) {
      if (isPathWithinRoot(openFilePath, d.path)) return openFilePath;
    }
    return null;
  }, [explorerOutOfSync, openFilePath, explorerRoot, agentContextPathsKey, panelVisibility.editor]);

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
  const visibleContextDirs = useMemo(
    () => agentContextDirs.filter(d => d.path !== explorerRoot),
    [agentContextDirs, explorerRoot],
  );

  const allRoots = useMemo(() => {
    // Use the dirs from the last completed git fetch so that allRoots and gitStatus
    // always update atomically. This prevents the tree from flickering when switching
    // between terminals with different paths (roots would change instantly but git data
    // would still be from the previous fetch).
    if (lastFetchedDirs !== null) return lastFetchedDirs;
    const roots = explorerRoot ? [explorerRoot] : [];
    return roots.concat(visibleContextDirs.map(d => d.path));
  }, [lastFetchedDirs, explorerRoot, visibleContextDirs]);

  const combinedGitStatus = useMemo(() => {
    if (Object.keys(gitStagedStatus).length === 0) return gitStatus;
    return { ...gitStagedStatus, ...gitStatus };
  }, [gitStatus, gitStagedStatus]);

  const gitIgnoredSet = useMemo(() => new Set(gitIgnored), [gitIgnored]);

  const changesCount = Object.keys(gitStatus).length + Object.keys(gitStagedStatus).length;

  if (!explorerRoot) {
    if (settings.autoLoadExplorer && cwd) {
      return (
        <div className="panel explorer-panel">
          <div className="panel-header">
            <span className="panel-title panel-icon explorer-icon" data-tooltip="Explorer - drag to reorder" data-tooltip-pos="bottom"><VscFolderOpened size={16} /></span>
            <PanelMaximizeButton isMaximized={maximizedPanel === 'explorer'} onToggle={() => setMaximizedPanel(maximizedPanel === 'explorer' ? null : 'explorer')} />
            <PanelMinimizeButton onMinimize={() => { setMaximizedPanel(null); setPanelVisibility('explorer', false); }} tooltip={tooltipWithShortcut('Hide Explorer', 'toggle-explorer')} />
          </div>
          <div className="panel-body explorer-tree">
            <div className="explorer-loading">Loading...</div>
          </div>
        </div>
      );
    }
    return (
      <div className="panel explorer-panel">
        <div className="panel-header">
          <span className="panel-title panel-icon explorer-icon" data-tooltip="Explorer - drag to reorder" data-tooltip-pos="bottom"><VscFolderOpened size={16} /></span>
          <PanelMaximizeButton isMaximized={maximizedPanel === 'explorer'} onToggle={() => setMaximizedPanel(maximizedPanel === 'explorer' ? null : 'explorer')} />
          <PanelMinimizeButton onMinimize={() => { setMaximizedPanel(null); setPanelVisibility('explorer', false); }} tooltip={tooltipWithShortcut('Hide Explorer', 'toggle-explorer')} />
        </div>
        <div className="panel-body explorer-tree">
          <div className="explorer-prompt">
            <div className="editor-empty-icon">~</div>
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
    <CreateCtx.Provider value={{ pending: pendingCreate, onChange: changeCreateValue, onCancel: cancelCreate }}>
    <>
    <div className="panel explorer-panel">
      <div className="panel-header">
        <span className="panel-title panel-icon explorer-icon" data-tooltip={`${displayRoot} - drag to reorder`} data-tooltip-pos="bottom"><VscFolderOpened size={16} /></span>
        <div className="explorer-actions">
          {activeView === 'files' && explorerOutOfSync && !settings.autoLoadExplorer && (
            <IconButton
              className="explorer-action-btn explorer-sync-btn"
              tooltip="Sync to terminal directory"
              tooltipPos="bottom"
              onClick={handleLoadCwd}
            >
              ↻
            </IconButton>
          )}
          {activeView === 'files' && explorerRoot && (
            <>
              <IconButton
                className="explorer-action-btn"
                tooltip="New File"
                tooltipPos="bottom"
                onClick={() => startCreate('file', explorerRoot)}
              >
                <VscNewFile size={14} />
              </IconButton>
              <IconButton
                className="explorer-action-btn"
                tooltip="New Folder"
                tooltipPos="bottom"
                onClick={() => startCreate('folder', explorerRoot)}
              >
                <VscNewFolder size={14} />
              </IconButton>
              <IconButton
                className="explorer-action-btn"
                tooltip="Collapse all folders"
                tooltipPos="bottom"
                onClick={(e) => { e.stopPropagation(); setRootOpen(false); setCollapseKey(k => k + 1); }}
              >
                <VscCollapseAll size={14} />
              </IconButton>
              <IconButton
                className="explorer-action-btn"
                tooltip="Refresh file tree"
                tooltipPos="bottom"
                onClick={handleRefresh}
              >
                <VscRefresh size={14} />
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
              <VscRefresh size={14} />
            </IconButton>
          )}
          <PanelMaximizeButton isMaximized={maximizedPanel === 'explorer'} onToggle={() => setMaximizedPanel(maximizedPanel === 'explorer' ? null : 'explorer')} />
          <PanelMinimizeButton onMinimize={() => { setMaximizedPanel(null); setPanelVisibility('explorer', false); }} tooltip={tooltipWithShortcut('Hide Explorer', 'toggle-explorer')} />
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
          className={`explorer-view-tab ${activeView === 'search' ? 'explorer-view-tab-active' : ''}`}
          onClick={() => setActiveView('search')}
          data-tooltip="Search"
          data-tooltip-pos="bottom"
        >
          <VscSearch size={16} />
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
      {activeView === 'files' && explorerOutOfSync && !settings.autoLoadExplorer && (
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
          <div
            className="explorer-tree"
            ref={explorerTreeRef}
            tabIndex={0}
            onMouseDown={handleTreeMouseDown}
            onKeyDown={handleTreeKeyDown}
            onFocus={handleTreeFocus}
            onBlur={clearTypeahead}
          >
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
              ) : entries.length === 0 && !pendingCreate ? (
                <div className="explorer-empty">Empty directory</div>
              ) : (
                <>
                  {entries.map((entry) => (
                    <TreeNode
                      key={entry.path}
                      entry={entry}
                      depth={1}
                      onFileClick={handleFileClick}
                      onFileDoubleClick={showEditorPanel}
                      onContextMenu={handleFileContextMenu}
                      collapseKey={collapseKey}
                      gitStatus={combinedGitStatus}
                      gitIgnoredSet={gitIgnoredSet}
                      showHiddenFiles={settings.showHiddenFiles}
                      syncedRevealFile={syncedRevealFile}
                      revealGeneration={revealGeneration}
                    />
                  ))}
                  {truncatedInfo.truncated && (
                    <div className="explorer-truncated-row" style={{ paddingLeft: 16 }}>
                      {truncatedInfo.totalCount - entries.length} more items not shown
                    </div>
                  )}
                  {pendingCreate?.parentPath === explorerRoot && (
                    <CreateInputRow
                      depth={1}
                      type={pendingCreate.type}
                      value={pendingCreate.value}
                      onChange={changeCreateValue}
                      onConfirm={async () => {
                        const name = pendingCreate.value.trim();
                        if (!name) { cancelCreate(); return; }
                        const fullPath = explorerRoot + '/' + name;
                        if (pendingCreate.type === 'file') {
                          const result = await window.api.createFile(fullPath);
                          if (!result.error) {
                            await loadFolder(explorerRoot, true);
                            handleFileClick(fullPath, true);
                          }
                        } else {
                          const result = await window.api.createDirectory(fullPath);
                          if (!result.error) {
                            await loadFolder(explorerRoot, true);
                          }
                        }
                        cancelCreate();
                      }}
                      onCancel={cancelCreate}
                    />
                  )}
                </>
              )
            )}
            {visibleContextDirs.map((dir) => (
              <ContextDirSection
                key={dir.path}
                dir={dir}
                onFileClick={handleFileClick}
                onFileDoubleClick={showEditorPanel}
                onContextMenu={handleFileContextMenu}
                collapseKey={collapseKey}
                gitStatus={combinedGitStatus}
                gitIgnoredSet={gitIgnoredSet}
                showHiddenFiles={settings.showHiddenFiles}
                syncedRevealFile={syncedRevealFile}
                revealGeneration={revealGeneration}
              />
            ))}
          </div>
        ) : activeView === 'search' ? (
          <SearchView explorerRoot={explorerRoot} />
        ) : (
          <SourceControlView
            gitStatus={gitStatus}
            gitStagedStatus={gitStagedStatus}
            allRoots={allRoots}
            gitRepoRootsMap={gitRepoRootsMap}
            onFileClick={handleChangeFileClick}
            onFileDoubleClick={showEditorPanel}
            onStageFile={(path) => stageFiles([path])}
            onUnstageFile={(path) => unstageFiles([path])}
            onStageAll={handleStageAll}
            onUnstageAll={handleUnstageAll}
            onDiscardFile={handleDiscardFile}
            onDiscardAll={handleDiscardAll}
            onStash={stashChanges}
            onStashPop={stashPop}
            onCommitStaged={commitStaged}
            onCommitAll={commitAll}
            onUndoLastCommit={undoLastCommit}
          />
        )}
      </div>
    </div>

    {fileContextMenu && (() => {
      const menuWidth = 200;
      const relativePath = explorerRoot && fileContextMenu.path.startsWith(explorerRoot + '/')
        ? fileContextMenu.path.slice(explorerRoot.length + 1)
        : null;
      const newItemParent = fileContextMenu.isDirectory
        ? fileContextMenu.path
        : fileContextMenu.path.split('/').slice(0, -1).join('/');
      const menuHeight = 116
        + (relativePath !== null ? 28 : 0)
        + (fileContextMenu.isDirectory ? 64 : 0)
        + 65 + 37;
      const x = Math.min(fileContextMenu.x, window.innerWidth - menuWidth - 8);
      const y = Math.min(fileContextMenu.y, window.innerHeight - menuHeight - 8);
      return (
        <div
          ref={fileContextMenuRef}
          className="tab-context-menu"
          style={{ left: x, top: y }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setFileContextMenu(null);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              e.stopPropagation();
              const buttons = Array.from(fileContextMenuRef.current?.querySelectorAll<HTMLElement>('button') ?? []);
              const idx = buttons.indexOf(document.activeElement as HTMLElement);
              const next = e.key === 'ArrowDown'
                ? buttons[(idx + 1) % buttons.length]
                : buttons[(idx - 1 + buttons.length) % buttons.length];
              next?.focus();
            }
          }}
        >
          <button
            className="tab-context-item"
            onClick={() => { startCreate('file', newItemParent); setFileContextMenu(null); }}
          >
            New File
          </button>
          <button
            className="tab-context-item"
            onClick={() => { startCreate('folder', newItemParent); setFileContextMenu(null); }}
          >
            New Folder
          </button>
          <div className="tab-context-separator" />
          <button
            className="tab-context-item"
            onClick={() => { window.api.showItemInFolder(fileContextMenu.path); setFileContextMenu(null); }}
          >
            {revealLabel}
          </button>
          {fileContextMenu.isDirectory && (
            <>
              <div className="tab-context-separator" />
              <button
                className="tab-context-item"
                onClick={() => {
                  createGroupAtPath(fileContextMenu.path);
                  setPanelVisibility('terminal', true);
                  setFileContextMenu(null);
                }}
              >
                Open Terminal Here
              </button>
              <button
                className="tab-context-item"
                onClick={() => {
                  if (focusedPaneId) {
                    const escaped = fileContextMenu.path.replace(/"/g, '\\"');
                    window.api.writeTerminal(focusedPaneId, `cd "${escaped}"\r`);
                    setPanelVisibility('terminal', true);
                    requestAnimationFrame(() => {
                      document.querySelector<HTMLElement>(
                        `[data-session-id="${focusedPaneId}"] .xterm-helper-textarea`
                      )?.focus();
                    });
                  }
                  setFileContextMenu(null);
                }}
              >
                CD to Here
              </button>
            </>
          )}
          <div className="tab-context-separator" />
          <button
            className="tab-context-item"
            onClick={() => { navigator.clipboard.writeText(fileContextMenu.path); setFileContextMenu(null); }}
          >
            Copy Full Path
          </button>
          {relativePath !== null && (
            <button
              className="tab-context-item"
              onClick={() => { navigator.clipboard.writeText(relativePath); setFileContextMenu(null); }}
            >
              Copy Relative Path
            </button>
          )}
          <div className="tab-context-separator" />
          <button
            className="tab-context-item tab-context-item-danger"
            onClick={async () => {
              const name = fileContextMenu.path.split('/').pop() ?? fileContextMenu.path;
              const label = fileContextMenu.isDirectory ? `folder "${name}"` : `"${name}"`;
              if (!window.confirm(`Move ${label} to trash?`)) return;
              setFileContextMenu(null);
              const result = await window.api.trashPath(fileContextMenu.path);
              if (!result.error) {
                handleRefresh();
              }
            }}
          >
            Delete
          </button>
        </div>
      );
    })()}
    </>
    </CreateCtx.Provider>
  );
}
