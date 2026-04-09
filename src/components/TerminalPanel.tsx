import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { TerminalInstance } from './TerminalInstance';
import { PanelMinimizeButton } from './IconButton';
import { tooltipWithShortcut } from '../shortcuts';

export function TerminalPanel() {
  const { theme, setPanelVisibility, setOpenFilePath } = useUIContext();
  const {
    sessions,
    activeSessionId,
    createSession,
    updateSessionCwd,
    explorerRoot,
    agentContextDirs,
  } = useSessionContext();

  const workspaceRoots = useMemo(() => {
    const roots: string[] = [];
    if (explorerRoot) roots.push(explorerRoot);
    for (const d of agentContextDirs) {
      if (d.path && !roots.includes(d.path)) roots.push(d.path);
    }
    return roots;
  }, [explorerRoot, agentContextDirs]);

  const creatingInitialRef = useRef(false);

  // Bootstrap: create the first terminal session if none exist
  useEffect(() => {
    if (creatingInitialRef.current || sessions.length > 0) return;
    creatingInitialRef.current = true;
    createSession();
  }, []);

  const handleCwdChange = useCallback((sessionId: string, newCwd: string) => {
    updateSessionCwd(sessionId, newCwd);
  }, [updateSessionCwd]);

  const handleOpenFile = useCallback((filePath: string) => {
    setOpenFilePath(filePath);
    setPanelVisibility('viewer', true);
  }, [setOpenFilePath, setPanelVisibility]);

  return (
    <div className="panel terminal-panel">
      <div className="panel-header">
        <span className="panel-title panel-icon terminal-icon" data-tooltip="Terminal - drag to reorder" data-tooltip-pos="bottom">&gt;_</span>
        <PanelMinimizeButton onMinimize={() => setPanelVisibility('terminal', false)} tooltip={tooltipWithShortcut('Hide Terminal', 'toggle-terminal')} />
      </div>
      <div className="terminal-instances">
        {sessions.map(session => (
          <TerminalInstance
            key={session.id}
            sessionId={session.id}
            isActive={session.id === activeSessionId}
            theme={theme}
            cwd={session.cwd}
            workspaceRoots={workspaceRoots}
            onCwdChange={handleCwdChange}
            onOpenFile={handleOpenFile}
          />
        ))}
      </div>
    </div>
  );
}
