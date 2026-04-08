import React, { useState, useRef, useCallback, useMemo, useLayoutEffect, useEffect } from 'react';
import { VscFolderOpened } from 'react-icons/vsc';
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

interface PanelGhostState {
  x: number;
  y: number;
  w: number;
  h: number;
  grabDx: number;
  grabDy: number;
  panelId: PanelId;
}

const EDGE_THRESHOLD = 48;
const DIRECTION_THRESHOLD = 0.25;

/** Minimum pixel size for any panel track while resizing (explorer, fr columns, row %). Also applied in App.css on `.kraft-panel`. */
const MIN_PANEL_RESIZE_PX = 100;
/** Numeric floor for fr values so math stays stable. */
const MIN_COL_FR = 1e-4;

/** Ensure two adjacent fr tracks each get at least minPx width inside availablePx. */
function clampFrPairMinPx(leftFr: number, rightFr: number, availablePx: number, minPx: number): [number, number] {
  if (availablePx <= minPx * 2) {
    const t = Math.max(MIN_COL_FR, leftFr + rightFr);
    return [Math.max(MIN_COL_FR, t / 2), Math.max(MIN_COL_FR, t / 2)];
  }
  let L = Math.max(MIN_COL_FR, leftFr);
  let R = Math.max(MIN_COL_FR, rightFr);
  const W = availablePx;
  for (let i = 0; i < 16; i++) {
    const minL = (minPx * R) / (W - minPx);
    const minR = (minPx * L) / (W - minPx);
    const nL = Math.max(L, minL, MIN_COL_FR);
    const nR = Math.max(R, minR, MIN_COL_FR);
    if (Math.abs(nL - L) < 1e-9 && Math.abs(nR - R) < 1e-9) break;
    L = nL;
    R = nR;
  }
  return [L, R];
}

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

function maxExplorerColumnWidthPx(grid: PanelId[][], containerWidth: number): number {
  if (!grid.length || !grid[0]?.length) return MIN_PANEL_RESIZE_PX;
  const numCols = grid[0].length;
  const handleW = Math.max(0, numCols - 1) * 4;
  let minOtherCols = 0;
  for (let c = 0; c < numCols; c++) {
    if (isExplorerFixedCol(grid, c)) continue;
    minOtherCols += MIN_PANEL_RESIZE_PX;
  }
  return Math.max(MIN_PANEL_RESIZE_PX, containerWidth - handleW - minOtherCols);
}

function gridHasExplorerFixedColumn(grid: PanelId[][]): boolean {
  if (!grid.length || !grid[0]?.length) return false;
  for (let c = 0; c < grid[0].length; c++) {
    if (isExplorerFixedCol(grid, c)) return true;
  }
  return false;
}

function getNonExplorerCols(grid: PanelId[][]): number[] {
  const numCols = grid[0]?.length ?? 0;
  const result: number[] = [];
  for (let c = 0; c < numCols; c++) {
    if (!isExplorerFixedCol(grid, c)) result.push(c);
  }
  return result;
}

function defaultColWidths(grid: PanelId[][]): number[] {
  const count = getNonExplorerCols(grid).length;
  if (count <= 1) return [];
  return Array.from({ length: count - 1 }, () => 1);
}

function buildColTemplate(grid: PanelId[][], explorerWidth: number, colWidths?: number[]): string {
  const numCols = grid[0]?.length ?? 0;
  const neCols = getNonExplorerCols(grid);
  const cols: string[] = [];
  let neIdx = 0;
  for (let c = 0; c < numCols; c++) {
    if (c > 0) cols.push('4px');
    if (isExplorerFixedCol(grid, c)) {
      cols.push(`${explorerWidth}px`);
    } else if (neIdx < neCols.length - 1) {
      const fr = colWidths?.[neIdx] ?? 1;
      cols.push(`minmax(${MIN_PANEL_RESIZE_PX}px, ${fr}fr)`);
      neIdx++;
    } else {
      cols.push(`minmax(${MIN_PANEL_RESIZE_PX}px, 1fr)`);
      neIdx++;
    }
  }
  return cols.join(' ');
}

