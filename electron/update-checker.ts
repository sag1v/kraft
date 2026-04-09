import { app } from 'electron';
import { autoUpdater, type UpdateInfo as ElectronUpdateInfo, type UpdateDownloadedEvent } from 'electron-updater';

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseName: string;
}

export interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

type UpdateAvailableCallback = (info: UpdateInfo) => void;
type ProgressCallback = (progress: DownloadProgress) => void;
type DownloadedCallback = (info: UpdateInfo, filePath: string) => void;
type ErrorCallback = (error: string) => void;

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 1000;

export class UpdateChecker {
  private onUpdateAvailableCb: UpdateAvailableCallback | null = null;
  private onProgressCb: ProgressCallback | null = null;
  private onDownloadedCb: DownloadedCallback | null = null;
  private onErrorCb: ErrorCallback | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private configured = false;

  constructor() {
    this.configure();
  }

  private configure() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('checking-for-update', () => {
      console.log('[UpdateChecker] Checking for update...');
    });

    autoUpdater.on('update-available', (info: ElectronUpdateInfo) => {
      console.log(`[UpdateChecker] Update available: ${info.version}`);
      this.onUpdateAvailableCb?.({
        version: info.version,
        releaseDate: info.releaseDate || new Date().toISOString(),
        releaseName: `v${info.version}`,
      });
    });

    autoUpdater.on('update-not-available', () => {
      console.log('[UpdateChecker] No update available');
    });

    autoUpdater.on('download-progress', (progress) => {
      this.onProgressCb?.({
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
      console.log(`[UpdateChecker] Update downloaded: ${info.version} at ${info.downloadedFile}`);
      this.onDownloadedCb?.({
        version: info.version,
        releaseDate: info.releaseDate || new Date().toISOString(),
        releaseName: `v${info.version}`,
      }, info.downloadedFile);
    });

    autoUpdater.on('error', (err) => {
      console.error('[UpdateChecker] Error:', err.message);
      this.onErrorCb?.(err.message);
    });

    this.configured = true;
  }

  onUpdateAvailable(cb: UpdateAvailableCallback) { this.onUpdateAvailableCb = cb; }
  onProgress(cb: ProgressCallback) { this.onProgressCb = cb; }
  onDownloaded(cb: DownloadedCallback) { this.onDownloadedCb = cb; }
  onError(cb: ErrorCallback) { this.onErrorCb = cb; }

  start() {
    if (!this.configured) return;
    setTimeout(() => this.check(), INITIAL_DELAY_MS);
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async check(): Promise<boolean> {
    if (!this.configured) return false;
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo?.version !== app.getVersion();
    } catch (err) {
      console.error('[UpdateChecker] Check failed:', err);
      return false;
    }
  }

  async downloadUpdate() {
    if (!this.configured) return;
    await autoUpdater.downloadUpdate();
  }

  installUpdate() {
    autoUpdater.quitAndInstall();
  }
}
