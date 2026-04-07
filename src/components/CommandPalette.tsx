import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { FileIcon } from './FileIcon';

type CommandDef = {
  id: string;
  category: string;
  label: string;
  shortcut?: string;
  run: () => void;
};

const IS_MAC = navigator.platform.startsWith('Mac');
const MOD = IS_MAC ? '⌘' : 'Ctrl';

export function CommandPalette() {
  const { setSettingsOpen, setThemeId, setOpenFilePath, homeDir, setPanelVisibility } = useUIContext();
  const { explorerRoot, cwd } = useSessionContext();

  const commands = useMemo<CommandDef[]>(
    () => [
      {
        id: 'reload-window',
        category: 'Developer',
        label: 'Reload Window',
        run: () => window.api?.reloadWindow?.(),
      },
      {
        id: 'devtools',
        category: 'Developer',
        label: 'Toggle Developer Tools',
        shortcut: `${MOD}+Alt+I`,
        run: () => window.api?.toggleDevTools?.(),
      },
      {
        id: 'settings',
        category: 'Preferences',
        label: 'Open Settings',
        shortcut: `${MOD}+,`,
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
        run: () => setPanelVisibility('explorer', true),
      },
      {
        id: 'toggle-viewer',
        category: 'View',
        label: 'Toggle Viewer',
        run: () => setPanelVisibility('viewer', true),
      },
      {
        id: 'toggle-terminal',
        category: 'View',
        label: 'Toggle Terminal',
        run: () => setPanelVisibility('terminal', true),
      },
    ],
    [setSettingsOpen, setThemeId, setPanelVisibility]
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

  const items = useMemo(() => {
    if (isCommandMode) {
      return filteredCommands.map((c) => ({ kind: 'command' as const, key: c.id, category: c.category, label: c.label, shortcut: c.shortcut, run: c.run }));
    }
    return fileResults.map((r) => {
      const parts = r.path.split('/');
      const fileName = parts.pop() || r.path;
      let dirPath = parts.join('/');
      if (searchRoot && dirPath.startsWith(searchRoot)) {
        dirPath = dirPath.slice(searchRoot.length);
        if (dirPath.startsWith('/')) dirPath = dirPath.slice(1);
      }
      return { kind: 'file' as const, key: r.path, path: r.path, label: r.path, fileName, dirPath, isDirectory: r.isDirectory };
    });
  }, [isCommandMode, filteredCommands, fileResults, searchRoot]);

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

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
      if (!item) return;
      if (item.kind === 'command') {
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
      setSelectedIndex((i) => Math.min(i + 1, Math.max(0, items.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
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
            items.map((item, index) => (
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}
