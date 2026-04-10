import React, { useState, useEffect, useRef } from 'react';
import { useUIContext } from '../context/AppContext';
import { IconButton } from './IconButton';
import { tooltipWithShortcut } from '../shortcuts';
import { SessionBar } from './SessionBar';

const WORD = 'Kraft';
const TYPE_DELAY = 200;
const PAUSE_AFTER = 60_000;
const ERASE_DELAY = 80;

function useTypewriter() {
  const [count, setCount] = useState(0);
  const [idle, setIdle] = useState(false);
  const phase = useRef<'typing' | 'idle' | 'erasing'>('typing');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    if (phase.current === 'typing') {
      if (count < WORD.length) {
        timer = setTimeout(() => setCount(c => c + 1), TYPE_DELAY);
      } else {
        phase.current = 'idle';
        setIdle(true);
        timer = setTimeout(() => {
          phase.current = 'erasing';
          setIdle(false);
          setCount(c => c - 1);
        }, PAUSE_AFTER);
      }
    } else if (phase.current === 'erasing') {
      if (count > 0) {
        timer = setTimeout(() => setCount(c => c - 1), ERASE_DELAY);
      } else {
        phase.current = 'typing';
        timer = setTimeout(() => setCount(1), TYPE_DELAY);
      }
    }

    return () => clearTimeout(timer);
  }, [count]);

  return { text: WORD.slice(0, count), idle };
}

// ── Shard types ──────────────────────────────────────────────────────────────

interface Shard {
  clip:            string; // clip-path polygon in % coords
  origin:          string; // transform-origin matching shard centroid
  crackedTx:       number; // px — tiny drift that opens crack gaps
  crackedTy:       number;
  crackedRot:      number; // deg
  shatteredTx:     number; // px — fly apart on final break
  shatteredTy:     number;
  shatteredRot:    number; // deg
}

interface LetterData {
  shards: Shard[];
  state:  'cracked' | 'shattered';
}

