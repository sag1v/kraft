import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { PanelMinimizeButton } from './IconButton';
import { tooltipWithShortcut } from '../shortcuts';
import { FileIcon } from './FileIcon';
import { TabBar, type TabItem } from './TabBar';
import { DiffView } from './DiffView';
import { shortenPath } from '../utils';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';

export function Viewer() {
  const {
    openFilePath,
    openFiles,
    closeFileTab,
    closeOtherFileTabs,
    closeAllFileTabs,
    setActiveFileTab,
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
  const [fileVersion, setFileVersion] = useState(0);
  const fetchedVersionRef = useRef<Record<string, number>>({});

  // Search state — used by DiffView only; CodeEditor handles its own search natively
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [diffMatchCount, setDiffMatchCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [editDrafts, setEditDrafts] = useState<Record<string, string>>({});

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
      fetchedVersionRef.current[filePath] = fileVersion;
    }
  }, [editDrafts, fileVersion]);

  useEffect(() => {
    if (!openFilePath || !window.api?.watchFile || !window.api?.onFileChanged) return;
    window.api.watchFile(openFilePath);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = window.api.onFileChanged((changedPath) => {
      if (changedPath !== openFilePath) return;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        setFileVersion(v => v + 1);
      }, 400);
    });
    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      window.api.unwatchFile(openFilePath);
      unsubscribe();
    };
  }, [openFilePath]);

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
  }, [openFilePath, fileVersion]);

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
            {subpath && <span className="viewer-tab-subpath">{subpath}</span>}
            {isUnsaved && <span className="viewer-tab-unsaved" title="Unsaved changes">●</span>}
          </>
        ),
      };
    }),
    [openFiles, duplicateNames, homeDir, contentCache, editDrafts],
  );

  return (
    <div className="panel viewer-panel">
      <div className="panel-header tabbed-panel-header">
        <span className="panel-title panel-icon viewer-icon tabbed-panel-title" data-tooltip="Viewer - drag to reorder" data-tooltip-pos="bottom">{'{}'}</span>
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
            className={`viewer-diff-toggle ${isDiffMode ? 'active' : ''}`}
            onClick={() => setDiffFilePath(isDiffMode ? null : openFilePath)}
            data-tooltip={isDiffMode ? 'Show code' : 'Show diff'}
            data-tooltip-pos="bottom"
          >
            Diff
          </button>
        )}
        <PanelMinimizeButton onMinimize={() => setPanelVisibility('viewer', false)} tooltip={tooltipWithShortcut('Hide Viewer', 'toggle-viewer')} />
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
        <div className="viewer-search-bar">
          <input
            ref={searchInputRef}
            className="viewer-search-input"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search..."
            spellCheck={false}
          />
          <span className="viewer-search-count">
            {searchQuery
              ? diffMatchCount === 0 ? 'No results' : `${activeMatchIndex + 1} / ${diffMatchCount}`
              : ''}
          </span>
          <button className="viewer-search-btn" onClick={goPrev} title="Previous (Shift+Enter)">↑</button>
          <button className="viewer-search-btn" onClick={goNext} title="Next (Enter)">↓</button>
          <button
            className={`viewer-search-btn viewer-search-toggle${caseSensitive ? ' active' : ''}`}
            onClick={() => setCaseSensitive(v => !v)}
            title="Match Case"
          >Aa</button>
          <button
            className={`viewer-search-btn viewer-search-toggle${wholeWord ? ' active' : ''}`}
            onClick={() => setWholeWord(v => !v)}
            title="Match Whole Word"
          >W</button>
          <button className="viewer-search-btn" onClick={() => { setSearchVisible(false); setSearchQuery(''); }} title="Close (Esc)">✕</button>
        </div>
      )}
      {isConflictFile && !effectiveDiffMode && (
        <div className="viewer-conflict-banner">
          <span className="viewer-conflict-icon">!</span>
          {conflictCount > 0 ? (
            <>
              <span className="viewer-conflict-count">
                {conflictCount} merge conflict{conflictCount !== 1 ? 's' : ''}
              </span>
              <div className="viewer-conflict-nav">
                <button
                  className="viewer-conflict-nav-btn"
                  onClick={() => codeEditorRef.current?.navigateConflict('prev')}
                  title="Previous conflict"
                >↑</button>
                <button
                  className="viewer-conflict-nav-btn"
                  onClick={() => codeEditorRef.current?.navigateConflict('next')}
                  title="Next conflict"
                >↓</button>
              </div>
            </>
          ) : (
            <span className="viewer-conflict-count viewer-conflict-all-resolved">
              All conflicts resolved
            </span>
          )}
          <button
            className="viewer-conflict-resolve-btn"
            disabled={conflictCount > 0}
            onClick={markResolved}
            title={conflictCount > 0 ? 'Resolve all conflicts first' : 'Stage file as resolved'}
          >
            Mark Resolved
          </button>
        </div>
      )}
      <div className="panel-body viewer-body">
        {effectiveDiffMode && openFilePath ? (
          <DiffView
            filePath={openFilePath}
            version={fileVersion}
            searchQuery={searchQuery}
            caseSensitive={caseSensitive}
            wholeWord={wholeWord}
            activeMatchIndex={activeMatchIndex}
            onMatchCountChange={handleDiffMatchCountChange}
          />
        ) : loading ? (
          <div className="viewer-placeholder">Loading...</div>
        ) : error ? (
          <div className="viewer-placeholder viewer-error">{error}</div>
        ) : !openFilePath ? (
          <div className="viewer-placeholder">
            <div className="viewer-empty-icon">[ ]</div>
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
        <div className="viewer-git-error-overlay">
          <div className="viewer-git-error-header">
            <span className="viewer-git-error-icon">⚠</span>
            <span className="viewer-git-error-title">{errorViewTitle}</span>
            <CopyButton text={gitErrorViewContent} />
            <button
              className="viewer-git-error-close"
              onClick={() => setGitErrorViewContent(null)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="viewer-git-error-body">
            <pre className="viewer-git-error-pre">{gitErrorViewContent}</pre>
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
      className="viewer-git-error-copy"
      onClick={handleCopy}
      aria-label="Copy error"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}
