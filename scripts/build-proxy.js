#!/usr/bin/env node
/**
 * Build SpoofDPI 1.2.1 (bypax-proxy) and copy to spoofdpi/ and src-tauri/binaries/.
 * Requires Go in PATH.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const spoofDpiDir = path.join(root, 'SpoofDPI-1.2.1', 'SpoofDPI-1.2.1');
const outExe = path.join(root, 'spoofdpi', 'bypax-proxy.exe');

if (!fs.existsSync(path.join(spoofDpiDir, 'go.mod'))) {
  console.error('SpoofDPI-1.2.1 source not found at', spoofDpiDir);
  process.exit(1);
}

const spoofdpiDir = path.join(root, 'spoofdpi');
if (!fs.existsSync(spoofdpiDir)) {
  fs.mkdirSync(spoofdpiDir, { recursive: true });
}

console.log('Building SpoofDPI (bypax-proxy)...');
const go = spawnSync('go', ['build', '-o', outExe, './cmd/spoofdpi'], {
  cwd: spoofDpiDir,
  stdio: 'inherit',
  shell: true,
});

if (go.status !== 0) {
  console.error('go build failed');
  process.exit(go.status || 1);
}

console.log('Build OK:', outExe);
console.log('Copying to src-tauri/binaries/...');
const copy = spawnSync('node', [path.join(__dirname, 'copy-proxy.js')], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(copy.status || 0);
