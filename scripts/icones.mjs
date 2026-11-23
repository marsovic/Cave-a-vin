// Icônes illustrées (style « emoji à dégradés ») : ajustement exact aux deux formats livrés.
//
//   icones/source/<nom>.svg   dessin libre dans un repère 100 × 100 (sans fond, sans filtre)
//   icones/16/<nom>.svg       dessin de 15 px centré dans un carré de 16 px
//   icones/15/<nom>.svg       dessin de 13 px centré dans un carré de 15 px
//
// Usage :
//   node scripts/icones.mjs build                  → régénère icones/16, icones/15 et icones/apercu.png
//   node scripts/icones.mjs apercu <nom> <png>     → planche d'aperçu d'une seule icône (travail en cours)
//
// La boîte réellement peinte de chaque source est mesurée dans Chromium (Playwright), puis le dessin est
// mis à l'échelle pour que sa plus grande dimension fasse exactement 15 px (ou 13 px), centré.
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'icones');
const SOURCE = join(root, 'source');
/** Formats livrés : dessin de `art` px dans un carré de `box` px. */
const FORMATS = [
  { box: 16, art: 15 },
  { box: 15, art: 13 },
];

const round = (n) => Number(n.toFixed(4));
const dataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Contenu du <svg> source, identifiants préfixés pour rester uniques une fois plusieurs icônes dans la même page. */
function inner(source, prefix) {
  const body = source
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
  return body
    .replace(/\bid="([^"]+)"/g, `id="${prefix}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}$1"`);
}

/** Boîte peinte d'un SVG carré de côté `size` (unités du SVG), mesurée sur un rendu de `pixels` px de côté. */
async function paintedBox(page, svg, size, pixels) {
  return page.evaluate(
    async ({ url, size, pixels }) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = pixels;
      canvas.height = pixels;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, pixels, pixels);
      const { data } = ctx.getImageData(0, 0, pixels, pixels);
      let x0 = pixels;
      let y0 = pixels;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < pixels; y++) {
        for (let x = 0; x < pixels; x++) {
          // Seuil : un bord anticrénelé à peine visible ne compte pas.
          if (data[(y * pixels + x) * 4 + 3] >= 32) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) return null;
      const k = size / pixels;
      return { x: x0 * k, y: y0 * k, w: (x1 + 1 - x0) * k, h: (y1 + 1 - y0) * k };
    },
    { url: dataUrl(svg), size, pixels },
  );
}

/** SVG final : le dessin source mis à l'échelle et centré dans le carré du format. */
function fitted(source, name, box, format) {
  const scale = format.art / Math.max(box.w, box.h);
  const tx = (format.box - box.w * scale) / 2 - box.x * scale;
  const ty = (format.box - box.h * scale) / 2 - box.y * scale;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${format.box}" height="${format.box}" viewBox="0 0 ${format.box} ${format.box}">\n` +
    `<g transform="translate(${round(tx)} ${round(ty)}) scale(${round(scale)})">\n${inner(source, `${name}-${format.box}-`)}\n</g>\n</svg>\n`
  );
}

async function fitAll(page, name) {
  const source = await readFile(join(SOURCE, `${name}.svg`), 'utf8');
  const box = await paintedBox(page, source, 100, 2000);
  if (!box) throw new Error(`${name} : la source ne peint rien.`);
  return FORMATS.map((format) => ({ format, svg: fitted(source, name, box, format) }));
}

