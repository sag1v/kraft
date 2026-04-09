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

function SessionTab({ session, isActive, isClosable, dropSide, onActivate, onClose, onRename, onContextMenu, onDragStart, onDragOver, onDrop }: {
  session: { id: string; label: string; customLabel?: string; icon?: string; iconColor?: string; cwd: string };
  isActive: boolean;
  isClosable: boolean;
  dropSide: 'left' | 'right' | null;
  onActivate: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const dirName = session.cwd ? session.cwd.split('/').pop() || session.label : session.label;
  const displayName = session.customLabel || dirName;

  const dropClass = dropSide ? ` drop-${dropSide}` : '';

  return (
    <div
      className={`session-tab${isActive ? ' active' : ''}${dropClass}`}
      onClick={onActivate}
      onMouseDown={e => { if (e.button === 1 && isClosable) { e.preventDefault(); onClose(); } }}
      onContextMenu={onContextMenu}
      onDoubleClick={e => { e.stopPropagation(); setRenaming(true); }}
      title={session.cwd || displayName}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <TerminalTabIcon iconId={session.icon} color={session.iconColor} />
      {renaming ? (
        <RenameInput
          value={displayName}
          onCommit={v => { onRename(v); setRenaming(false); }}
          onCancel={() => setRenaming(false)}
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
    sessions,
    activeSessionId,
    setActiveSession,
    createSession,
    destroySession,
    renameSession,
    updateSessionAppearance,
    reorderSessions,
  } = useSessionContext();

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const createSessionRef = useRef(createSession);
  createSessionRef.current = createSession;

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        createSessionRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        const sid = activeSessionIdRef.current;
        if (sid && sessionsRef.current.length > 1) destroySession(sid);
      }
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const s = sessionsRef.current;
        if (s.length < 2) return;
        const idx = s.findIndex(x => x.id === activeSessionIdRef.current);
        const next = e.shiftKey ? (idx - 1 + s.length) % s.length : (idx + 1) % s.length;
        setActiveSession(s[next].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [destroySession, setActiveSession]);

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
      reorderSessions(from, effective);
    }
  }, [reorderSessions, dropIndicator, getEffectiveDropIndex]);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  const [ctxSub, setCtxSub] = useState<'icon' | 'color' | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  const closeCtx = useCallback(() => { setCtxMenu(null); setCtxSub(null); }, []);

  useEffect(() => {
    if (!ctxMenu) return;
    const onClick = (e: MouseEvent) => {
      if (ctxRef.current?.contains(e.target as Node)) return;
      closeCtx();
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [ctxMenu, closeCtx]);

  const handleCloseOthers = useCallback((keepId: string) => {
    sessionsRef.current.filter(s => s.id !== keepId).forEach(s => destroySession(s.id));
  }, [destroySession]);

  return (
    <div className={className ?? 'session-bar'}>
      <div className="session-bar-tabs" onDragLeave={handleDragLeave} onDragEnd={handleDragEnd}>
        {sessions.map((session, i) => (
          <SessionTab
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            isClosable={sessions.length > 1}
            dropSide={dropIndicator?.index === i ? dropIndicator.side : null}
            onActivate={() => setActiveSession(session.id)}
            onClose={() => destroySession(session.id)}
            onRename={label => renameSession(session.id, label)}
            onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, sessionId: session.id }); }}
            onDragStart={handleDragStart(i)}
            onDragOver={handleDragOver(i)}
            onDrop={handleDrop(i)}
          />
        ))}
        <button className="session-bar-add" onClick={createSession} title="New session (Ctrl+Shift+T)">+</button>
      </div>

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
                const s = sessions.find(x => x.id === ctxMenu.sessionId);
                return (
                  <button key={icon.id} type="button"
                    className={`tab-icon-option ${(s?.icon || 'terminal') === icon.id ? 'active' : ''}`}
                    data-tooltip={icon.label} data-tooltip-pos="bottom"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { updateSessionAppearance(ctxMenu.sessionId, icon.id, undefined); closeCtx(); }}>
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
                  className={`tab-color-option ${(sessions.find(s => s.id === ctxMenu.sessionId)?.iconColor || '') === color.value ? 'active' : ''}`}
                  data-tooltip={color.label} data-tooltip-pos="bottom"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { updateSessionAppearance(ctxMenu.sessionId, undefined, color.value); closeCtx(); }}>
                  {color.value
                    ? <span className="tab-color-swatch" style={{ background: color.value }} />
                    : <span className="tab-color-swatch tab-color-default"><span className="tab-color-reset-line" /></span>}
                </button>
              ))}
            </div>
          )}
          <div className="tab-context-separator" />
          {sessions.length > 1 && (
            <>
              <button type="button" className="tab-context-item" role="menuitem"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { destroySession(ctxMenu.sessionId); closeCtx(); }}>
                Close
              </button>
              <button type="button" className="tab-context-item" role="menuitem"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { handleCloseOthers(ctxMenu.sessionId); closeCtx(); }}>
                Close Others
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
