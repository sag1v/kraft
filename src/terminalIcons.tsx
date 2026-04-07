import React from 'react';

export interface TerminalIconDef {
  id: string;
  label: string;
  svg: React.ReactNode;
}

const s = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' };
const stroke = { stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const TERMINAL_ICONS: TerminalIconDef[] = [
  {
    id: 'terminal',
    label: 'Terminal',
    svg: (
      <svg {...s}>
        <polyline points="4,5 7,8 4,11" {...stroke} />
        <line x1="9" y1="11" x2="13" y2="11" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'star',
    label: 'Star',
    svg: (
      <svg {...s}>
        <polygon points="8,2 9.8,6 14,6.5 10.9,9.4 11.8,14 8,11.8 4.2,14 5.1,9.4 2,6.5 6.2,6" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'bolt',
    label: 'Bolt',
    svg: (
      <svg {...s}>
        <polyline points="9,2 5,9 8,9 7,14 11,7 8,7 9,2" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'bug',
    label: 'Bug',
    svg: (
      <svg {...s}>
        <ellipse cx="8" cy="9.5" rx="3.5" ry="4" {...stroke} />
        <ellipse cx="8" cy="5" rx="2" ry="1.5" {...stroke} />
        <line x1="3" y1="7" x2="4.5" y2="8" {...stroke} />
        <line x1="13" y1="7" x2="11.5" y2="8" {...stroke} />
        <line x1="3" y1="12" x2="4.5" y2="11" {...stroke} />
        <line x1="13" y1="12" x2="11.5" y2="11" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'server',
    label: 'Server',
    svg: (
      <svg {...s}>
        <rect x="3" y="2" width="10" height="4" rx="1" {...stroke} />
        <rect x="3" y="10" width="10" height="4" rx="1" {...stroke} />
        <line x1="8" y1="6" x2="8" y2="10" {...stroke} />
        <circle cx="5.5" cy="4" r="0.7" fill="currentColor" />
        <circle cx="5.5" cy="12" r="0.7" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'code',
    label: 'Code',
    svg: (
      <svg {...s}>
        <polyline points="5,4 2,8 5,12" {...stroke} />
        <polyline points="11,4 14,8 11,12" {...stroke} />
        <line x1="9.5" y1="3" x2="6.5" y2="13" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'globe',
    label: 'Globe',
    svg: (
      <svg {...s}>
        <circle cx="8" cy="8" r="6" {...stroke} />
        <ellipse cx="8" cy="8" rx="2.5" ry="6" {...stroke} />
        <line x1="2" y1="8" x2="14" y2="8" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'gear',
    label: 'Settings',
    svg: (
      <svg {...s}>
        <circle cx="8" cy="8" r="2.5" {...stroke} />
        <path d="M8,2 L8,3.5 M8,12.5 L8,14 M2,8 L3.5,8 M12.5,8 L14,8 M3.8,3.8 L4.8,4.8 M11.2,11.2 L12.2,12.2 M12.2,3.8 L11.2,4.8 M4.8,11.2 L3.8,12.2" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'flask',
    label: 'Flask',
    svg: (
      <svg {...s}>
        <path d="M6,2 L6,6 L3,13 L13,13 L10,6 L10,2" {...stroke} />
        <line x1="5" y1="2" x2="11" y2="2" {...stroke} />
        <line x1="4" y1="10" x2="12" y2="10" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'heart',
    label: 'Heart',
    svg: (
      <svg {...s}>
        <path d="M8,13 L2.5,7.5 C1,6 1,3.5 3,2.5 C5,1.5 7,3 8,4.5 C9,3 11,1.5 13,2.5 C15,3.5 15,6 13.5,7.5 Z" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'home',
    label: 'Home',
    svg: (
      <svg {...s}>
        <path d="M3,8 L8,3 L13,8" {...stroke} />
        <path d="M4,7.5 L4,13 L7,13 L7,10 L9,10 L9,13 L12,13 L12,7.5" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'robot',
    label: 'Robot',
    svg: (
      <svg {...s}>
        <rect x="3" y="5" width="10" height="8" rx="2" {...stroke} />
        <circle cx="6" cy="9" r="1" fill="currentColor" />
        <circle cx="10" cy="9" r="1" fill="currentColor" />
        <line x1="8" y1="3" x2="8" y2="5" {...stroke} />
        <circle cx="8" cy="2.5" r="1" {...stroke} />
      </svg>
    ),
  },
];

export const TERMINAL_ICON_MAP = new Map(TERMINAL_ICONS.map(i => [i.id, i]));

export const DEFAULT_TERMINAL_ICON = 'terminal';

export const TAB_COLORS = [
  { id: 'default', label: 'Default', value: '' },
  { id: 'red', label: 'Red', value: '#f14c4c' },
  { id: 'orange', label: 'Orange', value: '#e89d5e' },
  { id: 'yellow', label: 'Yellow', value: '#e2c95c' },
  { id: 'green', label: 'Green', value: '#73c991' },
  { id: 'cyan', label: 'Cyan', value: '#41c9d8' },
  { id: 'blue', label: 'Blue', value: '#6c9ced' },
  { id: 'purple', label: 'Purple', value: '#c975d2' },
  { id: 'pink', label: 'Pink', value: '#e77da8' },
];

export function TerminalTabIcon({ iconId, color }: { iconId?: string; color?: string }) {
  const def = TERMINAL_ICON_MAP.get(iconId || DEFAULT_TERMINAL_ICON) || TERMINAL_ICONS[0];
  return (
    <span className="terminal-tab-icon" style={color ? { color } : undefined}>
      {def.svg}
    </span>
  );
}
