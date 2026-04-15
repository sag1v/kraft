import React, { useEffect } from 'react';
import { useUIContext } from '../context/AppContext';

const AUTO_DISMISS_MS = 8000;
const PREVIEW_LINES = 4;

export function GitErrorToast() {
  const { gitError, clearGitError, setGitErrorViewContent, setPanelVisibility } = useUIContext();

  useEffect(() => {
    if (!gitError) return;
    const t = setTimeout(clearGitError, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [gitError, clearGitError]);

  if (!gitError) return null;

  const lines = gitError.split('\n');
  const preview = lines.slice(0, PREVIEW_LINES).join('\n');
  const hasMore = lines.length > PREVIEW_LINES;

  const handleExpand = () => {
    setGitErrorViewContent(gitError);
    setPanelVisibility('editor', true);
    clearGitError();
  };

  return (
    <div className="git-error-toast" role="alert" onClick={handleExpand} title="Click to view full output">
      <span className="git-error-toast-icon">⚠</span>
      <div className="git-error-toast-content">
        <span className="git-error-toast-msg">{preview}</span>
        {hasMore && <span className="git-error-toast-more">Click to view full output →</span>}
      </div>
      <button
        className="git-error-toast-close"
        onClick={(e) => { e.stopPropagation(); clearGitError(); }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
