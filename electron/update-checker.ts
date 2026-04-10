import { app } from 'electron';
import { createWriteStream } from 'fs';
import { get as httpsGet } from 'https';
import { get as httpGet } from 'http';
import { join } from 'path';
import { autoUpdater, type UpdateInfo as ElectronUpdateInfo } from 'electron-updater';

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
  private pendingUpdate: { info: UpdateInfo; dmgUrl: string } | null = null;

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

      const dmgFile = info.files?.find((f) => f.url.endsWith('.dmg'));
      if (!dmgFile) {
        console.warn('[UpdateChecker] No DMG file found in update info');
        return;
      }

      const updateInfo: UpdateInfo = {
        version: info.version,
        releaseDate: info.releaseDate || new Date().toISOString(),
        releaseName: `v${info.version}`,
      };

      this.pendingUpdate = { info: updateInfo, dmgUrl: dmgFile.url };
      this.onUpdateAvailableCb?.(updateInfo);
    });

    autoUpdater.on('update-not-available', () => {
      console.log('[UpdateChecker] No update available');
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

  private fetchFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const get = url.startsWith('https') ? httpsGet : httpGet;
      get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          this.fetchFile(response.headers.location!, destPath).then(resolve).catch(reject);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }
        const total = parseInt(response.headers['content-length'] as string || '0', 10);
        let downloaded = 0;
        const file = createWriteStream(destPath);
        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          file.write(chunk);
          this.onProgressCb?.({
            percent: total > 0 ? (downloaded / total) * 100 : 0,
            bytesPerSecond: 0,
            transferred: downloaded,
            total,
          });
        });
        response.on('end', () => {
          file.end();
          file.on('finish', resolve);
        });
        response.on('error', (err) => { file.destroy(); reject(err); });
      }).on('error', reject);
    });
  }

  async downloadUpdate() {
    if (!this.configured || !this.pendingUpdate) return;
    const { info, dmgUrl } = this.pendingUpdate;
    const tempPath = join(app.getPath('temp'), `Kraft-${info.version}.dmg`);
    try {
      console.log(`[UpdateChecker] Downloading DMG from ${dmgUrl}`);
      await this.fetchFile(dmgUrl, tempPath);
      console.log(`[UpdateChecker] DMG downloaded to ${tempPath}`);
      this.onDownloadedCb?.(info, tempPath);
    } catch (err: any) {
      console.error('[UpdateChecker] Download failed:', err);
      this.onErrorCb?.(err.message);
    }
  }
}
