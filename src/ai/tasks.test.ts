import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findAppellation, suggestWineDefaults } from '../domain/knowledge';
import { wineKey } from '../domain/normalize';
import type { WineFields } from '../domain/types';
import { aiComplete } from './client';
import {
  fetchDrinkWindows,
  fetchPairings,
  fitDimensions,
  interpretLabel,
  interpretPairings,
  interpretWindows,
  prepareImage,
  scanLabel,
} from './tasks';
import { AiError, DEFAULT_AI_SETTINGS } from './types';
import type { AiMessage, AiRequest, AiResponse, AiSettings } from './types';

vi.mock('./client', () => ({ aiComplete: vi.fn() }));
// La base de connaissances est développée en parallèle : elle est simulée ici.
vi.mock('../domain/knowledge', () => ({ findAppellation: vi.fn(), suggestWineDefaults: vi.fn() }));

const complete = vi.mocked(aiComplete);
const findAppellationMock = vi.mocked(findAppellation);
const suggestDefaultsMock = vi.mocked(suggestWineDefaults);

const SANS_WEB: AiSettings = { ...DEFAULT_AI_SETTINGS, rechercheWeb: false };
const AVEC_WEB: AiSettings = { ...DEFAULT_AI_SETTINGS, rechercheWeb: true };
const YEAR = 2026;

function reply(content: unknown, web = false): AiResponse {
  return { content: typeof content === 'string' ? content : JSON.stringify(content), modele: 'modele-test', web };
}

function wine(n: number, overrides: Partial<WineFields> = {}): WineFields {
  return {
    chateau: `Château ${n}`,
    appellation: 'Margaux',
    annee: 2015,
    cepages: ['Merlot'],
    robe: 'rouge',
    forme: 'bordeaux',
    ...overrides,
  };
}

function textOf(messages: AiMessage[]): string {
  return messages
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : message.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n'),
    )
    .join('\n');
}

function requestOf(call: number): AiRequest {
  return complete.mock.calls[call]![0];
}

/** Numéros des vins ([0], [1]…) présents dans la liste d'une demande. */
function indexesIn(request: AiRequest): number[] {
  const list = textOf(request.messages).split('Vins :')[1] ?? '';
  return [...list.matchAll(/^\[(\d+)\]/gm)].map((match) => Number(match[1]));
}

async function failure(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    return error as AiError;
  }
  throw new Error('une AiError était attendue');
}

beforeEach(() => {
  complete.mockReset();
  findAppellationMock.mockReset();
  suggestDefaultsMock.mockReset();
  findAppellationMock.mockReturnValue(undefined);
  suggestDefaultsMock.mockReturnValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/* Simulacres du canevas (jsdom n'en a pas)                            */
/* ------------------------------------------------------------------ */

interface Render {
  width: number;
  height: number;
  type: string | undefined;
  quality: unknown;
}

interface CanvasStub {
  renders: Render[];
  drawImage: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  bitmapFactory: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const SMALL_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

function stubCanvas(options: { width?: number; height?: number; dataUrls?: string[]; bitmapFails?: boolean } = {}): CanvasStub {
  const renders: Render[] = [];
  const urls = [...(options.dataUrls ?? [])];
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  const close = vi.fn();
  const bitmapFactory = vi.fn(() =>
    options.bitmapFails
      ? Promise.reject(new DOMException('format non pris en charge', 'InvalidStateError'))
      : Promise.resolve({ width: options.width ?? 4000, height: options.height ?? 3000, close }),
  );
  vi.stubGlobal('createImageBitmap', bitmapFactory);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage, fillRect, fillStyle: '' }) as never,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement,
    type?: string,
    quality?: unknown,
  ) {
    renders.push({ width: this.width, height: this.height, type, quality });
    return urls.shift() ?? SMALL_JPEG;
  });
  return { renders, drawImage, fillRect, bitmapFactory, close };
}

const PHOTO = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

