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

  return (
    <div className="topbar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="topbar-left">
        <span className="topbar-logo" style={{ color: theme.colors.accent }}>
          {text}<span className={`topbar-cursor${idle ? '' : ' typing'}`}>_</span>
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
