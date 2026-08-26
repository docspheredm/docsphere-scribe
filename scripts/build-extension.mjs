import { execSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'dist-extension');

execSync('npx vite build --config vite.extension.config.ts', { cwd: root, stdio: 'inherit' });

mkdirSync(outDir, { recursive: true });
cpSync(path.join(root, 'extension-src/manifest.json'), path.join(outDir, 'manifest.json'));
cpSync(path.join(root, 'extension-src/icons'), path.join(outDir, 'icons'), { recursive: true });

console.log(`\nExtension build ready at ${path.relative(root, outDir)}/`);
console.log('Load it via chrome://extensions -> Developer mode -> Load unpacked.');
