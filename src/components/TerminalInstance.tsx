import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import type { ILink, ILinkProvider } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import type { Theme } from '../types';
import '@xterm/xterm/css/xterm.css';

function buildXtermTheme(theme: Theme) {
  return {
    background: theme.colors.terminalBg,
    foreground: theme.colors.terminalFg,
    cursor: theme.colors.terminalCursor,
    cursorAccent: theme.colors.terminalBg,
    selectionBackground: theme.colors.terminalSelection,
    selectionForeground: undefined,
    black: theme.colors.ansi.black,
    red: theme.colors.ansi.red,
    green: theme.colors.ansi.green,
    yellow: theme.colors.ansi.yellow,
    blue: theme.colors.ansi.blue,
    magenta: theme.colors.ansi.magenta,
    cyan: theme.colors.ansi.cyan,
    white: theme.colors.ansi.white,
    brightBlack: theme.colors.ansi.brightBlack,
    brightRed: theme.colors.ansi.brightRed,
    brightGreen: theme.colors.ansi.brightGreen,
    brightYellow: theme.colors.ansi.brightYellow,
    brightBlue: theme.colors.ansi.brightBlue,
    brightMagenta: theme.colors.ansi.brightMagenta,
    brightCyan: theme.colors.ansi.brightCyan,
    brightWhite: theme.colors.ansi.brightWhite,
  };
}

const enum LinkLimits {
  MaxLineLength = 2000,
  MaxLinkLength = 500,
  MaxLinksPerLine = 10,
  MinPathLength = 3,
  CacheTTLMs = 10_000,
  CacheMaxSize = 500,
}

