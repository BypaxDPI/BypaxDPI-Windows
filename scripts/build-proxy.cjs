#!/usr/bin/env node
/**
 * Build SpoofDPI 1.2.1 (bypax-proxy) for the current platform.
 * Requires Go in PATH.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const platform = process.platform;
const isWindows = platform === 'win32';

const root = path.resolve(__dirname, '..');
const spoofDpiDir = path.join(root, 'SpoofDPI-1.2.1', 'spoofdpi-1.2.1');
const outName = isWindows ? 'bypax-proxy.exe' : 'bypax-proxy';
const outExe = path.join(root, 'spoofdpi', outName);

if (!fs.existsSync(path.join(spoofDpiDir, 'go.mod'))) {
  console.error('SpoofDPI-1.2.1 source not found at', spoofDpiDir);
  process.exit(1);
}

const spoofdpiDir = path.join(root, 'spoofdpi');
if (!fs.existsSync(spoofdpiDir)) {
  fs.mkdirSync(spoofdpiDir, { recursive: true });
}

const env = { ...process.env };
if (!isWindows) {
  env.GOOS = platform === 'darwin' ? 'darwin' : 'linux';
  env.GOARCH = process.arch === 'arm64' ? 'arm64' : 'amd64';
}

console.log(`Building SpoofDPI (bypax-proxy) for ${env.GOOS || 'windows'}/${env.GOARCH || 'amd64'}...`);
const go = spawnSync('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', outExe, './cmd/spoofdpi'], {
  cwd: spoofDpiDir,
  stdio: 'inherit',
  shell: false,
  env,
});

if (go.status !== 0) {
  console.error('go build failed');
  process.exit(go.status || 1);
}

console.log('Build OK:', outExe);
console.log('Copying to src-tauri/binaries/...');
const copy = spawnSync('node', [path.join(__dirname, 'copy-proxy.cjs')], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(copy.status || 0);
