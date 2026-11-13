# Kraft

A terminal-first developer IDE built with Electron, React, and xterm.js. Kraft puts the terminal at the center of the development workflow, with an integrated file explorer, code editor, Git controls, and customizable panel layout.

## Features

### Terminal
- Multiple terminal sessions with tabbed interface and split grid panes
- Middle-click to close tabs, right-click context menu, and tab restoration (`Cmd+Shift+T`)
- Keyboard shortcuts: `Cmd+T` (new tab), `Cmd+Shift+W` (close tab), `Ctrl+Tab` / `Ctrl+Shift+Tab` (switch tabs)
- Configurable shell (`zsh`, `bash`, `fish`, or system default) and optional `Shift+Enter` newline mode
- GPU-accelerated rendering via WebGL

### File Explorer & Git
- Live file tree that updates automatically when files change on disk
- Syncs with the active terminal session's working directory
- Create, rename, reveal in Finder, and move files or folders to Trash
- Integrated Git status indicators, diff view, staging/unstaging, commit, stash, and branch switching/creation

### Code Editor
- CodeMirror 6 editor with multi-language syntax highlighting and merge-conflict decorations
- Multi-tab editing with external file-change detection
- In-file search (`Cmd+F`) and workspace content search (`Cmd+Shift+F`)

### Command Palette & Workspaces
- `Cmd+P` - Quick file search (respects `.gitignore` via `git ls-files`)
- `Cmd+Shift+P` - Command search with keyboard shortcut badges
- Saved workspaces with macOS Dock "Open Recent" integration

### Layout & Themes
- Drag-and-drop panel rearrangement, resizing, maximizing, and minimizing
- Layout presets plus a persistent custom layout
- Built-in themes: Kraft Dark (default), One Dark, Console, DOS, Rose, and Console Light
- Settings import/export as JSON (`Cmd+,`)

## AI Agent Integration

Kraft automatically detects active Claude Code terminal sessions and syncs session context directories with the UI.

## Development

### Prerequisites

- macOS
- Node.js 22+
- npm

### Setup

```bash
npm install
```

### Run in development

```bash
npm run dev
```

Starts the Vite dev server (renderer hot reload) and the Electron main process.

### Build

```bash
# Compile Electron main/preload + renderer
npm run build

# Package macOS .dmg and .zip locally (into dist-release/)
npm run dist
```

## CI & Releases

- **CI (`.github/workflows/ci.yml`)**: Runs `npm ci` and `npm run build` on `macos-latest` for pushes and pull requests to `main`.
- **Automated Release (`.github/workflows/release.yml`)**: Pushing a `v*` tag (for example `v0.28.0`) builds macOS `.dmg` and `.zip` installers and publishes them to [GitHub Releases](https://github.com/sag1v/kraft/releases) along with `latest-mac.yml` for in-app updates via `electron-updater`. Optional repository secrets `CSC_LINK` and `CSC_KEY_PASSWORD` enable macOS code signing in CI.
- **Local Release (`npm run release`)**: Builds macOS artifacts locally and publishes them to [GitHub Releases](https://github.com/sag1v/kraft/releases) using `GITHUB_KRAFT_TOKEN` (from `.env` or environment) or an authenticated `gh` CLI session.

## Tech Stack

- **Electron** - Desktop application framework
- **electron-builder** & **electron-updater** - Packaging and GitHub Releases auto-updates
- **React 18** & **TypeScript** - UI and type safety
- **Vite** & **esbuild** - Renderer and Electron bundling
- **xterm.js** & **node-pty** - WebGL terminal emulation and PTY management
- **CodeMirror 6** & **highlight.js** - Code editing and syntax highlighting
