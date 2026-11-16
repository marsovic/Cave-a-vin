// Génère les icônes PNG de l'application à partir des SVG de public/icons/.
// Usage : npm run icons   (nécessite Playwright + Chromium, voir ci-dessous)
import { createRequire } from 'node:module';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'icons');

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    try {
      // Installation globale (npm i -g playwright).
      const require = createRequire(import.meta.url);
      const globalRoot = process.env.NODE_PATH?.split(':')[0] ?? '/opt/node22/lib/node_modules';
      return require(join(globalRoot, 'playwright')).chromium;
    } catch {
      console.error('Playwright est introuvable. Installez-le : npm i -D playwright && npx playwright install chromium');
      process.exit(1);
    }
  }
}

const TARGETS = [
  { file: 'icon-16.png', svg: 'favicon.svg', size: 16, transparent: true },
  { file: 'icon-32.png', svg: 'favicon.svg', size: 32, transparent: true },
  { file: 'icon-48.png', svg: 'icon.svg', size: 48, transparent: true },
  { file: 'icon-64.png', svg: 'icon.svg', size: 64, transparent: true },
  { file: 'icon-192.png', svg: 'icon.svg', size: 192, transparent: true },
  { file: 'icon-512.png', svg: 'icon.svg', size: 512, transparent: true },
  // iOS arrondit lui-même l'icône : fond plein, bord à bord.
  { file: 'icon-180.png', svg: 'icon-maskable.svg', size: 180, transparent: false, scale: 1.18 },
  { file: 'icon-maskable-192.png', svg: 'icon-maskable.svg', size: 192, transparent: false },
  { file: 'icon-maskable-512.png', svg: 'icon-maskable.svg', size: 512, transparent: false },
];

const chromium = await loadChromium();
const browser = await chromium.launch();
try {
  for (const t of TARGETS) {
    const svg = await readFile(join(dir, t.svg), 'utf8');
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
    const scale = t.scale ?? 1;
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:${t.transparent ? 'transparent' : '#5b1a2b'};overflow:hidden}
       svg{display:block;width:${t.size}px;height:${t.size}px;transform:scale(${scale})}</style>${svg}`,
    );
    const png = await page.screenshot({ omitBackground: t.transparent, type: 'png' });
    await writeFile(join(dir, t.file), png);
    await page.close();
    console.log(`${t.file} (${t.size}×${t.size})`);
  }
} finally {
  await browser.close();
}
await copyFile(join(dir, 'icon-180.png'), join(root, 'public', 'apple-touch-icon.png'));
console.log('apple-touch-icon.png');
