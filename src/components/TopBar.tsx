import React from 'react';
import { useUIContext } from '../context/AppContext';
import { IconButton } from './IconButton';

export function TopBar() {
  const { theme, setSettingsOpen } = useUIContext();

  return (
    <div className="topbar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="topbar-left">
        <span className="topbar-logo" style={{ color: theme.colors.accent }}>
          Kraft
        </span>
      </div>
      <div className="topbar-right" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <IconButton
          className="topbar-settings-btn"
          tooltip="Settings (Ctrl+,)"
          tooltipPos="bottom"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </IconButton>
      </div>
    </div>
  );
}
