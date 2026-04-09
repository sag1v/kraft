import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useUIContext } from '../context/AppContext';
import { themes } from '../themes';
import type { LayoutPreset, PanelId, PanelVisibility } from '../types';
import { removePanelFromGrid, simplifyGrid } from './PanelLayout';
import { SHORTCUTS, SHORTCUT_CATEGORIES, MOD_KEY } from '../shortcuts';

const shells = [
  { value: '', label: 'System Default' },
  { value: '/bin/zsh', label: 'zsh' },
  { value: '/bin/bash', label: 'bash' },
  { value: '/usr/bin/fish', label: 'fish' },
];

const layouts: { value: LayoutPreset; label: string }[] = [
  { value: 'get-shit-done', label: 'Get Sh*t Done' },
  { value: 'watch-shit-done', label: 'Watch Sh*t Done' },
  { value: 'why', label: 'Why Though?' },
  { value: 'really', label: 'Really?!' },
];

type SettingsCategory = 'appearance' | 'layout' | 'terminal' | 'keybindings';

const CATEGORIES: { id: SettingsCategory; label: string; icon: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: '◑' },
  { id: 'layout', label: 'Layout', icon: '⊞' },
  { id: 'terminal', label: 'Terminal', icon: '▸' },
  { id: 'keybindings', label: 'Keybindings', icon: '⌨' },
];

function renderGridPreview(grid: PanelId[][]): React.ReactNode {
  if (!grid || grid.length === 0) return null;
  const numRows = grid.length;
  const numCols = grid[0].length;
  const areas = grid.map(row => `"${row.join(' ')}"`).join(' ');
  const style: React.CSSProperties = {
    display: 'grid',
    gridTemplateAreas: areas,
    gridTemplateRows: `repeat(${numRows}, 1fr)`,
    gridTemplateColumns: `repeat(${numCols}, 1fr)`,
    gap: 2,
    width: '100%',
    height: '100%',
  };
  const rendered = new Set<string>();
  const boxes: React.ReactNode[] = [];
  for (const row of grid) {
    for (const id of row) {
      if (rendered.has(id)) continue;
      rendered.add(id);
      boxes.push(
        <div key={id} className={`settings-layout-preview-box ${id}`} style={{ gridArea: id }} />,
      );
    }
  }
  return <div className="settings-layout-preview-grid" style={style}>{boxes}</div>;
}

const PRESET_GRIDS: Record<string, PanelId[][]> = {
  'get-shit-done': [['terminal' as PanelId]],
  'watch-shit-done': [['explorer', 'terminal'], ['explorer', 'viewer']],
  'why': [['explorer', 'viewer', 'terminal']],
  'really': [['explorer'], ['viewer'], ['terminal']],
};

const MY_LAYOUT_DEFAULT_GRID: PanelId[][] = [['explorer', 'terminal'], ['viewer', 'terminal']];

function filterHiddenPanels(grid: PanelId[][], visibility: PanelVisibility): PanelId[][] {
  const hidden = (['explorer', 'viewer', 'terminal'] as PanelId[]).filter(id => !visibility[id]);
  if (hidden.length === 0) return grid;

  let g = grid.map(r => [...r]);
  for (const panel of hidden) {
    if (g.some(row => row.includes(panel))) {
      g = removePanelFromGrid(g, panel);
    }
  }
  return simplifyGrid(g);
}

function renderLayoutPreview(
  preset: LayoutPreset,
  savedCustom?: PanelId[][] | null,
  customVisibility?: PanelVisibility | null,
): React.ReactNode {
  if (preset === 'custom') {
    let grid = (savedCustom && savedCustom.length > 0) ? savedCustom : MY_LAYOUT_DEFAULT_GRID;
    if (customVisibility) {
      grid = filterHiddenPanels(grid, customVisibility);
    }
    return renderGridPreview(grid);
  }
  const grid = PRESET_GRIDS[preset];
  if (grid) return renderGridPreview(grid);
  return null;
}

function ReallyConfirmModal({ step, onConfirm, onCancel }: {
  step: 1 | 2;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="really-confirm-overlay" onClick={onCancel}>
      <div className="really-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <span className="really-confirm-title">
          {step === 1 ? 'Are you sure?' : 'Really?!'}
        </span>
        <span className="really-confirm-subtitle">
          {step === 1
            ? 'You want to stack all panels vertically?'
            : "Don't say we didn't warn you."}
        </span>
        <div className="really-confirm-actions">
          <button className="really-confirm-btn really-confirm-cancel" onClick={onCancel}>
            Nah
          </button>
          <button className="really-confirm-btn really-confirm-yes" onClick={onConfirm}>
            {step === 1 ? 'Yeah' : 'Just do it'}
          </button>
        </div>
      </div>
    </div>
  );
}

