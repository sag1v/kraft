import React, { useCallback, useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useDraggableTabs } from '../hooks/useDraggableTabs';

export interface TabItem {
  id: string;
  label: React.ReactNode;
  editableLabel?: string;
  tooltip?: string;
  closable?: boolean;
}

interface TabBarProps {
  tabs: TabItem[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRename?: (id: string, newLabel: string) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
  trailing?: React.ReactNode;
  className?: string;
}

function InlineRenameInput({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    const val = inputRef.current?.value.trim();
    if (val) onCommit(val);
    else onCancel();
  };

  return (
    <input
      ref={inputRef}
      className="tab-rename-input"
      defaultValue={initialValue}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        e.stopPropagation();
      }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    />
  );
}

export interface TabBarHandle {
  startRename: (id: string) => void;
}

export const TabBar = forwardRef<TabBarHandle, TabBarProps>(function TabBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onReorder,
  onRename,
  onContextMenu,
  trailing,
  className,
}, ref) {
  const tabIds = tabs.map(t => t.id);
  const { getDragProps, getDropClass } = useDraggableTabs(tabIds, onReorder);
  const [editingId, setEditingId] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    startRename: (id: string) => setEditingId(id),
  }), []);

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

  const handleDoubleClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (!onRename) return;
      e.preventDefault();
      e.stopPropagation();
      setEditingId(id);
    },
    [onRename],
  );

  const handleRenameCommit = useCallback(
    (id: string, newLabel: string) => {
      setEditingId(null);
      onRename?.(id, newLabel);
    },
    [onRename],
  );

  const handleRenameCancel = useCallback(() => {
    setEditingId(null);
  }, []);

  return (
    <div className={`tab-bar ${className ?? ''}`}>
      {tabs.map(tab => {
        const isActive = tab.id === activeId;
        const closable = tab.closable !== false;
        const dropClass = getDropClass(tab.id);
        const isEditing = editingId === tab.id;
        return (
          <div
            key={tab.id}
            className={`tab-item ${isActive ? 'active' : ''} ${dropClass}`}
            onClick={() => { if (!isEditing) onActivate(tab.id); }}
            onDoubleClick={e => handleDoubleClick(tab.id, e)}
            onMouseDown={e => handleMiddleClick(tab.id, closable, e)}
            onContextMenu={onContextMenu ? e => onContextMenu(tab.id, e) : undefined}
            data-tooltip={isEditing ? undefined : tab.tooltip}
            data-tooltip-pos="bottom"
            {...(isEditing ? {} : getDragProps(tab.id))}
          >
            {isEditing ? (
              <InlineRenameInput
                initialValue={tab.editableLabel ?? ''}
                onCommit={val => handleRenameCommit(tab.id, val)}
                onCancel={handleRenameCancel}
              />
            ) : (
              tab.label
            )}
            {closable && onClose && !isEditing && (
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
});
