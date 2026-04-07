import React, { useCallback } from 'react';
import { useDraggableTabs } from '../hooks/useDraggableTabs';

export interface TabItem {
  id: string;
  label: React.ReactNode;
  tooltip?: string;
  closable?: boolean;
}

interface TabBarProps {
  tabs: TabItem[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
  trailing?: React.ReactNode;
  className?: string;
}

export function TabBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onReorder,
  onContextMenu,
  trailing,
  className,
}: TabBarProps) {
  const tabIds = tabs.map(t => t.id);
  const { getDragProps, getDropClass } = useDraggableTabs(tabIds, onReorder);

  const handleMiddleClick = useCallback(
    (id: string, closable: boolean, e: React.MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      if (closable && onClose) onClose(id);
    },
    [onClose],
  );

  const handleCloseClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      onClose?.(id);
    },
    [onClose],
  );

  return (
    <div className={`tab-bar ${className ?? ''}`}>
      {tabs.map(tab => {
        const isActive = tab.id === activeId;
        const closable = tab.closable !== false;
        const dropClass = getDropClass(tab.id);
        return (
          <div
            key={tab.id}
            className={`tab-item ${isActive ? 'active' : ''} ${dropClass}`}
            onClick={() => onActivate(tab.id)}
            onMouseDown={e => handleMiddleClick(tab.id, closable, e)}
            onContextMenu={onContextMenu ? e => onContextMenu(tab.id, e) : undefined}
            data-tooltip={tab.tooltip}
            data-tooltip-pos="bottom"
            {...getDragProps(tab.id)}
          >
            {tab.label}
            {closable && onClose && (
              <button
                className="tab-item-close"
                onClick={e => handleCloseClick(tab.id, e)}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      {trailing}
    </div>
  );
}
