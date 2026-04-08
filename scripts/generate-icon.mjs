/**
 * Generates a static app icon (assets/icon.png) by rendering the "K" glyph
 * from the Good Timing font on an Electron offscreen BrowserWindow.
 *
 * Usage: npx electron scripts/generate-icon.mjs
 */
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fontPath = path.join(root, 'src', 'fonts', 'good-timing-bd.otf');
const outPath = path.join(root, 'assets', 'icon.png');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const size = 1024;
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });

  const fontData = fs.readFileSync(fontPath).toString('base64');

  const html = `
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; }
        html, body { background: transparent !important; }
        body { width: ${size}px; height: ${size}px; overflow: hidden; }
        canvas { display: block; }
      </style>
    </head>
    <body>
      <canvas id="c" width="${size}" height="${size}"></canvas>
      <script>
        (async () => {
          const fontFace = new FontFace(
            'Good Timing',
            'url(data:font/opentype;base64,${fontData})',
            { weight: '700' }
          );
          const loaded = await fontFace.load();
          document.fonts.add(loaded);

          const canvas = document.getElementById('c');
          const ctx = canvas.getContext('2d');
          const s = ${size};
          const pad = s * 0.1;
          const icon = s - pad * 2;
          const r = icon * 0.18;

          ctx.clearRect(0, 0, s, s);

          ctx.beginPath();
          ctx.roundRect(pad, pad, icon, icon, r);
          ctx.fillStyle = '#2b2d30';
          ctx.fill();

          ctx.fillStyle = '#73e07a';
          ctx.font = '700 ${Math.round(size * 0.44)}px "Good Timing"';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('K_', s / 2, s * 0.52);

          document.title = 'done';
        })();
      </script>
    </body>
    </html>
  `;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (win.getTitle() === 'done') {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  await new Promise((r) => setTimeout(r, 300));

  const image = await win.capturePage();
  const png = image.toPNG();
  fs.writeFileSync(outPath, png);
  console.log(`Icon saved to ${outPath} (${png.length} bytes)`);

  app.quit();
});
