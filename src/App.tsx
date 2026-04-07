import React, { useEffect, useCallback } from 'react';
import { AppProvider, useUIContext } from './context/AppContext';
import { TopBar } from './components/TopBar';
import { Footer } from './components/Footer';
import { PanelLayout } from './components/PanelLayout';
import { Settings } from './components/Settings';
import { CommandPalette } from './components/CommandPalette';
import { GlobalTooltip } from './components/GlobalTooltip';

function AppInner() {
  const { theme, setSettingsOpen, settingsLoaded } = useUIContext();

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
  }, [theme]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      }
    },
    [setSettingsOpen]
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