function zoomLevelToPercent(level: number): number {
  return Math.round(Math.pow(1.2, level) * 100);
}

function ZoomControl() {
  const [zoomLevel, setZoomLevel] = useState(0);
  const zoomRef = useRef(0);

  useEffect(() => {
    window.api?.getZoomLevel?.().then((level) => {
      setZoomLevel(level);
      zoomRef.current = level;
    });

    const unsub = window.api?.onZoomLevelChanged?.((level) => {
      zoomRef.current = level;
      setZoomLevel(level);
    });
    return () => unsub?.();
  }, []);

  const changeZoom = useCallback((delta: number) => {
    const next = Math.max(-3, Math.min(5, zoomRef.current + delta));
    zoomRef.current = next;
    setZoomLevel(next);
    window.api?.setZoomLevel?.(next);
  }, []);

  const resetZoom = useCallback(() => {
    zoomRef.current = 0;
    setZoomLevel(0);
    window.api?.setZoomLevel?.(0);
  }, []);

  const percent = zoomLevelToPercent(zoomLevel);

  return (
    <div className="settings-row">
      <div className="settings-row-info">
        <span className="settings-row-title">Zoom Level</span>
        <span className="settings-row-desc">Adjust the zoom level of the entire application. Use {MOD_KEY}+/- keys anywhere.</span>
      </div>
      <div className="settings-font-size">
        <button
          className="settings-font-btn"
          onClick={() => changeZoom(-0.5)}
          data-tooltip={`Zoom out (${MOD_KEY}+-)`}
          data-tooltip-pos="bottom"
        >
          −
        </button>
        <span
          className="settings-font-value"
          onClick={resetZoom}
          style={{ cursor: 'pointer' }}
          data-tooltip={`Reset to 100% (${MOD_KEY}+0)`}
          data-tooltip-pos="bottom"
        >
          {percent}%
        </span>
        <button
          className="settings-font-btn"
          onClick={() => changeZoom(0.5)}
          data-tooltip={`Zoom in (${MOD_KEY}++)`}
          data-tooltip-pos="bottom"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function Settings() {
  const { settings, updateSettings, settingsOpen, setSettingsOpen, theme, setThemeId } = useUIContext();
  const [reallyStep, setReallyStep] = useState<0 | 1 | 2>(0);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('appearance');
  const [searchQuery, setSearchQuery] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<SettingsCategory, HTMLDivElement | null>>({
    appearance: null,
    layout: null,
    terminal: null,
    keybindings: null,
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollingTo = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (reallyStep > 0) {
          setReallyStep(0);
        } else if (settingsOpen) {
          setSettingsOpen(false);
        }
      }
    },
    [settingsOpen, setSettingsOpen, reallyStep]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (settingsOpen) {
      setSearchQuery('');
      setActiveCategory('appearance');
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [settingsOpen]);

  const scrollToCategory = useCallback((id: SettingsCategory) => {
    setActiveCategory(id);
    if (scrollingTo.current) clearTimeout(scrollingTo.current);
    scrollingTo.current = setTimeout(() => { scrollingTo.current = null; }, 500);
    const el = sectionRefs.current[id];
    if (el && bodyRef.current) {
      bodyRef.current.scrollTo({ top: el.offsetTop - bodyRef.current.offsetTop, behavior: 'smooth' });
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollingTo.current) return;
    const body = bodyRef.current;
    if (!body) return;
    const scrollTop = body.scrollTop + body.offsetTop + 40;
    let current: SettingsCategory = 'appearance';
    for (const cat of CATEGORIES) {
      const el = sectionRefs.current[cat.id];
      if (el && el.offsetTop <= scrollTop) {
        current = cat.id;
      }
    }
    setActiveCategory(current);
  }, []);

  const handleLayoutClick = useCallback((preset: LayoutPreset) => {
    if (preset === 'really') {
      setReallyStep(1);
      return;
    }
    updateSettings({ defaultLayout: preset });
  }, [updateSettings]);

  const handleReallyConfirm = useCallback(() => {
    if (reallyStep === 1) {
      setReallyStep(2);
    } else {
      setReallyStep(0);
      updateSettings({ defaultLayout: 'really' });
    }
  }, [reallyStep, updateSettings]);

  if (!settingsOpen) return null;

  const q = searchQuery.toLowerCase().trim();
  const isSearching = q.length > 0;
  const matches = (text: string) => text.toLowerCase().includes(q);

  const filteredThemes = isSearching
    ? themes.filter(t => matches(t.name) || matches(t.type) || matches('theme color appearance'))
    : themes;
  const showTheme = !isSearching || filteredThemes.length > 0;
  const showZoom = !isSearching || matches('zoom level scale size');

  const filteredLayouts = isSearching
    ? layouts.filter(l => matches(l.label) || matches(l.value) || matches('layout panel arrange'))
    : layouts;
  const showCustomLayout = !isSearching || matches('custom layout my');
  const showSyncLayout = !isSearching || matches('sync layout tabs independent per tab session');
  const showLayoutSection = !isSearching || filteredLayouts.length > 0 || showCustomLayout || showSyncLayout;

  const showShell = !isSearching || matches('shell terminal bash zsh fish default explorer auto load folder');

  const filteredShortcuts = SHORTCUT_CATEGORIES.map(category => {
    const items = SHORTCUTS.filter(s => s.category === category);
    const filtered = isSearching
      ? items.filter(s => matches(s.label) || matches(s.keys) || matches(s.category) || matches(s.id))
      : items;
    return { category, items: filtered };
  }).filter(g => g.items.length > 0);
  const showKeybindings = !isSearching || filteredShortcuts.length > 0;

  const showAppearance = showTheme || showZoom;

  const visibleCategories = new Set<SettingsCategory>();
  if (showAppearance) visibleCategories.add('appearance');
  if (showLayoutSection) visibleCategories.add('layout');
  if (showShell) visibleCategories.add('terminal');
  if (showKeybindings) visibleCategories.add('keybindings');

  const noResults = isSearching && visibleCategories.size === 0;

  return (
    <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
      <div
        className="settings-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.bgSecondary,
        }}
      >
        <div className="settings-header">
          <span className="settings-title" style={{ color: theme.colors.accent }}>
            Settings
          </span>
          <div className="settings-search-wrap">
            <input
              ref={searchRef}
              type="text"
              className="settings-search"
              placeholder="Search settings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            className="settings-close"
            onClick={() => setSettingsOpen(false)}
          >
            ✕
          </button>
        </div>
        <div className="settings-content">
          <nav className="settings-sidebar">
            {CATEGORIES.map((cat) => {
              const visible = visibleCategories.has(cat.id);
              if (isSearching && !visible) return null;
              return (
                <button
                  key={cat.id}
                  className={`settings-sidebar-item ${activeCategory === cat.id ? 'active' : ''}`}
                  onClick={() => scrollToCategory(cat.id)}
                >
                  <span className="settings-sidebar-icon">{cat.icon}</span>
                  <span className="settings-sidebar-label">{cat.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="settings-body" ref={bodyRef} onScroll={handleScroll}>
            {noResults && (
              <div className="settings-no-results">
                No settings matching "<span className="settings-no-results-query">{searchQuery}</span>"
              </div>
            )}

            {/* Appearance */}
            {showAppearance && (
              <div
                className="settings-section"
                ref={(el) => { sectionRefs.current.appearance = el; }}
              >
                <h2 className="settings-section-title">Appearance</h2>

                {showTheme && (
                  <>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <span className="settings-row-title">Color Theme</span>
                        <span className="settings-row-desc">Specifies the color theme used in the application.</span>
                      </div>
                    </div>
                    <div className="settings-theme-list">
                      {filteredThemes.map((t) => (
                        <button
                          key={t.id}
                          className={`settings-theme-btn ${theme.id === t.id ? 'active' : ''}`}
                          onClick={() => setThemeId(t.id)}
                        >
                          <span
                            className="settings-theme-dot"
                            style={{ backgroundColor: t.dot }}
                          />
                          <span className="settings-theme-name">{t.name}</span>
                          <span className="settings-theme-type">{t.type}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {showZoom && <ZoomControl />}
              </div>
            )}

            {/* Layout */}
            {showLayoutSection && (
              <div
                className="settings-section"
                ref={(el) => { sectionRefs.current.layout = el; }}
              >
                <h2 className="settings-section-title">Layout</h2>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">Default Layout</span>
                    <span className="settings-row-desc">Choose how panels are arranged when the application starts.</span>
                  </div>
                </div>
                <div className="settings-layout-legend">
                  <span className="settings-legend-item">
                    <span className="settings-legend-dot explorer" />
                    Explorer
                  </span>
                  <span className="settings-legend-item">
                    <span className="settings-legend-dot viewer" />
                    Viewer
                  </span>
                  <span className="settings-legend-item">
                    <span className="settings-legend-dot terminal" />
                    Terminal
                  </span>
                </div>
                <div className="settings-layout-grid">
                  {(isSearching ? filteredLayouts : layouts).map((l) => (
                    <div
                      key={l.value}
                      className={`settings-layout-card ${settings.defaultLayout === l.value ? 'active' : ''}`}
                      onClick={() => handleLayoutClick(l.value)}
                    >
                      <div className="settings-layout-preview">
                        {renderLayoutPreview(l.value, null)}
                      </div>
                      <span className="settings-layout-name">{l.label}</span>
                    </div>
                  ))}
                  {showCustomLayout && (
                    <div
                      className={`settings-layout-card settings-layout-card-custom ${settings.defaultLayout === 'custom' ? 'active' : ''}`}
                      onClick={() => updateSettings({ defaultLayout: 'custom' })}
                      data-tooltip={settings.savedCustomLayout ? 'Restore your custom layout' : 'Save current layout as yours'}
                      data-tooltip-pos="bottom"
                    >
                      <div className="settings-layout-preview">
                        {renderLayoutPreview('custom', settings.savedCustomLayout, settings.customPanelVisibility)}
                      </div>
                      <span className="settings-layout-name">¯\_(ツ)_/¯</span>
                    </div>
                  )}
                </div>

                {showSyncLayout && (
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <span className="settings-row-title">Sync Layout Across Tabs</span>
                      <span className="settings-row-desc">When enabled, panel visibility and explorer view are shared across all tabs. When disabled, each tab has its own independent layout.</span>
                    </div>
                    <button
                      className="settings-toggle"
                      data-checked={settings.syncLayoutAcrossTabs}
                      onClick={() => updateSettings({ syncLayoutAcrossTabs: !settings.syncLayoutAcrossTabs })}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Terminal */}
            {showShell && (
              <div
                className="settings-section"
                ref={(el) => { sectionRefs.current.terminal = el; }}
              >
                <h2 className="settings-section-title">Terminal</h2>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">Default Shell</span>
                    <span className="settings-row-desc">The shell program to use for new terminal sessions. Requires restart of terminal.</span>
                  </div>
                  <select
                    className="settings-select"
                    value={settings.shellOverride || ''}
                    onChange={(e) =>
                      updateSettings({ shellOverride: e.target.value || null })
                    }
                  >
                    {shells.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="settings-row-title">Auto-load Explorer</span>
                    <span className="settings-row-desc">Automatically load and follow the terminal's working directory in the explorer. When off, you can load folders on demand.</span>
                  </div>
                  <button
                    className="settings-toggle"
                    data-checked={settings.autoLoadExplorer}
                    onClick={() => updateSettings({ autoLoadExplorer: !settings.autoLoadExplorer })}
                  />
                </div>
              </div>
            )}

            {/* Keybindings */}
            {showKeybindings && (
              <div
                className="settings-section"
                ref={(el) => { sectionRefs.current.keybindings = el; }}
              >
                <h2 className="settings-section-title">Keyboard Shortcuts</h2>

                <div className="settings-shortcuts">
                  {filteredShortcuts.map(({ category, items }) => (
                    <div key={category} className="settings-shortcuts-category">
                      <div className="settings-shortcuts-category-title">{category}</div>
                      {items.map(s => (
                        <div key={s.id} className="settings-shortcut-row">
                          <span className="settings-shortcut-label">{s.label}</span>
                          <span className="settings-shortcut-keys">
                            {s.keys.split('+').map((key, i) => (
                              <kbd key={i} className="settings-shortcut-kbd">{key}</kbd>
                            ))}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {reallyStep > 0 && (
        <ReallyConfirmModal
          step={reallyStep as 1 | 2}
          onConfirm={handleReallyConfirm}
          onCancel={() => setReallyStep(0)}
        />
      )}
    </div>
  );
}
