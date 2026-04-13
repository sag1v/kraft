import React from 'react';
import { useSessionContext } from '../context/AppContext';

export function CrashRestoreBanner() {
  const { crashSession, restoreCrashSession, dismissCrashSession } = useSessionContext();

  if (!crashSession) return null;

  const tabCount = crashSession.groups.length;
  const tabWord = tabCount === 1 ? 'tab' : 'tabs';

  return (
    <div className="crash-restore-banner">
      <span className="crash-restore-banner__icon">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"/>
          <path d="M7.25 4.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5ZM8 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" fill="currentColor"/>
        </svg>
      </span>
      <span className="crash-restore-banner__message">
        Kraft didn't close properly. Restore your previous {tabCount} {tabWord}?
      </span>
      <button className="crash-restore-banner__btn crash-restore-banner__btn--primary" onClick={restoreCrashSession}>
        Restore
      </button>
      <button className="crash-restore-banner__btn crash-restore-banner__btn--dismiss" onClick={dismissCrashSession}>
        Dismiss
      </button>
    </div>
  );
}
