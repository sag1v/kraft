import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const envPath = resolve(root, '.env');
const envFile = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';

function envVar(name) {
  if (process.env[name]) return process.env[name];
  const line = envFile.split('\n').find((l) => l.startsWith(`${name}=`));
  return line?.split('=').slice(1).join('=').trim() || '';
}

function resolveGitHubToken() {
  const fromEnv = envVar('GITHUB_KRAFT_TOKEN') || envVar('GH_TOKEN') || envVar('GITHUB_TOKEN');
  if (fromEnv) return fromEnv;
  try {
    const ghUser = envVar('GITHUB_USER') || 'sag1v';
    return execSync(`gh auth token --user ${ghUser}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const GITHUB_TOKEN = resolveGitHubToken();
const GITHUB_REPO = envVar('GITHUB_REPO') || 'sag1v/kraft';
const TARGET_BRANCH = envVar('GITHUB_RELEASE_BRANCH') || 'main';
const API = 'https://api.github.com';

if (!GITHUB_TOKEN) {
  console.error('GitHub token not found. Set GITHUB_KRAFT_TOKEN in .env or authenticate gh CLI as sag1v.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const VERSION = pkg.version;
const TAG = `v${VERSION}`;

async function api(path, options = {}) {
  return fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Kraft-Release-Script',
      ...options.headers,
    },
  });
}

async function releaseExists() {
  const res = await api(`/repos/${GITHUB_REPO}/releases/tags/${TAG}`);
  return res.ok;
}

async function createDraftRelease() {
  const res = await api(`/repos/${GITHUB_REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: TAG,
      target_commitish: TARGET_BRANCH,
      name: `Kraft ${TAG}`,
      body: `Release ${TAG}`,
      draft: true,
      prerelease: false,
      generate_release_notes: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create draft release: ${res.status} ${body}`);
  }
  const release = await res.json();
  console.log(`Created draft release ${TAG} (id: ${release.id})`);
  return release;
}

async function publishRelease(releaseId) {
  const res = await api(`/repos/${GITHUB_REPO}/releases/${releaseId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      draft: false,
      tag_name: TAG,
      target_commitish: TARGET_BRANCH,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to publish release: ${res.status} ${body}`);
  }
  return res.json();
}

function uploadAsset(uploadUrlTemplate, filePath) {
  const fileName = basename(filePath).replace(/ /g, '-');
  const sizeMB = (statSync(filePath).size / 1024 / 1024).toFixed(1);
  const baseUploadUrl = uploadUrlTemplate.replace(/\{\?name,label\}$/, '');
  const uploadUrl = `${baseUploadUrl}?name=${encodeURIComponent(fileName)}`;

  console.log(`Uploading ${fileName} (${sizeMB} MB)...`);

  execSync(
    `curl --retry 3 --retry-delay 5 --retry-connrefused -fS \
      -X POST \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"${filePath}" \
      "${uploadUrl}" > /dev/null`,
    { stdio: 'inherit' }
  );

  console.log(`Uploaded ${fileName}`);
}

function generateLatestMacYml(zipPath, dmgPath) {
  const zipBuffer = readFileSync(zipPath);
  const zipSha512 = createHash('sha512').update(zipBuffer).digest('base64');
  const zipSize = statSync(zipPath).size;
  const zipFileName = basename(zipPath).replace(/ /g, '-');

  const dmgBuffer = readFileSync(dmgPath);
  const dmgSha512 = createHash('sha512').update(dmgBuffer).digest('base64');
  const dmgSize = statSync(dmgPath).size;
  const dmgFileName = basename(dmgPath).replace(/ /g, '-');

  return [
    `version: ${VERSION}`,
    `files:`,
    `  - url: ${zipFileName}`,
    `    sha512: ${zipSha512}`,
    `    size: ${zipSize}`,
    `  - url: ${dmgFileName}`,
    `    sha512: ${dmgSha512}`,
    `    size: ${dmgSize}`,
    `path: ${zipFileName}`,
    `sha512: ${zipSha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
  ].join('\n');
}

async function main() {
  console.log(`\nKraft Release Script`);
  console.log(`Version: ${VERSION}`);
  console.log(`Tag: ${TAG}`);
  console.log(`Repository: ${GITHUB_REPO}\n`);

  if (await releaseExists()) {
    console.error(`Release ${TAG} already exists. Bump the version in package.json first.`);
    process.exit(1);
  }

  const keychainPath = envVar('KRAFT_KEYCHAIN_PATH') || resolve(process.env.HOME, 'Library/Keychains/kraft-build.keychain-db');
  const skipBuild = process.argv.includes('--skip-build');
  if (!skipBuild) {
    console.log('Building app...');
    const buildEnv = { ...process.env };
    if (existsSync(keychainPath)) {
      buildEnv.CSC_KEYCHAIN = keychainPath;
    }
    execSync('npm run dist', {
      cwd: root,
      stdio: 'inherit',
      env: buildEnv,
    });
    console.log('Build complete\n');
  }

  const distDir = resolve(root, 'dist-release');
  const artifactFiles = readdirSync(distDir).filter(
    (f) =>
      (f.endsWith('.zip') || f.endsWith('.dmg') || f.endsWith('.blockmap')) &&
      f.includes(VERSION)
  );

  const zipFile = artifactFiles.find((f) => f.endsWith('.zip'));
  const dmgFile = artifactFiles.find((f) => f.endsWith('.dmg'));

  if (!zipFile || !dmgFile) {
    console.error(`Expected .zip and .dmg files for version ${VERSION} in dist-release/`);
    process.exit(1);
  }

  const latestMacYmlPath = resolve(distDir, 'latest-mac.yml');
  const ymlContent = generateLatestMacYml(resolve(distDir, zipFile), resolve(distDir, dmgFile));
  writeFileSync(latestMacYmlPath, `${ymlContent}\n`, 'utf-8');

  const filesToUpload = [...artifactFiles.map((f) => resolve(distDir, f)), latestMacYmlPath];

  console.log('Artifacts to upload:');
  filesToUpload.forEach((f) => console.log(`  ${basename(f)}`));
  console.log();

  const draftRelease = await createDraftRelease();

  for (const filePath of filesToUpload) {
    uploadAsset(draftRelease.upload_url, filePath);
  }

  const published = await publishRelease(draftRelease.id);

  console.log(`\nRelease ${TAG} published successfully!`);
  console.log(`View at: ${published.html_url}`);
}

main().catch((err) => {
  console.error('Release failed:', err.message);
  process.exit(1);
});
