import { useRef, useCallback, useState } from 'react';

interface DragState {
  dragId: string | null;
  dropTargetId: string | null;
  dropSide: 'before' | 'after' | null;
}

const INITIAL_STATE: DragState = { dragId: null, dropTargetId: null, dropSide: null };

export function useDraggableTabs(
  tabIds: string[],
  onReorder: (fromIndex: number, toIndex: number) => void,
) {
  const [dragState, setDragState] = useState<DragState>(INITIAL_STATE);
  const dragIdRef = useRef<string | null>(null);

  const handleDragStart = useCallback((id: string, e: React.DragEvent) => {
    e.stopPropagation();
    dragIdRef.current = id;
    setDragState({ dragId: id, dropTargetId: null, dropSide: null });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '0.4';
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '';
    dragIdRef.current = null;
    setDragState(INITIAL_STATE);
  }, []);

  const handleDragOver = useCallback((id: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (!dragIdRef.current || dragIdRef.current === id) {
      if (dragIdRef.current === id) {
        setDragState(prev => prev.dropTargetId !== null
          ? { ...prev, dropTargetId: null, dropSide: null }
          : prev
        );
      }
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const side: 'before' | 'after' = e.clientX < midX ? 'before' : 'after';

    setDragState(prev =>
      prev.dropTargetId === id && prev.dropSide === side
        ? prev
        : { dragId: dragIdRef.current, dropTargetId: id, dropSide: side }
    );
  }, []);

  const handleDrop = useCallback((id: string, e: React.DragEvent) => {
    e.preventDefault();
    const srcId = dragIdRef.current;
    if (!srcId || srcId === id) return;

    const fromIndex = tabIds.indexOf(srcId);
    if (fromIndex === -1) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const side = e.clientX < midX ? 'before' : 'after';

    let toIndex = tabIds.indexOf(id);
    if (toIndex === -1) return;

    if (side === 'after') toIndex += 1;
    if (fromIndex < toIndex) toIndex -= 1;

    if (fromIndex !== toIndex) {
      onReorder(fromIndex, toIndex);
    }

    dragIdRef.current = null;
    setDragState(INITIAL_STATE);
  }, [tabIds, onReorder]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as HTMLElement).contains(related)) return;
    setDragState(prev =>
      prev.dropTargetId ? { ...prev, dropTargetId: null, dropSide: null } : prev
    );
  }, []);

  const getDragProps = useCallback((id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => handleDragStart(id, e),
    onDragEnd: handleDragEnd,
    onDragOver: (e: React.DragEvent) => handleDragOver(id, e),
    onDrop: (e: React.DragEvent) => handleDrop(id, e),
    onDragLeave: handleDragLeave,
  }), [handleDragStart, handleDragEnd, handleDragOver, handleDrop, handleDragLeave]);

  const getDropClass = useCallback((id: string) => {
    if (dragState.dropTargetId !== id || !dragState.dropSide) return '';
    return dragState.dropSide === 'before' ? 'drag-drop-before' : 'drag-drop-after';
  }, [dragState.dropTargetId, dragState.dropSide]);

  const isDragging = dragState.dragId !== null;

  return { getDragProps, getDropClass, isDragging };
}
