import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import type { Theme, AppSettings } from '../types';
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

interface TerminalInstanceProps {
  sessionId: string;
  isActive: boolean;
  theme: Theme;
  settings: AppSettings;
  onCwdChange: (sessionId: string, cwd: string) => void;
}

export const TerminalInstance = React.memo(function TerminalInstance({
  sessionId,
  isActive,
  theme,
  settings,
  onCwdChange,
}: TerminalInstanceProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;

  useEffect(() => {
    const container = termRef.current;
    if (!container) return;

    const hasApi = typeof window.api !== 'undefined' && window.api?.createTerminal;
    if (!hasApi) {
      container.innerHTML = '<div style="padding:16px;color:var(--fg-muted);font-size:12px;">Terminal requires Electron runtime</div>';
      return;
    }

    let receivedFirstOutput = false;
    const pendingCwd = { value: null as string | null, count: 0 };

    const xterm = new XTerm({
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
      fontSize: settings.fontSize,
      theme: buildXtermTheme(theme),
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: false,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(new WebLinksAddon());
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

    const removeDataListener = window.api.onTerminalData((termId, data) => {
      if (termId === sessionIdRef.current) {
        if (!receivedFirstOutput) receivedFirstOutput = true;
        xterm.write(data);
      }
    });

    const removeExitListener = window.api.onTerminalExit((termId, exitCode) => {
      if (termId === sessionIdRef.current) {
        xterm.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
      }
    });

    xterm.onData((data) => {
      window.api.writeTerminal(sessionIdRef.current, data);
    });

    let lastReportedCwd: string | null = null;

    const cwdPoll = setInterval(async () => {
      if (!sessionIdRef.current || !receivedFirstOutput) return;
      try {
        const newCwd = await window.api.getTerminalCwd(sessionIdRef.current);
        if (!newCwd) return;
        if (newCwd === pendingCwd.value) {
          pendingCwd.count++;
          if (pendingCwd.count === 2 && newCwd !== lastReportedCwd) {
            lastReportedCwd = newCwd;
            onCwdChangeRef.current(sessionIdRef.current, newCwd);
          }
        } else {
          pendingCwd.value = newCwd;
          pendingCwd.count = 1;
        }
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

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = settings.fontSize;
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore
      }
    }
  }, [settings.fontSize]);

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
          xtermRef.current.focus();
        }
      } catch {
        // ignore
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [isActive]);

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
      className="terminal-instance"
      style={{ display: isActive ? 'flex' : 'none', flex: 1, height: '100%' }}
    >
      <div className="panel-body terminal-body" ref={termRef} />
    </div>
  );
});
