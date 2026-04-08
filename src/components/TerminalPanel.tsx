import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { TerminalInstance } from './TerminalInstance';
import { IconButton, PanelMinimizeButton } from './IconButton';
import { TabBar, type TabItem, type TabBarHandle } from './TabBar';
import { TerminalTabIcon, TERMINAL_ICONS, TAB_COLORS } from '../terminalIcons';

let tabCounter = 0;

export function TerminalPanel() {
  const { theme, settings, homeDir, setPanelVisibility, setOpenFilePath } = useUIContext();
  const {
    cwd,
    sessions,
    activeSessionId,
    addSession,
    removeSession,
    setActiveSession,
    updateSessionCwd,
    reorderSessions,
    renameSession,
    updateSessionAppearance,
  } = useSessionContext();

  const tabBarRef = useRef<TabBarHandle>(null);
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
  const [contextSubMenu, setContextSubMenu] = useState<'icon' | 'color' | null>(null);
  const tabContextMenuRef = useRef<HTMLDivElement>(null);

  const closeContextMenu = useCallback(() => {
    setTabContextMenu(null);
    setContextSubMenu(null);
  }, []);

  useEffect(() => {
    if (!tabContextMenu) return;
    const onClick = (e: MouseEvent) => {
      if (tabContextMenuRef.current?.contains(e.target as Node)) return;
      closeContextMenu();
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [tabContextMenu, closeContextMenu]);

  const handleCwdChange = useCallback((sessionId: string, newCwd: string) => {
    updateSessionCwd(sessionId, newCwd);
  }, [updateSessionCwd]);

  const handleOpenFile = useCallback((filePath: string) => {
    setOpenFilePath(filePath);
  }, [setOpenFilePath]);

  const handleRenameTab = useCallback((id: string, newLabel: string) => {
    renameSession(id, newLabel);
  }, [renameSession]);

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
      const displayName = session.customLabel || dirName;
      return {
        id: session.id,
        tooltip: session.cwd ? `${displayName} - ${session.cwd}` : displayName,
        editableLabel: displayName,
        closable: sessions.length > 1,
        label: (
          <>
            <TerminalTabIcon iconId={session.icon} color={session.iconColor} />
            <span className="tab-item-label">{displayName}</span>
          </>
        ),
      };
    }),
    [sessions],
  );

  const handleTabContextMenu = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault();
    setTabContextMenu({ x: e.clientX, y: e.clientY, sessionId: id });
  }, []);

  return (
    <div className="panel terminal-panel">
      <div className="panel-header tabbed-panel-header">
        <span className="panel-title panel-icon terminal-icon tabbed-panel-title" data-tooltip="Terminal - drag to reorder" data-tooltip-pos="bottom">&gt;_</span>
        <TabBar
          ref={tabBarRef}
          tabs={tabs}
          activeId={activeSessionId}
          onActivate={setActiveSession}
          onClose={handleCloseTab}
          onReorder={reorderSessions}
          onRename={handleRenameTab}
          onContextMenu={handleTabContextMenu}
          className="tabbed-panel-tabs"
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
        <PanelMinimizeButton onMinimize={() => setPanelVisibility('terminal', false)} />
      </div>
      {tabContextMenu && (
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
              tabBarRef.current?.startRename(tabContextMenu.sessionId);
              closeContextMenu();
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className={`tab-context-item tab-context-has-sub ${contextSubMenu === 'icon' ? 'active' : ''}`}
            role="menuitem"
            onMouseDown={e => e.preventDefault()}
            onClick={() => setContextSubMenu(contextSubMenu === 'icon' ? null : 'icon')}
          >
            Change Icon
          </button>
          <button
            type="button"
            className={`tab-context-item tab-context-has-sub ${contextSubMenu === 'color' ? 'active' : ''}`}
            role="menuitem"
            onMouseDown={e => e.preventDefault()}
            onClick={() => setContextSubMenu(contextSubMenu === 'color' ? null : 'color')}
          >
            Change Color
          </button>
          {contextSubMenu === 'icon' && (
            <div className="tab-context-picker tab-icon-picker">
              {TERMINAL_ICONS.map(icon => {
                const session = sessions.find(s => s.id === tabContextMenu.sessionId);
                const isActive = (session?.icon || 'terminal') === icon.id;
                return (
                  <button
                    key={icon.id}
                    type="button"
                    className={`tab-icon-option ${isActive ? 'active' : ''}`}
                    data-tooltip={icon.label}
                    data-tooltip-pos="bottom"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      updateSessionAppearance(tabContextMenu.sessionId, icon.id, undefined);
                      closeContextMenu();
                    }}
                  >
                    {icon.svg}
                  </button>
                );
              })}
            </div>
          )}
          {contextSubMenu === 'color' && (
            <div className="tab-context-picker tab-color-picker">
              {TAB_COLORS.map(color => (
                <button
                  key={color.id}
                  type="button"
                  className={`tab-color-option ${
                    (sessions.find(s => s.id === tabContextMenu.sessionId)?.iconColor || '') === color.value ? 'active' : ''
                  }`}
                  data-tooltip={color.label}
                  data-tooltip-pos="bottom"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    updateSessionAppearance(tabContextMenu.sessionId, undefined, color.value);
                    closeContextMenu();
                  }}
                >
                  {color.value ? (
                    <span className="tab-color-swatch" style={{ background: color.value }} />
                  ) : (
                    <span className="tab-color-swatch tab-color-default">
                      <span className="tab-color-reset-line" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="tab-context-separator" />
          {sessions.length > 1 && (
            <>
              <button
                type="button"
                className="tab-context-item"
                role="menuitem"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  handleCloseTab(tabContextMenu.sessionId);
                  closeContextMenu();
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
                  closeContextMenu();
                }}
              >
                Close Others
              </button>
            </>
          )}
        </div>
      )}
      <div className="terminal-instances">
        {sessions.map(session => (
          <TerminalInstance
            key={session.id}
            sessionId={session.id}
            isActive={session.id === activeSessionId}
            theme={theme}
            cwd={session.cwd}
            onCwdChange={handleCwdChange}
            onOpenFile={handleOpenFile}
          />
        ))}
      </div>
    </div>
  );
}
