import React from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { shortenPath } from '../utils';
import { shortcutLabel } from '../shortcuts';

export function Footer() {
  const { homeDir, theme } = useUIContext();
  const { cwd, gitInfo, gitStatus, gitStagedStatus, gitRepoRoot } = useSessionContext();

  const displayPath = cwd ? shortenPath(cwd, homeDir) : '~';
  const hasLocalChanges = Object.keys(gitStatus).length > 0 || Object.keys(gitStagedStatus).length > 0;

  return (
    <div className="footer">
      <div className="footer-left">
        {gitInfo.isGitRepo && (
          <>
            {gitInfo.repoName && (
              <>
                <span className="footer-repo" style={{ color: theme.colors.accentSecondary }} data-tooltip="Repository name">
                  {gitInfo.repoName}
                </span>
                <span className="footer-separator">·</span>
              </>
            )}
            {gitInfo.branch && (
              <>
                <button
                  className="footer-branch footer-branch-btn"
                  style={{ color: theme.colors.accent }}
                  data-tooltip={gitRepoRoot ? 'Switch branch' : 'Current branch'}
                  onClick={() => gitRepoRoot && window.dispatchEvent(new CustomEvent('kraft:open-branch-switcher'))}
                >
                  ⎇ {gitInfo.branch}
                </button>
              </>
            )}
            {hasLocalChanges && (
              <span className="footer-git-dirty" style={{ color: theme.colors.accentSecondary }} data-tooltip="Uncommitted local changes">
                •
              </span>
            )}
            {gitInfo.aheadCount > 0 && (
              <span className="footer-git-ahead" style={{ color: theme.colors.accentSecondary }} data-tooltip={`${gitInfo.aheadCount} unpushed commit${gitInfo.aheadCount !== 1 ? 's' : ''}`}>
                ↑{gitInfo.aheadCount}
              </span>
            )}
            <span className="footer-separator">·</span>
          </>
        )}
        <span className="footer-path" data-tooltip="Current working directory">{displayPath}</span>
      </div>
      <div className="footer-right">
        <span className="footer-hint" data-tooltip="Open settings" data-tooltip-pos="left">{shortcutLabel('open-settings')} settings</span>
      </div>
    </div>
  );
}
