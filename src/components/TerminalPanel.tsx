import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { TerminalInstance } from './TerminalInstance';
import { IconButton } from './IconButton';
import { TabBar, type TabItem } from './TabBar';

let tabCounter = 0;

export function TerminalPanel() {
  const { theme, settings, homeDir, setPanelVisibility } = useUIContext();
  const {
    cwd,
    sessions,
    activeSessionId,
    addSession,
    removeSession,
    setActiveSession,
    updateSessionCwd,
    reorderSessions,
  } = useSessionContext();

  const creatingInitialRef = useRef(false);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const createTab = useCallback(async () => {
    const hasApi = typeof window.api !== 'undefined' && window.api?.createTerminal;
    if (!hasApi) return;

    try {
      const startCwd = cwd || homeDir || undefined;
      const shell = settings.shellOverride || undefined;
      const { id } = await window.api.createTerminal({
        cwd: startCwd,
        shell,
        cols: 80,
        rows: 24,
      });

      tabCounter++;
      addSession({
        id,
        label: `Terminal ${tabCounter}`,
        cwd: startCwd || '',
      });
    } catch (err) {
      console.error('Failed to create terminal tab:', err);
    }
  }, [cwd, homeDir, settings.shellOverride, addSession]);

  const createTabRef = useRef(createTab);
  createTabRef.current = createTab;

  useEffect(() => {
    if (creatingInitialRef.current || sessions.length > 0) return;
    creatingInitialRef.current = true;
    createTab();
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    if (sessionsRef.current.length <= 1) return;
    try {
      window.api?.destroyTerminal(id);
    } catch {
      // ignore
    }
    removeSession(id);
  }, [removeSession]);

  const handleCloseOthers = useCallback(
    (keepId: string) => {
      const toClose = sessionsRef.current.filter(s => s.id !== keepId).map(s => s.id);
      for (const id of toClose) {
        try {
          window.api?.destroyTerminal(id);
        } catch {
          // ignore
        }
        removeSession(id);
      }
    },
    [removeSession],
  );

  const [tabContextMenu, setTabContextMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
  } | null>(null);
  const tabContextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tabContextMenu) return;
    const onClick = (e: MouseEvent) => {
      if (tabContextMenuRef.current?.contains(e.target as Node)) return;
      setTabContextMenu(null);
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [tabContextMenu]);

  const handleCwdChange = useCallback((sessionId: string, newCwd: string) => {
    updateSessionCwd(sessionId, newCwd);
  }, [updateSessionCwd]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        createTabRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        const sid = activeSessionIdRef.current;
        if (sid && sessionsRef.current.length > 1) {
          handleCloseTab(sid);
        }
      }
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const s = sessionsRef.current;
        if (s.length < 2) return;
        const idx = s.findIndex(x => x.id === activeSessionIdRef.current);
        const nextIdx = e.shiftKey
          ? (idx - 1 + s.length) % s.length
          : (idx + 1) % s.length;
        setActiveSession(s[nextIdx].id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCloseTab, setActiveSession]);

  const tabs = useMemo<TabItem[]>(() =>
    sessions.map(session => {
      const dirName = session.cwd ? session.cwd.split('/').pop() || session.label : session.label;
      return {
        id: session.id,
        tooltip: session.cwd ? `${session.label} - ${session.cwd}` : session.label,
        closable: sessions.length > 1,
        label: <span className="tab-item-label">{dirName}</span>,
      };
    }),
    [sessions],
  );

  const handleTabContextMenu = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (sessions.length <= 1) return;
    setTabContextMenu({ x: e.clientX, y: e.clientY, sessionId: id });
  }, [sessions.length]);

  return (
    <div className="panel terminal-panel">
      <div className="panel-header terminal-tab-header">
        <span className="panel-title panel-icon terminal-icon terminal-panel-title" data-tooltip="Terminal - drag to reorder" data-tooltip-pos="bottom">&gt;_</span>
        <TabBar
          tabs={tabs}
          activeId={activeSessionId}
          onActivate={setActiveSession}
          onClose={handleCloseTab}
          onReorder={reorderSessions}
          onContextMenu={handleTabContextMenu}
          className="terminal-tabs"
          trailing={
            <IconButton
              className="terminal-tab-add"
              tooltip="New terminal session (Ctrl+Shift+T)"
              tooltipPos="bottom"
              onClick={() => createTabRef.current()}
            >
              +
            </IconButton>
          }
        />
        <IconButton
          className="panel-minimize-btn"
          tooltip="Minimize panel"
          tooltipPos="bottom"
          onMouseDown={e => e.stopPropagation()}
          onClick={() => setPanelVisibility('terminal', false)}
        >
          &#x2212;
        </IconButton>
      </div>
      {tabContextMenu && sessions.length > 1 && (
        <div
          ref={tabContextMenuRef}
          className="tab-context-menu"
          style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          role="menu"
        >
          <button
            type="button"
            className="tab-context-item"
            role="menuitem"
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              handleCloseTab(tabContextMenu.sessionId);
              setTabContextMenu(null);
            }}
          >
            Close
          </button>
          <button
            type="button"
            className="tab-context-item"
            role="menuitem"
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              handleCloseOthers(tabContextMenu.sessionId);
              setTabContextMenu(null);
            }}
          >
            Close Others
          </button>
        </div>
      )}
      <div className="terminal-instances">
        {sessions.map(session => (
          <TerminalInstance
            key={session.id}
            sessionId={session.id}
            isActive={session.id === activeSessionId}
            theme={theme}
            settings={settings}
            onCwdChange={handleCwdChange}
          />
        ))}
      </div>
    </div>
  );
}
