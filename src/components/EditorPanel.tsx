import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { PanelMinimizeButton } from './IconButton';
import { tooltipWithShortcut } from '../shortcuts';
import { FileIcon } from './FileIcon';
import { TabBar, type TabItem } from './TabBar';
import { DiffView } from './DiffView';
import { shortenPath } from '../utils';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';

export function EditorPanel() {
  const {
    openFilePath,
    openFiles,
    closeFileTab,
    closeOtherFileTabs,
    closeAllFileTabs,
    setActiveFileTab,
    setOpenFilePath,
    reorderFileTabs,
    homeDir,
    setPanelVisibility,
    diffFilePath,
    setDiffFilePath,
    gitErrorViewContent,
    setGitErrorViewContent,
    errorViewTitle,
  } = useUIContext();
  const { gitStatus, gitStagedStatus, stageFiles, getRepoRootForFile } = useSessionContext();
  const codeEditorRef = useRef<CodeEditorHandle>(null);
  const [contentCache, setContentCache] = useState<Record<string, { content: string | null; error: string | null }>>({});
  const [loading, setLoading] = useState(false);
  const [fileVersions, setFileVersions] = useState<Record<string, number>>({});
  const fetchedVersionRef = useRef<Record<string, number>>({});
  const pendingNavLineRef = useRef<number | null>(null);
  const openFilePathRef = useRef(openFilePath);
  openFilePathRef.current = openFilePath;

  // Search state — used by DiffView only; CodeEditor handles its own search natively
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [diffMatchCount, setDiffMatchCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [editDrafts, setEditDrafts] = useState<Record<string, string>>({});
  const editDraftsRef = useRef(editDrafts);
  editDraftsRef.current = editDrafts;
  const [diskChangedFiles, setDiskChangedFiles] = useState<Set<string>>(new Set());

  const [tabContextMenu, setTabContextMenu] = useState<{
    x: number;
    y: number;
    filePath: string;
  } | null>(null);
  const tabContextMenuRef = useRef<HTMLDivElement>(null);

  const closeTabContextMenu = useCallback(() => {
    setTabContextMenu(null);
  }, []);

  useEffect(() => {
    if (!tabContextMenu) return;
    const onClick = (e: MouseEvent) => {
      if (tabContextMenuRef.current?.contains(e.target as Node)) return;
      closeTabContextMenu();
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [tabContextMenu, closeTabContextMenu]);

  const handleTabContextMenu = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault();
    setTabContextMenu({ x: e.clientX, y: e.clientY, filePath: id });
  }, []);

  const saveFile = useCallback(async (filePath: string) => {
    const draft = editDrafts[filePath];
    if (draft === undefined) return;
    const result = await window.api.writeFile(filePath, draft);
    if (!result.error) {
      setContentCache(prev => ({ ...prev, [filePath]: { content: draft, error: null } }));
      setEditDrafts(prev => { const next = { ...prev }; delete next[filePath]; return next; });
      fetchedVersionRef.current[filePath] = fileVersions[filePath] ?? 0;
      setDiskChangedFiles(prev => {
        if (!prev.has(filePath)) return prev;
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
    }
  }, [editDrafts, fileVersions]);

  useEffect(() => {
    if (!openFiles.length || !window.api?.watchFile || !window.api?.onFileChanged) return;
    openFiles.forEach(f => window.api.watchFile(f));
    const timers: Record<string, ReturnType<typeof setTimeout>> = {};
    const unsubscribe = window.api.onFileChanged((changedPath) => {
      if (!openFiles.includes(changedPath)) return;
      if (timers[changedPath]) clearTimeout(timers[changedPath]);
      timers[changedPath] = setTimeout(() => {
        delete timers[changedPath];
        setFileVersions(prev => ({ ...prev, [changedPath]: (prev[changedPath] ?? 0) + 1 }));
      }, 400);
    });
    return () => {
      Object.values(timers).forEach(clearTimeout);
      openFiles.forEach(f => window.api.unwatchFile(f));
      unsubscribe();
    };
  }, [openFiles]);

  // Handle navigation requests from search panel
  useEffect(() => {
    const handler = (e: Event) => {
      const { path: targetPath, line } = (e as CustomEvent<{ path: string; line: number }>).detail;
      pendingNavLineRef.current = line;
      setPanelVisibility('editor', true);
      if (openFilePathRef.current === targetPath) {
        // File already open — scroll immediately after render
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            codeEditorRef.current?.scrollToLine(line);
            pendingNavLineRef.current = null;
          });
        });
      } else {
        setOpenFilePath(targetPath);
      }
    };
    window.addEventListener('kraft:open-file-at-line', handler);
    return () => window.removeEventListener('kraft:open-file-at-line', handler);
  }, [setOpenFilePath, setPanelVisibility]);

  // Scroll to pending line once file finishes loading
  useEffect(() => {
    if (loading || !openFilePath || pendingNavLineRef.current === null) return;
    const line = pendingNavLineRef.current;
    pendingNavLineRef.current = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        codeEditorRef.current?.scrollToLine(line);
      });
    });
  }, [loading, openFilePath]);

  const isDiffMode = !!(openFilePath && diffFilePath === openFilePath);
  const isConflictFile = !!(openFilePath && gitStatus[openFilePath] === 'conflict');
  // Conflict files use inline markers as their diff — diff mode is disabled for them
  const effectiveDiffMode = isDiffMode && !isConflictFile;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+F: open search bar only in diff mode; CodeEditor handles it natively otherwise
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && openFilePath && effectiveDiffMode) {
        e.preventDefault();
        setSearchVisible(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      // Cmd+S: save current file if there's an unsaved draft
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && openFilePath) {
        e.preventDefault();
        saveFile(openFilePath);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openFilePath, effectiveDiffMode, saveFile]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery, caseSensitive, wholeWord, openFilePath]);

  useEffect(() => {
    if (!openFilePath) {
      setLoading(false);
      return;
    }

    const fileVersion = fileVersions[openFilePath] ?? 0;
    const hasCached = !!contentCache[openFilePath];
    const lastFetchedVersion = fetchedVersionRef.current[openFilePath] ?? -1;

    if (hasCached && lastFetchedVersion === fileVersion) {
      setLoading(false);
      return;
    }

    setLoading(!hasCached);

    let cancelled = false;

    (async () => {
      try {
        const result = await window.api.readFile(openFilePath);
        if (!cancelled) {
          fetchedVersionRef.current[openFilePath] = fileVersion;
          if (result.error) {
            setContentCache(prev => ({ ...prev, [openFilePath]: { content: null, error: result.error } }));
          } else {
            setContentCache(prev => ({ ...prev, [openFilePath]: { content: result.content, error: null } }));
            const localDraft = editDraftsRef.current[openFilePath];
            if (localDraft !== undefined && localDraft !== result.content) {
              setDiskChangedFiles(prev => new Set([...prev, openFilePath]));
            } else {
              setDiskChangedFiles(prev => {
                if (!prev.has(openFilePath)) return prev;
                const next = new Set(prev);
                next.delete(openFilePath);
                return next;
              });
            }
          }
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          fetchedVersionRef.current[openFilePath] = fileVersion;
          setContentCache(prev => ({ ...prev, [openFilePath]: { content: null, error: e.message } }));
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [openFilePath, fileVersions]);

  useEffect(() => {
    const staleKeys = Object.keys(contentCache).filter(k => !openFiles.includes(k));
    if (staleKeys.length > 0) {
      setContentCache(prev => {
        const next = { ...prev };
        for (const k of staleKeys) delete next[k];
        return next;
      });
      setEditDrafts(prev => {
        const next = { ...prev };
        for (const k of staleKeys) delete next[k];
        return next;
      });
      setDiskChangedFiles(prev => {
        const stale = staleKeys.filter(k => prev.has(k));
        if (!stale.length) return prev;
        const next = new Set(prev);
        for (const k of stale) next.delete(k);
        return next;
      });
    }
  }, [openFiles]);

  const cached = openFilePath ? contentCache[openFilePath] : undefined;
  const content = cached?.content ?? null;
  const error = cached?.error ?? null;

  const fileHasChanges = !!(openFilePath && (gitStatus[openFilePath] || gitStagedStatus[openFilePath]));

  // Count remaining <<<<<<< markers in the current (possibly edited) content
  const conflictCount = useMemo(() => {
    if (!isConflictFile || effectiveDiffMode || !openFilePath) return 0;
    const text = editDrafts[openFilePath] ?? contentCache[openFilePath]?.content ?? '';
    let count = 0;
    for (const line of text.split('\n')) {
      if (line.startsWith('<<<<<<<')) count++;
    }
    return count;
  }, [isConflictFile, effectiveDiffMode, openFilePath, editDrafts, contentCache]);

  const markResolved = useCallback(async () => {
    if (!openFilePath) return;
    await saveFile(openFilePath);
    stageFiles([openFilePath]);
  }, [openFilePath, saveFile, stageFiles]);

  const handleReloadFromDisk = useCallback(() => {
    if (!openFilePath) return;
    setEditDrafts(prev => { const next = { ...prev }; delete next[openFilePath]; return next; });
    setDiskChangedFiles(prev => { const next = new Set(prev); next.delete(openFilePath); return next; });
  }, [openFilePath]);

  const handleKeepLocalChanges = useCallback(() => {
    if (!openFilePath) return;
    setDiskChangedFiles(prev => { const next = new Set(prev); next.delete(openFilePath); return next; });
  }, [openFilePath]);

  const goNext = useCallback(() => {
    setActiveMatchIndex(i => diffMatchCount > 0 ? (i + 1) % diffMatchCount : 0);
  }, [diffMatchCount]);

  const goPrev = useCallback(() => {
    setActiveMatchIndex(i => diffMatchCount > 0 ? (i - 1 + diffMatchCount) % diffMatchCount : 0);
  }, [diffMatchCount]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) goPrev(); else goNext();
    } else if (e.key === 'Escape') {
      setSearchVisible(false);
      setSearchQuery('');
    }
  }, [goNext, goPrev]);

  const handleDiffMatchCountChange = useCallback((count: number) => {
    setDiffMatchCount(count);
    setActiveMatchIndex(i => i >= count ? 0 : i);
  }, []);

  const duplicateNames = useMemo(() => {
    const names = openFiles.map(f => f.split('/').pop() || f);
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const n of names) {
      if (seen.has(n)) dupes.add(n);
      seen.add(n);
    }
    return dupes;
  }, [openFiles]);

  const tabs = useMemo<TabItem[]>(() =>
    openFiles.map(filePath => {
      const name = filePath.split('/').pop() || filePath;
      const parts = filePath.split('/');
      const subpath = duplicateNames.has(name) && parts.length >= 2
        ? parts[parts.length - 2]
        : null;
      const savedContent = contentCache[filePath]?.content;
      const draft = editDrafts[filePath];
      const isUnsaved = draft !== undefined && draft !== savedContent;
      return {
        id: filePath,
        tooltip: shortenPath(filePath, homeDir),
        label: (
          <>
            <FileIcon name={name} isDirectory={false} />
            <span className="tab-item-label">{name}</span>
            {subpath && <span className="editor-tab-subpath">{subpath}</span>}
            {isUnsaved && <span className="editor-tab-unsaved" title="Unsaved changes">●</span>}
          </>
        ),
      };
    }),
    [openFiles, duplicateNames, homeDir, contentCache, editDrafts],
  );

  return (
    <div className="panel editor-panel">
      <div className="panel-header tabbed-panel-header">
        <span className="panel-title panel-icon editor-icon tabbed-panel-title" data-tooltip="Editor - drag to reorder" data-tooltip-pos="bottom">{'{}'}</span>
        <TabBar
          tabs={tabs}
          activeId={openFilePath}
          onActivate={(id) => { setDiffFilePath(null); setActiveFileTab(id); }}
          onClose={closeFileTab}
          onReorder={reorderFileTabs}
          onContextMenu={handleTabContextMenu}
          className="tabbed-panel-tabs"
        />
        {openFilePath && fileHasChanges && !isConflictFile && (
          <button
            className={`editor-diff-toggle ${isDiffMode ? 'active' : ''}`}
            onClick={() => setDiffFilePath(isDiffMode ? null : openFilePath)}
            data-tooltip={isDiffMode ? 'Show code' : 'Show diff'}
            data-tooltip-pos="bottom"
          >
            Diff
          </button>
        )}
        <PanelMinimizeButton onMinimize={() => setPanelVisibility('editor', false)} tooltip={tooltipWithShortcut('Hide Editor', 'toggle-editor')} />
      </div>
      {tabContextMenu && openFiles.length > 0 && (
        <div
          ref={tabContextMenuRef}
          className="tab-context-menu"
          style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          role="menu"
        >
          <button
            type="button"
            className="tab-context-item"
            role="menuitem"
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              closeFileTab(tabContextMenu.filePath);
              closeTabContextMenu();
            }}
          >
            Close
          </button>
          {openFiles.length > 1 && (
            <button
              type="button"
              className="tab-context-item"
              role="menuitem"
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                closeOtherFileTabs(tabContextMenu.filePath);
                closeTabContextMenu();
              }}
            >
              Close Others
            </button>
          )}
          <button
            type="button"
            className="tab-context-item"
            role="menuitem"
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              closeAllFileTabs();
              closeTabContextMenu();
            }}
          >
            Close All
          </button>
        </div>
      )}
      {searchVisible && effectiveDiffMode && openFilePath && (
        <div className="editor-search-bar">
          <input
            ref={searchInputRef}
            className="editor-search-input"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search..."
            spellCheck={false}
          />
          <span className="editor-search-count">
            {searchQuery
              ? diffMatchCount === 0 ? 'No results' : `${activeMatchIndex + 1} / ${diffMatchCount}`
              : ''}
          </span>
          <button className="editor-search-btn" onClick={goPrev} title="Previous (Shift+Enter)">↑</button>
          <button className="editor-search-btn" onClick={goNext} title="Next (Enter)">↓</button>
          <button
            className={`editor-search-btn editor-search-toggle${caseSensitive ? ' active' : ''}`}
            onClick={() => setCaseSensitive(v => !v)}
            title="Match Case"
          >Aa</button>
          <button
            className={`editor-search-btn editor-search-toggle${wholeWord ? ' active' : ''}`}
            onClick={() => setWholeWord(v => !v)}
            title="Match Whole Word"
          >W</button>
          <button className="editor-search-btn" onClick={() => { setSearchVisible(false); setSearchQuery(''); }} title="Close (Esc)">✕</button>
        </div>
      )}
      {openFilePath && diskChangedFiles.has(openFilePath) && (
        <div className="editor-conflict-banner">
          <span className="editor-conflict-icon">!</span>
          <span className="editor-conflict-count">File changed on disk</span>
          <div className="editor-conflict-nav">
            <button className="editor-conflict-nav-btn" onClick={handleReloadFromDisk} title="Discard local edits and load from disk">Reload</button>
            <button className="editor-conflict-nav-btn" onClick={handleKeepLocalChanges} title="Keep your local edits">Keep local</button>
          </div>
        </div>
      )}
      {isConflictFile && !effectiveDiffMode && (
        <div className="editor-conflict-banner">
          <span className="editor-conflict-icon">!</span>
          {conflictCount > 0 ? (
            <>
              <span className="editor-conflict-count">
                {conflictCount} merge conflict{conflictCount !== 1 ? 's' : ''}
              </span>
              <div className="editor-conflict-nav">
                <button
                  className="editor-conflict-nav-btn"
                  onClick={() => codeEditorRef.current?.navigateConflict('prev')}
                  title="Previous conflict"
                >↑</button>
                <button
                  className="editor-conflict-nav-btn"
                  onClick={() => codeEditorRef.current?.navigateConflict('next')}
                  title="Next conflict"
                >↓</button>
              </div>
            </>
          ) : (
            <span className="editor-conflict-count editor-conflict-all-resolved">
              All conflicts resolved
            </span>
          )}
          <button
            className="editor-conflict-resolve-btn"
            disabled={conflictCount > 0}
            onClick={markResolved}
            title={conflictCount > 0 ? 'Resolve all conflicts first' : 'Stage file as resolved'}
          >
            Mark Resolved
          </button>
        </div>
      )}
      <div className="panel-body editor-body">
        {effectiveDiffMode && openFilePath ? (
          <DiffView
            filePath={openFilePath}
            version={fileVersions[openFilePath] ?? 0}
            searchQuery={searchQuery}
            caseSensitive={caseSensitive}
            wholeWord={wholeWord}
            activeMatchIndex={activeMatchIndex}
            onMatchCountChange={handleDiffMatchCountChange}
          />
        ) : loading ? (
          <div className="editor-placeholder">Loading...</div>
        ) : error ? (
          <div className="editor-placeholder editor-error">{error}</div>
        ) : !openFilePath ? (
          <div className="editor-placeholder">
            <div className="editor-empty-icon">[ ]</div>
            <div>Select a file from the Explorer</div>
          </div>
        ) : content !== null ? (
          <CodeEditor
            ref={codeEditorRef}
            filePath={openFilePath}
            value={editDrafts[openFilePath] ?? content}
            onChange={draft => setEditDrafts(prev => ({ ...prev, [openFilePath]: draft }))}
          />
        ) : null}
      </div>
      {gitErrorViewContent && (
        <div className="editor-git-error-overlay">
          <div className="editor-git-error-header">
            <span className="editor-git-error-icon">⚠</span>
            <span className="editor-git-error-title">{errorViewTitle}</span>
            <CopyButton text={gitErrorViewContent} />
            <button
              className="editor-git-error-close"
              onClick={() => setGitErrorViewContent(null)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="editor-git-error-body">
            <pre className="editor-git-error-pre">{gitErrorViewContent}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      className="editor-git-error-copy"
      onClick={handleCopy}
      aria-label="Copy error"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}
