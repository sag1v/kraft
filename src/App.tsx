import React, { useEffect, useCallback, useRef, useState } from 'react';
import { AppProvider, useUIContext, useSessionContext } from './context/AppContext';
import { matchesKeyCombo, getEffectiveCombo, FOCUS_SHORTCUT_IDS } from './keybindings';
import { TopBar } from './components/TopBar';
import { Footer } from './components/Footer';
import { PanelLayout } from './components/PanelLayout';
import { Settings } from './components/Settings';
import { CommandPalette } from './components/CommandPalette';
import { GlobalTooltip } from './components/GlobalTooltip';
import { GitErrorToast } from './components/GitErrorToast';
import { UpdateNotification } from './components/UpdateNotification';
import { EasterEggGame } from './components/EasterEggGame';

function AppInner() {
  const {
    theme,
    setSettingsOpen,
    settingsLoaded,
    panelVisibility,
    setPanelVisibility,
    openFilePath,
    openFiles,
    closeFileTab,
    setActiveFileTab,
    settings,
  } = useUIContext();
  const { activeSessionId } = useSessionContext();
  const [gameOpen, setGameOpen] = useState(false);

  useEffect(() => {
    const open = () => setGameOpen(true);
    window.addEventListener('kraft:easter-egg', open);
    return () => window.removeEventListener('kraft:easter-egg', open);
  }, []);

  const panelVisRef = useRef(panelVisibility);
  panelVisRef.current = panelVisibility;
  const openFilePathRef = useRef(openFilePath);
  openFilePathRef.current = openFilePath;
  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  useEffect(() => {
    const root = document.documentElement;
    const c = theme.colors;
    root.style.setProperty('--bg', c.bg);
    root.style.setProperty('--bg-secondary', c.bgSecondary);
    root.style.setProperty('--bg-tertiary', c.bgTertiary);
    root.style.setProperty('--fg', c.fg);
    root.style.setProperty('--fg-muted', c.fgMuted);
    root.style.setProperty('--fg-dim', c.fgDim);
    root.style.setProperty('--accent', c.accent);
    root.style.setProperty('--accent-secondary', c.accentSecondary);
    root.style.setProperty('--accent-tertiary', c.accentTertiary);
    root.style.setProperty('--border', c.border);
    root.style.setProperty('--selection', c.selection);
    root.style.setProperty('--scrollbar', c.scrollbar);
    root.style.setProperty('--scrollbar-hover', c.scrollbarHover);
    root.style.setProperty('--agent-accent', c.agentAccent);
    root.style.setProperty('--diff-add', c.diffAdd);
    root.style.setProperty('--diff-remove', c.diffRemove);
    root.style.setProperty('--git-modified', c.ansi.yellow);
    root.style.setProperty('--git-added', c.diffAdd);
    root.style.setProperty('--git-deleted', c.diffRemove);
    root.style.setProperty('--git-untracked', c.diffAdd);
    root.style.setProperty('--git-conflict', c.ansi.red);
  }, [theme]);

  const flashPanel = useCallback((panelId: string) => {
    const panel = document.querySelector<HTMLElement>(`[data-panel-id="${panelId}"]`);
    if (!panel) return;
    panel.classList.remove('panel-focus-flash');
    void panel.offsetWidth; // force reflow so animation restarts
    panel.classList.add('panel-focus-flash');
    setTimeout(() => panel.classList.remove('panel-focus-flash'), 700);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const s = settingsRef.current;

      // ── Panel focus shortcuts ────────────────────────────────────────
      if (matchesKeyCombo(e, getEffectiveCombo('focus-explorer', s))) {
        e.preventDefault();
        if (!panelVisRef.current.explorer) setPanelVisibility('explorer', true);
        flashPanel('explorer');
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('.explorer-tree')?.focus();
        });
        return;
      }

      if (matchesKeyCombo(e, getEffectiveCombo('focus-terminal', s))) {
        e.preventDefault();
        if (!panelVisRef.current.terminal) setPanelVisibility('terminal', true);
        flashPanel('terminal');
        requestAnimationFrame(() => {
          const sid = activeSessionIdRef.current;
          const el = sid
            ? document.querySelector<HTMLElement>(`[data-session-id="${sid}"] .xterm-helper-textarea`)
            : document.querySelector<HTMLElement>('.xterm-helper-textarea');
          el?.focus();
        });
        return;
      }

      if (matchesKeyCombo(e, getEffectiveCombo('focus-editor', s))) {
        e.preventDefault();
        if (!panelVisRef.current.viewer) setPanelVisibility('viewer', true);
        flashPanel('viewer');
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('.viewer-code-editor .cm-content')?.focus();
        });
        return;
      }
      // ────────────────────────────────────────────────────────────────

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }

      if (e.key === 'b' || e.key === 'B') {
        if (e.shiftKey || e.altKey) return;
        e.preventDefault();
        setPanelVisibility('explorer', !panelVisRef.current.explorer);
        return;
      }

      if (e.key === 'j' || e.key === 'J') {
        if (e.shiftKey || e.altKey) return;
        e.preventDefault();
        setPanelVisibility('terminal', !panelVisRef.current.terminal);
        return;
      }

      if (e.key === '\\') {
        if (e.shiftKey || e.altKey) return;
        e.preventDefault();
        setPanelVisibility('viewer', !panelVisRef.current.viewer);
        return;
      }

      if ((e.key === 'w' || e.key === 'W') && !e.shiftKey) {
        e.preventDefault();
        const fp = openFilePathRef.current;
        if (fp) closeFileTab(fp);
        return;
      }

      if (e.shiftKey && (e.key === '[' || e.key === '{')) {
        e.preventDefault();
        const files = openFilesRef.current;
        const active = openFilePathRef.current;
        if (files.length < 2 || !active) return;
        const idx = files.indexOf(active);
        const prev = (idx - 1 + files.length) % files.length;
        setActiveFileTab(files[prev]);
        return;
      }

      if (e.shiftKey && (e.key === ']' || e.key === '}')) {
        e.preventDefault();
        const files = openFilesRef.current;
        const active = openFilePathRef.current;
        if (files.length < 2 || !active) return;
        const idx = files.indexOf(active);
        const next = (idx + 1) % files.length;
        setActiveFileTab(files[next]);
        return;
      }

      if (e.shiftKey && (e.key === 'r' || e.key === 'R') && !e.altKey) {
        e.preventDefault();
        window.api?.reloadWindow?.();
        return;
      }
    },
    [setSettingsOpen, setPanelVisibility, closeFileTab, setActiveFileTab, flashPanel]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    return window.api?.onOpenSettings?.(() => setSettingsOpen(true));
  }, [setSettingsOpen]);

  if (!settingsLoaded) {
    return (
      <div
        className="app-loading"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.bg,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            border: `2px solid ${theme.colors.border}`,
            borderTopColor: theme.colors.accent,
            borderRadius: '50%',
            animation: 'app-loading-spin 0.8s linear infinite',
          }}
          aria-label="Loading"
        />
        <style>{`
          @keyframes app-loading-spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <PanelLayout />
        {gameOpen && <EasterEggGame onClose={() => setGameOpen(false)} />}
      </div>
      <Footer />
      <Settings />
      <CommandPalette />
      <GlobalTooltip />
      <GitErrorToast />
      <UpdateNotification />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}
