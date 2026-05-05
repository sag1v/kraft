import { build } from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');


function loadEnvVar(name, fallback = '') {
  try {
    const envContent = fs.readFileSync(path.join(root, '.env'), 'utf-8');
    const line = envContent.split('\n').find((l) => l.startsWith(`${name}=`));
    return line?.split('=').slice(1).join('=').trim() || fallback;
  } catch {
    return fallback;
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

await build({
  entryPoints: [
    path.join(root, 'electron/main.ts'),
    path.join(root, 'electron/preload.ts'),
  ],
  bundle: true,
  platform: 'node',
  outdir: path.join(root, 'dist-electron'),
  external: ['electron', 'node-pty', 'electron-updater'],
  format: 'cjs',
  sourcemap: true,
  target: 'node20',
  minify: false,
  define: {
    '__APP_VERSION__': JSON.stringify(pkg.version),
  },
});

console.log('Electron build complete.');