describe('fitDimensions', () => {
  it('réduit le plus grand côté en gardant les proportions', () => {
    expect(fitDimensions(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
    expect(fitDimensions(3000, 4000, 1280)).toEqual({ width: 960, height: 1280 });
    expect(fitDimensions(2000, 2000, 1024)).toEqual({ width: 1024, height: 1024 });
    expect(fitDimensions(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 });
  });

  it('n\'agrandit jamais une petite image', () => {
    expect(fitDimensions(800, 600, 1280)).toEqual({ width: 800, height: 600 });
    expect(fitDimensions(1280, 720, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it('garde au moins un pixel par côté', () => {
    expect(fitDimensions(10_000, 2, 1280)).toEqual({ width: 1280, height: 1 });
    expect(fitDimensions(0.2, 0.2, 1280)).toEqual({ width: 1, height: 1 });
  });

  it('arrondit des dimensions non entières', () => {
    expect(fitDimensions(1000.4, 499.6, 500)).toEqual({ width: 500, height: 250 });
  });
});

describe('prepareImage', () => {
  it('réduit à 1280 px, encode en JPEG qualité 0,82 et respecte l\'orientation', async () => {
    const canvas = stubCanvas({ width: 4000, height: 3000 });
    const dataUrl = await prepareImage(PHOTO);
    expect(dataUrl).toBe(SMALL_JPEG);
    expect(canvas.bitmapFactory).toHaveBeenCalledWith(PHOTO, { imageOrientation: 'from-image' });
    expect(canvas.renders).toEqual([{ width: 1280, height: 960, type: 'image/jpeg', quality: 0.82 }]);
    expect(canvas.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1280, 960);
    expect(canvas.fillRect).toHaveBeenCalledWith(0, 0, 1280, 960);
    expect(canvas.close).toHaveBeenCalledTimes(1);
  });

  it('accepte un autre côté maximal', async () => {
    const canvas = stubCanvas({ width: 3000, height: 4000 });
    await prepareImage(PHOTO, 800);
    expect(canvas.renders[0]).toMatchObject({ width: 600, height: 800 });
  });

  it('réencode en 1024 px, qualité 0,7, si la data URL dépasse ~2,5 Mo', async () => {
    const heavy = `data:image/jpeg;base64,${'A'.repeat(2_600_000)}`;
    const canvas = stubCanvas({ width: 4000, height: 3000, dataUrls: [heavy, SMALL_JPEG] });
    expect(await prepareImage(PHOTO)).toBe(SMALL_JPEG);
    expect(canvas.renders).toEqual([
      { width: 1280, height: 960, type: 'image/jpeg', quality: 0.82 },
      { width: 1024, height: 768, type: 'image/jpeg', quality: 0.7 },
    ]);
    expect(canvas.close).toHaveBeenCalledTimes(1);
  });

  it('se replie sur un élément <img> si createImageBitmap échoue', async () => {
    const canvas = stubCanvas({ bitmapFails: true });
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:photo'), revokeObjectURL: revoke });
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 2000;
      naturalHeight = 1000;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    expect(await prepareImage(PHOTO)).toBe(SMALL_JPEG);
    expect(canvas.renders).toEqual([{ width: 1280, height: 640, type: 'image/jpeg', quality: 0.82 }]);
    expect(canvas.drawImage.mock.calls[0]![0]).toBeInstanceOf(FakeImage);
    expect(revoke).toHaveBeenCalledWith('blob:photo');
  });

  it('erreur en français si l\'image est illisible', async () => {
    stubCanvas({ bitmapFails: true });
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:photo'), revokeObjectURL: revoke });
    class BrokenImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', BrokenImage);
    const error = await failure(prepareImage(new Blob(['pas une image'], { type: 'text/plain' })));
    expect(error.message).toMatch(/Impossible de lire cette image/);
    expect(revoke).toHaveBeenCalledWith('blob:photo');
  });

  it('erreur en français pour un fichier vide ou un encodage raté', async () => {
    stubCanvas();
    expect((await failure(prepareImage(new Blob([])))).message).toMatch(/Impossible de lire cette image/);
    const canvas = stubCanvas({ dataUrls: ['data:,'] });
    expect((await failure(prepareImage(PHOTO))).message).toMatch(/Impossible de lire cette image/);
    expect(canvas.close).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* Lecture d'étiquette                                                 */
/* ------------------------------------------------------------------ */

const LABEL = {
  chateau: '  Château   Margaux ',
  appellation: 'Margaux',
  annee: 2015,
  cepages: ['Cabernet sauvignon', 'Merlot', 'merlot'],
  robe: 'rouge',
  forme: 'bordeaux',
  cepages_deduits: false,
  lisible: true,
  note: null,
};

describe('scanLabel', () => {
  it('réponse nominale : champs du formulaire, rien de déduit', async () => {
    stubCanvas();
    complete.mockResolvedValueOnce(reply(LABEL));
    const result = await scanLabel(PHOTO, SANS_WEB);
    expect(result).toEqual({
      fields: {
        chateau: 'Château Margaux',
        appellation: 'Margaux',
        annee: '2015',
        cepages: 'Cabernet sauvignon, Merlot',
        robe: 'rouge',
        forme: 'bordeaux',
      },
      deduits: [],
    });
  });

  it('envoie la photo préparée au modèle de vision avec un schéma strict', async () => {
    stubCanvas();
    complete.mockResolvedValueOnce(reply(LABEL));
    const controller = new AbortController();
    await scanLabel(PHOTO, SANS_WEB, controller.signal);

    expect(complete).toHaveBeenCalledTimes(1);
    const [request, settings, signal] = complete.mock.calls[0]!;
    expect(settings).toBe(SANS_WEB);
    expect(signal).toBe(controller.signal);
    expect(request.role).toBe('vision');
    expect(request.json).toMatchObject({ name: 'etiquette_vin' });
    expect(request.maxTokens).toBeLessThanOrEqual(1200);
    const user = request.messages.find((message) => message.role === 'user')!;
    expect(user.content).toContainEqual({ type: 'image_url', image_url: { url: SMALL_JPEG } });
    expect(textOf(request.messages)).toMatch(/n'invente JAMAIS/);
  });

  it('signale les cépages déduits de l\'appellation', async () => {
    stubCanvas();
    complete.mockResolvedValueOnce(reply({ ...LABEL, cepages_deduits: true, note: 'Cépages typiques de Margaux.' }));
    const result = await scanLabel(PHOTO, SANS_WEB);
    expect(result.deduits).toEqual(['cepages']);
    expect(result.note).toBe('Cépages typiques de Margaux.');
  });

  it('champs null ou vides : omis', async () => {
    stubCanvas();
    complete.mockResolvedValueOnce(
      reply({
        chateau: 'Domaine des Tilleuls',
        appellation: null,
        annee: null,
        cepages: [],
        robe: null,
        forme: null,
        cepages_deduits: true,
        lisible: true,
        note: '  ',
      }),
    );
    const result = await scanLabel(PHOTO, SANS_WEB);
    expect(result).toEqual({ fields: { chateau: 'Domaine des Tilleuls' }, deduits: [] });
    expect(result).not.toHaveProperty('note');
  });

  it('ignore les valeurs de remplissage (« inconnu », « null »…)', () => {
    const result = interpretLabel(
      { ...LABEL, chateau: 'Inconnu', appellation: 'null', cepages: ['N/A', 'Syrah'], note: 'illisible' },
      YEAR,
    );
    expect(result?.fields).toEqual({ annee: '2015', cepages: 'Syrah', robe: 'rouge', forme: 'bordeaux' });
  });

  it('année aberrante : ignorée', () => {
    for (const annee of [1492, 1799, YEAR + 2, 2090, 15, -2015, 2015.5, 'deux mille quinze']) {
      const result = interpretLabel({ ...LABEL, annee }, YEAR);
      expect(result?.fields).not.toHaveProperty('annee');
      expect(result?.fields.chateau).toBe('Château Margaux');
    }
    for (const annee of [1800, 1947, YEAR, YEAR + 1, '2019']) {
      expect(interpretLabel({ ...LABEL, annee }, YEAR)?.fields.annee).toBe(String(annee));
    }
  });

  it('utilise l\'année courante pour juger le millésime', async () => {
    stubCanvas();
    const nextYear = new Date().getFullYear() + 1;
    complete.mockResolvedValueOnce(reply({ ...LABEL, annee: nextYear })).mockResolvedValueOnce(reply({ ...LABEL, annee: nextYear + 1 }));
    expect((await scanLabel(PHOTO, SANS_WEB)).fields.annee).toBe(String(nextYear));
    expect((await scanLabel(PHOTO, SANS_WEB)).fields).not.toHaveProperty('annee');
  });

  it('tolère une robe ou une forme écrites librement, et l\'appellation « contrôlée »', () => {
    const result = interpretLabel(
      { ...LABEL, robe: 'Rosé', forme: 'Bourguignonne', appellation: 'Appellation Côtes de Provence Contrôlée' },
      YEAR,
    );
    expect(result?.fields).toMatchObject({ robe: 'rose', forme: 'bourgogne', appellation: 'Côtes de Provence' });
    expect(interpretLabel({ ...LABEL, appellation: 'AOC Saint-Émilion Grand Cru' }, YEAR)?.fields.appellation).toBe(
      'Saint-Émilion Grand Cru',
    );
    expect(interpretLabel({ ...LABEL, robe: 'violet', forme: 'cubique' }, YEAR)?.fields).not.toHaveProperty('robe');
  });

  it('étiquette illisible : erreur explicite, sans nouvel essai', async () => {
    stubCanvas();
    complete.mockResolvedValueOnce(
      reply({
        chateau: null,
        appellation: null,
        annee: null,
        cepages: [],
        robe: null,
        forme: null,
        cepages_deduits: false,
        lisible: false,
        note: 'Photo floue.',
      }),
    );
    const error = await failure(scanLabel(PHOTO, SANS_WEB));
    expect(error.code).toBe('reponse-invalide');
    expect(error.message).toBe('Étiquette illisible : reprenez la photo de plus près, bien éclairée.');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('étiquette peu lisible mais partiellement lue : champs gardés, remarque ajoutée', () => {
    const result = interpretLabel({ ...LABEL, appellation: null, lisible: false, note: null }, YEAR);
    expect(result?.fields.chateau).toBe('Château Margaux');
    expect(result?.note).toMatch(/peu lisible/);
  });

  it('réponse non conforme : un nouvel essai, puis succès', async () => {
    stubCanvas();
    complete.mockResolvedValueOnce(reply('Je ne peux pas lire cette image.')).mockResolvedValueOnce(reply(`\`\`\`json\n${JSON.stringify(LABEL)}\n\`\`\``));
    const result = await scanLabel(PHOTO, SANS_WEB);
    expect(result.fields.chateau).toBe('Château Margaux');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('réponse non conforme deux fois : AiError reponse-invalide', async () => {
    stubCanvas();
    complete.mockResolvedValueOnce(reply('[1, 2, 3]')).mockResolvedValueOnce(reply({ sans: 'rapport' }));
    const error = await failure(scanLabel(PHOTO, SANS_WEB));
    expect(error.code).toBe('reponse-invalide');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('JSON refusé par le modèle (reponse-invalide) : un nouvel essai', async () => {
    stubCanvas();
    complete
      .mockRejectedValueOnce(new AiError('reponse-invalide', 'L\'IA n\'a pas pu produire de réponse exploitable.'))
      .mockResolvedValueOnce(reply(LABEL));
    expect((await scanLabel(PHOTO, SANS_WEB)).fields.chateau).toBe('Château Margaux');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('les autres erreurs de l\'IA remontent telles quelles, sans nouvel essai', async () => {
    stubCanvas();
    const quota = new AiError('quota', 'Quota de l\'IA atteint.', 60);
    complete.mockRejectedValueOnce(quota);
    expect(await failure(scanLabel(PHOTO, SANS_WEB))).toBe(quota);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('IA désactivée : erreur avant toute préparation de la photo', async () => {
    const canvas = stubCanvas();
    const error = await failure(scanLabel(PHOTO, { ...SANS_WEB, desactivee: true }));
    expect(error.code).toBe('desactivee');
    expect(canvas.bitmapFactory).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('demande annulée pendant la préparation de la photo : pas d\'appel à l\'IA', async () => {
    stubCanvas();
    const controller = new AbortController();
    controller.abort();
    expect((await failure(scanLabel(PHOTO, SANS_WEB, controller.signal))).code).toBe('annule');
    expect(complete).not.toHaveBeenCalled();
  });

  it('complète par la base de connaissances : nom canonique, forme et cépages typiques signalés comme déduits', async () => {
    stubCanvas();
    findAppellationMock.mockReturnValue({
      nom: 'Haut-Médoc',
      region: 'Bordeaux',
      pays: 'France',
      robes: ['rouge'],
      forme: 'bordeaux',
      cepages: { rouge: ['Cabernet sauvignon', 'Merlot'] },
      garde: { rouge: [5, 15] },
    });
    suggestDefaultsMock.mockReturnValue({ robe: 'rouge', forme: 'bordeaux', cepages: ['Cabernet sauvignon', 'Merlot'] });
    complete.mockResolvedValueOnce(
      reply({ ...LABEL, chateau: 'Château Sociando-Mallet', appellation: 'HAUT MEDOC', cepages: [], robe: null, forme: null }),
    );
    const result = await scanLabel(PHOTO, SANS_WEB);
    expect(findAppellationMock).toHaveBeenCalledWith('HAUT MEDOC');
    expect(suggestDefaultsMock).toHaveBeenCalledWith('Haut-Médoc', 'rouge');
    expect(result.fields).toEqual({
      chateau: 'Château Sociando-Mallet',
      appellation: 'Haut-Médoc',
      annee: '2015',
      robe: 'rouge',
      forme: 'bordeaux',
      cepages: 'Cabernet sauvignon, Merlot',
    });
    expect([...result.deduits].sort()).toEqual(['cepages', 'forme', 'robe']);
  });

  it('la base de connaissances ne remplace jamais ce que l\'IA a lu, ni ne devine la robe d\'une appellation à plusieurs couleurs', () => {
    const knowledge = {
      findAppellation: () => ({ nom: 'Bourgogne', robes: ['rouge' as const, 'blanc' as const] }),
      suggestWineDefaults: () => ({ robe: 'rouge' as const, forme: 'bourgogne' as const, cepages: ['Pinot noir'] }),
    };
    const lu = interpretLabel({ ...LABEL, appellation: 'bourgogne', robe: 'blanc', forme: 'bordeaux', cepages: ['Chardonnay'] }, YEAR, knowledge);
    expect(lu).toEqual({
      fields: { chateau: 'Château Margaux', appellation: 'Bourgogne', annee: '2015', cepages: 'Chardonnay', robe: 'blanc', forme: 'bordeaux' },
      deduits: [],
    });
    const sansRobe = interpretLabel({ ...LABEL, appellation: 'bourgogne', robe: null, forme: null, cepages: [] }, YEAR, knowledge);
    expect(sansRobe?.fields).not.toHaveProperty('robe');
    expect(sansRobe?.fields).not.toHaveProperty('cepages');
    expect(sansRobe?.fields.forme).toBe('bourgogne');
    expect(sansRobe?.deduits).toEqual(['forme']);
  });

  it('fonctionne même si la base de connaissances n\'est pas disponible', async () => {
    stubCanvas();
    findAppellationMock.mockImplementation(() => {
      throw new Error('non implémenté');
    });
    complete.mockResolvedValueOnce(reply(LABEL));
    expect((await scanLabel(PHOTO, SANS_WEB)).fields.appellation).toBe('Margaux');
  });
});

/* ------------------------------------------------------------------ */
/* Fenêtres de dégustation                                             */
/* ------------------------------------------------------------------ */

/** Réponse « fenêtres » couvrant tous les vins de la demande. */
function windowsFor(request: AiRequest, note = 'Belle garde.'): AiResponse {
  return reply({ fenetres: indexesIn(request).map((i) => ({ i, debut: 2020, fin: 2035, note })) });
}

describe('fetchDrinkWindows', () => {
  it('traite les vins millésimés, dédoublonnés, par lots de 20 successifs', async () => {
    const wines = [
      ...Array.from({ length: 45 }, (_, n) => wine(n)),
      wine(3),
      wine(7, { cepages: ['Autre'], forme: 'autre' }),
      wine(100, { annee: null }),
      wine(101, { annee: null }),
    ];
    let active = 0;
    let maxActive = 0;
    complete.mockImplementation(async (request) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return windowsFor(request);
    });
    const progress: [number, number][] = [];

    const result = await fetchDrinkWindows(wines, YEAR, SANS_WEB, { onProgress: (done, total) => progress.push([done, total]) });

    expect(complete).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
    expect(indexesIn(requestOf(0))).toHaveLength(20);
    expect(indexesIn(requestOf(1))).toHaveLength(20);
    expect(indexesIn(requestOf(2))).toEqual([0, 1, 2, 3, 4]);
    expect(progress).toEqual([
      [20, 45],
      [40, 45],
      [45, 45],
    ]);
    expect(result.size).toBe(45);
    expect(result.get(wineKey(wine(0)))).toEqual({ debut: 2020, fin: 2035, source: 'ia', note: 'Belle garde.' });
    expect(result.get(wineKey(wine(44)))).toMatchObject({ debut: 2020, fin: 2035, source: 'ia' });
    expect(result.has(wineKey(wine(100, { annee: null })))).toBe(false);
  });

  it('demande un JSON strict au modèle texte, avec l\'année courante et le détail des vins', async () => {
    complete.mockImplementation((request) => Promise.resolve(windowsFor(request)));
    const controller = new AbortController();
    await fetchDrinkWindows([wine(1, { chateau: 'Château Palmer', annee: 2010 })], YEAR, SANS_WEB, { signal: controller.signal });
    const [request, settings, signal] = complete.mock.calls[0]!;
    expect(request.role).toBe('texte');
    expect(request.json).toMatchObject({ name: 'fenetres_degustation' });
    expect(request.maxTokens).toBeGreaterThanOrEqual(600);
    expect(request.maxTokens).toBeLessThanOrEqual(8192);
    expect(settings).toBe(SANS_WEB);
    expect(signal).toBe(controller.signal);
    const text = textOf(request.messages);
    expect(text).toContain('Nous sommes en 2026');
    expect(text).toContain('[0] Château Palmer — Margaux — 2010 — rouge — cépages : Merlot');
  });

  it('aucun vin millésimé : aucun appel', async () => {
    const progress = vi.fn();
    const result = await fetchDrinkWindows([wine(1, { annee: null })], YEAR, AVEC_WEB, { onProgress: progress });
    expect(result.size).toBe(0);
    expect(complete).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it('contrôles de cohérence : millésime ≤ début ≤ fin ≤ millésime + 100', async () => {
    const wines = Array.from({ length: 9 }, (_, n) => wine(n, { annee: 2015 }));
    complete.mockResolvedValueOnce(
      reply({
        fenetres: [
          { i: 0, debut: 2015, fin: 2115, note: 'Limites admises.' },
          { i: 1, debut: 2014, fin: 2030, note: 'Début avant le millésime.' },
          { i: 2, debut: 2030, fin: 2025, note: 'Fin avant le début.' },
          { i: 3, debut: 2020, fin: 2116, note: 'Garde de plus de cent ans.' },
          { i: 4, debut: '2021', fin: 2031.0, note: '  Nombres   écrits autrement. ' },
          { i: 5, debut: 2020.5, fin: 2030, note: 'Année non entière.' },
          { i: 6, debut: null, fin: 2030, note: 'Début manquant.' },
          { i: 7, debut: 2022, fin: 2032, note: '' },
          { i: 7, debut: 2023, fin: 2033, note: 'Doublon ignoré.' },
          { i: 8, debut: 2020, fin: 2030, note: 'x'.repeat(300) },
          { i: 9, debut: 2020, fin: 2030, note: 'Indice hors lot.' },
          { i: -1, debut: 2020, fin: 2030, note: 'Indice négatif.' },
          'pas un objet',
          null,
        ],
      }),
    );
    const result = await fetchDrinkWindows(wines, YEAR, SANS_WEB);
    const key = (n: number): string => wineKey(wines[n]!);
    expect([...result.keys()].sort()).toEqual([key(0), key(4), key(7), key(8)].sort());
    expect(result.get(key(0))).toEqual({ debut: 2015, fin: 2115, source: 'ia', note: 'Limites admises.' });
    expect(result.get(key(4))).toEqual({ debut: 2021, fin: 2031, source: 'ia', note: 'Nombres écrits autrement.' });
    expect(result.get(key(7))).toEqual({ debut: 2022, fin: 2032, source: 'ia' });
    const longNote = result.get(key(8))!.note!;
    expect(longNote.length).toBeLessThanOrEqual(140);
    expect(longNote.endsWith('…')).toBe(true);
  });

  it('la cohérence se juge sur le millésime de chaque vin', () => {
    const lot = [wine(0, { annee: 1990 }), wine(1, { annee: 2020 })];
    const found = interpretWindows(
      [
        { i: 0, debut: 1995, fin: 2010, note: 'Ancien.' },
        { i: 1, debut: 1995, fin: 2010, note: 'Incohérent pour un 2020.' },
      ],
      lot,
    );
    expect([...found!.keys()]).toEqual([0]);
    expect(interpretWindows({ fenetres: 'non' }, lot)).toBeNull();
    expect(interpretWindows('texte', lot)).toBeNull();
    expect(interpretWindows({ fenetres: [] }, lot)?.size).toBe(0);
  });

  it('avec recherche web : un appel web puis un appel texte qui structure ce texte (source ia-web)', async () => {
    const wines = Array.from({ length: 25 }, (_, n) => wine(n));
    complete.mockImplementation((request) =>
      Promise.resolve(
        request.role === 'web' ? reply(`Synthèse web : lot de ${indexesIn(request).length} vins, apogée 2022-2034.`, true) : windowsFor(request),
      ),
    );
    const result = await fetchDrinkWindows(wines, YEAR, AVEC_WEB);

    expect(complete.mock.calls.map(([request]) => request.role)).toEqual(['web', 'texte', 'web', 'texte']);
    expect(requestOf(0).json).toBeUndefined();
    expect(textOf(requestOf(0).messages)).toContain('[19] Château 19');
    expect(textOf(requestOf(1).messages)).toContain('Synthèse web : lot de 20 vins, apogée 2022-2034.');
    expect(requestOf(1).json).toMatchObject({ name: 'fenetres_degustation' });
    expect(textOf(requestOf(3).messages)).toContain('Synthèse web : lot de 5 vins');
    expect(result.size).toBe(25);
    for (const window of result.values()) expect(window.source).toBe('ia-web');
  });

  it('recherche web non effectuée par le modèle : source ia', async () => {
    complete.mockImplementation((request) =>
      Promise.resolve(request.role === 'web' ? reply('Réponse sans recherche.', false) : windowsFor(request)),
    );
    const result = await fetchDrinkWindows([wine(1)], YEAR, AVEC_WEB);
    expect(result.get(wineKey(wine(1)))?.source).toBe('ia');
  });

  it('borne le texte web réinjecté', async () => {
    complete.mockImplementation((request) =>
      Promise.resolve(request.role === 'web' ? reply('w'.repeat(50_000), true) : windowsFor(request)),
    );
    await fetchDrinkWindows([wine(1)], YEAR, AVEC_WEB);
    expect(textOf(requestOf(1).messages).length).toBeLessThan(8000);
  });

  it.each(['indisponible', 'quota', 'reseau', 'trop-volumineux', 'reponse-invalide'] as const)(
    'recherche web en échec (%s) : repli silencieux sans web, pour ce lot et les suivants',
    async (code) => {
      const wines = Array.from({ length: 45 }, (_, n) => wine(n));
      complete.mockImplementation((request) =>
        request.role === 'web' ? Promise.reject(new AiError(code, 'Recherche web en panne.')) : Promise.resolve(windowsFor(request)),
      );
      const onPartialError = vi.fn();
      const result = await fetchDrinkWindows(wines, YEAR, AVEC_WEB, { onPartialError });

      expect(complete.mock.calls.map(([request]) => request.role)).toEqual(['web', 'texte', 'texte', 'texte']);
      expect(textOf(requestOf(1).messages)).not.toContain('internet');
      expect(result.size).toBe(45);
      for (const window of result.values()) expect(window.source).toBe('ia');
      expect(onPartialError).not.toHaveBeenCalled();
    },
  );

  it('le repli peut survenir en cours de route : les lots déjà traités restent ia-web', async () => {
    const wines = Array.from({ length: 45 }, (_, n) => wine(n));
    let webCalls = 0;
    complete.mockImplementation((request) => {
      if (request.role !== 'web') return Promise.resolve(windowsFor(request));
      webCalls += 1;
      return webCalls === 1 ? Promise.resolve(reply('Synthèse.', true)) : Promise.reject(new AiError('quota', 'Quota atteint.'));
    });
    const result = await fetchDrinkWindows(wines, YEAR, AVEC_WEB);
    expect(complete.mock.calls.map(([request]) => request.role)).toEqual(['web', 'texte', 'web', 'texte', 'texte']);
    expect(result.get(wineKey(wine(0)))?.source).toBe('ia-web');
    expect(result.get(wineKey(wine(20)))?.source).toBe('ia');
    expect(result.get(wineKey(wine(44)))?.source).toBe('ia');
  });

  it.each(['annule', 'cle-invalide', 'code-acces', 'desactivee'] as const)(
    'recherche web en échec (%s) : pas de repli, l\'erreur remonte',
    async (code) => {
      const original = new AiError(code, 'Erreur bloquante.');
      complete.mockRejectedValueOnce(original);
      expect(await failure(fetchDrinkWindows([wine(1)], YEAR, AVEC_WEB))).toBe(original);
      expect(complete).toHaveBeenCalledTimes(1);
    },
  );

  it('résultat partiel : une erreur après un lot réussi ne perd pas les résultats obtenus', async () => {
    const wines = Array.from({ length: 45 }, (_, n) => wine(n));
    const quota = new AiError('quota', 'Quota de l\'IA atteint : réessayez dans 12 min.', 720);
    complete.mockImplementationOnce((request) => Promise.resolve(windowsFor(request))).mockRejectedValueOnce(quota);
    const progress: [number, number][] = [];
    const onPartialError = vi.fn();

    const result = await fetchDrinkWindows(wines, YEAR, SANS_WEB, {
      onProgress: (done, total) => progress.push([done, total]),
      onPartialError,
    });

    expect(result.size).toBe(20);
    expect(result.has(wineKey(wine(19)))).toBe(true);
    expect(result.has(wineKey(wine(20)))).toBe(false);
    expect(onPartialError).toHaveBeenCalledTimes(1);
    expect(onPartialError).toHaveBeenCalledWith(quota);
    expect(progress).toEqual([[20, 45]]);
    // Le troisième lot n'est pas tenté.
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('résultat partiel même sans onPartialError', async () => {
    const wines = Array.from({ length: 21 }, (_, n) => wine(n));
    complete
      .mockImplementationOnce((request) => Promise.resolve(windowsFor(request)))
      .mockRejectedValueOnce(new AiError('indisponible', 'Panne.'));
    expect((await fetchDrinkWindows(wines, YEAR, SANS_WEB)).size).toBe(20);
  });

  it('erreur dès le premier lot : elle est levée', async () => {
    const error = new AiError('indisponible', 'L\'assistant IA n\'est pas configuré.');
    complete.mockRejectedValueOnce(error);
    const onPartialError = vi.fn();
    expect(await failure(fetchDrinkWindows([wine(1), wine(2)], YEAR, SANS_WEB, { onPartialError }))).toBe(error);
    expect(onPartialError).not.toHaveBeenCalled();
  });

  it('annulation en cours de route : l\'erreur est levée, même après un lot réussi', async () => {
    const wines = Array.from({ length: 30 }, (_, n) => wine(n));
    const controller = new AbortController();
    complete.mockImplementationOnce((request) => {
      controller.abort();
      return Promise.resolve(windowsFor(request));
    });
    const onPartialError = vi.fn();
    const error = await failure(fetchDrinkWindows(wines, YEAR, SANS_WEB, { signal: controller.signal, onPartialError }));
    expect(error.code).toBe('annule');
    expect(onPartialError).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('réponse non conforme : un nouvel essai, puis AiError reponse-invalide', async () => {
    complete.mockResolvedValueOnce(reply('Voici mes estimations…')).mockImplementationOnce((request) => Promise.resolve(windowsFor(request)));
    expect((await fetchDrinkWindows([wine(1)], YEAR, SANS_WEB)).size).toBe(1);
    expect(complete).toHaveBeenCalledTimes(2);

    complete.mockReset();
    complete.mockResolvedValue(reply({ fenetres: 'aucune' }));
    const error = await failure(fetchDrinkWindows([wine(1)], YEAR, SANS_WEB));
    expect(error.code).toBe('reponse-invalide');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('accepte un tableau nu ou entouré de texte', async () => {
    complete.mockResolvedValueOnce(reply('Voici : [{"i":0,"debut":2019,"fin":2029,"note":"Prêt."}] Bonne dégustation.'));
    const result = await fetchDrinkWindows([wine(1)], YEAR, SANS_WEB);
    expect(result.get(wineKey(wine(1)))).toEqual({ debut: 2019, fin: 2029, source: 'ia', note: 'Prêt.' });
  });
});

/* ------------------------------------------------------------------ */
/* Accords mets-vin                                                    */
/* ------------------------------------------------------------------ */

function pairingsFor(request: AiRequest, score = 70): AiResponse {
  return reply({ accords: indexesIn(request).map((i) => ({ i, score, raison: 'Bel accord.' })) });
}

describe('fetchPairings', () => {
  it('note chaque vin, par lots de 25 successifs', async () => {
    const wines = [...Array.from({ length: 30 }, (_, n) => wine(n)), wine(4), wine(200, { annee: null, robe: 'blanc' })];
    complete.mockImplementation((request) => Promise.resolve(pairingsFor(request, 82)));
    const progress: [number, number][] = [];

    const result = await fetchPairings('Magret de canard', wines, YEAR, SANS_WEB, {
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(indexesIn(requestOf(0))).toHaveLength(25);
    expect(indexesIn(requestOf(1))).toHaveLength(6);
    expect(progress).toEqual([
      [25, 31],
      [31, 31],
    ]);
    expect(result.size).toBe(31);
    expect(result.get(wineKey(wine(0)))).toEqual({ score: 82, raison: 'Bel accord.', source: 'ia' });
    expect(result.has(wineKey(wine(200, { annee: null, robe: 'blanc' })))).toBe(true);
  });

  it('le prompt donne le plat, l\'année courante et le détail de chaque vin', async () => {
    complete.mockImplementation((request) => Promise.resolve(pairingsFor(request)));
    await fetchPairings(
      '  Blanquette de veau ',
      [
        wine(1, { chateau: 'Domaine Leflaive', appellation: 'Puligny-Montrachet', annee: 2019, robe: 'blanc', cepages: ['Chardonnay'] }),
        wine(2, { chateau: 'Maison Ruinart', appellation: 'Champagne', annee: null, robe: 'blanc', cepages: [] }),
      ],
      YEAR,
      SANS_WEB,
    );
    const request = requestOf(0);
    expect(request.role).toBe('texte');
    expect(request.json).toMatchObject({ name: 'accords_mets_vin' });
    const text = textOf(request.messages);
    expect(text).toContain('« Blanquette de veau »');
    expect(text).toContain('Nous sommes en 2026');
    expect(text).toContain('[0] Domaine Leflaive — Puligny-Montrachet — 2019 — blanc — cépages : Chardonnay');
    expect(text).toContain('[1] Maison Ruinart — Champagne — non millésimé — blanc');
  });

  it('borne les scores entre 0 et 100 et les justifications à 160 caractères', async () => {
    const wines = Array.from({ length: 8 }, (_, n) => wine(n));
    complete.mockResolvedValueOnce(
      reply({
        accords: [
          { i: 0, score: 150, raison: 'Trop généreux.' },
          { i: 1, score: -20, raison: 'Trop sévère.' },
          { i: 2, score: 72.6, raison: '  Note   décimale. ' },
          { i: 3, score: '85', raison: 'x'.repeat(400) },
          { i: 4, score: 'excellent', raison: 'Note illisible.' },
          { i: 5, score: 60, raison: '' },
          { i: 5, score: 10, raison: 'Doublon ignoré.' },
          { i: 8, score: 50, raison: 'Indice hors lot.' },
          { i: 6, score: 0, raison: 'À éviter.' },
          { i: 7, score: 100, raison: 'Accord idéal.' },
        ],
      }),
    );
    const result = await fetchPairings('Plat', wines, YEAR, SANS_WEB);
    const at = (n: number): unknown => result.get(wineKey(wines[n]!));
    expect(at(0)).toEqual({ score: 100, raison: 'Trop généreux.', source: 'ia' });
    expect(at(1)).toEqual({ score: 0, raison: 'Trop sévère.', source: 'ia' });
    expect(at(2)).toEqual({ score: 73, raison: 'Note décimale.', source: 'ia' });
    expect(result.get(wineKey(wines[3]!))!.score).toBe(85);
    expect(result.get(wineKey(wines[3]!))!.raison.length).toBeLessThanOrEqual(160);
    expect(at(4)).toBeUndefined();
    expect(result.get(wineKey(wines[5]!))).toMatchObject({ score: 60 });
    expect(result.get(wineKey(wines[5]!))!.raison.length).toBeGreaterThan(0);
    expect(at(6)).toMatchObject({ score: 0 });
    expect(at(7)).toMatchObject({ score: 100 });
    expect(result.size).toBe(7);
    for (const pairing of result.values()) {
      expect(pairing.score).toBeGreaterThanOrEqual(0);
      expect(pairing.score).toBeLessThanOrEqual(100);
    }
  });

  it('interpretPairings refuse une réponse sans tableau', () => {
    expect(interpretPairings({ accords: 'aucun' }, 3)).toBeNull();
    expect(interpretPairings(42, 3)).toBeNull();
    expect(interpretPairings([{ i: 0, score: 55, raison: 'Correct.' }], 3)?.get(0)).toEqual({ score: 55, raison: 'Correct.' });
  });

  it('avec recherche web : UN appel web préalable, dont le résumé sert de contexte à chaque lot (source ia-web)', async () => {
    const wines = Array.from({ length: 30 }, (_, n) => wine(n));
    complete.mockImplementation((request) =>
      Promise.resolve(request.role === 'web' ? reply('Avec le canard : rouges du Sud-Ouest, Madiran, Cahors.', true) : pairingsFor(request)),
    );
    const result = await fetchPairings('Magret de canard', wines, YEAR, AVEC_WEB);

    expect(complete.mock.calls.map(([request]) => request.role)).toEqual(['web', 'texte', 'texte']);
    const web = requestOf(0);
    expect(web.json).toBeUndefined();
    expect(textOf(web.messages)).toContain('« Magret de canard »');
    expect(textOf(web.messages)).toContain('appellations');
    expect(textOf(web.messages)).not.toContain('Château 0');
    for (const call of [1, 2]) {
      expect(textOf(requestOf(call).messages)).toContain('Avec le canard : rouges du Sud-Ouest, Madiran, Cahors.');
    }
    expect(result.size).toBe(30);
    for (const pairing of result.values()) expect(pairing.source).toBe('ia-web');
  });

  it('le résumé web injecté ne dépasse pas 1500 caractères', async () => {
    complete.mockImplementation((request) =>
      Promise.resolve(request.role === 'web' ? reply(`DEBUT${'w'.repeat(5000)}FIN`, true) : pairingsFor(request)),
    );
    await fetchPairings('Plat', [wine(1)], YEAR, AVEC_WEB);
    const text = textOf(requestOf(1).messages);
    expect(text).toContain('DEBUT');
    expect(text).not.toContain('FIN');
    expect((text.match(/w+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0)).toBeLessThanOrEqual(1500);
  });

  it('recherche web en échec : repli silencieux (source ia)', async () => {
    complete.mockImplementation((request) =>
      request.role === 'web' ? Promise.reject(new AiError('indisponible', 'Panne.')) : Promise.resolve(pairingsFor(request)),
    );
    const onPartialError = vi.fn();
    const result = await fetchPairings('Plat', [wine(1), wine(2)], YEAR, AVEC_WEB, { onPartialError });
    expect(complete.mock.calls.map(([request]) => request.role)).toEqual(['web', 'texte']);
    expect(textOf(requestOf(1).messages)).not.toContain('internet');
    expect(result.get(wineKey(wine(1)))?.source).toBe('ia');
    expect(onPartialError).not.toHaveBeenCalled();
  });

  it.each(['annule', 'cle-invalide', 'code-acces', 'desactivee'] as const)(
    'recherche web en échec (%s) : pas de repli',
    async (code) => {
      const original = new AiError(code, 'Erreur bloquante.');
      complete.mockRejectedValueOnce(original);
      expect(await failure(fetchPairings('Plat', [wine(1)], YEAR, AVEC_WEB))).toBe(original);
      expect(complete).toHaveBeenCalledTimes(1);
    },
  );

  it('résultat partiel : garde les lots réussis et signale l\'erreur', async () => {
    const wines = Array.from({ length: 30 }, (_, n) => wine(n));
    const panne = new AiError('reseau', 'Connexion impossible.');
    complete.mockImplementationOnce((request) => Promise.resolve(pairingsFor(request))).mockRejectedValueOnce(panne);
    const onPartialError = vi.fn();
    const result = await fetchPairings('Plat', wines, YEAR, SANS_WEB, { onPartialError });
    expect(result.size).toBe(25);
    expect(onPartialError).toHaveBeenCalledWith(panne);
  });

  it('plat vide ou cave vide : aucun appel', async () => {
    expect((await fetchPairings('   ', [wine(1)], YEAR, AVEC_WEB)).size).toBe(0);
    expect((await fetchPairings('Plat', [], YEAR, AVEC_WEB)).size).toBe(0);
    expect(complete).not.toHaveBeenCalled();
  });

  it('réponse non conforme deux fois : AiError reponse-invalide', async () => {
    complete.mockResolvedValue(reply('Je recommande le Château 1.'));
    const error = await failure(fetchPairings('Plat', [wine(1)], YEAR, SANS_WEB));
    expect(error.code).toBe('reponse-invalide');
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
