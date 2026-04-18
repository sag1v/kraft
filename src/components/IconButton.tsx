import React from 'react';

interface IconButtonProps {
  tooltip: string;
  tooltipPos?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  ariaLabel?: string;
  draggable?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

export const IconButton = React.memo(function IconButton({
  tooltip,
  tooltipPos,
  className = '',
  ariaLabel,
  draggable = false,
  onClick,
  onMouseDown,
  children,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel || tooltip}
      data-tooltip={tooltip}
      data-tooltip-pos={tooltipPos}
      draggable={draggable ? undefined : 'false'}
      onClick={onClick}
      onMouseDown={onMouseDown}
    >
      {children}
    </button>
  );
});

export const PanelMinimizeButton = React.memo(function PanelMinimizeButton({
  onMinimize,
  tooltip = 'Minimize panel',
}: {
  onMinimize: () => void;
  tooltip?: string;
}) {
  return (
    <IconButton
      className="panel-minimize-btn"
      tooltip={tooltip}
      onMouseDown={e => e.stopPropagation()}
      onClick={onMinimize}
    >
      &#x2212;
    </IconButton>
  );
});

function MaximizeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M1,4 L1,1 L4,1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8,1 L11,1 L11,4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M11,8 L11,11 L8,11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4,11 L1,11 L1,8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function RestoreIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <rect x="3.5" y="1" width="8" height="8" stroke="currentColor" strokeWidth="1.3" rx="0.5"/>
      <rect x="1" y="3.5" width="8" height="8" stroke="currentColor" strokeWidth="1.3" rx="0.5" fill="var(--bg-secondary)"/>
    </svg>
  );
}

export const PanelMaximizeButton = React.memo(function PanelMaximizeButton({
  isMaximized,
  onToggle,
}: {
  isMaximized: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      className="panel-minimize-btn"
      tooltip={isMaximized ? 'Restore layout' : 'Maximize panel'}
      tooltipPos="bottom"
      onMouseDown={e => e.stopPropagation()}
      onClick={onToggle}
    >
      {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
    </IconButton>
  );
});
