import React, { useState, useEffect, useCallback } from 'react';
import type { UpdateInfo, DownloadProgress } from '../types';
import { useUIContext } from '../context/AppContext';

declare const __APP_VERSION__: string;

type UpdateState = 'available' | 'downloading' | 'ready' | 'error';

export function UpdateNotification() {
  const { setGitErrorViewContent, setErrorViewTitle, setPanelVisibility } = useUIContext();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [state, setState] = useState<UpdateState>('available');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [visible, setVisible] = useState(false);
  const [downloadedFilePath, setDownloadedFilePath] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      window.api?.onUpdateAvailable?.((info) => {
        setUpdateInfo(info);
        setState('available');
        setVisible(true);
      })
    );

    unsubs.push(
      window.api?.onUpdateDownloadProgress?.((p) => {
        setProgress(p);
      })
    );

    unsubs.push(
      window.api?.onUpdateDownloaded?.((_info, filePath) => {
        setDownloadedFilePath(filePath);
        setState('ready');
      })
    );

    unsubs.push(
      window.api?.onUpdateError?.((err) => {
        setErrorMsg(err);
        setState('error');
      })
    );

    return () => unsubs.forEach((fn) => fn?.());
  }, []);

  const handleDownload = useCallback(() => {
    setState('downloading');
    setProgress(null);
    window.api?.downloadUpdate?.();
  }, []);

  const handleShowInFinder = useCallback(() => {
    if (downloadedFilePath) {
      window.api?.showItemInFolder?.(downloadedFilePath);
    }
  }, [downloadedFilePath]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
  }, []);

  const handleRetry = useCallback(() => {
    setState('downloading');
    setProgress(null);
    setErrorMsg(null);
    window.api?.downloadUpdate?.();
  }, []);

  const handleViewError = useCallback(() => {
    if (!errorMsg) return;
    setErrorViewTitle('Update Error');
    setGitErrorViewContent(errorMsg);
    setPanelVisibility('editor', true);
  }, [errorMsg, setErrorViewTitle, setGitErrorViewContent, setPanelVisibility]);

  if (!visible || !updateInfo) return null;

  const currentVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

  return (
    <div className="update-notification">
      <div className="update-notification-content">
        <div className="update-notification-icon">{'\u2191'}</div>
        <div className="update-notification-text">
          <span className="update-notification-title">
            {state === 'ready'
              ? 'Update downloaded'
              : state === 'error'
                ? 'Update failed'
                : `Kraft ${updateInfo.releaseName} is available`}
          </span>
          <span className="update-notification-version">
            v{currentVersion} {'\u2192'} v{updateInfo.version}
          </span>
          {state === 'ready' && (
            <span className="update-notification-hint">
              Quit Kraft, open the DMG and drag to Applications
            </span>
          )}
          {state === 'error' && (
            <span
              className="update-notification-hint update-notification-hint-link"
              onClick={handleViewError}
            >
              View error details →
            </span>
          )}
        </div>

        {state === 'downloading' && (
          <div className="update-notification-progress">
            <div className="update-notification-progress-bar">
              <div
                className="update-notification-progress-fill"
                style={{ width: `${progress?.percent ?? 0}%` }}
              />
            </div>
            <span className="update-notification-progress-text">
              {Math.round(progress?.percent ?? 0)}%
            </span>
          </div>
        )}

        <div className="update-notification-actions">
          {state === 'available' && (
            <>
              <button
                className="update-notification-btn update-notification-btn-primary"
                onClick={handleDownload}
              >
                Update
              </button>
              <button
                className="update-notification-btn update-notification-btn-dismiss"
                onClick={handleDismiss}
              >
                Later
              </button>
            </>
          )}
          {state === 'downloading' && (
            <button
              className="update-notification-btn update-notification-btn-dismiss"
              onClick={handleDismiss}
            >
              Hide
            </button>
          )}
          {state === 'ready' && (
            <>
              <button
                className="update-notification-btn update-notification-btn-primary"
                onClick={handleShowInFinder}
              >
                Show in Finder
              </button>
              <button
                className="update-notification-btn update-notification-btn-dismiss"
                onClick={handleDismiss}
              >
                Later
              </button>
            </>
          )}
          {state === 'error' && (
            <>
              <button
                className="update-notification-btn update-notification-btn-primary"
                onClick={handleRetry}
              >
                Retry
              </button>
              <button
                className="update-notification-btn update-notification-btn-dismiss"
                onClick={handleDismiss}
              >
                Dismiss
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
