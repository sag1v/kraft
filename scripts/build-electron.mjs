import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

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
  minify: false,
});

console.log('Electron build complete.');
