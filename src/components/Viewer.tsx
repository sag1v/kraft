import React, { useState, useEffect, useMemo } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { IconButton } from './IconButton';
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
  const { openFilePath, theme, homeDir, setPanelVisibility } = useUIContext();
  const { explorerRoot } = useSessionContext();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!openFilePath) {
      setContent(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const result = await window.api.readFile(openFilePath);
        if (!cancelled) {
          if (result.error) {
            setError(result.error);
            setContent(null);
          } else {
            setContent(result.content);
            setError(null);
          }
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message);
          setContent(null);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openFilePath]);

  const highlightedHtml = useMemo(() => {
    if (!content || !openFilePath) return '';
    return highlightCode(content, openFilePath);
  }, [content, openFilePath]);

  const lineCount = content ? content.split('\n').length : 0;

  const fileName = openFilePath ? openFilePath.split('/').pop() : '';

  const relativePath = useMemo(() => {
    if (!openFilePath) return '';
    if (explorerRoot && openFilePath.startsWith(explorerRoot)) {
      const rel = openFilePath.slice(explorerRoot.length);
      return rel.startsWith('/') ? rel.slice(1) : rel;
    }
    return homeDir ? openFilePath.replace(homeDir, '~') : openFilePath;
  }, [openFilePath, explorerRoot, homeDir]);

  const relativeDir = relativePath ? relativePath.split('/').slice(0, -1).join('/') : '';

  const fullPath = openFilePath
    ? homeDir
      ? openFilePath.replace(homeDir, '~')
      : openFilePath
    : '';

  return (
    <div className="panel viewer-panel">
      <div className="panel-header">
        <span className="panel-title" data-tooltip={fullPath || undefined} data-tooltip-pos="bottom">
          {openFilePath ? (
            <>
              <span className="viewer-filename">{fileName}</span>
              {relativeDir && <span className="viewer-filepath">{relativeDir}</span>}
            </>
          ) : (
            'Viewer'
          )}
        </span>
        <IconButton
          className="panel-minimize-btn"
          tooltip="Minimize panel"
          onMouseDown={e => e.stopPropagation()}
          onClick={() => setPanelVisibility('viewer', false)}
        >
          —
        </IconButton>
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
