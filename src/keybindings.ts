import { IS_MAC } from './shortcuts';
import type { AppSettings } from './types';

export type FocusShortcutId = 'focus-explorer' | 'focus-terminal' | 'focus-editor';

export const FOCUS_SHORTCUT_IDS: FocusShortcutId[] = [
  'focus-explorer',
  'focus-terminal',
  'focus-editor',
];

/**
 * Combo string format: parts joined by '+'
 *   Mod   = Cmd on Mac, Ctrl on Win/Linux
 *   Cmd   = always metaKey (Mac only)
 *   Ctrl  = always ctrlKey
 *   Alt   = altKey / Option
 *   Shift = shiftKey
 *   then the key name exactly as KeyboardEvent.key
 */
export const VSCODE_BINDINGS: Record<FocusShortcutId, string> = {
  'focus-explorer': 'Mod+Shift+E',
  'focus-terminal': 'Ctrl+`',
  'focus-editor':   'Ctrl+1',
};

export const INTELLIJ_BINDINGS: Record<FocusShortcutId, string> = {
  'focus-explorer': IS_MAC ? 'Cmd+1' : 'Alt+1',
  'focus-terminal': 'Alt+F12',
  'focus-editor':   'Ctrl+1',
};

export function getPresetBindings(preset: AppSettings['keybindingPreset']): Record<FocusShortcutId, string> {
  return preset === 'intellij' ? INTELLIJ_BINDINGS : VSCODE_BINDINGS;
}

export function getEffectiveCombo(
  id: FocusShortcutId,
  settings: Pick<AppSettings, 'keybindingPreset' | 'customKeybindings'>,
): string {
  if (settings.keybindingPreset === 'custom') {
    const custom = settings.customKeybindings[id];
    if (custom) return custom;
  }
  return getPresetBindings(settings.keybindingPreset)[id];
}

export function matchesKeyCombo(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false;
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map(p => p.toLowerCase());

  const hasMod   = mods.includes('mod');
  const hasCmd   = mods.includes('cmd');
  const hasCtrl  = mods.includes('ctrl');
  const hasAlt   = mods.includes('alt');
  const hasShift = mods.includes('shift');

  const effectiveMod = IS_MAC ? e.metaKey : e.ctrlKey;

  if (hasMod  && !effectiveMod) return false;
  if (hasCmd  && !e.metaKey)    return false;
  if (hasCtrl && !e.ctrlKey)    return false;
  if (hasAlt  && !e.altKey)     return false;
  if (hasShift && !e.shiftKey)  return false;

  // Reject unexpected modifiers
  const expectsMeta = hasCmd || (hasMod && IS_MAC);
  if (!expectsMeta && e.metaKey) return false;
  const expectsCtrl = hasCtrl || (hasMod && !IS_MAC);
  if (!expectsCtrl && e.ctrlKey) return false;
  if (!hasAlt   && e.altKey)   return false;
  if (!hasShift && e.shiftKey) return false;

  return e.key === key || e.key.toLowerCase() === key.toLowerCase();
}

/** Convert a combo string to a human-readable label */
export function comboToDisplay(combo: string): string {
  if (!combo) return '';
  const sep = IS_MAC ? '' : '+';
  return combo
    .split('+')
    .map(p => {
      switch (p) {
        case 'Mod':    return IS_MAC ? '⌘' : 'Ctrl';
        case 'Cmd':    return '⌘';
        case 'Ctrl':   return IS_MAC ? '⌃' : 'Ctrl';
        case 'Alt':    return IS_MAC ? '⌥' : 'Alt';
        case 'Shift':  return IS_MAC ? '⇧' : 'Shift';
        case 'Escape': return 'Esc';
        default:       return p;
      }
    })
    .join(sep);
}

/** Capture a KeyboardEvent as a storable combo string. Returns null for modifier-only presses. */
export function eventToCombo(e: KeyboardEvent): string | null {
  const modifierKeys = ['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Dead'];
  if (modifierKeys.includes(e.key)) return null;

  const parts: string[] = [];
  if (e.metaKey)  parts.push('Cmd');
  else if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey)   parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key);
  return parts.join('+');
}
