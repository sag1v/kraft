import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionContext } from '../context/AppContext';
import { TerminalTabIcon, TERMINAL_ICONS, TAB_COLORS } from '../terminalIcons';

// ── Inline rename input ────────────────────────────────────────────────────

function RenameInput({ value, onCommit, onCancel }: {
  value: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.select(); }, []);

  return (
    <input
      ref={inputRef}
      className="session-tab-rename"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={() => onCommit(text.trim() || value)}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') onCommit(text.trim() || value);
        if (e.key === 'Escape') onCancel();
      }}
    />
  );
}

// ── Single tab ─────────────────────────────────────────────────────────────

function SessionTab({ group, isActive, isInSplit, isClosable, dropSide, onActivate, onClose, onRename, onRenameChange, onContextMenu, onDragStart, onDragOver, onDrop }: {
  group: { id: string; label: string; customLabel?: string; icon?: string; iconColor?: string; panes: { id: string; cwd: string }[] };
  isActive: boolean;
  isInSplit: boolean;
  isClosable: boolean;
  dropSide: 'left' | 'right' | null;
  onActivate: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
  onRenameChange: (renaming: boolean) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const setRenamingWithNotify = (v: boolean) => { setRenaming(v); onRenameChange(v); };
  const cwd = group.panes[0]?.cwd ?? '';
  const dirName = cwd ? cwd.split('/').pop() || group.label : group.label;
  const displayName = group.customLabel || dirName;

  const dropClass = dropSide ? ` drop-${dropSide}` : '';

  return (
    <div
      className={`session-tab${isActive ? ' active' : ''}${isInSplit ? ' session-tab--in-split' : ''}${dropClass}`}
      onClick={onActivate}
      onMouseDown={e => { if (e.button === 1 && isClosable) { e.preventDefault(); onClose(); } }}
      onContextMenu={onContextMenu}
      onDoubleClick={e => { e.stopPropagation(); setRenamingWithNotify(true); }}
      title={cwd || displayName}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <TerminalTabIcon iconId={group.icon} color={group.iconColor} />
      {renaming ? (
        <RenameInput
          value={displayName}
          onCommit={v => { onRename(v); setRenamingWithNotify(false); }}
          onCancel={() => setRenamingWithNotify(false)}
        />
      ) : (
        <span className="session-tab-label">{displayName}</span>
      )}
      {isClosable && (
        <button
          className="session-tab-close"
          onClick={e => { e.stopPropagation(); onClose(); }}
          title="Close session"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ── Main SessionBar ────────────────────────────────────────────────────────

export function SessionBar({ className }: { className?: string }) {
  const {
    groups,
    activeGroupId,
    activeGroup,
    setActiveGroup,
    createGroup,
    duplicateGroup,
    destroyGroup,
    renameGroup,
    updateGroupAppearance,
    reorderGroups,
    recentlyClosedGroups,
    restoreLastClosedGroup,
    splitPane,
    closePane,
  } = useSessionContext();

  const [isAnyRenaming, setIsAnyRenaming] = useState(false);

  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const activeGroupIdRef = useRef(activeGroupId);
  activeGroupIdRef.current = activeGroupId;
  const activeGroupRef = useRef(activeGroup);
  activeGroupRef.current = activeGroup;
  const createGroupRef = useRef(createGroup);
  createGroupRef.current = createGroup;
  const recentlyClosedGroupsRef = useRef(recentlyClosedGroups);
  recentlyClosedGroupsRef.current = recentlyClosedGroups;
  const restoreLastClosedGroupRef = useRef(restoreLastClosedGroup);
  restoreLastClosedGroupRef.current = restoreLastClosedGroup;
  const splitPaneRef = useRef(splitPane);
  splitPaneRef.current = splitPane;
  const closePaneRef = useRef(closePane);
  closePaneRef.current = closePane;


  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        createGroupRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        if (recentlyClosedGroupsRef.current.length > 0) {
          restoreLastClosedGroupRef.current();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        const gid = activeGroupIdRef.current;
        if (gid && groupsRef.current.length > 1) destroyGroup(gid);
      }
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const gs = groupsRef.current;
        if (gs.length < 2) return;
        const idx = gs.findIndex(x => x.id === activeGroupIdRef.current);
        const next = e.shiftKey ? (idx - 1 + gs.length) % gs.length : (idx + 1) % gs.length;
        setActiveGroup(gs[next].id);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        splitPaneRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [destroyGroup, setActiveGroup]);

  // Drag to reorder
  const dragIndexRef = useRef<number | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ index: number; side: 'left' | 'right' } | null>(null);

  const getEffectiveDropIndex = useCallback((from: number, to: number, side: 'left' | 'right'): number => {
    if (from < to) {
      return side === 'left' ? to - 1 : to;
    }
    return side === 'left' ? to : to + 1;
  }, []);

  const handleDragStart = useCallback((index: number) => (e: React.DragEvent) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const from = dragIndexRef.current;
    if (from === null) { setDropIndicator(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const side: 'left' | 'right' = e.clientX < midX ? 'left' : 'right';
    if (from === index || getEffectiveDropIndex(from, index, side) === from) {
      setDropIndicator(null);
      return;
    }
    setDropIndicator(prev => {
      if (prev?.index === index && prev?.side === side) return prev;
      return { index, side };
    });
  }, [getEffectiveDropIndex]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const container = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as Node | null;
    if (!related || !container.contains(related)) {
      setDropIndicator(null);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    dragIndexRef.current = null;
    setDropIndicator(null);
  }, []);

  const handleDrop = useCallback((_index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    const indicator = dropIndicator;
    dragIndexRef.current = null;
    setDropIndicator(null);
    if (from === null || !indicator) return;
    const effective = getEffectiveDropIndex(from, indicator.index, indicator.side);
    if (effective !== from) {
      reorderGroups(from, effective);
    }
  }, [reorderGroups, dropIndicator, getEffectiveDropIndex]);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; groupId: string } | null>(null);
  const [ctxSub, setCtxSub] = useState<'icon' | 'color' | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const [appBarCtxMenu, setAppBarCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const closeCtx = useCallback(() => { setCtxMenu(null); setCtxSub(null); }, []);
  const closeAppBarCtx = useCallback(() => setAppBarCtxMenu(null), []);
  const closeAllCtx = useCallback(() => { setCtxMenu(null); setCtxSub(null); setAppBarCtxMenu(null); }, []);

  const handleCloseOthers = useCallback((keepId: string) => {
    groupsRef.current.filter(g => g.id !== keepId).forEach(g => destroyGroup(g.id));
  }, [destroyGroup]);

  return (
    <div className={className ?? 'session-bar'}>
      <div className="session-bar-tabs" onDragLeave={handleDragLeave} onDragEnd={handleDragEnd}>
        {groups.map((group, i) => (
          <SessionTab
            key={group.id}
            group={group}
            isActive={group.id === activeGroupId}
            isInSplit={group.panes.length >= 2}
            isClosable={groups.length > 1}
            dropSide={dropIndicator?.index === i ? dropIndicator.side : null}
            onActivate={() => setActiveGroup(group.id)}
            onClose={() => destroyGroup(group.id)}
            onRename={label => renameGroup(group.id, label)}
            onRenameChange={setIsAnyRenaming}
            onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, groupId: group.id }); }}
            onDragStart={handleDragStart(i)}
            onDragOver={handleDragOver(i)}
            onDrop={handleDrop(i)}
          />
        ))}
        <button className="session-bar-add" onClick={createGroup} title="New session">+</button>
      </div>
      {!isAnyRenaming && (
        <div
          className="session-bar-drag-spacer"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          onContextMenu={e => { e.preventDefault(); closeAllCtx(); setAppBarCtxMenu({ x: e.clientX, y: e.clientY }); }}
        />
      )}

      {ctxMenu && (
        <div ref={ctxRef} className="tab-context-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} role="menu">
          <button type="button" className={`tab-context-item tab-context-has-sub ${ctxSub === 'icon' ? 'active' : ''}`}
            onMouseDown={e => e.preventDefault()} onClick={() => setCtxSub(ctxSub === 'icon' ? null : 'icon')}>
            Change Icon
          </button>
          <button type="button" className={`tab-context-item tab-context-has-sub ${ctxSub === 'color' ? 'active' : ''}`}
            onMouseDown={e => e.preventDefault()} onClick={() => setCtxSub(ctxSub === 'color' ? null : 'color')}>
            Change Color
          </button>
          {ctxSub === 'icon' && (
            <div className="tab-context-picker tab-icon-picker">
              {TERMINAL_ICONS.map(icon => {
                const g = groups.find(x => x.id === ctxMenu.groupId);
                return (
                  <button key={icon.id} type="button"
                    className={`tab-icon-option ${(g?.icon || 'terminal') === icon.id ? 'active' : ''}`}
                    data-tooltip={icon.label} data-tooltip-pos="bottom"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { updateGroupAppearance(ctxMenu.groupId, icon.id, undefined); closeCtx(); }}>
                    {icon.svg}
                  </button>
                );
              })}
            </div>
          )}
          {ctxSub === 'color' && (
            <div className="tab-context-picker tab-color-picker">
              {TAB_COLORS.map(color => (
                <button key={color.id} type="button"
                  className={`tab-color-option ${(groups.find(g => g.id === ctxMenu.groupId)?.iconColor || '') === color.value ? 'active' : ''}`}
                  data-tooltip={color.label} data-tooltip-pos="bottom"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { updateGroupAppearance(ctxMenu.groupId, undefined, color.value); closeCtx(); }}>
                  {color.value
                    ? <span className="tab-color-swatch" style={{ background: color.value }} />
                    : <span className="tab-color-swatch tab-color-default"><span className="tab-color-reset-line" /></span>}
                </button>
              ))}
            </div>
          )}
          <div className="tab-context-separator" />
          <button type="button" className="tab-context-item" role="menuitem"
            onMouseDown={e => e.preventDefault()}
            onClick={() => { duplicateGroup(ctxMenu.groupId); closeCtx(); }}>
            Duplicate Tab
          </button>
          <div className="tab-context-separator" />
          <button type="button" className="tab-context-item" role="menuitem"
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              if (ctxMenu.groupId === activeGroupId) splitPane();
              closeCtx();
            }}>
            Split Terminal
          </button>
          <div className="tab-context-separator" />
          {groups.length > 1 && (
            <>
              <button type="button" className="tab-context-item" role="menuitem"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { destroyGroup(ctxMenu.groupId); closeCtx(); }}>
                Close
              </button>
              <button type="button" className="tab-context-item" role="menuitem"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { handleCloseOthers(ctxMenu.groupId); closeCtx(); }}>
                Close Others
              </button>
            </>
          )}
        </div>
      )}
      {(ctxMenu || appBarCtxMenu) && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1099,
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          onClick={closeAllCtx}
          onContextMenu={e => { e.preventDefault(); closeAllCtx(); }}
        />
      )}
      {appBarCtxMenu && (
        <div className="tab-context-menu" style={{ left: appBarCtxMenu.x, top: appBarCtxMenu.y }} role="menu">
          <button type="button" className="tab-context-item" role="menuitem"
            onMouseDown={e => e.preventDefault()}
            onClick={() => { createGroup(); closeAppBarCtx(); }}>
            New Terminal
          </button>
          <button type="button" className={`tab-context-item${recentlyClosedGroups.length === 0 ? ' disabled' : ''}`} role="menuitem"
            onMouseDown={e => e.preventDefault()}
            onClick={() => { if (recentlyClosedGroups.length > 0) { restoreLastClosedGroup(); closeAppBarCtx(); } }}>
            Reopen Closed Session
          </button>
        </div>
      )}
    </div>
  );
}
