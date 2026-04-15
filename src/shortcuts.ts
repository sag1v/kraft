export const IS_MAC = navigator.platform.startsWith('Mac');
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

export interface ShortcutDef {
  id: string;
  category: 'General' | 'View' | 'Terminal' | 'Editor' | 'Developer';
  label: string;
  keys: string;
}

function mod(rest: string): string {
  return `${MOD_KEY}+${rest}`;
}

export const SHORTCUTS: ShortcutDef[] = [
  // General
  { id: 'open-settings', category: 'General', label: 'Open Settings', keys: mod(',') },
  { id: 'command-palette', category: 'General', label: 'Command Palette', keys: mod('Shift+P') },
  { id: 'quick-open', category: 'General', label: 'Quick Open File', keys: mod('P') },
  { id: 'search-across-files', category: 'General', label: 'Search Across Files', keys: mod('Shift+F') },
  { id: 'reload-window', category: 'General', label: 'Reload Window', keys: mod('Shift+R') },

  // View
  { id: 'focus-explorer', category: 'View', label: 'Focus Explorer', keys: '' },
  { id: 'focus-terminal', category: 'View', label: 'Focus Terminal', keys: '' },
  { id: 'focus-editor',   category: 'View', label: 'Focus Editor',   keys: '' },
  { id: 'toggle-explorer', category: 'View', label: 'Toggle Explorer', keys: mod('B') },
  { id: 'toggle-terminal', category: 'View', label: 'Toggle Terminal', keys: mod('J') },
  { id: 'toggle-editor', category: 'View', label: 'Toggle Editor', keys: mod('\\') },
  { id: 'zoom-in', category: 'View', label: 'Zoom In', keys: mod('+') },
  { id: 'zoom-out', category: 'View', label: 'Zoom Out', keys: mod('-') },
  { id: 'zoom-reset', category: 'View', label: 'Reset Zoom', keys: mod('0') },

  // Editor
  { id: 'search-in-file', category: 'Editor', label: 'Search in File', keys: mod('F') },
  { id: 'close-tab', category: 'Editor', label: 'Close File Tab', keys: mod('W') },
  { id: 'prev-tab', category: 'Editor', label: 'Previous File Tab', keys: mod('Shift+[') },
  { id: 'next-tab', category: 'Editor', label: 'Next File Tab', keys: mod('Shift+]') },

  // Terminal
  { id: 'new-terminal', category: 'Terminal', label: 'New Terminal', keys: mod('T') },
  { id: 'restore-terminal-tab', category: 'Terminal', label: 'Restore Terminal Tab', keys: mod('Shift+T') },
  { id: 'close-terminal', category: 'Terminal', label: 'Close Terminal', keys: mod('Shift+W') },
  { id: 'next-terminal', category: 'Terminal', label: 'Next Terminal', keys: 'Ctrl+Tab' },
  { id: 'prev-terminal', category: 'Terminal', label: 'Previous Terminal', keys: 'Ctrl+Shift+Tab' },

  // Developer
  { id: 'toggle-devtools', category: 'Developer', label: 'Toggle Developer Tools', keys: mod('Alt+I') },
];

export function getShortcut(id: string): ShortcutDef | undefined {
  return SHORTCUTS.find(s => s.id === id);
}

export function shortcutLabel(id: string): string {
  return getShortcut(id)?.keys ?? '';
}

export function tooltipWithShortcut(label: string, shortcutId: string): string {
  const keys = shortcutLabel(shortcutId);
  return keys ? `${label} (${keys})` : label;
}

export const SHORTCUT_CATEGORIES: ShortcutDef['category'][] = [
  'General',
  'View',
  'Editor',
  'Terminal',
  'Developer',
];