// Divide a letter bounding box into triangular shards radiating from a random
// fracture point.  8 boundary points → 8 triangles that tile the full box.
function makeShards(): Shard[] {
  const sign = () => (Math.random() > 0.5 ? 1 : -1);

  // Random fracture centre (kept away from edges so all triangles have area)
  const fx = 20 + Math.random() * 60;
  const fy = 20 + Math.random() * 60;

  // Boundary ring: corners + one random midpoint per edge → organic shard shapes
  const ring: [number, number][] = [
    [0,   0],
    [20 + Math.random() * 60, 0],
    [100, 0],
    [100, 20 + Math.random() * 60],
    [100, 100],
    [20 + Math.random() * 60, 100],
    [0,   100],
    [0,   20 + Math.random() * 60],
  ];

  return ring.map((p, i) => {
    const p2 = ring[(i + 1) % ring.length];

    // Centroid of this triangle (fracture pt + 2 boundary pts)
    const cx = (fx + p[0] + p2[0]) / 3;
    const cy = (fy + p[1] + p2[1]) / 3;

    // Direction: outward from fracture centre through shard centroid
    const angle = Math.atan2(cy - fy, cx - fx);

    return {
      clip:   `polygon(${fx.toFixed(1)}% ${fy.toFixed(1)}%, ${p[0]}% ${p[1]}%, ${p2[0]}% ${p2[1]}%)`,
      origin: `${cx.toFixed(1)}% ${cy.toFixed(1)}%`,

      // Cracked: barely-open gaps (2–4 px) — the gaps *are* the cracks
      crackedTx:  Math.cos(angle) * (2 + Math.random() * 2),
      crackedTy:  Math.sin(angle) * (2 + Math.random() * 2),
      crackedRot: sign() * (2 + Math.random() * 5),

      // Shattered: fragments fly outward
      shatteredTx:  Math.cos(angle) * (22 + Math.random() * 30),
      shatteredTy:  Math.sin(angle) * (18 + Math.random() * 25),
      shatteredRot: sign() * (30 + Math.random() * 150),
    };
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export function TopBar() {
  const { theme, setSettingsOpen } = useUIContext();
  const { text, idle } = useTypewriter();

  const clickCountRef   = useRef(0);
  const resetTimerRef   = useRef<ReturnType<typeof setTimeout>>();
  const shatterTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // null → intact (rendered normally); LetterData → cracked or shattered
  const [letterData, setLetterData] = useState<(LetterData | null)[]>(
    () => Array(WORD.length).fill(null)
  );
  // Cursor underscore — only shattered (never cracked), same shard system
  const [cursorData, setCursorData] = useState<LetterData | null>(null);

  const c = theme.colors;

  useEffect(() => () => {
    clearTimeout(resetTimerRef.current);
    clearTimeout(shatterTimerRef.current);
  }, []);

  const restore = () => {
    clickCountRef.current = 0;
    setLetterData(Array(WORD.length).fill(null));
    setCursorData(null);
  };

  const handleLogoClick = () => {
    clearTimeout(resetTimerRef.current);
    clearTimeout(shatterTimerRef.current);
    clickCountRef.current += 1;
    const n = clickCountRef.current;

    if (n >= WORD.length) {
      // Final hit — shatter every letter (cracked ones fly from their cracked pos)
      setLetterData(prev =>
        prev.map(d => ({
          shards: d ? d.shards : makeShards(),
          state:  'shattered' as const,
        }))
      );
      setCursorData({ shards: makeShards(), state: 'shattered' });
      shatterTimerRef.current = setTimeout(() => {
        restore();
        window.dispatchEvent(new CustomEvent('kraft:easter-egg'));
      }, 700);
      return;
    }

    // Crack one random intact letter
    setLetterData(prev => {
      const intact = prev.reduce<number[]>((a, d, i) => (d === null ? [...a, i] : a), []);
      if (intact.length === 0) return prev;
      const pick = intact[Math.floor(Math.random() * intact.length)];
      const next  = [...prev];
      next[pick]  = { shards: makeShards(), state: 'cracked' };
      return next;
    });

    // Slow click → restore as if untouched
    resetTimerRef.current = setTimeout(restore, 1500);
  };

  const isBreaking = letterData.some(d => d !== null);

  return (
    <div className="topbar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="topbar-left">
        <span
          className="topbar-logo"
          style={{ color: c.accent, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={handleLogoClick}
        >
          {isBreaking
            ? WORD.split('').map((ch, i) => {
                const data = letterData[i];

                if (!data) {
                  // Still intact — render normally so layout is preserved
                  return <span key={i} style={{ display: 'inline-block' }}>{ch}</span>;
                }

                const shattered = data.state === 'shattered';

                return (
                  // position:relative container sized by the invisible placeholder
                  <span key={i} style={{ position: 'relative', display: 'inline-block' }}>
                    {/* Invisible copy holds the layout width/height */}
                    <span style={{ visibility: 'hidden' }}>{ch}</span>

                    {data.shards.map((s, j) => {
                      const tx  = shattered ? s.shatteredTx  : s.crackedTx;
                      const ty  = shattered ? s.shatteredTy  : s.crackedTy;
                      const rot = shattered ? s.shatteredRot : s.crackedRot;

                      return (
                        <span
                          key={j}
                          style={{
                            position:        'absolute',
                            inset:           0,
                            clipPath:        s.clip,
                            transformOrigin: s.origin,
                            transform:       `translate(${tx}px, ${ty}px) rotate(${rot}deg)`,
                            opacity:         shattered ? 0 : 1,
                            ...(shattered && {
                              transition: 'transform 0.38s ease-out, opacity 0.32s ease-in',
                            }),
                          }}
                        >
                          {ch}
                        </span>
                      );
                    })}
                  </span>
                );
              })
            : text
          }
          {cursorData ? (
            <span style={{ position: 'relative', display: 'inline-block' }}>
              <span style={{ visibility: 'hidden' }}>_</span>
              {cursorData.shards.map((s, j) => (
                <span
                  key={j}
                  style={{
                    position:        'absolute',
                    inset:           0,
                    clipPath:        s.clip,
                    transformOrigin: s.origin,
                    transform:       `translate(${s.shatteredTx}px, ${s.shatteredTy}px) rotate(${s.shatteredRot}deg)`,
                    opacity:         0,
                    transition:      'transform 0.38s ease-out, opacity 0.32s ease-in',
                  }}
                >_</span>
              ))}
            </span>
          ) : (
            <span className={`topbar-cursor${idle && !isBreaking ? '' : ' typing'}`}>_</span>
          )}
        </span>
      </div>
      <SessionBar className="topbar-sessions" />
      <div className="topbar-right" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <IconButton
          className="topbar-settings-btn"
          tooltip={tooltipWithShortcut('Settings', 'open-settings')}
          tooltipPos="bottom"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </IconButton>
      </div>
    </div>
  );
}
