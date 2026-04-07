import React, { useState, useRef, useCallback, useMemo } from 'react';
import { useUIContext } from '../context/AppContext';
import type { PanelId } from '../types';
import { Explorer } from './Explorer';
import { Viewer } from './Viewer';
import { TerminalPanel } from './TerminalPanel';

const MemoExplorer = React.memo(Explorer);
const MemoViewer = React.memo(Viewer);
const MemoTerminalPanel = React.memo(TerminalPanel);

type DropPosition = 'left' | 'right' | 'top' | 'bottom';

interface DropLine {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DropIndicatorState {
  targetId: PanelId | null;
  position: DropPosition;
  line: DropLine;
}

const EDGE_THRESHOLD = 48;

/* ------------------------------------------------------------------ */
/*  Grid utilities                                                     */
/* ------------------------------------------------------------------ */

function defaultRowHeights(numRows: number): number[] {
  if (numRows <= 1) return [];
  const pct = Math.floor(100 / numRows);
  return Array.from({ length: numRows - 1 }, () => pct);
}

function buildRowTemplate(numRows: number, rowHeights: number[]): string {
  const parts: string[] = [];
  for (let r = 0; r < numRows; r++) {
    if (r > 0) parts.push('4px');
    if (r < numRows - 1) {
      parts.push(`${rowHeights[r] ?? Math.floor(100 / numRows)}%`);
    } else {
      parts.push('1fr');
    }
  }
  return parts.join(' ');
}

function buildExpandedGrid(grid: PanelId[][]): string[][] {
  const numRows = grid.length;
  const numCols = grid[0]?.length ?? 0;
  if (numRows === 0 || numCols === 0) return [];

  const exRows = numRows * 2 - 1;
  const exCols = numCols * 2 - 1;
  const result: string[][] = [];

  for (let er = 0; er < exRows; er++) {
    const row: string[] = [];
    for (let ec = 0; ec < exCols; ec++) {
      const isHR = er % 2 === 1;
      const isHC = ec % 2 === 1;
      const cr = Math.floor(er / 2);
      const cc = Math.floor(ec / 2);

      if (!isHR && !isHC) {
        row.push(grid[cr][cc]);
      } else if (isHR && !isHC) {
        const above = grid[cr][cc];
        const below = grid[cr + 1][cc];
        row.push(above === below ? above : `vr${cr}`);
      } else if (!isHR && isHC) {
        const left = grid[cr][cc];
        const right = grid[cr][cc + 1];
        row.push(left === right ? left : `hr${cr}c${cc}`);
      } else {
        const tl = grid[cr][cc];
        const tr = grid[cr][cc + 1];
        const bl = grid[cr + 1][cc];
        const br = grid[cr + 1][cc + 1];
        if (tl === tr && tr === bl && bl === br) {
          row.push(tl);
        } else {
          row.push(`vr${cr}`);
        }
      }
    }
    result.push(row);
  }
  return result;
}

function isExplorerFixedCol(grid: PanelId[][], c: number): boolean {
  const numCols = grid[0].length;
  if (numCols <= 1) return false;
  let found = false;
  for (const row of grid) {
    if (row[c] !== 'explorer') continue;
    found = true;
    if ((c > 0 && row[c - 1] === 'explorer') || (c < numCols - 1 && row[c + 1] === 'explorer')) {
      return false;
    }
  }
  return found;
}

function buildColTemplate(grid: PanelId[][], explorerWidth: number): string {
  const numCols = grid[0]?.length ?? 0;
  const cols: string[] = [];
  for (let c = 0; c < numCols; c++) {
    if (c > 0) cols.push('4px');
    cols.push(isExplorerFixedCol(grid, c) ? `${explorerWidth}px` : '1fr');
  }
  return cols.join(' ');
}

function buildGridStyles(
  grid: PanelId[][],
  explorerWidth: number,
  rowHeights: number[],
): React.CSSProperties {
  if (grid.length === 0) return { display: 'none' };

  const expanded = buildExpandedGrid(grid);
  const gridAreas = expanded.map(row => `"${row.join(' ')}"`).join(' ');

  return {
    display: 'grid',
    gridTemplateAreas: gridAreas,
    gridTemplateColumns: buildColTemplate(grid, explorerWidth),
    gridTemplateRows: buildRowTemplate(grid.length, rowHeights),
  };
}

/* ------------------------------------------------------------------ */
/*  Panel removal and grid simplification                              */
/* ------------------------------------------------------------------ */

function simplifyGrid(grid: PanelId[][]): PanelId[][] {
  let g = grid.map(r => [...r]);

  for (let c = g[0].length - 1; c > 0; c--) {
    if (g.every(row => row[c] === row[c - 1])) {
      g = g.map(row => [...row.slice(0, c), ...row.slice(c + 1)]);
    }
  }

  for (let r = g.length - 1; r > 0; r--) {
    if (g[r].every((v, c) => v === g[r - 1][c])) {
      g = [...g.slice(0, r), ...g.slice(r + 1)];
    }
  }

  return g;
}

function removePanelFromGrid(grid: PanelId[][], panel: PanelId): PanelId[][] {
  const numRows = grid.length;
  const numCols = grid[0].length;

  let minR = numRows, maxR = -1, minC = numCols, maxC = -1;
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      if (grid[r][c] === panel) {
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      }
    }
  }
  if (maxR === -1) return grid;

  const spanRows = maxR - minR + 1;
  const spanCols = maxC - minC + 1;

  if (spanCols === numCols) {
    const result = grid.filter((_, r) => r < minR || r > maxR);
    return result.length > 0 ? simplifyGrid(result) : grid;
  }

  if (spanRows === numRows) {
    const result = grid.map(row => row.filter((_, c) => c < minC || c > maxC));
    return result.length > 0 && result[0].length > 0 ? simplifyGrid(result) : grid;
  }

  const g = grid.map(r => [...r]);
  const tryExpand = (nr: number, nc: number): boolean => {
    if (nr < 0 || nr >= numRows || nc < 0 || nc >= numCols) return false;
    const neighbor = g[nr][nc];
    if (neighbor === panel) return false;
    let nMinR = numRows, nMaxR = -1, nMinC = numCols, nMaxC = -1;
    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        if (g[r][c] === neighbor) {
          nMinR = Math.min(nMinR, r); nMaxR = Math.max(nMaxR, r);
          nMinC = Math.min(nMinC, c); nMaxC = Math.max(nMaxC, c);
        }
      }
    }
    const newMinR = Math.min(nMinR, minR);
    const newMaxR = Math.max(nMaxR, maxR);
    const newMinC = Math.min(nMinC, minC);
    const newMaxC = Math.max(nMaxC, maxC);
    for (let r = newMinR; r <= newMaxR; r++) {
      for (let c = newMinC; c <= newMaxC; c++) {
        if (g[r][c] !== neighbor && g[r][c] !== panel) return false;
      }
    }
    for (let r = newMinR; r <= newMaxR; r++) {
      for (let c = newMinC; c <= newMaxC; c++) {
        g[r][c] = neighbor;
      }
    }
    return true;
  };

  const neighbors: [number, number][] = [];
  if (minC > 0) neighbors.push([minR, minC - 1]);
  if (maxC < numCols - 1) neighbors.push([minR, maxC + 1]);
  if (minR > 0) neighbors.push([minR - 1, minC]);
  if (maxR < numRows - 1) neighbors.push([maxR + 1, minC]);

  for (const [nr, nc] of neighbors) {
    if (tryExpand(nr, nc)) return simplifyGrid(g);
  }

  return grid;
}

