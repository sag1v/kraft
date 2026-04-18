import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { TerminalInstance } from './TerminalInstance';
import { PanelMinimizeButton, PanelMaximizeButton, RestoreIcon } from './IconButton';
import { tooltipWithShortcut } from '../shortcuts';

export function SplitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="8" y="1" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function SplitDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="12" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="1" y="8" width="12" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function PaneZoomIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M1 4.5V1.5A.5.5 0 0 1 1.5 1H4.5M7.5 1H10.5A.5.5 0 0 1 11 1.5V4.5M11 7.5V10.5A.5.5 0 0 1 10.5 11H7.5M4.5 11H1.5A.5.5 0 0 1 1 10.5V7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PaneRestoreIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4 1H1.5A.5.5 0 0 0 1 1.5V4M8 1H10.5A.5.5 0 0 1 11 1.5V4M8 11H10.5A.5.5 0 0 0 11 10.5V8M4 11H1.5A.5.5 0 0 1 1 10.5V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TilesIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="4.5" height="4.5" rx="0.75" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6.5" y="1" width="4.5" height="4.5" rx="0.75" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1" y="6.5" width="4.5" height="4.5" rx="0.75" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6.5" y="6.5" width="4.5" height="4.5" rx="0.75" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg width="8" height="12" viewBox="0 0 8 12" fill="none" aria-hidden="true">
      <circle cx="2" cy="2" r="1" fill="currentColor" />
      <circle cx="6" cy="2" r="1" fill="currentColor" />
      <circle cx="2" cy="5" r="1" fill="currentColor" />
      <circle cx="6" cy="5" r="1" fill="currentColor" />
      <circle cx="2" cy="8" r="1" fill="currentColor" />
      <circle cx="6" cy="8" r="1" fill="currentColor" />
      <circle cx="2" cy="11" r="1" fill="currentColor" />
      <circle cx="6" cy="11" r="1" fill="currentColor" />
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
    splitDown,
    updateGroupColPcts,
    updateGroupRowPcts,
    movePaneTo,
    explorerRoot,
    agentContextDirs,
  } = useSessionContext();

  type DropTarget =
    | { kind: 'column'; rowId: string; colIdx: number }
    | { kind: 'new-row'; insertAfterRowId: string | null };

  const workspaceRoots = useMemo(() => {
    const roots: string[] = [];
    if (explorerRoot) roots.push(explorerRoot);
    for (const d of agentContextDirs) {
      if (d.path && !roots.includes(d.path)) roots.push(d.path);
    }
    return roots;
  }, [explorerRoot, agentContextDirs]);

  const creatingInitialRef = useRef(false);

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

  // ── Container ref (for both col and row divider drag) ────────────────────
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Split mode detection ─────────────────────────────────────────────────
  const totalPanes = activeGroup?.rows.reduce((sum, r) => sum + r.panes.length, 0) ?? 0;
  const inSplitMode = totalPanes >= 2 || (activeGroup?.rows.length ?? 0) >= 2;

  // ── Per-pane zoom ─────────────────────────────────────────────────────────
  const [zoomedPaneId, setZoomedPaneId] = useState<string | null>(null);

  useEffect(() => { setZoomedPaneId(null); }, [activeGroupId]);

  const effectiveZoomedPaneId = useMemo(() => {
    if (!zoomedPaneId || !activeGroup) return null;
    return activeGroup.rows.some(r => r.panes.some(p => p.id === zoomedPaneId)) ? zoomedPaneId : null;
  }, [zoomedPaneId, activeGroup]);

  // ── Column divider drag ──────────────────────────────────────────────────
  const handleColDividerMouseDown = useCallback((rowId: string, dividerIdx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (!activeGroup) return;
    const groupId = activeGroup.id;
    const row = activeGroup.rows.find(r => r.id === rowId);
    if (!row) return;
    const startPcts = [...row.colPcts];
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
        const newPcts = [...startPcts];
        newPcts[dividerIdx] = newLeft;
        newPcts[dividerIdx + 1] = combinedSize - newLeft;
        updateGroupColPcts(groupId, rowId, newPcts);
      });
    };
    const onMouseUp = () => {
      cancelAnimationFrame(animFrame);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [activeGroup, updateGroupColPcts]);

  // ── Row divider drag ──────────────────────────────────────────────────────
  const handleRowDividerMouseDown = useCallback((dividerIdx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (!activeGroup) return;
    const groupId = activeGroup.id;
    const startPcts = [...activeGroup.rowPcts];
    const combinedStart = startPcts.slice(0, dividerIdx).reduce((a, b) => a + b, 0);
    const combinedSize = startPcts[dividerIdx] + startPcts[dividerIdx + 1];
    const MIN_PCT = 10;

    let animFrame = 0;
    const onMouseMove = (ev: MouseEvent) => {
      cancelAnimationFrame(animFrame);
      animFrame = requestAnimationFrame(() => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const mousePct = ((ev.clientY - rect.top) / rect.height) * 100;
        const newTop = Math.max(MIN_PCT, Math.min(combinedSize - MIN_PCT, mousePct - combinedStart));
        const newPcts = [...startPcts];
        newPcts[dividerIdx] = newTop;
        newPcts[dividerIdx + 1] = combinedSize - newTop;
        updateGroupRowPcts(groupId, newPcts);
      });
    };
    const onMouseUp = () => {
      cancelAnimationFrame(animFrame);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [activeGroup, updateGroupRowPcts]);

  // ── Pane drag-to-reorder (cross-row) ─────────────────────────────────────
  const [draggingPaneId, setDraggingPaneId] = useState<string | null>(null);
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleDragHandleMouseDown = useCallback((paneId: string, rowId: string, fromIdx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeGroup) return;
    const groupId = activeGroup.id;
    dropTargetRef.current = null;
    setDraggingPaneId(paneId);
    setDraggingRowId(rowId);
    setDropTarget(null);

    const onMouseUp = () => {
      document.removeEventListener('mouseup', onMouseUp);
      const target = dropTargetRef.current;
      setDraggingPaneId(null);
      setDraggingRowId(null);
      setDropTarget(null);
      dropTargetRef.current = null;
      if (!target) return;
      // skip no-op: same row, same column
      if (target.kind === 'column' && target.rowId === rowId && target.colIdx === fromIdx) return;
      movePaneTo(groupId, paneId, rowId, target);
    };
    document.addEventListener('mouseup', onMouseUp);
  }, [activeGroup, movePaneTo]);

  // Determines drop target from mouse position — supports cross-row column drops and new-row insertion
  const handleOverlayMouseMove = useCallback((e: React.MouseEvent) => {
    if (!activeGroup || !containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;
    const containerW = containerRect.width;
    const ROW_EDGE_PX = 20;
    const DIVIDER_W = 4;

    for (let ri = 0; ri < activeGroup.rows.length; ri++) {
      const row = activeGroup.rows[ri];
      const rowEl = rowRefs.current.get(row.id);
      if (!rowEl) continue;
      const rowRect = rowEl.getBoundingClientRect();
      const rowTop = rowRect.top - containerRect.top;
      const rowH = rowRect.height;
      if (mouseY < rowTop || mouseY >= rowTop + rowH) continue;

      const edgePx = Math.min(ROW_EDGE_PX, rowH * 0.25);

      // Top edge → new row before this one
      if (mouseY < rowTop + edgePx) {
        const target: DropTarget = { kind: 'new-row', insertAfterRowId: ri === 0 ? null : activeGroup.rows[ri - 1].id };
        dropTargetRef.current = target;
        setDropTarget(target);
        return;
      }

      // Bottom edge → new row after this one
      if (mouseY >= rowTop + rowH - edgePx) {
        const target: DropTarget = { kind: 'new-row', insertAfterRowId: row.id };
        dropTargetRef.current = target;
        setDropTarget(target);
        return;
      }

      // Middle → column slot in this row
      let closestColIdx = 0;
      let minDist = Infinity;
      let accumulated = 0;
      for (let ci = 0; ci < row.panes.length; ci++) {
        if (ci > 0) accumulated += DIVIDER_W;
        const paneW = (row.colPcts[ci] / 100) * containerW;
        const dist = Math.abs(mouseX - (accumulated + paneW / 2));
        if (dist < minDist) { minDist = dist; closestColIdx = ci; }
        accumulated += paneW;
      }
      const target: DropTarget = { kind: 'column', rowId: row.id, colIdx: closestColIdx };
      dropTargetRef.current = target;
      setDropTarget(target);
      return;
    }

    // Below all rows — insert after last
    if (activeGroup.rows.length > 0) {
      const target: DropTarget = { kind: 'new-row', insertAfterRowId: activeGroup.rows[activeGroup.rows.length - 1].id };
      dropTargetRef.current = target;
      setDropTarget(target);
    }
  }, [activeGroup]);

  return (
    <div className={`panel terminal-panel${inSplitMode ? ' terminal-panel--split' : ''}`}>
      <div className="panel-header">
        <div className="terminal-panel-header-left">
          <span className="panel-title panel-icon terminal-icon" data-tooltip="Terminal - drag to reorder" data-tooltip-pos="bottom">&gt;_</span>
          {effectiveZoomedPaneId && activeGroup && totalPanes > 1 && (
            <button
              type="button"
              className="terminal-zoom-restore-chip"
              onClick={() => setZoomedPaneId(null)}
              data-tooltip="Restore split view"
              data-tooltip-pos="bottom"
              onMouseDown={e => e.stopPropagation()}
            >
              <RestoreIcon />
              <span>{totalPanes} panes</span>
            </button>
          )}
        </div>
        <div className="terminal-panel-header-actions">
          <button
            type="button"
            className="panel-split-btn"
            data-tooltip="Split terminal right (Ctrl+Shift+D)"
            data-tooltip-pos="bottom"
            onMouseDown={e => e.stopPropagation()}
            onClick={splitPane}
          >
            <SplitIcon />
          </button>
          <button
            type="button"
            className="panel-split-btn"
            data-tooltip="Split terminal down"
            data-tooltip-pos="bottom"
            onMouseDown={e => e.stopPropagation()}
            onClick={splitDown}
          >
            <SplitDownIcon />
          </button>
          <PanelMaximizeButton isMaximized={maximizedPanel === 'terminal'} onToggle={() => setMaximizedPanel(maximizedPanel === 'terminal' ? null : 'terminal')} />
          <PanelMinimizeButton onMinimize={() => { setMaximizedPanel(null); setPanelVisibility('terminal', false); }} tooltip={tooltipWithShortcut('Hide Terminal', 'toggle-terminal')} />
        </div>
      </div>

      <div className="terminal-instances" ref={containerRef}>
        {/* Global drag overlay — covers entire container so xterm doesn't steal events.
            Renders column drop zones (all rows) + row-insertion lines. */}
        {draggingPaneId && activeGroup && (
          <div className="terminal-drag-overlay" onMouseMove={handleOverlayMouseMove}>
            {/* Column drop zones — one slot per pane, in each row */}
            {activeGroup.rows.flatMap((row, rowIdx) => {
              const rowTopPct = activeGroup.rowPcts.slice(0, rowIdx).reduce((a, b) => a + b, 0);
              const rowHeightPct = activeGroup.rowPcts[rowIdx];
              return row.panes.map((pane, ci) => {
                const leftPct = row.colPcts.slice(0, ci).reduce((a, b) => a + b, 0);
                const isActive = dropTarget?.kind === 'column'
                  && dropTarget.rowId === row.id
                  && dropTarget.colIdx === ci
                  && pane.id !== draggingPaneId;
                return (
                  <div key={`dz-${pane.id}`}
                    className={`terminal-drop-zone${isActive ? ' terminal-drop-zone--active' : ''}`}
                    style={{ top: `${rowTopPct}%`, height: `${rowHeightPct}%`, left: `${leftPct}%`, width: `${row.colPcts[ci]}%` }}
                  />
                );
              });
            })}
            {/* Row insertion lines — N+1 positions (before first, between each, after last) */}
            {[null, ...activeGroup.rows.map(r => r.id)].map((insertAfterRowId, li) => {
              const topPct = insertAfterRowId === null ? 0
                : activeGroup.rowPcts.slice(0, activeGroup.rows.findIndex(r => r.id === insertAfterRowId) + 1).reduce((a, b) => a + b, 0);
              const isActive = dropTarget?.kind === 'new-row' && dropTarget.insertAfterRowId === insertAfterRowId;
              return (
                <div key={`ri-${li}`}
                  className={`terminal-row-insert-line${isActive ? ' terminal-row-insert-line--active' : ''}`}
                  style={{ top: `${topPct}%` }}
                />
              );
            })}
          </div>
        )}

        {groups.flatMap(g => {
          const isActiveGrp = g.id === activeGroupId;

          return g.rows.flatMap((row, rowIdx) => {
            const isZoomedRow = isActiveGrp && !!effectiveZoomedPaneId && row.panes.some(p => p.id === effectiveZoomedPaneId);
            const isHiddenRow = isActiveGrp && !!effectiveZoomedPaneId && !isZoomedRow;

            const rowFlexValue = isActiveGrp && !effectiveZoomedPaneId ? (g.rowPcts[rowIdx] ?? 1) : 1;

            const rowStyle: React.CSSProperties = !isActiveGrp || isHiddenRow
              ? { display: 'none' }
              : { flex: rowFlexValue, display: 'flex', minHeight: 0, position: 'relative' };

            const elements: React.ReactNode[] = [];

            // Row divider before this row (active group only, not first row, not when zoomed)
            if (isActiveGrp && rowIdx > 0 && !effectiveZoomedPaneId) {
              elements.push(
                <div key={`rdiv-${row.id}`} className="terminal-row-divider" onMouseDown={handleRowDividerMouseDown(rowIdx - 1)} />
              );
            }

            elements.push(
              <div
                key={row.id}
                className="terminal-row"
                style={rowStyle}
                ref={el => { if (el) rowRefs.current.set(row.id, el); else rowRefs.current.delete(row.id); }}
              >

                {row.panes.flatMap((pane, paneIdx) => {
                  const isFocused = isActiveGrp && pane.id === g.focusedPaneId;
                  const groupInSplit = isActiveGrp && (g.rows.length > 1 || row.panes.length > 1);
                  const isZoomed = isActiveGrp && effectiveZoomedPaneId === pane.id;
                  const isHiddenByZoom = isActiveGrp && !!effectiveZoomedPaneId && !isZoomed;
                  const isDragging = draggingPaneId === pane.id;

                  const colFlex = isZoomed ? 1 : (row.colPcts[paneIdx] ?? 1);

                  const wrapperStyle: React.CSSProperties = isHiddenByZoom
                    ? { display: 'none' }
                    : { flex: colFlex, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', opacity: isDragging ? 0.35 : 1 };

                  const paneElements: React.ReactNode[] = [];

                  // Column divider between panes (not when zoomed)
                  if (paneIdx > 0 && !effectiveZoomedPaneId) {
                    paneElements.push(
                      <div key={`cdiv-${pane.id}`} className="terminal-split-divider" onMouseDown={handleColDividerMouseDown(row.id, paneIdx - 1)} />
                    );
                  }

                  paneElements.push(
                    <div key={pane.id} className="terminal-pane-wrapper" style={wrapperStyle}>
                      {/* Pane header bar — only in split mode; contains drag handle + zoom + close */}
                      {groupInSplit && (
                        <div className="terminal-pane-header">
                          <div
                            className="terminal-pane-header-grip"
                            onMouseDown={handleDragHandleMouseDown(pane.id, row.id, paneIdx)}
                            title="Drag to reorder"
                            aria-label="Drag to reorder pane"
                          >
                            <GripIcon />
                          </div>
                          <div className="terminal-pane-header-spacer" />
                          <button
                            className="terminal-pane-header-btn"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => {
                              e.stopPropagation();
                              setZoomedPaneId(isZoomed ? null : pane.id);
                            }}
                            title={isZoomed ? 'Restore split view' : 'Maximize pane'}
                            aria-label={isZoomed ? 'Restore split view' : 'Maximize pane'}
                          >
                            {isZoomed ? <RestoreIcon /> : <PaneZoomIcon />}
                          </button>
                          <button
                            className="terminal-pane-header-btn"
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => { e.stopPropagation(); closePane(pane.id); }}
                            title="Close pane"
                            aria-label="Close pane"
                          >×</button>
                        </div>
                      )}

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
                    </div>
                  );

                  return paneElements;
                })}
              </div>
            );

            return elements;
          });
        })}
      </div>
    </div>
  );
}
