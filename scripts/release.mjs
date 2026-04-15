import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const envFile = readFileSync(resolve(root, '.env'), 'utf-8');
function envVar(name) {
  const line = envFile.split('\n').find((l) => l.startsWith(`${name}=`));
  return line?.split('=').slice(1).join('=').trim() || '';
}

const GITLAB_TOKEN = envVar('GITLAB_KRAFT_TOKEN');
const GITLAB_HOST = envVar('GITLAB_HOST') || 'https://gitlab.example.com';
const GITLAB_PROJECT_PATH = envVar('GITLAB_PROJECT_PATH') || 'sag1v/kraft';
const PROJECT_NUM_ID = envVar('GITLAB_PROJECT_NUM_ID');

if (!GITLAB_TOKEN) {
  console.error('GITLAB_KRAFT_TOKEN is required in .env');
  process.exit(1);
}

const PROJECT_ID = encodeURIComponent(GITLAB_PROJECT_PATH);
const API = `${GITLAB_HOST}/api/v4`;
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const VERSION = pkg.version;
const TAG = `v${VERSION}`;

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'PRIVATE-TOKEN': GITLAB_TOKEN,
      ...options.headers,
    },
  });
  return res;
}

async function releaseExists() {
  const res = await api(`/projects/${PROJECT_ID}/releases/${TAG}`);
  return res.ok;
}

async function createRelease() {
  const res = await api(`/projects/${PROJECT_ID}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: TAG,
      name: `Kraft ${TAG}`,
      description: `Release ${TAG}`,
      ref: 'dev',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create release: ${res.status} ${body}`);
  }
  console.log(`Created release ${TAG}`);
  return res.json();
}

async function uploadPackage(filePath, packageVersion) {
  const fileName = basename(filePath);
  const sizeMB = (statSync(filePath).size / 1024 / 1024).toFixed(1);

  const uploadUrl = `${GITLAB_HOST}/api/v4/projects/${PROJECT_NUM_ID}/packages/generic/kraft/${packageVersion}/${encodeURIComponent(fileName)}`;
  console.log(`Uploading ${fileName} (${sizeMB} MB) to packages/generic/kraft/${packageVersion}/...`);

  execSync(
    `curl --retry 3 --retry-delay 5 --retry-connrefused -fS \
      -X PUT \
      -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
      -H "Content-Type: application/octet-stream" \
      --upload-file "${filePath}" \
      "${uploadUrl}"`,
    { stdio: 'inherit' }
  );

  const downloadUrl = `${GITLAB_HOST}/api/v4/projects/${PROJECT_NUM_ID}/packages/generic/kraft/${packageVersion}/${encodeURIComponent(fileName)}`;
  console.log(`Uploaded ${fileName}`);
  return downloadUrl;
}

async function linkAssetToRelease(name, url) {
  const res = await api(`/projects/${PROJECT_ID}/releases/${TAG}/assets/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, url, link_type: 'package' }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn(`Warning: failed to link ${name} to release: ${res.status} ${body}`);
  }
}

function generateLatestMacYml(zipPath, dmgPath) {
  const zipBuffer = readFileSync(zipPath);
  const zipSha512 = createHash('sha512').update(zipBuffer).digest('base64');
  const zipSize = statSync(zipPath).size;
  const zipFileName = basename(zipPath);
  const zipUrl = `${GITLAB_HOST}/api/v4/projects/${PROJECT_NUM_ID}/packages/generic/kraft/${VERSION}/${encodeURIComponent(zipFileName)}`;

  const dmgBuffer = readFileSync(dmgPath);
  const dmgSha512 = createHash('sha512').update(dmgBuffer).digest('base64');
  const dmgSize = statSync(dmgPath).size;
  const dmgFileName = basename(dmgPath);
  const dmgUrl = `${GITLAB_HOST}/api/v4/projects/${PROJECT_NUM_ID}/packages/generic/kraft/${VERSION}/${encodeURIComponent(dmgFileName)}`;

  return [
    `version: ${VERSION}`,
    `files:`,
    `  - url: ${zipUrl}`,
    `    sha512: ${zipSha512}`,
    `    size: ${zipSize}`,
    `  - url: ${dmgUrl}`,
    `    sha512: ${dmgSha512}`,
    `    size: ${dmgSize}`,
    `path: ${zipUrl}`,
    `sha512: ${zipSha512}`,
    `releaseDate: ${new Date().toISOString()}`,
  ].join('\n');
}

async function uploadLatestYml(ymlContent) {
  // Upload to stable "latest" path so electron-updater always checks the same URL
  const uploadUrl = `${GITLAB_HOST}/api/v4/projects/${PROJECT_NUM_ID}/packages/generic/kraft/latest/latest-mac.yml`;
  console.log('Uploading latest-mac.yml to packages/generic/kraft/latest/...');

  execSync(
    `curl --retry 3 --retry-delay 5 --retry-connrefused -fS \
      -X PUT \
      -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @- \
      "${uploadUrl}"`,
    { input: ymlContent, stdio: ['pipe', 'inherit', 'inherit'] }
  );

  const downloadUrl = `${GITLAB_HOST}/api/v4/projects/${PROJECT_NUM_ID}/packages/generic/kraft/latest/latest-mac.yml`;
  console.log('Uploaded latest-mac.yml');
  return downloadUrl;
}

async function main() {
  console.log(`\nKraft Release Script`);
  console.log(`Version: ${VERSION}`);
  console.log(`Tag: ${TAG}`);
  console.log(`Project: ${GITLAB_PROJECT_PATH}\n`);

  if (await releaseExists()) {
    console.error(`Release ${TAG} already exists. Bump the version in package.json first.`);
    process.exit(1);
  }

  const keychainPath = resolve(process.env.HOME, 'Library/Keychains/kraft-build.keychain-db');
  try {
    console.log('Unlocked build keychain');
  } catch {
    console.warn('Warning: could not unlock kraft-build keychain (may not exist)');
  }

  const skipBuild = process.argv.includes('--skip-build');
  if (!skipBuild) {
    console.log('Building app...');
    execSync('npm run dist', {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        CSC_KEYCHAIN: keychainPath,
      },
    });
    console.log('Build complete\n');
  }

  const distDir = resolve(root, 'dist-release');
  const files = readdirSync(distDir).filter(
    (f) => (f.endsWith('.zip') || f.endsWith('.dmg')) && f.includes(VERSION)
  );

  if (files.length === 0) {
    console.error('No .zip or .dmg files found in dist-release/');
    process.exit(1);
  }

  console.log('Artifacts found:');
  files.forEach((f) => console.log(`  ${f}`));
  console.log();

  await createRelease();

  let zipPath = '';
  let dmgPath = '';
  for (const file of files) {
    const filePath = resolve(distDir, file);
    const url = await uploadPackage(filePath, VERSION);
    await linkAssetToRelease(file, url);
    if (file.endsWith('.zip')) zipPath = filePath;
    if (file.endsWith('.dmg')) dmgPath = filePath;
  }

  if (zipPath && dmgPath) {
    const ymlContent = generateLatestMacYml(zipPath, dmgPath);
    console.log('\nlatest-mac.yml content:');
    console.log(ymlContent);
    console.log();

    const ymlUrl = await uploadLatestYml(ymlContent);
    await linkAssetToRelease('latest-mac.yml', ymlUrl);
  }

  console.log(`\nRelease ${TAG} published successfully!`);
  console.log(`View at: ${GITLAB_HOST}/${GITLAB_PROJECT_PATH}/-/releases/${TAG}`);
}

main().catch((err) => {
  console.error('Release failed:', err.message);
  process.exit(1);
});