/* ------------------------------------------------------------------ */
/*  Drop logic                                                         */
/* ------------------------------------------------------------------ */

function applyEdgeDrop(grid: PanelId[][], draggedId: PanelId, edge: DropPosition): PanelId[][] {
  const reduced = removePanelFromGrid(grid, draggedId);
  switch (edge) {
    case 'left':
      return reduced.map(row => [draggedId, ...row]);
    case 'right':
      return reduced.map(row => [...row, draggedId]);
    case 'top': {
      const cols = reduced[0].length;
      return [new Array(cols).fill(draggedId) as PanelId[], ...reduced];
    }
    case 'bottom': {
      const cols = reduced[0].length;
      return [...reduced, new Array(cols).fill(draggedId) as PanelId[]];
    }
  }
}

function applyPanelDrop(
  grid: PanelId[][],
  draggedId: PanelId,
  targetId: PanelId,
  position: DropPosition,
): PanelId[][] {
  const reduced = removePanelFromGrid(grid, draggedId);
  const numRows = reduced.length;
  const numCols = reduced[0].length;

  let tMinR = numRows, tMaxR = -1, tMinC = numCols, tMaxC = -1;
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      if (reduced[r][c] === targetId) {
        tMinR = Math.min(tMinR, r); tMaxR = Math.max(tMaxR, r);
        tMinC = Math.min(tMinC, c); tMaxC = Math.max(tMaxC, c);
      }
    }
  }
  if (tMaxR === -1) return grid;

  switch (position) {
    case 'left': {
      const result = reduced.map(r => [...r]);
      for (let r = 0; r < numRows; r++) {
        const insertCol = tMinC;
        result[r].splice(insertCol, 0, r >= tMinR && r <= tMaxR ? draggedId : result[r][insertCol]);
      }
      return simplifyGrid(result);
    }
    case 'right': {
      const result = reduced.map(r => [...r]);
      for (let r = 0; r < numRows; r++) {
        const insertCol = tMaxC + 1;
        result[r].splice(insertCol, 0, r >= tMinR && r <= tMaxR ? draggedId : result[r][Math.min(insertCol, result[r].length - 1)]);
      }
      return simplifyGrid(result);
    }
    case 'top': {
      const newRow: PanelId[] = reduced[tMinR].map((v, c) =>
        c >= tMinC && c <= tMaxC ? draggedId : v,
      );
      const result = [...reduced.slice(0, tMinR), newRow, ...reduced.slice(tMinR)];
      return simplifyGrid(result);
    }
    case 'bottom': {
      const newRow: PanelId[] = reduced[tMaxR].map((v, c) =>
        c >= tMinC && c <= tMaxC ? draggedId : v,
      );
      const result = [...reduced.slice(0, tMaxR + 1), newRow, ...reduced.slice(tMaxR + 1)];
      return simplifyGrid(result);
    }
  }
}

