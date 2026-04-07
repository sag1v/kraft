import { spawn } from 'child_process';
import { build } from 'esbuild';
import { createServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import electron from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function buildElectron() {
  await build({
    entryPoints: [
      path.join(root, 'electron/main.ts'),
      path.join(root, 'electron/preload.ts'),
    ],
    bundle: true,
    platform: 'node',
    outdir: path.join(root, 'dist-electron'),
    external: ['electron', 'node-pty'],
    format: 'cjs',
    sourcemap: true,
    target: 'node20',
  });
}

async function main() {
  await buildElectron();
  console.log('Electron build complete.');

  const viteServer = await createServer({
    root,
    server: { port: 5173, strictPort: true },
  });
  await viteServer.listen();
  console.log('Vite dev server running on http://localhost:5173');

  const electronBin = typeof electron === 'string' ? electron : electron.toString();
  console.log('Starting Electron from:', electronBin);

  const electronProcess = spawn(electronBin, ['.'], {
    cwd: root,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: 'http://localhost:5173',
    },
    stdio: 'inherit',
  });

  electronProcess.on('error', (err) => {
    console.error('Failed to start Electron:', err);
    viteServer.close();
    process.exit(1);
  });

  electronProcess.on('close', (code) => {
    console.log('Electron exited with code:', code);
    viteServer.close();
    process.exit();
  });

  process.on('SIGINT', () => {
    electronProcess.kill();
    viteServer.close();
    process.exit();
  });
}

main().catch((err) => {
  console.error('Dev script error:', err);
  process.exit(1);
});