function buildGridStyles(
  grid: PanelId[][],
  explorerWidth: number,
  rowHeights: number[],
  colWidths: number[],
  containerWidth = 0,
): React.CSSProperties {
  if (grid.length === 0) return { display: 'none' };

  const expanded = buildExpandedGrid(grid);
  const gridAreas = expanded.map(row => `"${row.join(' ')}"`).join(' ');

  let explorerForTemplate = explorerWidth;
  if (containerWidth > 0 && gridHasExplorerFixedColumn(grid)) {
    explorerForTemplate = Math.min(explorerWidth, maxExplorerColumnWidthPx(grid, containerWidth));
  }

  return {
    display: 'grid',
    gridTemplateAreas: gridAreas,
    gridTemplateColumns: buildColTemplate(grid, explorerForTemplate, colWidths),
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

function layoutsEqual(a: PanelId[][], b: PanelId[][]): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

function pointInRect(clientX: number, clientY: number, rect: DOMRect): boolean {
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
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
        result[r].splice(tMinC, 0, draggedId);
      }
      return simplifyGrid(result);
    }
    case 'right': {
      const result = reduced.map(r => [...r]);
      for (let r = 0; r < numRows; r++) {
        result[r].splice(tMaxC + 1, 0, draggedId);
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

function detectEdgeFromPoint(clientX: number, clientY: number, containerRect: DOMRect): DropPosition | null {
  const x = clientX - containerRect.left;
  const y = clientY - containerRect.top;
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

function resolvePanelDropHint(
  clientX: number,
  clientY: number,
  container: HTMLElement,
  draggedId: PanelId,
  dragStart: { x: number; y: number },
): DropIndicatorState | null {
  const containerRect = container.getBoundingClientRect();
  const intent = getDragIntent(dragStart.x, dragStart.y, clientX, clientY);

  if (intent.allowEdgeDrop) {
    const edge = detectEdgeFromPoint(clientX, clientY, containerRect);
    if (edge) {
      return { targetId: null, position: edge, line: computeEdgeDropLine(edge, containerRect) };
    }
  }

  const panelEls = container.querySelectorAll<HTMLElement>('[data-panel-id]');
  let closestPanel: PanelId | null = null;
  let closestRect: DOMRect | null = null;
  let closestDist = Infinity;

  for (const el of panelEls) {
    const id = el.dataset.panelId as PanelId;
    if (el.style.display === 'none') continue;
    if (id === draggedId) continue;
    const rect = el.getBoundingClientRect();
    if (
      clientX >= rect.left && clientX <= rect.right &&
      clientY >= rect.top && clientY <= rect.bottom
    ) {
      closestPanel = id;
      closestRect = rect;
      closestDist = 0;
      break;
    }
    const cx = Math.max(rect.left, Math.min(clientX, rect.right));
    const cy = Math.max(rect.top, Math.min(clientY, rect.bottom));
    const dist = Math.hypot(clientX - cx, clientY - cy);
    if (dist < closestDist) {
      closestDist = dist;
      closestPanel = id;
      closestRect = rect;
    }
  }

  if (!closestPanel || !closestRect) return null;

  const draggedEl = container.querySelector<HTMLElement>(`[data-panel-id="${draggedId}"]`);
  const excludeSide = draggedEl
    ? getExcludeSide(draggedEl.getBoundingClientRect(), closestRect)
    : undefined;

  const position = detectDropPositionFromRect(
    clientX, clientY, closestRect, intent.allowedPositions, excludeSide,
  );
  const line = computePanelDropLine(position, closestRect, containerRect);
  return { targetId: closestPanel, position, line };
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
  const [layoutContainerWidth, setLayoutContainerWidth] = useState(0);
  const [rowHeights, setRowHeights] = useState<number[]>([50]);
  const [colWidths, setColWidths] = useState<number[]>([]);
  const [dropIndicator, setDropIndicator] = useState<DropIndicatorState | null>(null);
  const [draggedPanel, setDraggedPanel] = useState<PanelId | null>(null);
  const [panelGhost, setPanelGhost] = useState<PanelGhostState | null>(null);
  const [panelPointerSession, setPanelPointerSession] = useState(false);

  const explorerWidthRef = useRef(explorerWidth);
  const rowHeightsRef = useRef(rowHeights);
  const colWidthsRef = useRef(colWidths);
  explorerWidthRef.current = explorerWidth;
  rowHeightsRef.current = rowHeights;
  colWidthsRef.current = colWidths;

  const layoutAllowsExplorer = layout !== 'get-shit-done';
  const layoutAllowsViewer = layout !== 'get-shit-done';

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
    () =>
      buildGridStyles(effectiveLayout, explorerWidth, rowHeights, colWidths, layoutContainerWidth),
    [effectiveLayout, explorerWidth, rowHeights, colWidths, layoutContainerWidth],
  );

  const effectiveLayoutRef = useRef(effectiveLayout);
  effectiveLayoutRef.current = effectiveLayout;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || effectiveLayout.length === 0) {
      setLayoutContainerWidth(0);
      return;
    }
    const sync = () => {
      const w = el.getBoundingClientRect().width;
      setLayoutContainerWidth(w);
      const grid = effectiveLayoutRef.current;
      if (!gridHasExplorerFixedColumn(grid)) return;
      const maxExp = maxExplorerColumnWidthPx(grid, w);
      if (explorerWidthRef.current > maxExp) {
        explorerWidthRef.current = maxExp;
        setExplorerWidth(maxExp);
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [effectiveLayout]);

  const onHandleMouseDown = useCallback((handleType: 'h' | 'v' | 'hc', param: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = explorerWidthRef.current;
    const snapshot = effectiveLayoutRef.current;
    const numRows = snapshot.length;
    const dragRowHeights = [...rowHeightsRef.current];
    while (dragRowHeights.length < numRows - 1) {
      dragRowHeights.push(Math.floor(100 / numRows));
    }

    const neCols = getNonExplorerCols(snapshot);
    const dragColWidths = [...colWidthsRef.current];
    while (dragColWidths.length < neCols.length - 1) {
      dragColWidths.push(1);
    }
    const startColWidths = [...dragColWidths];
    const totalFr = startColWidths.reduce((s, v) => s + v, 0) + 1;

    const onMouseMove = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      if (handleType === 'h') {
        const sign = param;
        const delta = (ev.clientX - startX) * sign;
        const rect = containerRef.current.getBoundingClientRect();
        const maxW = maxExplorerColumnWidthPx(snapshot, rect.width);
        const w = Math.max(MIN_PANEL_RESIZE_PX, Math.min(maxW, startWidth + delta));
        explorerWidthRef.current = w;
        containerRef.current.style.gridTemplateColumns = buildColTemplate(snapshot, w, dragColWidths);
      } else if (handleType === 'hc') {
        const neIdx = param;
        const rect = containerRef.current.getBoundingClientRect();
        const explorerCount = snapshot[0].length - neCols.length;
        const handleCount = snapshot[0].length - 1;
        const maxExp = maxExplorerColumnWidthPx(snapshot, rect.width);
        const explorerPx = Math.min(explorerWidthRef.current, maxExp);
        const availableWidth = rect.width - explorerCount * explorerPx - handleCount * 4;
        if (availableWidth <= 0) return;

        const deltaFr = ((ev.clientX - startX) / availableWidth) * totalFr;
        dragColWidths[neIdx] = Math.max(MIN_COL_FR, startColWidths[neIdx] + deltaFr);
        if (neIdx + 1 < dragColWidths.length) {
          dragColWidths[neIdx + 1] = Math.max(MIN_COL_FR, startColWidths[neIdx + 1] - deltaFr);
          const [L, R] = clampFrPairMinPx(
            dragColWidths[neIdx],
            dragColWidths[neIdx + 1],
            availableWidth,
            MIN_PANEL_RESIZE_PX,
          );
          dragColWidths[neIdx] = L;
          dragColWidths[neIdx + 1] = R;
        } else {
          const m = MIN_PANEL_RESIZE_PX;
          const W = availableWidth;
          let L = Math.max(MIN_COL_FR, startColWidths[neIdx] + deltaFr);
          if (W > 2 * m) {
            const lo = m / (W - m);
            const hi = W / m - 1;
            L = Math.max(MIN_COL_FR, Math.min(Math.max(L, lo), hi));
          }
          dragColWidths[neIdx] = L;
        }
        containerRef.current.style.gridTemplateColumns = buildColTemplate(snapshot, explorerPx, dragColWidths);
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

        const minRowPct = (MIN_PANEL_RESIZE_PX / rect.height) * 100;
        const newPct = Math.max(minRowPct, cursorPct - abovePct);
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
      setColWidths([...dragColWidths]);
    };

    document.body.style.cursor = handleType === 'v' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const panelLayoutRef = useRef(panelLayout);
  panelLayoutRef.current = panelLayout;

  const setPanelLayoutRef = useRef(setPanelLayout);
  setPanelLayoutRef.current = setPanelLayout;
  const setRowHeightsRef = useRef(setRowHeights);
  setRowHeightsRef.current = setRowHeights;
  const setColWidthsRef = useRef(setColWidths);
  setColWidthsRef.current = setColWidths;
  const setPanelGhostRef = useRef(setPanelGhost);
  setPanelGhostRef.current = setPanelGhost;
  const setPanelPointerSessionRef = useRef(setPanelPointerSession);
  setPanelPointerSessionRef.current = setPanelPointerSession;

  /* ---- Panel drag (pointer-based; source uses pointer-events: none while dragging) ---- */

  const MIN_DRAG_DISTANCE = 10;
  const pendingDragRef = useRef<{ id: PanelId; startX: number; startY: number } | null>(null);
  const activeDragRef = useRef<{ id: PanelId; startX: number; startY: number } | null>(null);
  const ghostBaseRef = useRef<Omit<PanelGhostState, 'x' | 'y'> | null>(null);
  const docListenersRef = useRef(false);

  const pointerDragHandlersRef = useRef({
    move: (_e: PointerEvent) => {},
    up: (_e: PointerEvent) => {},
  });

  const finishDragRef = useRef<(e: PointerEvent | null, cancel: boolean) => void>(() => {});

  const onPointerMoveCapture = useCallback((e: PointerEvent) => {
    pointerDragHandlersRef.current.move(e);
  }, []);

  const onPointerUpCapture = useCallback((e: PointerEvent) => {
    pointerDragHandlersRef.current.up(e);
  }, []);

  const onEscapeDuringPanelDrag = useCallback((ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    finishDragRef.current(null, true);
  }, []);

  useLayoutEffect(() => {
    finishDragRef.current = (e: PointerEvent | null, cancel: boolean) => {
      document.removeEventListener('pointermove', onPointerMoveCapture, true);
      document.removeEventListener('pointerup', onPointerUpCapture, true);
      document.removeEventListener('pointercancel', onPointerUpCapture, true);
      document.removeEventListener('keydown', onEscapeDuringPanelDrag, true);
      docListenersRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setPanelPointerSessionRef.current(false);

      if (pendingDragRef.current) {
        pendingDragRef.current = null;
        return;
      }

      const drag = activeDragRef.current;
      activeDragRef.current = null;
      pendingDragRef.current = null;
      setDraggedPanel(null);
      setDropIndicator(null);
      ghostBaseRef.current = null;
      setPanelGhostRef.current(null);

      if (!drag) return;
      if (cancel) return;

      const container = containerRef.current;
      if (!container || !e) return;

      const cr = container.getBoundingClientRect();
      if (!pointInRect(e.clientX, e.clientY, cr)) return;

      const hint = resolvePanelDropHint(
        e.clientX,
        e.clientY,
        container,
        drag.id,
        { x: drag.startX, y: drag.startY },
      );
      if (!hint) return;

      const currentLayout = panelLayoutRef.current;
      let newLayout: PanelId[][];
      if (hint.targetId === null) {
        newLayout = applyEdgeDrop(currentLayout, drag.id, hint.position);
      } else {
        newLayout = applyPanelDrop(currentLayout, drag.id, hint.targetId, hint.position);
      }
      if (layoutsEqual(currentLayout, newLayout)) return;

      setPanelLayoutRef.current(newLayout);
      setRowHeightsRef.current(defaultRowHeights(newLayout.length));
      setColWidthsRef.current(defaultColWidths(newLayout));
    };

    pointerDragHandlersRef.current.move = (e: PointerEvent) => {
      const pending = pendingDragRef.current;
      if (pending && !activeDragRef.current) {
        if (Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) >= MIN_DRAG_DISTANCE) {
          activeDragRef.current = pending;
          pendingDragRef.current = null;
          setDraggedPanel(pending.id);
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'grabbing';
          document.addEventListener('keydown', onEscapeDuringPanelDrag, true);

          const cont = containerRef.current;
          const panelEl = cont?.querySelector<HTMLElement>(`[data-panel-id="${pending.id}"]`);
          if (panelEl) {
            const r = panelEl.getBoundingClientRect();
            ghostBaseRef.current = {
              grabDx: pending.startX - r.left,
              grabDy: pending.startY - r.top,
              w: Math.min(Math.max(r.width * 0.58, 200), 420),
              h: Math.min(Math.max(Math.round(r.height * 0.3), 48), 168),
              panelId: pending.id,
            };
          } else {
            ghostBaseRef.current = {
              grabDx: 100,
              grabDy: 22,
              w: 260,
              h: 48,
              panelId: pending.id,
            };
          }
        } else {
          return;
        }
      }

      const drag = activeDragRef.current;
      if (!drag) return;

      const container = containerRef.current;
      if (!container) return;

      const ghostBase = ghostBaseRef.current;
      if (ghostBase) {
        setPanelGhostRef.current({
          ...ghostBase,
          x: e.clientX - ghostBase.grabDx,
          y: e.clientY - ghostBase.grabDy,
        });
      }

      const hint = resolvePanelDropHint(
        e.clientX,
        e.clientY,
        container,
        drag.id,
        { x: drag.startX, y: drag.startY },
      );
      if (hint) {
        setDropIndicator(prev => {
          if (prev?.targetId === hint.targetId && prev?.position === hint.position) return prev;
          return hint;
        });
      } else {
        setDropIndicator(null);
      }
    };

    pointerDragHandlersRef.current.up = (e: PointerEvent) => {
      finishDragRef.current(e, e.type === 'pointercancel');
    };
  }, [onPointerMoveCapture, onPointerUpCapture, onEscapeDuringPanelDrag]);

  useEffect(() => () => {
    document.removeEventListener('pointermove', onPointerMoveCapture, true);
    document.removeEventListener('pointerup', onPointerUpCapture, true);
    document.removeEventListener('pointercancel', onPointerUpCapture, true);
    document.removeEventListener('keydown', onEscapeDuringPanelDrag, true);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, [onPointerMoveCapture, onPointerUpCapture, onEscapeDuringPanelDrag]);

  const onPanelPointerDown = useCallback((id: PanelId, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const panelEl = e.currentTarget as HTMLElement;
    const title = panelEl.querySelector('.panel-title');
    if (!title || !title.contains(e.target as Node)) return;
    e.preventDefault();
    setPanelPointerSession(true);
    pendingDragRef.current = { id, startX: e.clientX, startY: e.clientY };
    if (!docListenersRef.current) {
      docListenersRef.current = true;
      document.addEventListener('pointermove', onPointerMoveCapture, true);
      document.addEventListener('pointerup', onPointerUpCapture, true);
      document.addEventListener('pointercancel', onPointerUpCapture, true);
    }
  }, [onPointerMoveCapture, onPointerUpCapture]);

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
          const explorerFixedLeft = isExplorerFixedCol(effectiveLayout, cc);
          const explorerFixedRight = isExplorerFixedCol(effectiveLayout, cc + 1);

          let handleDown: (e: React.MouseEvent) => void;
          if (explorerFixedRight) {
            handleDown = (e) => onHandleMouseDown('h', -1, e);
          } else if (explorerFixedLeft) {
            handleDown = (e) => onHandleMouseDown('h', 1, e);
          } else {
            const neCols = getNonExplorerCols(effectiveLayout);
            const neIdx = neCols.indexOf(cc);
            handleDown = (e) => onHandleMouseDown('hc', neIdx, e);
          }

          result.push(
            <div
              key={area}
              className="kraft-handle kraft-handle-h"
              style={{ gridArea: area }}
              onMouseDown={handleDown}
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

  const showIndicator = !!dropIndicator;

  const allPanelIds: PanelId[] = ['explorer', 'viewer', 'terminal'];

  return (
    <div className="kraft-layout-root">
      <div
        className={`kraft-layout${panelPointerSession ? ' kraft-layout-resize-suspended' : ''}`}
        ref={containerRef}
        style={{ ...gridStyles, position: 'relative' }}
      >
        {allPanelIds.map(id => {
          const visible = isPanelVisible(id);
          const inGrid = effectiveLayout.some(row => row.includes(id));
          return (
            <div
              key={id}
              data-panel-id={id}
              className={`kraft-panel kraft-${id} ${draggedPanel === id ? 'dragging' : ''}`}
              style={{
                gridArea: inGrid ? id : undefined,
                display: visible ? undefined : 'none',
                position: 'relative',
              }}
              onPointerDown={visible ? (e) => onPanelPointerDown(id, e) : undefined}
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

      {draggedPanel && (
        <div className="kraft-context-hint">
          Press <kbd>Esc</kbd> to cancel
        </div>
      )}

      {panelGhost && (
        <div
          className="kraft-panel-drag-ghost"
          style={{
            position: 'fixed',
            left: panelGhost.x,
            top: panelGhost.y,
            width: panelGhost.w,
            height: panelGhost.h,
            zIndex: 50000,
            pointerEvents: 'none',
          }}
          aria-hidden
        >
          <div className="kraft-panel-drag-ghost-inner">
            <PanelDragGhostChrome panelId={panelGhost.panelId} />
          </div>
        </div>
      )}

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

function PanelDragGhostChrome({ panelId }: { panelId: PanelId }) {
  if (panelId === 'explorer') {
    return (
      <>
        <span className="panel-title panel-icon explorer-icon tabbed-panel-title"><VscFolderOpened size={16} /></span>
        <span className="kraft-panel-drag-ghost-label">Explorer</span>
      </>
    );
  }
  if (panelId === 'viewer') {
    return (
      <>
        <span className="panel-title panel-icon viewer-icon tabbed-panel-title">{'{}'}</span>
        <span className="kraft-panel-drag-ghost-label">Viewer</span>
      </>
    );
  }
  return (
    <>
      <span className="panel-title panel-icon terminal-icon tabbed-panel-title">&gt;_</span>
      <span className="kraft-panel-drag-ghost-label">Terminal</span>
    </>
  );
}

function getDragIntent(
  startX: number, startY: number, currentX: number, currentY: number,
): { allowedPositions: DropPosition[] | undefined; allowEdgeDrop: boolean } {
  const absDx = Math.abs(currentX - startX);
  const absDy = Math.abs(currentY - startY);
  const total = absDx + absDy;
  if (total < 1) return { allowedPositions: undefined, allowEdgeDrop: true };

  const horizontalRatio = absDx / total;

  if (horizontalRatio < DIRECTION_THRESHOLD) {
    return { allowedPositions: ['top', 'bottom'], allowEdgeDrop: false };
  }
  return { allowedPositions: undefined, allowEdgeDrop: true };
}

function getExcludeSide(draggedRect: DOMRect, targetRect: DOMRect): DropPosition {
  const dx = (draggedRect.left + draggedRect.width / 2) - (targetRect.left + targetRect.width / 2);
  const dy = (draggedRect.top + draggedRect.height / 2) - (targetRect.top + targetRect.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? 'left' : 'right';
  }
  return dy < 0 ? 'top' : 'bottom';
}

function detectDropPositionFromRect(
  clientX: number, clientY: number, rect: DOMRect,
  allowedPositions?: DropPosition[],
  excludePosition?: DropPosition,
): DropPosition {
  const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
  const distances: [DropPosition, number][] = [
    ['left', x], ['right', 1 - x], ['top', y], ['bottom', 1 - y],
  ];
  let candidates = allowedPositions
    ? distances.filter(([pos]) => allowedPositions.includes(pos))
    : distances;
  if (excludePosition) {
    const filtered = candidates.filter(([pos]) => pos !== excludePosition);
    if (filtered.length > 0) candidates = filtered;
  }
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0]?.[0] ?? 'top';
}
