import React from 'react';
import { useUIContext, useSessionContext } from '../context/AppContext';
import { shortenPath } from '../utils';

export function Footer() {
  const { homeDir, theme } = useUIContext();
  const { cwd, gitInfo } = useSessionContext();

  const displayPath = cwd ? shortenPath(cwd, homeDir) : '~';

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
                <span className="footer-branch" style={{ color: theme.colors.accent }} data-tooltip="Current branch">
                  ⎇ {gitInfo.branch}
                </span>
                <span className="footer-separator">·</span>
              </>
            )}
          </>
        )}
        <span className="footer-path" data-tooltip="Current working directory">{displayPath}</span>
      </div>
      <div className="footer-right">
        <span className="footer-hint" data-tooltip="Open settings" data-tooltip-pos="left">Ctrl+, settings</span>
      </div>
    </div>
  );
}
