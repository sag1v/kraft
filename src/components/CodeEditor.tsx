import React, { useEffect, useLayoutEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { useUIContext } from '../context/AppContext';
import {
  EditorView,
  ViewUpdate,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view';
import { EditorState, Transaction } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  search, searchKeymap, highlightSelectionMatches,
  findNext, findPrevious, closeSearchPanel,
  getSearchQuery, setSearchQuery, SearchQuery,
} from '@codemirror/search';
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
    fontSize: 'var(--editor-font-size, 13px)',
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
    fontSize: 'var(--editor-font-size, 13px)',
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

function createKraftSearchPanel(view: EditorView) {
  const dom = document.createElement('div');
  dom.className = 'cm-search';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Find…';
  input.setAttribute('aria-label', 'Find');
  input.setAttribute('main-field', 'true');

  const counter = document.createElement('span');
  counter.className = 'cm-search-counter';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.name = 'prev';
  prevBtn.setAttribute('aria-label', 'Previous match');
  prevBtn.textContent = '↑';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.name = 'next';
  nextBtn.setAttribute('aria-label', 'Next match');
  nextBtn.textContent = '↓';

  dom.append(input, counter, prevBtn, nextBtn);

  prevBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    findPrevious(view);
  });
  nextBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    findNext(view);
  });

  input.addEventListener('input', () => {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: input.value })) });
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) findPrevious(view); else findNext(view);
    } else if (e.key === 'Escape') {
      closeSearchPanel(view);
      view.focus();
    }
  });

  function updateCounter() {
    const q = getSearchQuery(view.state);
    if (!q.search) {
      counter.textContent = '';
      counter.removeAttribute('data-no-results');
      return;
    }

    try {
      const matches: { from: number; to: number }[] = [];
      const cursor = q.getCursor(view.state.doc);
      let step = cursor.next();
      while (!step.done && matches.length < 10000) {
        matches.push(step.value);
        step = cursor.next();
      }

      if (matches.length === 0) {
        counter.textContent = 'No results';
        counter.setAttribute('data-no-results', '');
        return;
      }

      counter.removeAttribute('data-no-results');

      const sel = view.state.selection.main;
      let idx = matches.findIndex(m => m.from === sel.from && m.to === sel.to);
      if (idx === -1) {
        idx = matches.findIndex(m => m.from >= sel.head);
        if (idx === -1) idx = 0;
      }

      const total = matches.length >= 10000 ? '10000+' : String(matches.length);
      counter.textContent = `${idx + 1}/${total}`;
    } catch {
      counter.textContent = '';
    }
  }

  return {
    dom,
    top: true,
    mount() {
      const q = getSearchQuery(view.state);
      input.value = q.search || '';
      input.focus();
      input.select();
      updateCounter();
    },
    update(update: ViewUpdate) {
      if (update.transactions.some(tr => tr.effects.some(e => e.is(setSearchQuery)))) {
        const q = getSearchQuery(update.state);
        if (input.value !== q.search) input.value = q.search || '';
      }
      updateCounter();
    },
  };
}

// Persists scroll position and full editor state (undo history, selection) across tab switches
const scrollPositions = new Map<string, number>();
const editorStates = new Map<string, EditorState>();

export function clearEditorState(filePath: string) {
  editorStates.delete(filePath);
  scrollPositions.delete(filePath);
}

export interface CodeEditorHandle {
  navigateConflict: (direction: 'next' | 'prev') => void;
  scrollToLine: (lineNumber: number) => void;
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
    const { settings } = useUIContext();
    const effectiveEditorFontSize = settings.syncFontSizes ? settings.fontSize : settings.editorFontSize;

    useImperativeHandle(ref, () => ({
      navigateConflict: (direction) => {
        if (editorRef.current) navigateConflict(editorRef.current, direction);
      },
      scrollToLine: (lineNumber: number) => {
        const view = editorRef.current;
        if (!view) return;
        const clampedLine = Math.max(1, Math.min(lineNumber, view.state.doc.lines));
        const line = view.state.doc.line(clampedLine);
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
        });
        view.focus();
      },
    }));

    // Create/recreate editor when the file changes (handles language switching)
    useLayoutEffect(() => {
      if (!containerRef.current) return;

      const langExt = getLanguageExtension(filePath);

      const extensions = [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        search({ top: true, createPanel: createKraftSearchPanel }),
        highlightSelectionMatches({ minSelectionLength: 1, wholeWords: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        ...(Array.isArray(langExt) ? langExt : [langExt]),
        editorTheme,
        syntaxHighlighting(kraftHighlightStyle),
        ...conflictExtension(),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !update.transactions.some(tr => tr.annotation(Transaction.remote))) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ];

      // Restore previously saved state (preserves undo history and cursor position)
      const savedState = editorStates.get(filePath);
      const state = savedState ?? EditorState.create({ doc: value, extensions });

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
        scrollPositions.set(filePath, view.scrollDOM.scrollTop);
        editorStates.set(filePath, view.state);
        view.destroy();
        editorRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath]);

    // Sync externally-changed content (e.g. file reloaded from disk).
    // Annotated as Transaction.remote so the updateListener skips it and doesn't create a draft.
    useEffect(() => {
      const view = editorRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current !== value) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
          annotations: Transaction.remote.of(true),
        });
      }
    }, [value]);

    // When the editor font size changes, the CSS variable is updated immediately but
    // CodeMirror caches its internal geometry (gutter width, line heights). Calling
    // requestMeasure() forces a synchronous re-measure so gutter and content stay aligned.
    useEffect(() => {
      const view = editorRef.current;
      if (!view) return;
      view.requestMeasure();
    }, [effectiveEditorFontSize]);

    return <div ref={containerRef} className="editor-code-editor" />;
  }
);