/** Planche : chaque icône en taille réelle, en pixels agrandis (ce que l'écran affiche vraiment) et en vectoriel agrandi. */
function sheet(icons) {
  const backgrounds = [
    ['#ffffff', '#222'],
    ['#f5eee8', '#222'],
    ['#1e1418', '#eee'],
  ];
  const rows = icons
    .map(({ name, variants }) => {
      const cells = backgrounds
        .map(([bg, fg]) => {
          const parts = variants
            .map(({ format, svg }) => {
              const url = dataUrl(svg);
              const s = format.box;
              return (
                `<figure><img src="${url}" width="${s}" height="${s}"><figcaption>${format.art}/${s} ×1</figcaption></figure>` +
                `<figure><canvas data-src="${url}" data-size="${s}" data-zoom="1" style="width:${s * 8}px;height:${s * 8}px"></canvas><figcaption>pixels ×8</figcaption></figure>` +
                `<figure><canvas data-src="${url}" data-size="${s}" data-zoom="2" style="width:${s * 8}px;height:${s * 8}px"></canvas><figcaption>pixels écran 2× (×4)</figcaption></figure>` +
                `<figure><img src="${url}" width="${s * 14}" height="${s * 14}" class="frame"><figcaption>vectoriel ×14 (cadre = carré de ${s})</figcaption></figure>`
              );
            })
            .join('');
          return `<div class="cell" style="background:${bg};color:${fg}">${parts}</div>`;
        })
        .join('');
      return `<section><h2>${name}</h2>${cells}</section>`;
    })
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:12px;font:11px/1.3 system-ui,sans-serif;background:#888;width:max-content}
    h2{margin:10px 0 4px;font-size:13px;color:#fff}
    .cell{display:flex;gap:14px;align-items:flex-end;padding:10px;margin-bottom:4px}
    figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px}
    figcaption{opacity:.7;white-space:nowrap}
    canvas{image-rendering:pixelated}
    .frame{outline:1px dashed rgba(128,128,128,.6)}
  </style>${rows}`;
}

/** Planche compacte de toutes les icônes : tailles réelles sur trois fonds, pixels agrandis, vectoriel agrandi. */
function overview(icons) {
  const backgrounds = ['#ffffff', '#f5eee8', '#1e1418'];
  const rows = icons
    .map(({ name, variants }) => {
      const real = variants
        .map(({ format, svg }) =>
          backgrounds
            .map((bg) => `<span class="real" style="background:${bg}"><img src="${dataUrl(svg)}" width="${format.box}" height="${format.box}"></span>`)
            .join(''),
        )
        .join('<i></i>');
      const pixels = variants
        .map(({ format, svg }) => `<canvas data-src="${dataUrl(svg)}" data-size="${format.box}" data-zoom="1" style="width:${format.box * 6}px;height:${format.box * 6}px"></canvas>`)
        .join('');
      const big = variants[0];
      const vector = ['#ffffff', '#1e1418']
        .map((bg) => `<span class="big" style="background:${bg}"><img src="${dataUrl(big.svg)}" width="${big.format.box * 8}" height="${big.format.box * 8}"></span>`)
        .join('');
      return `<tr><th>${name}</th><td>${real}</td><td class="px">${pixels}</td><td>${vector}</td></tr>`;
    })
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:14px;font:12px/1.3 system-ui,sans-serif;background:#d9d4cf;width:max-content}
    table{border-collapse:collapse} th{text-align:left;padding-right:14px;font-weight:600}
    thead th{font-weight:400;opacity:.7;padding-bottom:6px} td{padding:5px 14px 5px 0;vertical-align:middle}
    .real{display:inline-flex;padding:8px;margin-right:2px} i{display:inline-block;width:12px}
    .px canvas{image-rendering:pixelated;background:#fff;margin-right:6px;vertical-align:middle}
    .big{display:inline-flex;padding:6px;margin-right:6px}
  </style><table><thead><tr><th></th><th>taille réelle : 15 dans 16, puis 13 dans 15</th><th>pixels ×6 (16 puis 15)</th><th>agrandi ×8</th></tr></thead>${rows}</table>`;
}

async function renderSheet(page, icons, out, html = sheet(icons)) {
  await page.setContent(html);
  await page.evaluate(async () => {
    for (const canvas of document.querySelectorAll('canvas')) {
      const size = Number(canvas.dataset.size) * Number(canvas.dataset.zoom);
      const img = new Image();
      img.src = canvas.dataset.src;
      await img.decode();
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
    }
    await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
  });
  await mkdir(dirname(out), { recursive: true });
  await page.locator('body').screenshot({ path: out });
}

async function sourceNames() {
  return (await readdir(SOURCE))
    .filter((file) => file.endsWith('.svg'))
    .map((file) => file.slice(0, -4))
    .sort();
}

const [command, ...rest] = process.argv.slice(2);
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
  if (command === 'apercu') {
    const [name, out] = rest;
    if (!name || !out) throw new Error('Usage : node scripts/icones.mjs apercu <nom> <fichier.png>');
    const variants = await fitAll(page, name);
    await renderSheet(page, [{ name, variants }], out);
    console.log(`Aperçu de « ${name} » : ${out}`);
  } else if (command === 'build') {
    const icons = [];
    for (const name of await sourceNames()) {
      const variants = await fitAll(page, name);
      for (const { format, svg } of variants) {
        const dir = join(root, String(format.box));
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${name}.svg`), svg);
        // Contrôle sur le fichier final : dimensions réellement peintes et marges.
        const box = await paintedBox(page, svg, format.box, format.box * 100);
        console.log(
          `${String(format.art).padStart(2)}/${format.box}  ${name.padEnd(20)} ${box.w.toFixed(2)} × ${box.h.toFixed(2)} px  ` +
            `marges g ${box.x.toFixed(2)} h ${box.y.toFixed(2)} d ${(format.box - box.x - box.w).toFixed(2)} b ${(format.box - box.y - box.h).toFixed(2)}  ` +
            `${Buffer.byteLength(svg)} octets`,
        );
      }
      icons.push({ name, variants });
    }
    await renderSheet(page, icons, join(root, 'apercu.png'), overview(icons));
    console.log(`${icons.length} icône(s) ; planche : icones/apercu.png`);
  } else {
    throw new Error('Commande inconnue : build | apercu <nom> <fichier.png>');
  }
} finally {
  await browser.close();
}
