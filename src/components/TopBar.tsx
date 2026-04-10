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

export function TopBar() {
  const { theme, setSettingsOpen } = useUIContext();
  const { text, idle } = useTypewriter();
  const clickCountRef     = useRef(0);
  const clickTimerRef     = useRef<ReturnType<typeof setTimeout>>();
  const glitchIntervalRef = useRef<ReturnType<typeof setInterval>>();
  const glitchTimeoutRef  = useRef<ReturnType<typeof setTimeout>>();
  const [glitchText, setGlitchText] = useState<string | null>(null);
  const c = theme.colors;

  useEffect(() => () => {
    clearTimeout(clickTimerRef.current);
    clearInterval(glitchIntervalRef.current);
    clearTimeout(glitchTimeoutRef.current);
  }, []);

  // How many chars to scramble, how long, how fast — escalates with each click
  const GLITCH_CHARS = '!@#$%<>{}|~_*^?/\\0123456789abcdef';
  const GLITCH_CONFIG = [
    null,
    { n: 1, duration: 120, interval: 60  }, // click 1 — 1 char, barely noticeable
    { n: 2, duration: 220, interval: 40  }, // click 2 — 2 chars, clearly a glitch
    { n: 4, duration: 320, interval: 25  }, // click 3 — most of the word spasming
    { n: 5, duration: 500, interval: 14  }, // click 4 — whole word, rapid chaos
  ];

  const handleLogoClick = () => {
    clickCountRef.current += 1;
    clearTimeout(clickTimerRef.current);
    clearInterval(glitchIntervalRef.current);
    clearTimeout(glitchTimeoutRef.current);

    if (clickCountRef.current >= 5) {
      clickCountRef.current = 0;
      setGlitchText(null);
      window.dispatchEvent(new CustomEvent('kraft:easter-egg'));
      return;
    }

    const cfg = GLITCH_CONFIG[clickCountRef.current];
    const base = text || WORD;

    if (cfg) {
      const scramble = () => {
        const result    = base.split('');
        const positions = result.map((_, i) => i);
        // Fisher-Yates shuffle of positions, then replace first cfg.n with glitch chars
        for (let i = positions.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [positions[i], positions[j]] = [positions[j], positions[i]];
        }
        positions.slice(0, cfg.n).forEach(idx => {
          result[idx] = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
        });
        setGlitchText(result.join(''));
      };

      scramble();
      glitchIntervalRef.current = setInterval(scramble, cfg.interval);
      glitchTimeoutRef.current  = setTimeout(() => {
        clearInterval(glitchIntervalRef.current);
        setGlitchText(null);
      }, cfg.duration);
    }

    clickTimerRef.current = setTimeout(() => {
      clickCountRef.current = 0;
    }, 1500);
  };

  return (
    <div className="topbar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="topbar-left">
        <span
          className="topbar-logo"
          style={{ color: c.accent, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={handleLogoClick}
        >
          {glitchText ?? text}<span className={`topbar-cursor${idle ? '' : ' typing'}`}>_</span>
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
