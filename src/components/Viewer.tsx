import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { PanelMinimizeButton } from './IconButton';
import { tooltipWithShortcut } from '../shortcuts';
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

function findTextMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
): Array<{ start: number; end: number }> {
  if (!query) return [];
  try {
    let pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) pattern = `\\b${pattern}\\b`;
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(pattern, flags);
    const matches: Array<{ start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) regex.lastIndex++;
    }
    return matches;
  } catch {
    return [];
  }
}

function injectMarksIntoHtml(
  html: string,
  matches: Array<{ start: number; end: number }>,
  activeMatchIndex: number,
): string {
  if (matches.length === 0) return html;

  // Map each text-content character index to its byte range in the HTML string.
  const charMap: Array<{ htmlStart: number; htmlEnd: number }> = [];
  let j = 0;
  while (j < html.length) {
    if (html[j] === '<') {
      while (j < html.length && html[j] !== '>') j++;
      j++;
    } else if (html[j] === '&') {
      const start = j;
      while (j < html.length && html[j] !== ';') j++;
      j++;
      charMap.push({ htmlStart: start, htmlEnd: j });
    } else {
      charMap.push({ htmlStart: j, htmlEnd: j + 1 });
      j++;
    }
  }

  const insertions: Array<{ htmlOffset: number; text: string }> = [];
  for (let mi = 0; mi < matches.length; mi++) {
    const { start, end } = matches[mi];
    const cls = mi === activeMatchIndex ? 'search-mark search-mark-active' : 'search-mark';
    if (start < charMap.length) {
      insertions.push({ htmlOffset: charMap[start].htmlStart, text: `<mark class="${cls}">` });
    }
    const last = end - 1;
    if (last >= 0 && last < charMap.length) {
      insertions.push({ htmlOffset: charMap[last].htmlEnd, text: '</mark>' });
    }
  }

  // Opening tags before closing tags at the same offset to keep nesting valid.
  insertions.sort((a, b) =>
    a.htmlOffset !== b.htmlOffset ? a.htmlOffset - b.htmlOffset : (a.text.startsWith('</') ? 1 : -1),
  );

  let result = '';
  let prev = 0;
  for (const { htmlOffset, text } of insertions) {
    if (htmlOffset >= prev) {
      result += html.slice(prev, htmlOffset);
      result += text;
      prev = htmlOffset;
    }
  }
  result += html.slice(prev);
  return result;
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
  const { gitStatus, gitStagedStatus } = useSessionContext();
  const [contentCache, setContentCache] = useState<Record<string, { content: string | null; error: string | null }>>({});
  const [loading, setLoading] = useState(false);
  const [fileVersion, setFileVersion] = useState(0);
  const fetchedVersionRef = useRef<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [diffMatchCount, setDiffMatchCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && openFilePath) {
        e.preventDefault();
        setSearchVisible(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openFilePath]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery, caseSensitive, wholeWord, openFilePath]);

  useEffect(() => {
    if (!searchVisible) return;
    document.querySelector('.search-mark-active')?.scrollIntoView({ block: 'nearest' });
  }, [activeMatchIndex, searchVisible]);

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
  const fileHasChanges = !!(openFilePath && (gitStatus[openFilePath] || gitStagedStatus[openFilePath]));

  const contentMatches = useMemo(
    () => findTextMatches(content ?? '', searchQuery, caseSensitive, wholeWord),
    [content, searchQuery, caseSensitive, wholeWord],
  );

  const totalMatches = isDiffMode ? diffMatchCount : contentMatches.length;

  const highlightedHtmlWithMarks = useMemo(() => {
    if (isDiffMode || !searchQuery) return highlightedHtml;
    return injectMarksIntoHtml(highlightedHtml, contentMatches, activeMatchIndex);
  }, [isDiffMode, highlightedHtml, contentMatches, activeMatchIndex, searchQuery]);

  const goNext = useCallback(() => {
    setActiveMatchIndex(i => totalMatches > 0 ? (i + 1) % totalMatches : 0);
  }, [totalMatches]);

  const goPrev = useCallback(() => {
    setActiveMatchIndex(i => totalMatches > 0 ? (i - 1 + totalMatches) % totalMatches : 0);
  }, [totalMatches]);

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
      {searchVisible && openFilePath && (
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
              ? totalMatches === 0 ? 'No results' : `${activeMatchIndex + 1} / ${totalMatches}`
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
      <div className="panel-body viewer-body">
        {isDiffMode && openFilePath ? (
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
          <div className="viewer-code-wrapper">
            <div className="viewer-line-numbers">
              {Array.from({ length: lineCount }, (_, i) => (
                <span key={i} className="viewer-line-number">
                  {i + 1}
                </span>
              ))}
            </div>
            <pre className="viewer-code">
              <code dangerouslySetInnerHTML={{ __html: highlightedHtmlWithMarks }} />
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
