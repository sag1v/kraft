import React from 'react';
import {
  VscFolder,
  VscFolderOpened,
  VscFile,
  VscJson,
  VscMarkdown,
  VscCode,
  VscTerminalBash,
  VscGitMerge,
} from 'react-icons/vsc';
import {
  DiJavascript1,
  DiPython,
  DiRust,
  DiReact,
  DiCss3,
  DiHtml5,
  DiDocker,
} from 'react-icons/di';
import {
  BiLogoTypescript,
} from 'react-icons/bi';

interface FileIconProps {
  name: string;
  isDirectory: boolean;
  isOpen?: boolean;
}

const iconSize = 22;

const extensionIcons: Record<string, { icon: React.ReactElement; color: string }> = {
  '.js': { icon: <DiJavascript1 size={iconSize} />, color: '#e5c07b' },
  '.mjs': { icon: <DiJavascript1 size={iconSize} />, color: '#e5c07b' },
  '.cjs': { icon: <DiJavascript1 size={iconSize} />, color: '#e5c07b' },
  '.ts': { icon: <BiLogoTypescript size={iconSize} />, color: '#519aba' },
  '.tsx': { icon: <DiReact size={iconSize} />, color: '#519aba' },
  '.jsx': { icon: <DiReact size={iconSize} />, color: '#61dafb' },
  '.py': { icon: <DiPython size={iconSize} />, color: '#68a063' },
  '.rs': { icon: <DiRust size={iconSize} />, color: '#dea584' },
  '.css': { icon: <DiCss3 size={iconSize} />, color: '#a377db' },
  '.scss': { icon: <DiCss3 size={iconSize} />, color: '#cd6799' },
  '.html': { icon: <DiHtml5 size={iconSize} />, color: '#e34c26' },
  '.htm': { icon: <DiHtml5 size={iconSize} />, color: '#e34c26' },
  '.json': { icon: <VscJson size={iconSize} />, color: '#e5c07b' },
  '.md': { icon: <VscMarkdown size={iconSize} />, color: '#519aba' },
  '.mdx': { icon: <VscMarkdown size={iconSize} />, color: '#519aba' },
  '.sh': { icon: <VscTerminalBash size={iconSize} />, color: '#89e051' },
  '.bash': { icon: <VscTerminalBash size={iconSize} />, color: '#89e051' },
  '.zsh': { icon: <VscTerminalBash size={iconSize} />, color: '#89e051' },
  '.yaml': { icon: <VscCode size={iconSize} />, color: '#cb171e' },
  '.yml': { icon: <VscCode size={iconSize} />, color: '#cb171e' },
  '.toml': { icon: <VscCode size={iconSize} />, color: '#9c4221' },
};

const filenameIcons: Record<string, { icon: React.ReactElement; color: string }> = {
  'Dockerfile': { icon: <DiDocker size={iconSize} />, color: '#2496ed' },
  'dockerfile': { icon: <DiDocker size={iconSize} />, color: '#2496ed' },
  '.dockerignore': { icon: <DiDocker size={iconSize} />, color: '#2496ed' },
  '.gitignore': { icon: <VscGitMerge size={iconSize} />, color: '#e84d31' },
  '.gitattributes': { icon: <VscGitMerge size={iconSize} />, color: '#e84d31' },
  'package.json': { icon: <VscJson size={iconSize} />, color: '#68a063' },
  'tsconfig.json': { icon: <BiLogoTypescript size={iconSize} />, color: '#519aba' },
};

export function FileIcon({ name, isDirectory, isOpen }: FileIconProps) {
  if (isDirectory) {
    return (
      <span className="file-icon" style={{ color: '#e5c07b' }}>
        {isOpen ? <VscFolderOpened size={iconSize} /> : <VscFolder size={iconSize} />}
      </span>
    );
  }

  const filenameMatch = filenameIcons[name];
  if (filenameMatch) {
    return (
      <span className="file-icon" style={{ color: filenameMatch.color }}>
        {filenameMatch.icon}
      </span>
    );
  }

  const ext = '.' + name.split('.').pop()?.toLowerCase();
  const extMatch = extensionIcons[ext];
  if (extMatch) {
    return (
      <span className="file-icon" style={{ color: extMatch.color }}>
        {extMatch.icon}
      </span>
    );
  }

  return (
    <span className="file-icon" style={{ color: 'var(--fg-muted)' }}>
      <VscFile size={iconSize} />
    </span>
  );
}
