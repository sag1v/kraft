import React, { useState, useEffect, useCallback } from 'react';
import { useUIContext } from '../context/AppContext';
import { themes } from '../themes';
import type { LayoutPreset, PanelId } from '../types';

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

function renderLayoutPreview(preset: LayoutPreset, savedCustom?: PanelId[][] | null): React.ReactNode {
  if (preset === 'custom') {
    const grid = (savedCustom && savedCustom.length > 0) ? savedCustom : MY_LAYOUT_DEFAULT_GRID;
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

export function Settings() {
  const { settings, updateSettings, settingsOpen, setSettingsOpen, theme, setThemeId } = useUIContext();
  const [reallyStep, setReallyStep] = useState<0 | 1 | 2>(0);

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
          <button
            className="settings-close"
            onClick={() => setSettingsOpen(false)}
          >
            ✕
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-group">
            <label className="settings-label">Theme</label>
            <div className="settings-theme-list">
              {themes.map((t) => (
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
          </div>
          <div className="settings-group">
            <label className="settings-label">Shell</label>
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
            <span className="settings-hint">Requires restart of terminal</span>
          </div>
          <div className="settings-group">
            <label className="settings-label">Layout</label>
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
              {layouts.map((l) => (
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
              <div
                className={`settings-layout-card settings-layout-card-custom ${settings.defaultLayout === 'custom' ? 'active' : ''}`}
                onClick={() => updateSettings({ defaultLayout: 'custom' })}
                data-tooltip={settings.savedCustomLayout ? 'Restore your custom layout' : 'Save current layout as yours'}
                data-tooltip-pos="bottom"
              >
                <div className="settings-layout-preview">
                  {renderLayoutPreview('custom', settings.savedCustomLayout)}
                </div>
                <span className="settings-layout-name">¯\_(ツ)_/¯</span>
              </div>
            </div>
          </div>
          <div className="settings-group">
            <label className="settings-label">Font Size</label>
            <div className="settings-font-size">
              <button
                className="settings-font-btn"
                onClick={() =>
                  updateSettings({ fontSize: Math.max(10, settings.fontSize - 1) })
                }
              >
                −
              </button>
              <span className="settings-font-value">{settings.fontSize}px</span>
              <button
                className="settings-font-btn"
                onClick={() =>
                  updateSettings({ fontSize: Math.min(24, settings.fontSize + 1) })
                }
              >
                +
              </button>
            </div>
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
