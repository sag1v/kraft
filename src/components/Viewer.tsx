import React, { useState, useEffect, useMemo } from 'react';
import { useUIContext } from '../context/AppContext';
import { PanelMinimizeButton } from './IconButton';
import { FileIcon } from './FileIcon';
import { TabBar, type TabItem } from './TabBar';
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
  const { openFilePath, openFiles, closeFileTab, setActiveFileTab, reorderFileTabs, homeDir, setPanelVisibility } = useUIContext();
  const [contentCache, setContentCache] = useState<Record<string, { content: string | null; error: string | null }>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!openFilePath) {
      setLoading(false);
      return;
    }

    if (contentCache[openFilePath]) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const result = await window.api.readFile(openFilePath);
        if (!cancelled) {
          if (result.error) {
            setContentCache(prev => ({ ...prev, [openFilePath]: { content: null, error: result.error } }));
          } else {
            setContentCache(prev => ({ ...prev, [openFilePath]: { content: result.content, error: null } }));
          }
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setContentCache(prev => ({ ...prev, [openFilePath]: { content: null, error: e.message } }));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openFilePath]);

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
          onActivate={setActiveFileTab}
          onClose={closeFileTab}
          onReorder={reorderFileTabs}
          className="tabbed-panel-tabs"
        />
        <PanelMinimizeButton onMinimize={() => setPanelVisibility('viewer', false)} />
      </div>
      <div className="panel-body viewer-body">
        {loading ? (
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
