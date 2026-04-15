import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { FileIcon } from './FileIcon';
import { shortcutLabel } from '../shortcuts';

type CommandDef = {
  id: string;
  category: string;
  label: string;
  shortcut?: string;
  run: () => void;
};

const RECENT_COMMANDS_KEY = 'kraft-recent-commands';
const MAX_RECENT = 5;

function loadRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_COMMANDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecentIds(ids: string[]) {
  localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
}

function pushRecent(id: string, prev: string[]): string[] {
  const next = [id, ...prev.filter((x) => x !== id)].slice(0, MAX_RECENT);
  saveRecentIds(next);
  return next;
}

export function CommandPalette() {
  const { setSettingsOpen, setThemeId, setOpenFilePath, homeDir, panelVisibility, setPanelVisibility } = useUIContext();
  const { explorerRoot, cwd } = useSessionContext();
  const [recentIds, setRecentIds] = useState<string[]>(loadRecentIds);

  const commands = useMemo<CommandDef[]>(
    () => [
      {
        id: 'reload-window',
        category: 'Developer',
        label: 'Reload Window',
        shortcut: shortcutLabel('reload-window'),
        run: () => window.api?.reloadWindow?.(),
      },
      {
        id: 'devtools',
        category: 'Developer',
        label: 'Toggle Developer Tools',
        shortcut: shortcutLabel('toggle-devtools'),
        run: () => window.api?.toggleDevTools?.(),
      },
      {
        id: 'settings',
        category: 'Preferences',
        label: 'Open Settings',
        shortcut: shortcutLabel('open-settings'),
        run: () => setSettingsOpen(true),
      },
      {
        id: 'theme-kraft-dark',
        category: 'Preferences',
        label: 'Color Theme: Kraft Dark',
        run: () => setThemeId('kraft-dark'),
      },
      {
        id: 'theme-tokyo-night',
        category: 'Preferences',
        label: 'Color Theme: Tokyo Night',
        run: () => setThemeId('tokyo-night'),
      },
      {
        id: 'theme-gruvbox-dark',
        category: 'Preferences',
        label: 'Color Theme: Gruvbox Dark',
        run: () => setThemeId('gruvbox-dark'),
      },
      {
        id: 'theme-rose-pine-dawn',
        category: 'Preferences',
        label: 'Color Theme: Rose Pine Dawn',
        run: () => setThemeId('rose-pine-dawn'),
      },
      {
        id: 'toggle-explorer',
        category: 'View',
        label: 'Toggle Explorer',
        shortcut: shortcutLabel('toggle-explorer'),
        run: () => setPanelVisibility('explorer', !panelVisibility.explorer),
      },
      {
        id: 'toggle-editor',
        category: 'View',
        label: 'Toggle Editor',
        shortcut: shortcutLabel('toggle-editor'),
        run: () => setPanelVisibility('editor', !panelVisibility.editor),
      },
      {
        id: 'toggle-terminal',
        category: 'View',
        label: 'Toggle Terminal',
        shortcut: shortcutLabel('toggle-terminal'),
        run: () => setPanelVisibility('terminal', !panelVisibility.terminal),
      },
    ],
    [setSettingsOpen, setThemeId, panelVisibility, setPanelVisibility]
  );

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('>');
  const [fileResults, setFileResults] = useState<Array<{ path: string; isDirectory: boolean }>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);
  const openModeRef = useRef<'command' | 'file'>('command');

  const isCommandMode = input.startsWith('>');
  const commandFilter = isCommandMode ? input.slice(1).trim().toLowerCase() : '';
  const fileQuery = !isCommandMode ? input.trim() : '';

  const filteredCommands = useMemo(() => {
    if (!isCommandMode) return [];
    if (!commandFilter) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(commandFilter));
  }, [commands, isCommandMode, commandFilter]);

  const searchRoot = cwd || explorerRoot || '';

  useEffect(() => {
    if (!open || isCommandMode) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setFileResults([]);
      return;
    }

    if (!searchRoot || !fileQuery) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setFileResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const seq = ++searchSeq.current;
    debounceRef.current = setTimeout(async () => {
      if (!window.api?.searchFiles) {
        if (seq === searchSeq.current) setFileResults([]);
        return;
      }
      try {
        const results = await window.api.searchFiles(searchRoot, fileQuery);
        if (seq === searchSeq.current) setFileResults(results);
      } catch {
        if (seq === searchSeq.current) setFileResults([]);
      }
    }, 200);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [open, isCommandMode, fileQuery, searchRoot]);

  type CommandItem = { kind: 'command'; key: string; category: string; label: string; shortcut?: string; run: () => void };
  type FileItem = { kind: 'file'; key: string; path: string; label: string; fileName: string; dirPath: string; isDirectory: boolean };
  type SectionHeader = { kind: 'section'; key: string; label: string };
  type PaletteItem = CommandItem | FileItem | SectionHeader;

  const items: PaletteItem[] = useMemo(() => {
    if (isCommandMode) {
      const toItem = (c: CommandDef): CommandItem => ({
        kind: 'command', key: c.id, category: c.category, label: c.label, shortcut: c.shortcut, run: c.run,
      });

      if (!commandFilter && recentIds.length > 0) {
        const recentCommands = recentIds
          .map((id) => commands.find((c) => c.id === id))
          .filter((c): c is CommandDef => c != null);
        const recentSet = new Set(recentIds);
        const otherCommands = commands.filter((c) => !recentSet.has(c.id));

        const result: PaletteItem[] = [];
        if (recentCommands.length > 0) {
          result.push({ kind: 'section', key: 'section-recent', label: 'recently used' });
          result.push(...recentCommands.map(toItem));
        }
        if (otherCommands.length > 0) {
          result.push({ kind: 'section', key: 'section-other', label: 'other commands' });
          result.push(...otherCommands.map(toItem));
        }
        return result;
      }

      return filteredCommands.map(toItem);
    }
    return fileResults.map((r) => {
      const parts = r.path.split('/');
      const fileName = parts.pop() || r.path;
      let dirPath = parts.join('/');
      if (searchRoot && dirPath.startsWith(searchRoot)) {
        dirPath = dirPath.slice(searchRoot.length);
        if (dirPath.startsWith('/')) dirPath = dirPath.slice(1);
      }
      return { kind: 'file' as const, key: r.path, path: r.path, label: r.path, fileName, dirPath, isDirectory: r.isDirectory } as FileItem;
    });
  }, [isCommandMode, filteredCommands, fileResults, searchRoot, commandFilter, recentIds, commands]);

  const selectableIndices = useMemo(
    () => items.reduce<number[]>((acc, item, i) => { if (item.kind !== 'section') acc.push(i); return acc; }, []),
    [items]
  );

  useEffect(() => {
    setSelectedIndex((prev) => {
      if (selectableIndices.length === 0) return 0;
      if (selectableIndices.includes(prev)) return prev;
      return selectableIndices[0];
    });
  }, [selectableIndices]);

  useLayoutEffect(() => {
    if (!open) return;
    setInput(openModeRef.current === 'command' ? '>' : '');
    setSelectedIndex(0);
    setFileResults([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        const mode = e.shiftKey ? 'command' : 'file';
        setOpen(prev => {
          if (prev) {
            openModeRef.current = mode;
            setInput(mode === 'command' ? '>' : '');
            setSelectedIndex(0);
            setFileResults([]);
            return true;
          }
          openModeRef.current = mode;
          return true;
        });
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open]);

  const executeIndex = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item || item.kind === 'section') return;
      if (item.kind === 'command') {
        setRecentIds((prev) => pushRecent(item.key, prev));
        item.run();
        setOpen(false);
      } else if (item.isDirectory) {
        let relativePath = item.path;
        if (searchRoot && relativePath.startsWith(searchRoot)) {
          relativePath = relativePath.slice(searchRoot.length);
          if (relativePath.startsWith('/')) relativePath = relativePath.slice(1);
        }
        setInput(relativePath + '/');
        setSelectedIndex(0);
      } else {
        setOpenFilePath(item.path);
        setOpen(false);
      }
    },
    [items, setOpenFilePath, searchRoot]
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    setSelectedIndex(0);
  };

  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!resultsRef.current) return;
    const el = resultsRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((cur) => {
        const pos = selectableIndices.indexOf(cur);
        return pos < selectableIndices.length - 1 ? selectableIndices[pos + 1] : cur;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((cur) => {
        const pos = selectableIndices.indexOf(cur);
        return pos > 0 ? selectableIndices[pos - 1] : cur;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeIndex(selectedIndex);
    }
  };

  const placeholder = isCommandMode ? 'Search commands… (delete > for files)' : 'Search files by name or path… (type > for commands)';

  if (!open) return null;

  return (
    <div
      className="command-palette-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="command-palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          value={input}
          onChange={onInputChange}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          aria-autocomplete="list"
        />
        <div className="command-palette-results" role="listbox" ref={resultsRef}>
          {items.length === 0 ? (
            <div className="command-palette-empty">
              {isCommandMode ? 'No matching commands' : !searchRoot ? 'Open a folder or terminal cwd to search files' : !fileQuery ? 'Type to search files' : 'No matching files'}
            </div>
          ) : (
            items.map((item, index) =>
              item.kind === 'section' ? (
                <div key={item.key} className="command-palette-section-header">{item.label}</div>
              ) : (
                <div
                  key={item.key}
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={`command-palette-item${index === selectedIndex ? ' active' : ''}`}
                  data-index={index}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => executeIndex(index)}
                >
                  {item.kind === 'command' ? (
                    <>
                      <span className="command-palette-cmd-label">
                        <span className="command-palette-cmd-category">{item.category}: </span>
                        {item.label}
                      </span>
                      {item.shortcut && (
                        <span className="command-palette-shortcut">
                          {item.shortcut.split('+').map((key, i) => (
                            <kbd key={i} className="command-palette-kbd">{key}</kbd>
                          ))}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <FileIcon name={item.fileName} isDirectory={item.isDirectory} />
                      <span className="command-palette-file-name">{item.fileName}{item.isDirectory ? '/' : ''}</span>
                      {item.dirPath && <span className="command-palette-file-path">{item.dirPath}</span>}
                    </>
                  )}
                </div>
              )
            )
          )}
        </div>
      </div>
    </div>
  );
}
