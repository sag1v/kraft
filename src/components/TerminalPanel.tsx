import React, { useCallback, useRef, useState, useEffect } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { TerminalInstance } from './TerminalInstance';
import { IconButton } from './IconButton';

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
  } = useSessionContext();

  const [agentModeActive, setAgentModeActive] = useState(false);
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

  const handleAgentModeChange = useCallback((active: boolean) => {
    setAgentModeActive(active);
  }, []);

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

  const getTabLabel = (session: typeof sessions[0]) => {
    if (!session.cwd) return session.label;
    const parts = session.cwd.split('/');
    return parts[parts.length - 1] || session.label;
  };

  return (
    <div className="panel terminal-panel">
      <div className="panel-header terminal-tab-header">
        <span className="panel-title terminal-panel-title">Terminal</span>
        <div className="terminal-tabs">
          {sessions.map(session => (
            <div
              key={session.id}
              className={`terminal-tab ${session.id === activeSessionId ? 'active' : ''}`}
              onClick={() => setActiveSession(session.id)}
              onMouseDown={e => {
                if (e.button !== 1) return;
                e.preventDefault();
                e.stopPropagation();
                if (sessions.length <= 1) return;
                handleCloseTab(session.id);
              }}
              onContextMenu={e => {
                e.preventDefault();
                if (sessions.length <= 1) return;
                setTabContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  sessionId: session.id,
                });
              }}
              data-tooltip={session.cwd ? `${session.label} - ${session.cwd}` : session.label}
              data-tooltip-pos="bottom"
            >
              <span className="terminal-tab-label">{getTabLabel(session)}</span>
              {sessions.length > 1 && (
                <button
                  className="terminal-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(session.id);
                  }}
                  data-tooltip="Close tab" data-tooltip-pos="bottom"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <IconButton
            className="terminal-tab-add"
            tooltip="New terminal session (Ctrl+Shift+T)"
            tooltipPos="bottom"
            onClick={() => createTabRef.current()}
          >
            +
          </IconButton>
        </div>
        <span
          className="terminal-hint"
          style={{ color: theme.colors.fgMuted }}
          data-tooltip={agentModeActive ? 'Press Enter to send, Ctrl+C to cancel' : 'Type ? and Enter to start agent mode'}
          data-tooltip-pos="bottom"
        >
          {agentModeActive ? 'Enter to send, Ctrl+C to cancel' : '? for agent mode'}
        </span>
        <IconButton
          className="panel-minimize-btn"
          tooltip="Minimize panel"
          tooltipPos="bottom"
          onMouseDown={e => e.stopPropagation()}
          onClick={() => setPanelVisibility('terminal', false)}
        >
          —
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
            onAgentModeChange={handleAgentModeChange}
          />
        ))}
      </div>
    </div>
  );
}
