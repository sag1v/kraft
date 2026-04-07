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
  {
    id: 'database',
    label: 'Database',
    svg: (
      <svg {...s}>
        <ellipse cx="8" cy="4.5" rx="4" ry="1.4" {...stroke} />
        <path d="M4,4.5 L4,11.5 M12,4.5 L12,11.5" {...stroke} />
        <ellipse cx="8" cy="11.5" rx="4" ry="1.4" {...stroke} />
        <line x1="4" y1="8" x2="12" y2="8" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'containers',
    label: 'Containers',
    svg: (
      <svg {...s}>
        <rect x="2" y="2" width="12" height="3.2" rx="0.8" {...stroke} />
        <rect x="2" y="6.4" width="12" height="3.2" rx="0.8" {...stroke} />
        <rect x="2" y="10.8" width="12" height="3.2" rx="0.8" {...stroke} />
        <circle cx="4.5" cy="3.6" r="0.65" fill="currentColor" />
        <circle cx="4.5" cy="8" r="0.65" fill="currentColor" />
        <circle cx="4.5" cy="12.4" r="0.65" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'git',
    label: 'Git',
    svg: (
      <svg {...s}>
        <circle cx="4" cy="12" r="1.6" {...stroke} />
        <circle cx="4" cy="4" r="1.6" {...stroke} />
        <circle cx="12" cy="4" r="1.6" {...stroke} />
        <circle cx="8" cy="8" r="1.6" {...stroke} />
        <path d="M4,12 L8,8 M4,4 L8,8 L12,4" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'logs',
    label: 'Logs',
    svg: (
      <svg {...s}>
        <rect x="3" y="2" width="10" height="12" rx="1" {...stroke} />
        <line x1="5" y1="5" x2="11" y2="5" {...stroke} />
        <line x1="5" y1="7.5" x2="11" y2="7.5" {...stroke} />
        <line x1="5" y1="10" x2="9" y2="10" {...stroke} />
        <line x1="5" y1="12.5" x2="11" y2="12.5" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'package',
    label: 'Package',
    svg: (
      <svg {...s}>
        <path d="M4,5 L8,2.5 L12,5 L8,7.5 Z" {...stroke} />
        <path d="M4,5 L4,13 L12,13 L12,5" {...stroke} />
        <line x1="8" y1="7.5" x2="8" y2="13" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'test',
    label: 'Tests',
    svg: (
      <svg {...s}>
        <circle cx="8" cy="8" r="5.2" {...stroke} />
        <polyline points="5,8 7.5,10.5 11.5,6" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'rocket',
    label: 'Deploy',
    svg: (
      <svg {...s}>
        <path d="M8,2 L10,8.5 L8,7.7 L6,8.5 Z" {...stroke} />
        <rect x="6" y="8.5" width="4" height="4" rx="0.5" {...stroke} />
        <path d="M6,12.5 L5,14 M10,12.5 L11,14" {...stroke} />
        <path d="M8,11 L7,13.2 L8,12.5 L9,13.2 Z" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'link',
    label: 'Remote',
    svg: (
      <svg {...s}>
        <circle cx="6" cy="8" r="2.7" {...stroke} />
        <circle cx="10" cy="8" r="2.7" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'refresh',
    label: 'Watch',
    svg: (
      <svg {...s}>
        <path
          d="M12.5,5 A5.2,5.2 0 1 0 12.5,12"
          fill="none"
          {...stroke}
        />
        <polyline points="14,3 14,6 11,6" {...stroke} />
        <path
          d="M3.5,11 A5.2,5.2 0 1 0 3.5,4"
          fill="none"
          {...stroke}
        />
        <polyline points="2,13 2,10 5,10" {...stroke} />
      </svg>
    ),
  },
  {
    id: 'cloud',
    label: 'Cloud',
    svg: (
      <svg {...s}>
        <path
          d="M4,10.5 C2.8,10.5 2,9.6 2,8.5 C2,7.2 3.2,6 4.8,6 C5.2,4.3 6.8,3 8.8,3 C11.2,3 13,4.8 13,7 C13.8,7 14.5,7.8 14.5,8.8 C14.5,9.9 13.6,10.8 12.4,10.8 L4,10.5 Z"
          {...stroke}
        />
      </svg>
    ),
  },
  {
    id: 'cpu',
    label: 'CPU',
    svg: (
      <svg {...s}>
        <rect x="5" y="5" width="6" height="6" rx="0.6" {...stroke} />
        <line x1="8" y1="2" x2="8" y2="5" {...stroke} />
        <line x1="8" y1="11" x2="8" y2="14" {...stroke} />
        <line x1="2" y1="8" x2="5" y2="8" {...stroke} />
        <line x1="11" y1="8" x2="14" y2="8" {...stroke} />
        <line x1="4.2" y1="4.2" x2="5.8" y2="5.8" {...stroke} />
        <line x1="11.8" y1="4.2" x2="10.2" y2="5.8" {...stroke} />
        <line x1="4.2" y1="11.8" x2="5.8" y2="10.2" {...stroke} />
        <line x1="11.8" y1="11.8" x2="10.2" y2="10.2" {...stroke} />
      </svg>
    ),
  },
];

export const TERMINAL_ICON_MAP = new Map(TERMINAL_ICONS.map(i => [i.id, i]));

export const DEFAULT_TERMINAL_ICON = 'terminal';

/** Tab icon applied when an AI agent session is detected, only if the user never set a tab icon. */
export const AGENT_AUTO_TAB_ICON_ID = 'robot';

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

const ASSIGNABLE_COLORS = TAB_COLORS.filter(c => c.value !== '').map(c => c.value);

export function pickRandomColor(usedColors: string[]): string {
  const unused = ASSIGNABLE_COLORS.filter(c => !usedColors.includes(c));
  const pool = unused.length > 0 ? unused : ASSIGNABLE_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function TerminalTabIcon({ iconId, color }: { iconId?: string; color?: string }) {
  const def = TERMINAL_ICON_MAP.get(iconId || DEFAULT_TERMINAL_ICON) || TERMINAL_ICONS[0];
  return (
    <span className="terminal-tab-icon" style={color ? { color } : undefined}>
      {def.svg}
    </span>
  );
}