function detectEdge(e: React.DragEvent, containerRect: DOMRect): DropPosition | null {
  const x = e.clientX - containerRect.left;
  const y = e.clientY - containerRect.top;
  const w = containerRect.width;
  const h = containerRect.height;

  const dL = x;
  const dR = w - x;
  const dT = y;
  const dB = h - y;
  const min = Math.min(dL, dR, dT, dB);

  if (min > EDGE_THRESHOLD) return null;

  if (min === dL) return 'left';
  if (min === dR) return 'right';
  if (min === dT) return 'top';
  return 'bottom';
}

const INDICATOR_SIZE = 4;

function computeEdgeDropLine(edge: DropPosition, containerRect: DOMRect): DropLine {
  const w = containerRect.width;
  const h = containerRect.height;
  switch (edge) {
    case 'top':
      return { left: 0, top: 0, width: w, height: INDICATOR_SIZE };
    case 'bottom':
      return { left: 0, top: h - INDICATOR_SIZE, width: w, height: INDICATOR_SIZE };
    case 'left':
      return { left: 0, top: 0, width: INDICATOR_SIZE, height: h };
    case 'right':
      return { left: w - INDICATOR_SIZE, top: 0, width: INDICATOR_SIZE, height: h };
  }
}

function computePanelDropLine(
  position: DropPosition,
  panelRect: DOMRect,
  containerRect: DOMRect,
): DropLine {
  const pL = panelRect.left - containerRect.left;
  const pT = panelRect.top - containerRect.top;
  switch (position) {
    case 'top':
      return { left: pL, top: pT, width: panelRect.width, height: INDICATOR_SIZE };
    case 'bottom':
      return { left: pL, top: pT + panelRect.height - INDICATOR_SIZE, width: panelRect.width, height: INDICATOR_SIZE };
    case 'left':
      return { left: pL, top: pT, width: INDICATOR_SIZE, height: panelRect.height };
    case 'right':
      return { left: pL + panelRect.width - INDICATOR_SIZE, top: pT, width: INDICATOR_SIZE, height: panelRect.height };
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PanelLayout() {
  const { layout, panelLayout, setPanelLayout, panelVisibility, setPanelVisibility } = useUIContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [rowHeights, setRowHeights] = useState<number[]>([50]);
  const [dropIndicator, setDropIndicator] = useState<DropIndicatorState | null>(null);
  const [draggedPanel, setDraggedPanel] = useState<PanelId | null>(null);

  const explorerWidthRef = useRef(explorerWidth);
  const rowHeightsRef = useRef(rowHeights);
  explorerWidthRef.current = explorerWidth;
  rowHeightsRef.current = rowHeights;

  const layoutAllowsExplorer = layout !== 'editor-focus';
  const layoutAllowsViewer = layout !== 'terminal-focus';

  const showExplorer = layoutAllowsExplorer && panelVisibility.explorer;
  const showViewer = layoutAllowsViewer && panelVisibility.viewer;
  const showTerminal = panelVisibility.terminal;

  const isPanelVisible = useCallback((id: PanelId): boolean => {
    if (id === 'explorer') return showExplorer;
    if (id === 'viewer') return showViewer;
    return showTerminal;
  }, [showExplorer, showViewer, showTerminal]);

  const effectiveLayout = useMemo(() => {
    const visiblePanels = new Set(
      (['explorer', 'viewer', 'terminal'] as PanelId[]).filter(isPanelVisible)
    );
    if (visiblePanels.size === 0) return [];

    let grid = panelLayout.map(r => [...r]);
    const hiddenPanels = (['explorer', 'viewer', 'terminal'] as PanelId[]).filter(
      id => !visiblePanels.has(id)
    );
    for (const hidden of hiddenPanels) {
      const hasPanel = grid.some(row => row.includes(hidden));
      if (hasPanel) {
        grid = removePanelFromGrid(grid, hidden);
      }
    }

    return simplifyGrid(grid);
  }, [panelLayout, isPanelVisible]);

  const gridStyles = useMemo(
    () => buildGridStyles(effectiveLayout, explorerWidth, rowHeights),
    [effectiveLayout, explorerWidth, rowHeights],
  );

  const effectiveLayoutRef = useRef(effectiveLayout);
  effectiveLayoutRef.current = effectiveLayout;

  const onHandleMouseDown = useCallback((handleType: 'h' | 'v', param: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = explorerWidthRef.current;
    const snapshot = effectiveLayoutRef.current;
    const numCols = snapshot[0]?.length ?? 0;
    const numRows = snapshot.length;
    const dragRowHeights = [...rowHeightsRef.current];
    while (dragRowHeights.length < numRows - 1) {
      dragRowHeights.push(Math.floor(100 / numRows));
    }

    const onMouseMove = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      if (handleType === 'h') {
        const sign = param;
        const delta = (ev.clientX - startX) * sign;
        const w = Math.max(140, Math.min(startWidth + delta, 500));
        explorerWidthRef.current = w;
        containerRef.current.style.gridTemplateColumns = buildColTemplate(snapshot, w);
      } else {
        const rowIdx = param;
        const rect = containerRef.current.getBoundingClientRect();
        const cursorPct = ((ev.clientY - rect.top) / rect.height) * 100;
        const handlePct = (4 / rect.height) * 100;

        let abovePct = 0;
        for (let i = 0; i < rowIdx; i++) {
          abovePct += dragRowHeights[i];
          abovePct += handlePct;
        }

        const newPct = Math.max(10, Math.min(cursorPct - abovePct, 70));
        dragRowHeights[rowIdx] = newPct;

        containerRef.current.style.gridTemplateRows = buildRowTemplate(numRows, dragRowHeights);
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setExplorerWidth(explorerWidthRef.current);
      setRowHeights([...dragRowHeights]);
    };

    document.body.style.cursor = handleType === 'v' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  /* ---- Drag & Drop ---- */

  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const dragMouseDownTarget = useRef<EventTarget | null>(null);
  const MIN_DRAG_DISTANCE = 60;

  const onPanelMouseDown = useCallback((e: React.MouseEvent) => {
    dragMouseDownTarget.current = e.target;
  }, []);

  const onDragStart = useCallback((id: PanelId, e: React.DragEvent) => {
    const title = (e.currentTarget as HTMLElement).querySelector('.panel-title');
    const clickedEl = dragMouseDownTarget.current as Node | null;
    if (!title || !clickedEl || !title.contains(clickedEl)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    setDraggedPanel(id);
  }, []);

  const panelLayoutRef = useRef(panelLayout);
  panelLayoutRef.current = panelLayout;
  const draggedPanelRef = useRef(draggedPanel);
  draggedPanelRef.current = draggedPanel;

  const onContainerDragOver = useCallback((e: React.DragEvent) => {
    if (!draggedPanelRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!containerRef.current) return;

    if (dragStartPos.current) {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (Math.hypot(dx, dy) < MIN_DRAG_DISTANCE) return;
    }
    const containerRect = containerRef.current.getBoundingClientRect();
    const edge = detectEdge(e, containerRect);

    if (edge) {
      const line = computeEdgeDropLine(edge, containerRect);
      setDropIndicator(prev => {
        if (prev?.targetId === null && prev?.position === edge) return prev;
        return { targetId: null, position: edge, line };
      });
      return;
    }

    const panelEls = containerRef.current.querySelectorAll<HTMLElement>('[data-panel-id]');
    let closestPanel: PanelId | null = null;
    let closestRect: DOMRect | null = null;
    let closestDist = Infinity;

    for (const el of panelEls) {
      const id = el.dataset.panelId as PanelId;
      if (el.style.display === 'none') continue;
      const rect = el.getBoundingClientRect();
      if (
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom
      ) {
        closestPanel = id;
        closestRect = rect;
        closestDist = 0;
        break;
      }
      const cx = Math.max(rect.left, Math.min(e.clientX, rect.right));
      const cy = Math.max(rect.top, Math.min(e.clientY, rect.bottom));
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (dist < closestDist) {
        closestDist = dist;
        closestPanel = id;
        closestRect = rect;
      }
    }

    if (!closestPanel || !closestRect) return;

    const position = detectDropPositionFromRect(e.clientX, e.clientY, closestRect);
    const line = computePanelDropLine(position, closestRect, containerRect);

    setDropIndicator(prev => {
      if (prev?.targetId === closestPanel && prev?.position === position) return prev;
      return { targetId: closestPanel, position, line };
    });
  }, []);

  const onContainerDrop = useCallback((e: React.DragEvent) => {
    if (!draggedPanelRef.current) return;
    e.preventDefault();
    setDropIndicator(null);
    setDraggedPanel(null);
    const draggedId = e.dataTransfer.getData('text/plain') as PanelId;
    if (!draggedId || !containerRef.current) return;

    if (dragStartPos.current) {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (Math.hypot(dx, dy) < MIN_DRAG_DISTANCE) {
        dragStartPos.current = null;
        return;
      }
      dragStartPos.current = null;
    }
    const currentLayout = panelLayoutRef.current;
    const containerRect = containerRef.current.getBoundingClientRect();
    const edge = detectEdge(e, containerRect);

    let newLayout: PanelId[][];

    if (edge) {
      newLayout = applyEdgeDrop(currentLayout, draggedId, edge);
    } else {
      const panelEls = containerRef.current.querySelectorAll<HTMLElement>('[data-panel-id]');
      let targetId: PanelId | null = null;
      let targetRect: DOMRect | null = null;

      for (const el of panelEls) {
        const id = el.dataset.panelId as PanelId;
        if (el.style.display === 'none') continue;
        const rect = el.getBoundingClientRect();
        if (
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom
        ) {
          targetId = id;
          targetRect = rect;
          break;
        }
      }

      if (!targetId || !targetRect) return;
      if (targetId === draggedId) return;

      const position = detectDropPositionFromRect(e.clientX, e.clientY, targetRect);
      newLayout = applyPanelDrop(currentLayout, draggedId, targetId, position);
    }

    setPanelLayout(newLayout);
    setRowHeights(defaultRowHeights(newLayout.length));
  }, [setPanelLayout]);

  const onContainerDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && containerRef.current?.contains(related)) return;
    setDropIndicator(null);
  }, []);

  const onDragEnd = useCallback(() => {
    setDropIndicator(null);
    setDraggedPanel(null);
    dragStartPos.current = null;
  }, []);

  /* ---- Handles ---- */

  const handles = useMemo(() => {
    const result: React.ReactNode[] = [];
    if (effectiveLayout.length === 0) return result;
    const expanded = buildExpandedGrid(effectiveLayout);
    const seen = new Set<string>();

    for (let er = 0; er < expanded.length; er++) {
      for (let ec = 0; ec < expanded[er].length; ec++) {
        const area = expanded[er][ec];
        if (seen.has(area)) continue;

        const isVHandle = area.startsWith('vr');
        const isHHandle = area.startsWith('hr');
        if (!isVHandle && !isHHandle) continue;
        seen.add(area);

        if (isHHandle) {
          const cr = Math.floor(er / 2);
          const cc = Math.floor(ec / 2);
          const left = effectiveLayout[cr][cc];
          const right = effectiveLayout[cr][cc + 1];
          const explorerOnLeft = left === 'explorer';
          const explorerOnRight = right === 'explorer';
          const hasExplorer = explorerOnLeft || explorerOnRight;
          const sign = explorerOnRight ? -1 : 1;
          result.push(
            <div
              key={area}
              className="kraft-handle kraft-handle-h"
              style={{ gridArea: area }}
              onMouseDown={hasExplorer ? (e) => onHandleMouseDown('h', sign, e) : undefined}
            />,
          );
        } else {
          const match = area.match(/^vr(\d+)$/);
          const rowIdx = match ? parseInt(match[1], 10) : 0;
          result.push(
            <div
              key={area}
              className="kraft-handle kraft-handle-v"
              style={{ gridArea: area }}
              onMouseDown={(e) => onHandleMouseDown('v', rowIdx, e)}
            />,
          );
        }
      }
    }
    return result;
  }, [effectiveLayout, onHandleMouseDown]);

  const hasHiddenPanel = !panelVisibility.explorer || !panelVisibility.viewer || !panelVisibility.terminal;

  const showIndicator = dropIndicator && !(
    dropIndicator.targetId !== null && dropIndicator.targetId === draggedPanel
  );

  const allPanelIds: PanelId[] = ['explorer', 'viewer', 'terminal'];

  return (
    <div className="kraft-layout-root">
      <div
        className="kraft-layout"
        ref={containerRef}
        style={{ ...gridStyles, position: 'relative' }}
        onDragOver={onContainerDragOver}
        onDrop={onContainerDrop}
        onDragLeave={onContainerDragLeave}
      >
        {allPanelIds.map(id => {
          const visible = isPanelVisible(id);
          const inGrid = effectiveLayout.some(row => row.includes(id));
          return (
            <div
              key={id}
              data-panel-id={id}
              className={`kraft-panel kraft-${id} ${draggedPanel === id ? 'dragging' : ''}`}
              draggable={visible}
              style={{
                gridArea: inGrid ? id : undefined,
                display: visible ? undefined : 'none',
                position: 'relative',
              }}
              onMouseDown={onPanelMouseDown}
              onDragStart={visible ? (e) => onDragStart(id, e) : undefined}
              onDragEnd={visible ? onDragEnd : undefined}
            >
              {id === 'explorer' && <MemoExplorer />}
              {id === 'viewer' && <MemoViewer />}
              {id === 'terminal' && <MemoTerminalPanel />}
            </div>
          );
        })}
        {handles}
        {showIndicator && (
          <div
            className="kraft-drop-indicator"
            style={{
              position: 'absolute',
              left: dropIndicator!.line.left,
              top: dropIndicator!.line.top,
              width: dropIndicator!.line.width,
              height: dropIndicator!.line.height,
              pointerEvents: 'none',
              zIndex: 20,
              background: 'var(--accent)',
              borderRadius: '2px',
            }}
          />
        )}
      </div>

      {hasHiddenPanel && (
        <div className="panel-restore-bar" role="toolbar" aria-label="Restore panels">
          <span className="panel-restore-bar-label">Hidden:</span>
          {!panelVisibility.explorer && (
            <button type="button" className="panel-restore-btn" data-tooltip="Restore Explorer panel" onClick={() => setPanelVisibility('explorer', true)}>Explorer</button>
          )}
          {!panelVisibility.viewer && (
            <button type="button" className="panel-restore-btn" data-tooltip="Restore Viewer panel" onClick={() => setPanelVisibility('viewer', true)}>Viewer</button>
          )}
          {!panelVisibility.terminal && (
            <button type="button" className="panel-restore-btn" data-tooltip="Restore Terminal panel" onClick={() => setPanelVisibility('terminal', true)}>Terminal</button>
          )}
        </div>
      )}
    </div>
  );
}

function detectDropPositionFromRect(clientX: number, clientY: number, rect: DOMRect): DropPosition {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  const dL = x, dR = 1 - x, dT = y, dB = 1 - y;
  const min = Math.min(dL, dR, dT, dB);
  if (min === dT) return 'top';
  if (min === dB) return 'bottom';
  if (min === dL) return 'left';
  return 'right';
}
