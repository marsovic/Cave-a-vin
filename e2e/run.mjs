// Parcours de bout en bout de Bacchus SmartCellar dans un vrai navigateur (Chromium, via Playwright).
//
//   npm run build && npm run preview      (dans un terminal)
//   npm run e2e                           (dans un autre)
//
// Variables : BASE_URL (défaut http://localhost:4173), E2E_SHOTS=1 pour enregistrer des captures dans e2e/output.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const SHOTS = process.env.E2E_SHOTS === '1';
const OUT = join(here, 'output');

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const require = createRequire(import.meta.url);
    const root = process.env.PLAYWRIGHT_ROOT ?? '/opt/node22/lib/node_modules/playwright';
    try {
      return require(root);
    } catch {
      console.error('Playwright est introuvable : npm i -D playwright && npx playwright install chromium');
      process.exit(2);
    }
  }
}

const { chromium, devices } = await loadPlaywright();
let failures = 0;
const problems = [];

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Lit la cave enregistrée par l'application (copie de travail CSV). */
async function readCellar(page) {
  return page.evaluate(() => {
    const csv = localStorage.getItem('bacchus.cave.csv') ?? '';
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = (lines.shift() ?? '').split(';');
    const rows = lines.map((line) => {
      const cells = line.split(';');
      return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
    });
    return {
      shelves: rows.filter((r) => r.enregistrement === 'clayette'),
      bottles: rows.filter((r) => r.enregistrement === 'bouteille'),
    };
  });
}

const slot = (page, c, r) => page.locator(`.slot[data-key="${c}:${r}"]`);
const action = (page, label) =>
  page.locator('.action-bar .action').filter({
    has: page.locator('.action-label', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }),
  });
const field = (page, name) => page.locator(`.f-${name} input`);