// Matches absolute/relative/home-relative paths with strict character exclusions.
// Excludes: whitespace, quotes, backticks, !, &, *, ;, <, >, |, {, }, and backslash.
// The second alternative requires at least two segments with a file extension to reduce
// false positives on bare package names or version strings.
const FILE_PATH_RE =
  /(?:(?:~\/|\.{1,2}\/|\/)(?:[^\s"'`!&*;|<>{}\\:()[\]]|\\[ ])+|(?:[A-Za-z0-9@_.-]+\/){2,}[A-Za-z0-9@_.-]+\.[A-Za-z]\w*)(?::(\d+)(?::(\d+))?)?/g;

// Fallback patterns for well-known error output formats (only tried when primary regex finds nothing).
const FALLBACK_MATCHERS: { re: RegExp; pathGroup: string; lineGroup?: string; colGroup?: string }[] = [
  // Python: File "foo/bar.py", line 12
  { re: /^ *File "(?<path>.+)"(?:, line (?<line>\d+))?/, pathGroup: 'path', lineGroup: 'line' },
  // C/C++ compilers: foo/bar.cpp(339,12): error ...  OR  foo/bar.cpp(339): error ...
  { re: /^(?<path>[^\s(]+)\((?<line>\d+)(?:, ?(?<col>\d+))?\) ?:/, pathGroup: 'path', lineGroup: 'line', colGroup: 'col' },
  // Rust/Go/generic: foo/bar.rs:12:5: error ...
  { re: /^(?<path>[^\s:]+):(?<line>\d+)(?::(?<col>\d+))? ?:/, pathGroup: 'path', lineGroup: 'line', colGroup: 'col' },
];

function stripTrailingJunk(p: string): string {
  return p.replace(/[.,:;!?)>\]]+$/, '');
}

function isGitDiffLine(text: string): boolean {
  return text.startsWith('--- a/') || text.startsWith('+++ b/') || text.startsWith('diff --git');
}

const IS_MAC = navigator.platform.toUpperCase().includes('MAC');
const LINK_TOOLTIP_TEXT = IS_MAC ? 'Follow link (⌘ + click)' : 'Follow link (Ctrl + click)';

function createLinkTooltip(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'terminal-link-tooltip';
  el.textContent = LINK_TOOLTIP_TEXT;
  return el;
}

type ResolveResult = string | null;

class PathResolveCache {
  private cache = new Map<string, { resolved: ResolveResult; ts: number }>();

  get(key: string): ResolveResult | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > LinkLimits.CacheTTLMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.resolved;
  }

  set(key: string, resolved: ResolveResult): void {
    if (this.cache.size >= LinkLimits.CacheMaxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { resolved, ts: Date.now() });
  }
}

async function resolvePathAcrossRoots(
  rawPath: string,
  roots: string[],
  cache: PathResolveCache,
): Promise<ResolveResult> {
  for (const root of roots) {
    const cacheKey = `${root}\0${rawPath}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      if (cached !== null) return cached;
      continue;
    }
    try {
      const resolved = await window.api.resolveFilePath(rawPath, root);
      cache.set(cacheKey, resolved);
      if (resolved) return resolved;
    } catch {
      cache.set(cacheKey, null);
    }
  }
  return null;
}

class FilePathLinkProvider implements ILinkProvider {
  private resolveCache = new PathResolveCache();

  constructor(
    private terminal: XTerm,
    private getCwd: () => string,
    private getWorkspaceRoots: () => string[],
    private onOpenFile: (path: string) => void,
    private tooltip: HTMLDivElement,
  ) {}

  provideLinks(lineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.terminal.buffer.active.getLine(lineNumber - 1);
    if (!line) { callback(undefined); return; }

    const text = line.translateToString();
    if (text.length === 0 || text.length > LinkLimits.MaxLineLength) {
      callback(undefined);
      return;
    }

    if (isGitDiffLine(text)) {
      callback(undefined);
      return;
    }

    this.detectAndValidate(text, lineNumber).then(links => {
      callback(links.length > 0 ? links : undefined);
    });
  }

  private getResolutionRoots(): string[] {
    const roots: string[] = [];
    const seen = new Set<string>();
    const add = (p: string) => {
      if (p && !seen.has(p)) { seen.add(p); roots.push(p); }
    };
    add(this.getCwd());
    for (const r of this.getWorkspaceRoots()) add(r);
    return roots;
  }

  private async detectAndValidate(text: string, lineNumber: number): Promise<ILink[]> {
    const candidates = this.extractCandidates(text);
    if (candidates.length === 0) return [];

    const roots = this.getResolutionRoots();
    const tooltip = this.tooltip;
    const openFile = this.onOpenFile;
    const links: ILink[] = [];

    for (const candidate of candidates) {
      if (links.length >= LinkLimits.MaxLinksPerLine) break;

      const isAbsoluteish = candidate.path.startsWith('/') || candidate.path.startsWith('~/');
      let resolved: ResolveResult = null;

      if (isAbsoluteish) {
        const cacheKey = `\0${candidate.path}`;
        const cached = this.resolveCache.get(cacheKey);
        if (cached !== undefined) {
          resolved = cached;
        } else {
          try {
            resolved = await window.api.resolveFilePath(candidate.path);
          } catch {
            resolved = null;
          }
          this.resolveCache.set(cacheKey, resolved);
        }
      } else {
        resolved = await resolvePathAcrossRoots(candidate.path, roots, this.resolveCache);
      }

      if (resolved === null) continue;

      const fullText = candidate.suffix
        ? `${candidate.path}${candidate.suffix}`
        : candidate.path;

      links.push({
        range: {
          start: { x: candidate.startX, y: lineNumber },
          end: { x: candidate.startX + fullText.length, y: lineNumber },
        },
        text: fullText,
        decorations: { pointerCursor: true, underline: true },
        activate(event: MouseEvent) {
          if (!event.metaKey && !event.ctrlKey) return;
          tooltip.classList.remove('visible');
          openFile(resolved!);
        },
        hover(event: MouseEvent) {
          tooltip.style.left = `${event.clientX}px`;
          tooltip.style.top = `${event.clientY + 20}px`;
          tooltip.classList.add('visible');
        },
        leave() {
          tooltip.classList.remove('visible');
        },
      });
    }

    return links;
  }

  private extractCandidates(text: string): { path: string; suffix: string; startX: number }[] {
    const results: { path: string; suffix: string; startX: number }[] = [];

    FILE_PATH_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FILE_PATH_RE.exec(text)) !== null) {
      const fullMatch = match[0];
      if (fullMatch.length > LinkLimits.MaxLinkLength) continue;

      const lineNum = match[1];
      const colNum = match[2];
      const pathEnd = lineNum ? fullMatch.indexOf(`:${lineNum}`) : fullMatch.length;
      const rawPath = stripTrailingJunk(fullMatch.substring(0, pathEnd));
      if (rawPath.length < LinkLimits.MinPathLength) continue;

      const suffix = lineNum
        ? `:${lineNum}${colNum ? `:${colNum}` : ''}`
        : '';

      results.push({
        path: rawPath,
        suffix,
        startX: match.index + 1,
      });
    }

    if (results.length === 0) {
      for (const fm of FALLBACK_MATCHERS) {
        const m = text.match(fm.re);
        if (!m?.groups) continue;
        const fbPath = m.groups[fm.pathGroup];
        if (!fbPath || fbPath.length < LinkLimits.MinPathLength) continue;

        const fbLine = fm.lineGroup ? m.groups[fm.lineGroup] : undefined;
        const fbCol = fm.colGroup ? m.groups[fm.colGroup] : undefined;
        const suffix = fbLine ? `:${fbLine}${fbCol ? `:${fbCol}` : ''}` : '';
        const idx = text.indexOf(fbPath);
        if (idx === -1) continue;

        results.push({
          path: fbPath,
          suffix,
          startX: idx + 1,
        });
        break;
      }
    }

    return results;
  }
}

interface TerminalInstanceProps {
  sessionId: string;
  isActive: boolean;
  /** Which pane has keyboard focus (defaults to isActive). */
  isFocused?: boolean;
  theme: Theme;
  cwd: string;
  workspaceRoots: string[];
  onCwdChange: (sessionId: string, cwd: string) => void;
  onOpenFile: (filePath: string) => void;
  /** Called on mousedown — lets the parent focus this pane in split mode. */
  onActivate?: () => void;
  /** Extra inline styles merged onto the root div (e.g. flex sizing in split view). */
  style?: React.CSSProperties;
}

export const TerminalInstance = React.memo(function TerminalInstance({
  sessionId,
  isActive,
  isFocused,
  theme,
  cwd,
  workspaceRoots,
  onCwdChange,
  onOpenFile,
  onActivate,
  style,
}: TerminalInstanceProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  const workspaceRootsRef = useRef(workspaceRoots);
  workspaceRootsRef.current = workspaceRoots;

  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;

  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;

  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const isFileDrag = useCallback((e: React.DragEvent) => {
    return e.dataTransfer.types.includes('application/x-kraft-file-path') ||
      e.dataTransfer.types.includes('Files');
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (isFileDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, [isFileDrag]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (isFileDrag(e)) {
      e.preventDefault();
      dragCounterRef.current++;
      setIsDragOver(true);
    }
  }, [isFileDrag]);

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const currentCwd = cwdRef.current;
    const toRelative = (p: string) => {
      if (currentCwd && p.startsWith(currentCwd + '/')) {
        return p.slice(currentCwd.length + 1);
      }
      return p;
    };

    const kraftPath = e.dataTransfer.getData('application/x-kraft-file-path');
    if (kraftPath) {
      window.api.writeTerminal(sessionIdRef.current, `@${toRelative(kraftPath)} `);
      requestAnimationFrame(() => xtermRef.current?.focus());
      return;
    }

    if (e.dataTransfer.files.length > 0) {
      const paths: string[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const filePath = (e.dataTransfer.files[i] as any).path as string;
        if (filePath) paths.push(`@${toRelative(filePath)}`);
      }
      if (paths.length > 0) {
        window.api.writeTerminal(sessionIdRef.current, paths.join(' ') + ' ');
      }
    }
    requestAnimationFrame(() => xtermRef.current?.focus());
  }, []);

  useEffect(() => {
    const container = termRef.current;
    if (!container) return;

    const hasApi = typeof window.api !== 'undefined' && window.api?.createTerminal;
    if (!hasApi) {
      container.innerHTML = '<div style="padding:16px;color:var(--fg-muted);font-size:12px;">Terminal requires Electron runtime</div>';
      return;
    }

    let receivedFirstOutput = false;

    const xterm = new XTerm({
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
      fontSize: 14,
      theme: buildXtermTheme(theme),
      cursorBlink: true,
      cursorStyle: 'underline',
      allowTransparency: false,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(new WebLinksAddon());

    const linkTooltip = createLinkTooltip();
    document.body.appendChild(linkTooltip);

    xterm.registerLinkProvider(
      new FilePathLinkProvider(
        xterm,
        () => cwdRef.current,
        () => workspaceRootsRef.current,
        (filePath) => onOpenFileRef.current(filePath),
        linkTooltip,
      ),
    );
    xterm.open(container);

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    let webglAddon: WebglAddon | null = null;
    const webglRafId = requestAnimationFrame(() => {
      try {
        webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          try { webglAddon?.dispose(); } catch { /* already disposed */ }
          webglAddon = null;
        });
        xterm.loadAddon(webglAddon);
      } catch {
        webglAddon = null;
      }
    });

    const rafId = requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* layout not ready */ }
      try { xterm.focus(); } catch { /* ignore */ }
    });

    let lastReportedCwd: string | null = null;

    const reportCwd = (newCwd: string) => {
      if (newCwd && newCwd !== lastReportedCwd) {
        lastReportedCwd = newCwd;
        onCwdChangeRef.current(sessionIdRef.current, newCwd);
      }
    };

    // After the user runs a command (Enter), check cwd once output settles
    // so the explorer sync bar reacts quickly to `cd`.
    // Only armed by user Enter keystrokes - not by arbitrary terminal output
    // (avoids unnecessary lsof calls during AI agent chat, builds, etc.).
    let cwdCheckTimer: ReturnType<typeof setTimeout> | null = null;
    let cwdCheckArmed = false;

    const checkCwdSoon = () => {
      if (cwdCheckTimer !== null) clearTimeout(cwdCheckTimer);
      cwdCheckTimer = setTimeout(async () => {
        cwdCheckTimer = null;
        cwdCheckArmed = false;
        if (!sessionIdRef.current) return;
        try {
          const newCwd = await window.api.getTerminalCwd(sessionIdRef.current);
          if (newCwd) reportCwd(newCwd);
        } catch { /* ignore */ }
      }, 150);
    };

    const removeDataListener = window.api.onTerminalData((termId, data) => {
      if (termId === sessionIdRef.current) {
        if (!receivedFirstOutput) receivedFirstOutput = true;
        xterm.write(data);
        if (cwdCheckArmed) checkCwdSoon();
      }
    });

    const removeExitListener = window.api.onTerminalExit((termId, exitCode) => {
      if (termId === sessionIdRef.current) {
        xterm.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
      }
    });

    xterm.onData((data) => {
      window.api.writeTerminal(sessionIdRef.current, data);
      if (data.includes('\r') || data.includes('\n')) {
        cwdCheckArmed = true;
        // Start the timer immediately on Enter — don't wait for output to arrive first.
        // This ensures quick cwd detection even when the shell responds slowly.
        checkCwdSoon();
      }
    });

    // OSC 7 — instant cwd updates for shells that support it (zsh with oh-my-zsh/prezto,
    // fish, modern bash configs). Format: \e]7;file://hostname/path\a
    xterm.parser.registerOscHandler(7, (data: string) => {
      try {
        const url = new URL(data);
        const newCwd = decodeURIComponent(url.pathname);
        if (newCwd) reportCwd(newCwd);
      } catch {
        // not a valid URL, ignore
      }
      return false;
    });

    // Polling fallback for shells that don't emit OSC 7.
    // No double-read debounce — OSC 7 already handles the reliable case,
    // so a single stable reading is good enough here.
    const cwdPoll = setInterval(async () => {
      if (!sessionIdRef.current || !receivedFirstOutput) return;
      try {
        const newCwd = await window.api.getTerminalCwd(sessionIdRef.current);
        if (newCwd) reportCwd(newCwd);
      } catch {
        // ignore
      }
    }, 2000);

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(webglRafId);
      removeDataListener();
      removeExitListener();
      clearInterval(cwdPoll);
      if (cwdCheckTimer !== null) clearTimeout(cwdCheckTimer);
      linkTooltip.remove();
      xtermRef.current = null;
      fitAddonRef.current = null;
      try { webglAddon?.dispose(); } catch { /* already disposed */ }
      webglAddon = null;
      const suppress = (e: ErrorEvent) => {
        if (e.message?.includes('dimensions') || e.message?.includes('_isDisposed')) {
          e.preventDefault();
        }
      };
      window.addEventListener('error', suppress);
      xterm.dispose();
      requestAnimationFrame(() => window.removeEventListener('error', suppress));
    };
  }, [sessionId]);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = buildXtermTheme(theme);
    }
  }, [theme]);

  // Fit and sync PTY size whenever this pane becomes visible.
  useEffect(() => {
    if (!isActive) return;
    const rafId = requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
        if (xtermRef.current) {
          window.api?.resizeTerminal(
            sessionIdRef.current,
            xtermRef.current.cols,
            xtermRef.current.rows
          );
        }
      } catch {
        // ignore
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [isActive]);

  // Focus the xterm textarea when this pane is designated as the active one.
  // In single-session mode isFocused is undefined, so it falls back to isActive.
  useEffect(() => {
    if (!(isFocused ?? isActive)) return;
    const rafId = requestAnimationFrame(() => {
      try { xtermRef.current?.focus(); } catch { /* ignore */ }
    });
    return () => cancelAnimationFrame(rafId);
  }, [isActive, isFocused]);

  useEffect(() => {
    let rafId = 0;
    const handleResize = () => {
      if (!isActiveRef.current) return;
      try {
        fitAddonRef.current?.fit();
        if (xtermRef.current) {
          window.api?.resizeTerminal(
            sessionIdRef.current,
            xtermRef.current.cols,
            xtermRef.current.rows
          );
        }
      } catch {
        // ignore
      }
    };

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(handleResize);
    });
    if (termRef.current) {
      observer.observe(termRef.current);
    }
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className={`terminal-instance${isDragOver ? ' terminal-drag-over' : ''}${isFocused === true ? ' terminal-instance--focused' : ''}`}
      data-session-id={sessionId}
      style={{ display: isActive ? 'flex' : 'none', flex: 1, height: '100%', position: 'relative', ...style }}
      onMouseDown={() => onActivate?.()}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="panel-body terminal-body" ref={termRef} />
      {isDragOver && (
        <div className="terminal-drop-overlay">
          <span className="terminal-drop-label">Drop file to paste @path</span>
        </div>
      )}
    </div>
  );
});
