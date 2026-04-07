import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { PanelMinimizeButton } from './IconButton';
import { FileIcon } from './FileIcon';
import { TabBar, type TabItem } from './TabBar';
import { DiffView } from './DiffView';
import { shortenPath } from '../utils';
import hljs from 'highlight.js';

const extToLang: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  css: 'css',
  scss: 'scss',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  mdx: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  sql: 'sql',
  toml: 'ini',
  ini: 'ini',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  graphql: 'graphql',
  gql: 'graphql',
  swift: 'swift',
  kt: 'kotlin',
};

function getLanguage(filePath: string): string | undefined {
  const name = filePath.split('/').pop()?.toLowerCase() || '';
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  const ext = name.split('.').pop() || '';
  return extToLang[ext];
}

function highlightCode(code: string, filePath: string): string {
  const lang = getLanguage(filePath);
  if (lang) {
    try {
      return hljs.highlight(code, { language: lang }).value;
    } catch {
      // fall through
    }
  }
  try {
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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
  } = useUIContext();
  const { gitStatus, explorerRoot } = useSessionContext();
  const [contentCache, setContentCache] = useState<Record<string, { content: string | null; error: string | null }>>({});
  const [loading, setLoading] = useState(false);
  const [fileVersion, setFileVersion] = useState(0);
  const fetchedVersionRef = useRef<Record<string, number>>({});

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

  useEffect(() => {
    if (!explorerRoot || !window.api?.onDirectoryChanged) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = window.api.onDirectoryChanged(() => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        setFileVersion(v => v + 1);
      }, 400);
    });
    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, [explorerRoot]);

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

    return () => {
      cancelled = true;
    };
  }, [openFilePath, fileVersion]);

  useEffect(() => {
    const staleKeys = Object.keys(contentCache).filter(k => !openFiles.includes(k));
    if (staleKeys.length > 0) {
      setContentCache(prev => {
        const next = { ...prev };
        for (const k of staleKeys) delete next[k];
        return next;
      });
    }
  }, [openFiles]);

  const cached = openFilePath ? contentCache[openFilePath] : undefined;
  const content = cached?.content ?? null;
  const error = cached?.error ?? null;

  const highlightedHtml = useMemo(() => {
    if (!content || !openFilePath) return '';
    return highlightCode(content, openFilePath);
  }, [content, openFilePath]);

  const lineCount = content ? content.split('\n').length : 0;
  const isDiffMode = !!(openFilePath && diffFilePath === openFilePath);
  const fileHasChanges = !!(openFilePath && gitStatus[openFilePath]);

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
      return {
        id: filePath,
        tooltip: shortenPath(filePath, homeDir),
        label: (
          <>
            <FileIcon name={name} isDirectory={false} />
            <span className="tab-item-label">{name}</span>
            {subpath && <span className="viewer-tab-subpath">{subpath}</span>}
          </>
        ),
      };
    }),
    [openFiles, duplicateNames, homeDir],
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
        {openFilePath && fileHasChanges && (
          <button
            className={`viewer-diff-toggle ${isDiffMode ? 'active' : ''}`}
            onClick={() => setDiffFilePath(isDiffMode ? null : openFilePath)}
            data-tooltip={isDiffMode ? 'Show code' : 'Show diff'}
            data-tooltip-pos="bottom"
          >
            Diff
          </button>
        )}
        <PanelMinimizeButton onMinimize={() => setPanelVisibility('viewer', false)} />
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
      <div className="panel-body viewer-body">
        {isDiffMode && openFilePath ? (
          <DiffView filePath={openFilePath} />
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
          <div className="viewer-code-wrapper">
            <div className="viewer-line-numbers">
              {Array.from({ length: lineCount }, (_, i) => (
                <span key={i} className="viewer-line-number">
                  {i + 1}
                </span>
              ))}
            </div>
            <pre className="viewer-code">
              <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
