import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';

interface TooltipState {
  text: string;
  anchorRect: DOMRect;
  pos: string;
}

const MARGIN = 6;
const VIEWPORT_PAD = 8;

export function GlobalTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTarget = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [finalStyle, setFinalStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });

  const show = useCallback((el: HTMLElement) => {
    const text = el.getAttribute('data-tooltip');
    if (!text) return;
    const pos = el.getAttribute('data-tooltip-pos') || 'top';
    setTooltip({ text, anchorRect: el.getBoundingClientRect(), pos });
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    currentTarget.current = null;
    setTooltip(null);
    setFinalStyle({ visibility: 'hidden' });
  }, []);

  useEffect(() => {
    const onEnter = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.('[data-tooltip]') as HTMLElement | null;
      if (!el) return;
      if (currentTarget.current === el) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      currentTarget.current = el;
      timerRef.current = setTimeout(() => {
        if (currentTarget.current === el) show(el);
      }, 400);
    };

    const onLeave = (e: MouseEvent) => {
      if (!currentTarget.current) return;
      if (!currentTarget.current.contains(e.relatedTarget as Node | null)) hide();
    };

    document.addEventListener('mouseenter', onEnter, true);
    document.addEventListener('mouseleave', onLeave, true);
    document.addEventListener('mousedown', hide, true);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('dragstart', hide, true);

    return () => {
      document.removeEventListener('mouseenter', onEnter, true);
      document.removeEventListener('mouseleave', onLeave, true);
      document.removeEventListener('mousedown', hide, true);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('dragstart', hide, true);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [show, hide]);

  useLayoutEffect(() => {
    if (!tooltip || !tipRef.current) return;

    const tip = tipRef.current;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = tooltip.anchorRect;

    let x: number, y: number;

    switch (tooltip.pos) {
      case 'bottom':
        x = r.left + r.width / 2 - tw / 2;
        y = r.bottom + MARGIN;
        break;
      case 'left':
        x = r.left - tw - MARGIN;
        y = r.top + r.height / 2 - th / 2;
        break;
      case 'right':
        x = r.right + MARGIN;
        y = r.top + r.height / 2 - th / 2;
        break;
      default:
        x = r.left + r.width / 2 - tw / 2;
        y = r.top - th - MARGIN;
        break;
    }

    x = Math.max(VIEWPORT_PAD, Math.min(x, vw - tw - VIEWPORT_PAD));
    y = Math.max(VIEWPORT_PAD, Math.min(y, vh - th - VIEWPORT_PAD));

    setFinalStyle({
      position: 'fixed',
      left: x,
      top: y,
      visibility: 'visible',
    });
  }, [tooltip]);

  if (!tooltip) return null;

  return (
    <div
      ref={tipRef}
      className="global-tooltip"
      style={{
        position: 'fixed',
        zIndex: 10000,
        pointerEvents: 'none',
        padding: '4px 8px',
        background: 'var(--bg-tertiary)',
        color: 'var(--fg)',
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
        lineHeight: '1.4',
        whiteSpace: 'nowrap',
        borderRadius: '4px',
        border: '1px solid var(--border)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        ...finalStyle,
      }}
    >
      {tooltip.text}
    </div>
  );
}
