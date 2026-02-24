import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const { rcedit } = await import('rcedit');
    const exePath = path.join(__dirname, 'src-tauri', 'binaries', 'bypax-proxy-x86_64-pc-windows-msvc.exe');
    const iconPath = path.join(__dirname, 'src-tauri', 'icons', 'icon.ico');

    console.log(`Updating icon for ${exePath} using ${iconPath}`);

    try {
        await rcedit(exePath, {
            icon: iconPath,
            'version-string': {
                ProductName: 'BypaxDPI',
                FileDescription: 'BypaxDPI Service',
                CompanyName: 'ConsolAktif',
                LegalCopyright: 'Copyright © 2026 ConsolAktif'
            }
        });
        console.log('Icon updated successfully!');
    } catch (e) {
        console.error('Failed to update icon:', e);
    }
}

main();
