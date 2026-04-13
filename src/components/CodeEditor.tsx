import React, { useEffect, useLayoutEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import {
  syntaxHighlighting,
  HighlightStyle,
  indentOnInput,
  bracketMatching,
  indentUnit,
  StreamLanguage,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';

import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { xml } from '@codemirror/lang-xml';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { sql } from '@codemirror/lang-sql';

import { shell } from '@codemirror/legacy-modes/mode/shell';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { clojure } from '@codemirror/legacy-modes/mode/clojure';
import { scala } from '@codemirror/legacy-modes/mode/clike';
import { php } from '@codemirror/lang-php';

import { conflictExtension, navigateConflict } from './ConflictExtension';

function getLanguageExtension(filePath: string) {
  const name = filePath.split('/').pop()?.toLowerCase() || '';
  if (name === 'dockerfile') return StreamLanguage.define(dockerFile);

  const ext = name.split('.').pop() || '';
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'ts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'py':
      return python();
    case 'rs':
      return rust();
    case 'go':
      return go();
    case 'java':
      return java();
    case 'c':
    case 'h':
    case 'cpp':
    case 'hpp':
    case 'cc':
    case 'cxx':
      return cpp();
    case 'css':
    case 'scss':
      return css();
    case 'html':
    case 'htm':
      return html();
    case 'xml':
      return xml();
    case 'json':
      return json();
    case 'md':
    case 'mdx':
      return markdown();
    case 'sql':
      return sql();
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish':
      return StreamLanguage.define(shell);
    case 'rb':
      return StreamLanguage.define(ruby);
    case 'yaml':
    case 'yml':
      return StreamLanguage.define(yaml);
    case 'toml':
    case 'ini':
      return StreamLanguage.define(toml);
    case 'swift':
      return StreamLanguage.define(swift);
    case 'clj':
    case 'cljs':
    case 'cljc':
    case 'edn':
      return StreamLanguage.define(clojure);
    case 'scala':
    case 'sc':
      return StreamLanguage.define(scala);
    case 'php':
    case 'phtml':
      return php();
    default:
      return [];
  }
}

// Highlight style using the app's CSS variables — automatically adapts to all themes
const kraftHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--accent)' },
  { tag: tags.operator, color: 'var(--accent)' },
  { tag: tags.controlKeyword, color: 'var(--accent)' },
  { tag: tags.definitionKeyword, color: 'var(--accent)' },
  { tag: tags.moduleKeyword, color: 'var(--accent)' },
  { tag: tags.bool, color: 'var(--accent)' },
  { tag: tags.null, color: 'var(--accent)' },
  { tag: tags.comment, color: 'var(--fg-muted)', fontStyle: 'italic' },
  { tag: tags.lineComment, color: 'var(--fg-muted)', fontStyle: 'italic' },
  { tag: tags.blockComment, color: 'var(--fg-muted)', fontStyle: 'italic' },
  { tag: tags.docComment, color: 'var(--fg-muted)', fontStyle: 'italic' },
  { tag: tags.string, color: 'var(--accent-secondary)' },
  { tag: tags.special(tags.string), color: 'var(--accent-secondary)' },
  { tag: tags.number, color: 'var(--diff-add)' },
  { tag: tags.integer, color: 'var(--diff-add)' },
  { tag: tags.float, color: 'var(--diff-add)' },
  { tag: tags.regexp, color: 'var(--diff-add)' },
  { tag: tags.typeName, color: 'var(--accent-secondary)' },
  { tag: tags.className, color: 'var(--accent-secondary)' },
  { tag: tags.definition(tags.typeName), color: 'var(--accent-secondary)' },
  { tag: tags.definition(tags.className), color: 'var(--accent-secondary)' },
  { tag: tags.propertyName, color: 'var(--accent-tertiary)' },
  { tag: tags.definition(tags.propertyName), color: 'var(--accent-tertiary)' },
  { tag: tags.attributeName, color: 'var(--accent-secondary)' },
  { tag: tags.attributeValue, color: 'var(--accent-secondary)' },
  { tag: tags.function(tags.name), color: 'var(--accent-tertiary)' },
  { tag: tags.function(tags.variableName), color: 'var(--accent-tertiary)' },
  { tag: tags.tagName, color: 'var(--accent)' },
  { tag: tags.angleBracket, color: 'var(--fg-muted)' },
  { tag: tags.meta, color: 'var(--fg-muted)' },
  { tag: tags.url, color: 'var(--accent-tertiary)', textDecoration: 'underline' },
  { tag: tags.heading, color: 'var(--accent)', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--accent-tertiary)' },
  { tag: tags.bracket, color: 'var(--fg-muted)' },
  { tag: tags.punctuation, color: 'var(--fg-muted)' },
]);

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--fg)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    lineHeight: '1.6',
    padding: '8px 0',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    overflow: 'auto',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg)',
    color: 'var(--fg-dim)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 4px 0 8px',
    minWidth: '32px',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--fg-muted)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--selection) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--bg-tertiary)',
    outline: '1px solid var(--fg-dim)',
  },
}, { dark: true });

// Persists scroll position across tab switches (keyed by filePath)
const scrollPositions = new Map<string, number>();

export interface CodeEditorHandle {
  navigateConflict: (direction: 'next' | 'prev') => void;
}

interface CodeEditorProps {
  filePath: string;
  value: string;
  onChange: (value: string) => void;
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor({ filePath, value, onChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useImperativeHandle(ref, () => ({
      navigateConflict: (direction) => {
        if (editorRef.current) navigateConflict(editorRef.current, direction);
      },
    }));

    // Create/recreate editor when the file changes (handles language switching)
    useLayoutEffect(() => {
      if (!containerRef.current) return;

      const langExt = getLanguageExtension(filePath);

      const state = EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          indentUnit.of('  '),
          EditorState.tabSize.of(2),
          search({ top: true }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          ...(Array.isArray(langExt) ? langExt : [langExt]),
          editorTheme,
          syntaxHighlighting(kraftHighlightStyle),
          ...conflictExtension(),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      });

      const view = new EditorView({ state, parent: containerRef.current });

      // CM6 defers its initial measure phase (which calls toDOM on widgets) to rAF.
      // Dispatching a no-op in the next frame forces widgets to render immediately.
      let rafIds: number[] = [];

      rafIds.push(requestAnimationFrame(() => {
        if (!view.isDestroyed) view.dispatch({});
      }));

      // Restore saved scroll position for this file
      const savedScroll = scrollPositions.get(filePath);
      if (savedScroll !== undefined) {
        rafIds.push(requestAnimationFrame(() => {
          view.scrollDOM.scrollTop = savedScroll;
        }));
      }

      view.focus();
      editorRef.current = view;

      return () => {
        rafIds.forEach(cancelAnimationFrame);
        // Save scroll position before destroying
        scrollPositions.set(filePath, view.scrollDOM.scrollTop);
        view.destroy();
        editorRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath]);

    // Sync externally-changed content (e.g. file reloaded from disk)
    useEffect(() => {
      const view = editorRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current !== value) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
        });
      }
    }, [value]);

    return <div ref={containerRef} className="viewer-code-editor" />;
  }
);
