# Kraft

A terminal-first developer IDE built with Electron, React, and xterm.js. Kraft puts the terminal at the center of the development workflow, with an integrated file explorer, code viewer, and customizable panel layout.

## Features

### Terminal
- Multiple terminal sessions with tabbed interface
- Middle-click to close tabs, right-click context menu (Close / Close Others)
- Keyboard shortcuts: `Ctrl+Shift+T` (new tab), `Ctrl+Shift+W` (close tab), `Ctrl+Tab` (switch tabs)
- Configurable shell (zsh, bash, fish, or system default)
- GPU-accelerated rendering via WebGL

### File Explorer
- Live file tree that updates automatically when files change on disk
- Collapse all folders with a single click
- Syncs with the active terminal session's working directory
- Per-session tree caching for instant tab switching

### Code Viewer
- Syntax highlighting powered by highlight.js
- Relative path display with full path tooltip
- Horizontal and vertical scrolling with hover-visible scrollbars

### Command Palette
- `Cmd+P` - Quick file search (respects `.gitignore` via `git ls-files`)
- `Cmd+Shift+P` - Command search with keyboard shortcut badges
- File results show icons, filenames, and relative paths
- Breadth-first file ordering (closest to root first)

### Layout
- Drag-and-drop panel rearrangement with full-span drop indicators
- Predefined layouts: Standard, Split, Stacked, Terminal Focus, Editor Focus
- Custom "My Layout" that persists across sessions
- Resizable panels with drag handles
- Minimize and restore panels
- Minimum drag distance threshold to prevent accidental layout changes

### Themes
- Kraft Dark (default) - JetBrains-inspired dark theme with vivid text
- Tokyo Night
- Gruvbox Dark
- Rose Pine Dawn

### Other
- `Cmd+Shift+R` - Reload window
- `Cmd+Alt+I` - Toggle developer tools
- `Cmd+,` - Open settings
- Themed tooltips throughout the UI
- Settings persist across sessions (theme, shell, layout, font size)

## AI Agent

The AI agent feature is not yet implemented. The terminal includes an agent mode indicator (`? for agent mode`) as a placeholder for future integration, but the agent functionality is currently not available.

## Development

### Prerequisites

- Node.js (managed via nvm)
- npm

### Setup

```bash
npm install
```

### Run in development

```bash
npm run dev
```

This starts both the Vite dev server (for hot-reloading the renderer) and the Electron main process.

### Build

```bash
npm run build
```

## Tech Stack

- **Electron** - Desktop application framework
- **React 18** - UI rendering
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **xterm.js** - Terminal emulation with WebGL addon
- **node-pty** - Native terminal process management
- **highlight.js** - Syntax highlighting
- **react-icons** - File type icons
- **esbuild** - Electron main process bundling
