import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { TerminalInstance } from './TerminalInstance';
import { PanelMinimizeButton, PanelMaximizeButton } from './IconButton';
import { tooltipWithShortcut } from '../shortcuts';

// SVG icon for the split action
export function SplitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="8" y="1" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

export function TerminalPanel() {
  const { theme, settings, setPanelVisibility, setOpenFilePath, maximizedPanel, setMaximizedPanel } = useUIContext();
  const {
    groups,
    activeGroup,
    activeGroupId,
    createGroup,
    updatePaneCwd,
    setFocusedPane,
    closePane,
    splitPane,
    updateGroupSplitPcts,
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

  // Bootstrap: create the first terminal group if none exist
  useEffect(() => {
    if (creatingInitialRef.current || groups.length > 0) return;
    creatingInitialRef.current = true;
    createGroup();
  }, []);

  const handleCwdChange = useCallback((paneId: string, newCwd: string) => {
    updatePaneCwd(paneId, newCwd);
  }, [updatePaneCwd]);

  const handleOpenFile = useCallback((filePath: string) => {
    setOpenFilePath(filePath);
    setPanelVisibility('editor', true);
  }, [setOpenFilePath, setPanelVisibility]);

  // ── Split divider drag ────────────────────────────────────────────────────
  const inSplitMode = (activeGroup?.panes.length ?? 0) >= 2;
  const containerRef = useRef<HTMLDivElement>(null);

  // dividerIdx = index of the left pane of the divider (between pane[i] and pane[i+1])
  const handleDividerMouseDown = useCallback((dividerIdx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (!activeGroup) return;
    const groupId = activeGroup.id;
    // Snapshot pcts at drag-start so mousemove closure doesn't go stale
    const startPcts = [...activeGroup.splitPcts];
    const combinedStart = startPcts.slice(0, dividerIdx).reduce((a, b) => a + b, 0);
    const combinedSize = startPcts[dividerIdx] + startPcts[dividerIdx + 1];
    const MIN_PCT = 10;

    let animFrame = 0;
    const onMouseMove = (ev: MouseEvent) => {
      cancelAnimationFrame(animFrame);
      animFrame = requestAnimationFrame(() => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const mousePct = ((ev.clientX - rect.left) / rect.width) * 100;
        const newLeft = Math.max(MIN_PCT, Math.min(combinedSize - MIN_PCT, mousePct - combinedStart));
        const newRight = combinedSize - newLeft;
        const newPcts = [...startPcts];
        newPcts[dividerIdx] = newLeft;
        newPcts[dividerIdx + 1] = newRight;
        updateGroupSplitPcts(groupId, newPcts);
      });
    };
    const onMouseUp = () => {
      cancelAnimationFrame(animFrame);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [activeGroup, updateGroupSplitPcts]);

  return (
    <div className={`panel terminal-panel${inSplitMode ? ' terminal-panel--split' : ''}`}>
      <div className="panel-header">
        <span className="panel-title panel-icon terminal-icon" data-tooltip="Terminal - drag to reorder" data-tooltip-pos="bottom">&gt;_</span>
        <button
          type="button"
          className="panel-split-btn"
          data-tooltip="Split terminal (Ctrl+Shift+D)"
          data-tooltip-pos="bottom"
          onMouseDown={e => e.stopPropagation()}
          onClick={splitPane}
        >
          <SplitIcon />
        </button>
        <PanelMaximizeButton isMaximized={maximizedPanel === 'terminal'} onToggle={() => setMaximizedPanel(maximizedPanel === 'terminal' ? null : 'terminal')} />
        <PanelMinimizeButton onMinimize={() => { setMaximizedPanel(null); setPanelVisibility('terminal', false); }} tooltip={tooltipWithShortcut('Hide Terminal', 'toggle-terminal')} />
      </div>

      <div className="terminal-instances" ref={containerRef}>
        {/*
         * ALL panes from ALL groups are rendered here as stable keyed wrappers.
         * This prevents TerminalInstance from unmounting/remounting when switching tabs,
         * which would reset cwd tracking and lose terminal state.
         *
         * Active panes: wrapper is visible (flex), TerminalInstance isActive=true
         * Hidden panes: wrapper is display:none, TerminalInstance isActive=false
         *
         * Dividers are interleaved between consecutive active panes.
         */}
        {groups.flatMap(g =>
          g.panes.flatMap((pane, paneIdx) => {
            const isActiveGrp = g.id === activeGroupId;
            const isFocused = isActiveGrp && pane.id === g.focusedPaneId;
            const flex = isActiveGrp ? (g.splitPcts[paneIdx] ?? 1) : 1;
            const groupInSplit = isActiveGrp && g.panes.length >= 2;

            const elements: React.ReactNode[] = [];

            // Divider before this pane (only for active split panes, not the first)
            if (isActiveGrp && groupInSplit && paneIdx > 0) {
              elements.push(
                <div
                  key={`divider-${pane.id}`}
                  className="terminal-split-divider"
                  onMouseDown={handleDividerMouseDown(paneIdx - 1)}
                />
              );
            }

            elements.push(
              <div
                key={pane.id}
                className="terminal-pane-wrapper"
                style={isActiveGrp
                  ? { flex, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
                  : { display: 'none' }
                }
              >
                <TerminalInstance
                  sessionId={pane.id}
                  isActive={isActiveGrp}
                  isFocused={isFocused}
                  theme={theme}
                  fontFamily={settings.fontFamily}
                  fontSize={settings.fontSize}
                  cwd={pane.cwd}
                  workspaceRoots={workspaceRoots}
                  onCwdChange={handleCwdChange}
                  onOpenFile={handleOpenFile}
                  onActivate={isActiveGrp && groupInSplit ? () => setFocusedPane(pane.id) : undefined}
                />
                {groupInSplit && (
                  <button
                    className="terminal-pane-close-btn"
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); closePane(pane.id); }}
                    title="Close pane"
                    aria-label="Close pane"
                  >×</button>
                )}
              </div>
            );

            return elements;
          })
        )}
      </div>
    </div>
  );
}
