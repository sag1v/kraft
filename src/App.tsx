import React, { useEffect, useCallback, useRef } from 'react';
import { AppProvider, useUIContext } from './context/AppContext';
import { TopBar } from './components/TopBar';
import { Footer } from './components/Footer';
import { PanelLayout } from './components/PanelLayout';
import { Settings } from './components/Settings';
import { CommandPalette } from './components/CommandPalette';
import { GlobalTooltip } from './components/GlobalTooltip';

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
  } = useUIContext();

  const panelVisRef = useRef(panelVisibility);
  panelVisRef.current = panelVisibility;
  const openFilePathRef = useRef(openFilePath);
  openFilePathRef.current = openFilePath;
  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;

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

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
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
    [setSettingsOpen, setPanelVisibility, closeFileTab, setActiveFileTab]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

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
      </div>
      <Footer />
      <Settings />
      <CommandPalette />
      <GlobalTooltip />
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