async function shot(page, name) {
  if (!SHOTS) return;
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

async function open(browser, name, contextOptions) {
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: 'block', locale: 'fr-FR' });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${name}] console : ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${name}] exception : ${e.message}`));
  await page.goto(BASE);
  await page.waitForSelector('.app');
  return { context, page };
}

async function loadDemo(page) {
  await page.getByRole('button', { name: /cave d'exemple/i }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.slot[data-robe]').length > 50);
}

/** Vérifie que la cave affichée est triée par année en ordre de lecture (hors contraintes de type). */
async function readingOrderYears(page) {
  const cellar = await readCellar(page);
  return cellar.bottles
    .map((b) => ({ c: Number(b.clayette), r: Number(b.rang), y: b.annee ? Number(b.annee) : Infinity }))
    .sort((a, b) => a.c - b.c || a.r - b.r);
}

async function desktop(browser) {
  console.log('\nOrdinateur (1440 × 900)');
  const { context, page } = await open(browser, 'ordinateur', { viewport: { width: 1440, height: 900 } });

  check('écran de bienvenue au premier lancement', await page.getByRole('dialog').isVisible());
  await shot(page, 'ordi-01-bienvenue');
  await loadDemo(page);
  const initial = await readCellar(page);
  check('cave d\'exemple chargée', initial.bottles.length >= 80, `${initial.bottles.length} bouteilles`);
  await shot(page, 'ordi-02-cave');

  // --- Recherche en direct, conjonction de critères ---
  await field(page, 'appellation').fill('margaux');
  await page.waitForTimeout(150);
  const margaux = initial.bottles.filter((b) => /margaux/i.test(b.appellation)).length;
  check('recherche : les Margaux sont mis en valeur', (await page.locator('.slot[data-tone="match"]').count()) === margaux, `${margaux} attendus`);
  check('recherche : les autres bouteilles sont atténuées', (await page.locator('.slot[data-tone="dim"]').count()) === initial.bottles.length - margaux);
  await page.locator('.f-robe .chip', { hasText: 'Blanc' }).click();
  await page.waitForTimeout(100);
  check('conjonction : Margaux ET blanc ne donne rien', (await page.locator('.slot[data-tone="match"]').count()) === 0);
  await page.locator('.f-robe .chip', { hasText: 'Blanc' }).click();
  await field(page, 'appellation').fill('');
  await field(page, 'annee').fill('2010-2015');
  await page.waitForTimeout(150);
  const range = initial.bottles.filter((b) => Number(b.annee) >= 2010 && Number(b.annee) <= 2015).length;
  check('recherche par période d\'années', (await page.locator('.slot[data-tone="match"]').count()) === range, `${range} attendues`);
  await shot(page, 'ordi-03-recherche');
  await page.locator('.target-bar button[aria-label="Effacer le formulaire"]').click();

  // --- Désigner une bouteille, la supprimer, annuler ---
  const first = initial.bottles.find((b) => b.collection !== 'oui');
  await slot(page, first.clayette, first.rang).click();
  check('désignation : clayette et rang écrits dans le formulaire', (await field(page, 'clayette').inputValue()) === first.clayette && (await field(page, 'rang').inputValue()) === first.rang);
  check('désignation : fiche de la bouteille dans le panneau', await page.locator('.bottle-card').isVisible());
  await shot(page, 'ordi-04-designation');
  await action(page, 'Supprimer').click();
  await page.waitForTimeout(150);
  check('suppression d\'une bouteille', (await readCellar(page)).bottles.length === initial.bottles.length - 1);
  await page.locator('.toast .toast-undo').first().click();
  await page.waitForTimeout(150);
  check('annulation de la suppression', (await readCellar(page)).bottles.length === initial.bottles.length);

  // --- Ajouter trois bouteilles avec proposition d'emplacement ---
  await page.locator('.target-bar button[aria-label="Effacer le formulaire"]').click().catch(() => {});
  await field(page, 'chateau').fill('Château Test');
  await field(page, 'appellation').fill('Pauillac');
  await field(page, 'annee').fill('2016');
  await action(page, 'Ajouter').click();
  await page.waitForSelector('.slot[data-marker="propose"]');
  check('ajout : un emplacement est proposé', (await page.locator('.slot[data-marker="propose"]').count()) === 1);
  await page.getByRole('button', { name: 'Une bouteille de plus' }).click();
  await page.getByRole('button', { name: 'Une bouteille de plus' }).click();
  check('ajout : trois emplacements proposés pour trois bouteilles', (await page.locator('.slot[data-marker="propose"]').count()) === 3);
  await shot(page, 'ordi-05-ajout');
  await page.getByRole('button', { name: /Ranger les 3 bouteilles/ }).click();
  await page.waitForTimeout(150);
  let now = await readCellar(page);
  const added = now.bottles.filter((b) => b.chateau === 'Château Test');
  check('ajout : trois bouteilles enregistrées', added.length === 3);
  check('ajout : robe, forme et cépages déduits de l\'appellation', added.every((b) => b.robe === 'Rouge' && b.forme === 'Bordeaux' && /Cabernet/.test(b.cepages)), JSON.stringify(added[0]));

  // --- Déplacer vers une place libre ---
  const moved = added[0];
  await slot(page, moved.clayette, moved.rang).click();
  await action(page, 'Déplacer').click();
  const target = await page.locator('.slot[data-marker="possible"]:not([data-robe])').first();
  const key = await target.getAttribute('data-key');
  await target.click();
  await page.waitForTimeout(150);
  now = await readCellar(page);
  const [tc, tr] = key.split(':');
  check('déplacement vers une place libre', now.bottles.some((b) => b.chateau === 'Château Test' && b.clayette === tc && b.rang === tr));

  // --- Classer en collection par critères, puis déclasser ---
  await page.locator('.target-bar button[aria-label="Effacer le formulaire"]').click();
  await field(page, 'chateau').fill('Château Test');
  await page.waitForTimeout(100);
  await action(page, 'Classer').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Classer en collection' }).click();
  await page.waitForTimeout(150);
  now = await readCellar(page);
  check('classement en collection par critères', now.bottles.filter((b) => b.chateau === 'Château Test' && b.collection === 'oui').length === 3);
  await action(page, 'Déclasser').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Retirer de la collection' }).click();
  await page.waitForTimeout(150);
  now = await readCellar(page);
  check('déclassement par critères', now.bottles.filter((b) => b.chateau === 'Château Test' && b.collection === 'oui').length === 0);

  // --- Supprimer par critères (confirmation) ---
  await action(page, 'Supprimer').click();
  await page.getByRole('dialog').getByRole('button', { name: /Supprimer les 3 bouteilles/ }).click();
  await page.waitForTimeout(150);
  check('suppression par critères après confirmation', (await readCellar(page)).bottles.length === initial.bottles.length);
  await page.locator('.target-bar button[aria-label="Effacer le formulaire"]').click();

  // --- Places libres ---
  await action(page, 'Places libres').click();
  await page.waitForTimeout(100);
  const free = initial.shelves.reduce((n, s) => n + Number(s.emplacements), 0) - initial.bottles.length;
  check('places libres mises en valeur', (await page.locator('.slot[data-marker="libre"]').count()) === free, `${free} attendues`);
  await shot(page, 'ordi-06-places-libres');
  await action(page, 'Places libres').click();

  // --- Sommelier (règles locales quand l'IA n'est pas configurée) ---
  await action(page, 'À boire').click();
  await page.waitForSelector('.side-panel .panel-title:has-text("À boire rapidement")');
  check('sommelier : rapport « à boire rapidement » affiché', (await page.locator('.side-panel .result-item').count()) > 0);
  await shot(page, 'ordi-07-a-boire');
  await page.locator('.f-plat input').fill('gigot d\'agneau');
  await action(page, 'Accord').click();
  await page.waitForSelector('.side-panel .panel-title:has-text("Accord mets-vin")');
  await page.waitForTimeout(300);
  const firstPairing = await page.locator('.side-panel .result-item').first().innerText();
  check('sommelier : accord avec l\'agneau propose un rouge charpenté', /rouge charpenté/i.test(firstPairing), firstPairing.replace(/\n/g, ' | ').slice(0, 120));
  await action(page, 'Trop vieilles').click();
  await page.waitForSelector('.side-panel .panel-title:has-text("Candidates")');
  check('sommelier : candidates à la collection listées', (await page.locator('.side-panel .result-item').count()) > 0);
  await shot(page, 'ordi-08-candidates');
  await page.keyboard.press('Escape');

  // --- Réorganisation guidée complète ---
  await page.waitForFunction(() => !document.querySelector('.banner-busy'), null, { timeout: 15000 }).catch(() => {});
  await action(page, 'Réorganiser').click();
  await page.waitForSelector('.plan-option');
  await shot(page, 'ordi-09-reorg-apercu');
  await page.getByRole('button', { name: 'Après', exact: true }).click();
  await shot(page, 'ordi-10-reorg-apres');
  await page.getByRole('button', { name: /Commencer le guidage/ }).click();
  await page.waitForSelector('.banner-reorg');
  await shot(page, 'ordi-11-reorg-etape');
  const totalText = await page.locator('.banner-step').innerText();
  const total = Number(/\/\s*(\d+)/.exec(totalText)?.[1] ?? 0);
  check('réorganisation : plan de déplacements proposé', total > 0, totalText);
  for (let i = 0; i < total; i++) await page.locator('.banner-done').click();
  await page.waitForSelector('.banner-reorg', { state: 'detached' });
  const after = await readCellar(page);
  check('réorganisation : aucune bouteille perdue', after.bottles.length === initial.bottles.length);
  // L'ordre des années est respecté clayette par clayette de même type.
  const order = await readingOrderYears(page);
  const types = initial.shelves.map((s) => s.type);
  let inversions = 0;
  for (let i = 1; i < order.length; i++) {
    if (order[i].y < order[i - 1].y && types[order[i].c - 1] === types[order[i - 1].c - 1]) inversions += 1;
  }
  check('réorganisation : années croissantes de haut en bas et de gauche à droite', inversions === 0, `${inversions} inversion(s)`);
  await shot(page, 'ordi-12-reorg-fini');
  await action(page, 'Réorganiser').click();
  await page.waitForSelector('.plan-option');
  check('réorganisation : une cave rangée ne demande plus aucun déplacement', await page.getByRole('button', { name: /Commencer le guidage/ }).isDisabled());
  await page.keyboard.press('Escape');

  // --- Configuration de la cave ---
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: /Configurer la cave/ }).click();
  await page.getByRole('button', { name: 'Ajouter une clayette en bas' }).click();
  await shot(page, 'ordi-13-config');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.waitForTimeout(150);
  check('configuration : une clayette ajoutée', (await readCellar(page)).shelves.length === initial.shelves.length + 1);

  // --- Import par collage, export par téléchargement ---
  await page.getByRole('button', { name: /^Fichier/ }).click();
  await shot(page, 'ordi-14-fichier');
  await page.getByRole('button', { name: 'Coller un CSV' }).click();
  await page.locator('#paste-csv').fill(
    'Bonjour,\n\nVoici ma cave :\n\nenregistrement;clayette;rang;emplacements;type;chateau;appellation;annee;cepages;robe;forme;collection\n' +
      'clayette;1;;6;Tout;;;;;;;\nclayette;2;;6;Bordeaux;;;;;;;\n' +
      'bouteille;1;1;;;Domaine A;Chablis;2020;Chardonnay;Blanc;Bourgogne;non\n' +
      'bouteille;2;3;;;Château B;Pauillac;2010;Cabernet Sauvignon, Merlot;Rouge;Bordeaux;oui\n\nCordialement',
  );
  await page.getByRole('button', { name: 'Importer le texte collé' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remplacer' }).click();
  await page.waitForTimeout(200);
  const imported = await readCellar(page);
  check('import par collage (texte de courriel autour du CSV)', imported.bottles.length === 2 && imported.shelves.length === 2);
  await page.getByRole('button', { name: /^Fichier/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger le CSV' }).click();
  const file = await download;
  check('export : fichier CSV téléchargé', /^bacchus-cave-\d{4}-\d{2}-\d{2}\.csv$/.test(file.suggestedFilename()), file.suggestedFilename());
  await page.keyboard.press('Escape');

  // --- Persistance après rechargement ---
  await page.reload();
  await page.waitForSelector('.app');
  check('la cave est retrouvée après rechargement de la page', (await page.locator('.slot[data-robe]').count()) === 2);
  await context.close();
}

async function phone(browser) {
  console.log('\niPhone 14 (390 × 664)');
  const { context, page } = await open(browser, 'iphone', { ...devices['iPhone 14'] });
  await shot(page, 'iphone-01-bienvenue');
  await loadDemo(page);
  const initial = await readCellar(page);
  await page.waitForTimeout(400);
  await shot(page, 'iphone-02-cave');

  const box = await page.locator('.cabinet').boundingBox();
  const view = await page.locator('.cave-viewport').boundingBox();
  check('le schéma tient entièrement à l\'écran', box.height <= view.height + 1 && box.width <= view.width + 1, `${Math.round(box.width)}×${Math.round(box.height)} dans ${Math.round(view.width)}×${Math.round(view.height)}`);
  const form = await page.locator('.zone-form').boundingBox();
  check('formulaire et schéma visibles ensemble', form.y + form.height <= 664 + 1 && form.height < 340, `formulaire ${Math.round(form.height)} px`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('aucun défilement horizontal de la page', !overflow);

  await field(page, 'appellation').fill('margaux');
  await page.waitForTimeout(150);
  check('recherche en direct', (await page.locator('.slot[data-tone="match"]').count()) > 0);
  await shot(page, 'iphone-03-recherche');
  await page.locator('.target-bar button[aria-label="Effacer le formulaire"]').click();

  const first = initial.bottles.find((b) => b.collection !== 'oui');
  await slot(page, first.clayette, first.rang).click();
  await page.locator('.target-list-toggle').click();
  check('fiche de la bouteille désignée', await page.locator('.bottle-card').isVisible());
  await shot(page, 'iphone-04-fiche');
  await page.locator('.target-list-toggle').click();

  await action(page, 'Déplacer').click();
  await page.waitForSelector('.banner-mode');
  await shot(page, 'iphone-05-deplacement');
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();

  await action(page, 'Réorganiser').scrollIntoViewIfNeeded();
  await action(page, 'Réorganiser').click();
  await page.waitForSelector('.plan-option');
  await shot(page, 'iphone-06-reorg-apercu');
  await page.getByRole('button', { name: /Commencer le guidage/ }).click();
  await page.waitForSelector('.banner-reorg');
  await shot(page, 'iphone-07-reorg-etape');
  const done = await page.locator('.banner-done').boundingBox();
  check('guidage : bouton « Fait » large, en bas de l\'écran', done.height >= 44 && done.y > 560, `y=${Math.round(done.y)}, h=${Math.round(done.height)}`);
  const guided = await page.locator('.cabinet').boundingBox();
  const guidedView = await page.locator('.cave-viewport').boundingBox();
  check('guidage : le schéma reste entièrement visible', guided.height <= guidedView.height + 1, `${Math.round(guided.height)} dans ${Math.round(guidedView.height)}`);
  await page.locator('.banner-done').click();
  await page.locator('.banner-done').click();
  await page.getByRole('button', { name: 'Quitter' }).click();
  await page.waitForSelector('.banner-reorg', { state: 'detached' }).catch(() => {});
  check('guidage interrompu : aucune bouteille perdue', (await readCellar(page)).bottles.length === initial.bottles.length);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: /Assistant IA/ }).click();
  await shot(page, 'iphone-08-ia');
  await page.keyboard.press('Escape');
  await context.close();
}

const browser = await chromium.launch();
try {
  await desktop(browser);
  await phone(browser);
} catch (error) {
  failures += 1;
  console.error(`\nErreur inattendue : ${error.stack ?? error}`);
} finally {
  await browser.close();
}

if (problems.length > 0) {
  failures += problems.length;
  console.log(`\nErreurs du navigateur :\n${problems.map((p) => `  ✗ ${p}`).join('\n')}`);
}
console.log(failures === 0 ? '\nTous les contrôles sont passés.' : `\n${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
