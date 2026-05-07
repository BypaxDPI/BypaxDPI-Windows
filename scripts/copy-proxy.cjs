#!/usr/bin/env node
/**
 * Copy bypax-proxy binary from spoofdpi/ to src-tauri/binaries/
 * with the correct Tauri target-triple suffix for the current platform.
 * Run after building: npm run build-proxy
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const platform = process.platform;
const isWindows = platform === 'win32';

const root = path.resolve(__dirname, '..');
const destDir = path.join(root, 'src-tauri', 'binaries');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

function getRustHostTriple() {
  const result = spawnSync('rustc', ['-vV'], { encoding: 'utf8', shell: true });
  if (result.status !== 0) return null;
  const line = (result.stdout || '').split('\n').find(l => l.startsWith('host:'));
  return line ? line.split(':')[1].trim() : null;
}

if (isWindows) {
  const src = path.join(root, 'spoofdpi', 'bypax-proxy.exe');
  if (!fs.existsSync(src)) {
    console.error('spoofdpi/bypax-proxy.exe not found. Run: npm run build-proxy');
    process.exit(1);
  }
  const triple = getRustHostTriple() || 'x86_64-pc-windows-msvc';
  fs.copyFileSync(src, path.join(destDir, 'bypax-proxy.exe'));
  fs.copyFileSync(src, path.join(destDir, `bypax-proxy-${triple}.exe`));
  console.log(`Copied bypax-proxy.exe → src-tauri/binaries/ (triple: ${triple})`);
} else {
  const src = path.join(root, 'spoofdpi', 'bypax-proxy');
  if (!fs.existsSync(src)) {
    console.error('spoofdpi/bypax-proxy not found. Run: npm run build-proxy');
    process.exit(1);
  }
  const triple = getRustHostTriple() || (
    platform === 'darwin'
      ? (process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin')
      : 'x86_64-unknown-linux-gnu'
  );
  fs.copyFileSync(src, path.join(destDir, 'bypax-proxy'));
  fs.copyFileSync(src, path.join(destDir, `bypax-proxy-${triple}`));
  // Ensure execute permission
  fs.chmodSync(path.join(destDir, 'bypax-proxy'), 0o755);
  fs.chmodSync(path.join(destDir, `bypax-proxy-${triple}`), 0o755);
  console.log(`Copied bypax-proxy → src-tauri/binaries/ (triple: ${triple})`);
}
