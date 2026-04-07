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
}: {
  onMinimize: () => void;
}) {
  return (
    <IconButton
      className="panel-minimize-btn"
      tooltip="Minimize panel"
      onMouseDown={e => e.stopPropagation()}
      onClick={onMinimize}
    >
      &#x2212;
    </IconButton>
  );
});
