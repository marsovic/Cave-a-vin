import type { Pairing } from '../domain/advisor';
import { findAppellation, suggestWineDefaults } from '../domain/knowledge';
import { joinCepages, parseForme, parseRobe, splitCepages, wineKey } from '../domain/normalize';
import { FORMES, ROBES } from '../domain/types';
import type { DrinkWindow, Forme, Robe, WineFields } from '../domain/types';
import { aiComplete } from './client';
import { asInteger, asNumber, asOneOf, asText, asTextArray, clamp, extractJson, findArray, isRecord, truncate } from './json';
import {
  LABEL_SCHEMA,
  PAIRINGS_KEY,
  PAIRINGS_SCHEMA,
  WINDOWS_KEY,
  WINDOWS_SCHEMA,
  labelMessages,
  pairingMessages,
  pairingWebMessages,
  windowsMessages,
  windowsWebMessages,
} from './prompts';
import { AiError } from './types';
import type { AiErrorCode, AiRequest, AiResponse, AiSettings, ScanResult } from './types';

/* ------------------------------------------------------------------ */
/* Préparation de la photo                                             */
/* ------------------------------------------------------------------ */

/** Plus grand côté de la photo envoyée au modèle de vision (pixels). */
export const DEFAULT_IMAGE_SIDE = 1280;
const JPEG_QUALITY = 0.82;
/** Au-delà de cette longueur de data URL (~2,5 Mo), la photo est recompressée plus fortement. */
const MAX_DATA_URL_CHARS = 2_500_000;
const FALLBACK_IMAGE_SIDE = 1024;
const FALLBACK_JPEG_QUALITY = 0.7;

const UNREADABLE_IMAGE =
  'Impossible de lire cette image : choisissez une photo au format JPEG, PNG ou WebP.';

/**
 * Dimensions d'une image réduite pour que son plus grand côté ne dépasse pas `maxSide`,
 * en conservant les proportions. Une image déjà assez petite n'est jamais agrandie.
 */
export function fitDimensions(width: number, height: number, maxSide: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const longest = Math.max(w, h);
  if (!(maxSide > 0) || longest <= maxSide) return { width: w, height: h };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

function decodeWithImgElement(blob: Blob): Promise<DecodedImage> {
  return new Promise<DecodedImage>((resolve, reject) => {
    if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      reject(new AiError('reponse-invalide', UNREADABLE_IMAGE));
      return;
    }
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AiError('reponse-invalide', UNREADABLE_IMAGE));
    };
    img.src = url;
  });
}

/** Décode la photo en respectant son orientation EXIF. */
async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Repli sur un élément <img> (anciens navigateurs, formats refusés par createImageBitmap).
    }
  }
  return decodeWithImgElement(blob);
}

function renderJpeg(image: DecodedImage, maxSide: number, quality: number): string {
  const { width, height } = fitDimensions(image.width, image.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new AiError('reponse-invalide', 'Ce navigateur ne permet pas de préparer la photo pour l\'IA.');
  }
  // Fond blanc : le JPEG n'a pas de transparence.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image.source, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  // Libère tout de suite la mémoire du canevas (photos de plusieurs mégapixels sur mobile).
  canvas.width = 0;
  canvas.height = 0;
  if (!dataUrl.startsWith('data:image/jpeg;base64,')) {
    throw new AiError('reponse-invalide', UNREADABLE_IMAGE);
  }
  return dataUrl;
}

/**
 * Prépare une photo pour l'envoi au modèle de vision : correction de l'orientation,
 * réduction (plus grand côté <= `maxSide` px, 1280 par défaut), encodage JPEG ; renvoie
 * une data URL. Si elle dépasse ~2,5 Mo, la photo est réencodée en 1024 px, qualité 0,7.
 * Lève une `AiError` (message français) si l'image est illisible.
 */
export async function prepareImage(image: Blob, maxSide: number = DEFAULT_IMAGE_SIDE): Promise<string> {
  if (!image || image.size === 0) throw new AiError('reponse-invalide', UNREADABLE_IMAGE);
  const side = Number.isFinite(maxSide) && maxSide >= 16 ? Math.floor(maxSide) : DEFAULT_IMAGE_SIDE;
  const decoded = await decodeImage(image);
  try {
    if (!(decoded.width > 0) || !(decoded.height > 0)) {
      throw new AiError('reponse-invalide', UNREADABLE_IMAGE);
    }
    let dataUrl = renderJpeg(decoded, side, JPEG_QUALITY);
    if (dataUrl.length > MAX_DATA_URL_CHARS) {
      dataUrl = renderJpeg(decoded, Math.min(side, FALLBACK_IMAGE_SIDE), FALLBACK_JPEG_QUALITY);
    }
    return dataUrl;
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError('reponse-invalide', UNREADABLE_IMAGE);
  } finally {
    decoded.release();
  }
}

/* ------------------------------------------------------------------ */
/* Appel avec réponse JSON validée                                     */
/* ------------------------------------------------------------------ */

const UNUSABLE_ANSWER = 'L\'IA a renvoyé une réponse inexploitable. Réessayez dans un instant.';

function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  return new AiError('indisponible', 'L\'assistant IA a rencontré une erreur inattendue. Réessayez.');
}

/**
 * Appelle l'IA et interprète sa réponse JSON avec `interpret` (qui renvoie `null` si la
 * réponse n'est pas conforme). Une réponse non conforme — ou refusée par le modèle comme
 * telle — donne lieu à UN réessai, puis à une `AiError('reponse-invalide')`.
 */
async function completeJson<T>(
  request: AiRequest,
  settings: AiSettings,
  signal: AbortSignal | undefined,
  interpret: (value: unknown) => T | null,
): Promise<{ value: T; response: AiResponse }> {
  let lastMessage = UNUSABLE_ANSWER;
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: AiResponse;
    try {
      response = await aiComplete(request, settings, signal);
    } catch (error) {
      if (error instanceof AiError && error.code === 'reponse-invalide') {
        lastMessage = error.message;
        continue;
      }
      throw error;
    }
    const parsed = extractJson(response.content);
    const value = parsed === null ? null : interpret(parsed);
    if (value !== null) return { value, response };
    lastMessage = UNUSABLE_ANSWER;
  }
  throw new AiError('reponse-invalide', lastMessage);
}

/* ------------------------------------------------------------------ */
/* Lecture d'étiquette                                                 */
/* ------------------------------------------------------------------ */

const UNREADABLE_LABEL = 'Étiquette illisible : reprenez la photo de plus près, bien éclairée.';
const LABEL_KEYS = ['chateau', 'appellation', 'annee', 'cepages', 'robe', 'forme', 'lisible'] as const;
const PLACEHOLDERS = new Set(['null', 'undefined', 'inconnu', 'inconnue', 'illisible', 'n/a', 'na', 'nc', '?', '-', 'aucun', 'aucune']);
const MIN_VINTAGE = 1800;

type ScanFields = ScanResult['fields'];

/** Fonctions de la base de connaissances utilisées pour compléter une étiquette. */
export interface LabelKnowledge {
  findAppellation: (name: string) => { nom: string; robes: Robe[] } | undefined;
  suggestWineDefaults: (appellation: string, robe?: Robe | '') => { robe?: Robe; forme?: Forme; cepages?: string[] };
}

const DEFAULT_KNOWLEDGE: LabelKnowledge = { findAppellation, suggestWineDefaults };

function labelText(value: unknown, max: number): string | null {
  const text = asText(value);
  if (text === null || PLACEHOLDERS.has(text.toLowerCase())) return null;
  return truncate(text, max);
}

/** « Appellation Margaux Contrôlée », « AOC Margaux » → « Margaux ». */
function cleanAppellation(text: string): string {
  const wrapped = /^appellation\s+(?:d['’]origine\s+)?(.+?)\s+(?:contr[oô]l[ée]e|prot[ée]g[ée]e)$/i.exec(text);
  const inner = wrapped?.[1] ?? text;
  const clean = inner.replace(/^(?:AOC|AOP|IGP|DOCG|DOC)\s+/i, '').trim();
  return clean || text;
}

/**
 * Complète les champs lus par les valeurs habituelles de l'appellation (base de
 * connaissances locale) : nom canonique, robe si l'appellation n'en produit qu'une, forme
 * de bouteille, cépages typiques. Tout champ ainsi rempli est signalé dans `deduits`.
 * Sans effet si l'appellation est inconnue ou si la base n'est pas disponible.
 */
function completeFromKnowledge(fields: ScanFields, deduits: Set<keyof ScanFields>, knowledge: LabelKnowledge): void {
  if (!fields.appellation) return;
  try {
    const info = knowledge.findAppellation(fields.appellation);
    if (!info) return;
    fields.appellation = info.nom;
    if (!fields.robe && info.robes.length === 1 && info.robes[0]) {
      fields.robe = info.robes[0];
      deduits.add('robe');
    }
    const defaults = knowledge.suggestWineDefaults(info.nom, fields.robe ?? '');
    if (!fields.forme && defaults.forme) {
      fields.forme = defaults.forme;
      deduits.add('forme');
    }
    if (!fields.cepages && fields.robe && defaults.cepages && defaults.cepages.length > 0) {
      fields.cepages = joinCepages(defaults.cepages);
      deduits.add('cepages');
    }
  } catch {
    // Base de connaissances indisponible : on garde ce que l'IA a lu.
  }
}

/**
 * Transforme la réponse JSON du modèle de vision en `ScanResult`.
 * Renvoie `null` si la réponse n'a pas la forme attendue ; lève `AiError('reponse-invalide')`
 * si rien n'a pu être lu sur l'étiquette.
 */
export function interpretLabel(
  value: unknown,
  currentYear: number,
  knowledge: LabelKnowledge = DEFAULT_KNOWLEDGE,
): ScanResult | null {
  if (!isRecord(value) || !LABEL_KEYS.some((key) => key in value)) return null;

  const fields: ScanFields = {};
  const deduits = new Set<keyof ScanFields>();

  const chateau = labelText(value.chateau, 120);
  if (chateau) fields.chateau = chateau;

  const appellation = labelText(value.appellation, 120);
  if (appellation) fields.appellation = cleanAppellation(appellation);

  const annee = asInteger(value.annee);
  if (annee !== null && annee >= MIN_VINTAGE && annee <= currentYear + 1) fields.annee = String(annee);

  const cepages = splitCepages(
    asTextArray(typeof value.cepages === 'string' ? [value.cepages] : value.cepages)
      .filter((c) => !PLACEHOLDERS.has(c.toLowerCase()))
      .join(', '),
  ).slice(0, 8);
  if (cepages.length > 0) {
    fields.cepages = joinCepages(cepages.map((c) => truncate(c, 40)));
    if (value.cepages_deduits === true) deduits.add('cepages');
  }

  const robe = asOneOf(value.robe, ROBES) ?? (typeof value.robe === 'string' ? parseRobe(value.robe) : null);
  if (robe) fields.robe = robe;

  const forme = asOneOf(value.forme, FORMES) ?? (typeof value.forme === 'string' ? parseForme(value.forme) : null);
  if (forme) fields.forme = forme;

  if (Object.keys(fields).length === 0) {
    throw new AiError('reponse-invalide', UNREADABLE_LABEL);
  }

  completeFromKnowledge(fields, deduits, knowledge);

  const result: ScanResult = { fields, deduits: [...deduits] };
  const note = labelText(value.note, 200);
  if (note) result.note = note;
  else if (value.lisible === false) result.note = 'Étiquette peu lisible : vérifiez les champs proposés.';
  return result;
}

/** Lit une étiquette de bouteille (photo) et renvoie les champs du formulaire reconnus. */
export async function scanLabel(image: Blob, settings: AiSettings, signal?: AbortSignal): Promise<ScanResult> {
  if (settings.desactivee) {
    throw new AiError('desactivee', 'L\'assistant IA est désactivé dans les réglages.');
  }
  const dataUrl = await prepareImage(image);
  if (signal?.aborted) throw new AiError('annule', 'Demande annulée.');
  const currentYear = new Date().getFullYear();
  const { value } = await completeJson(
    { role: 'vision', messages: labelMessages(dataUrl), json: LABEL_SCHEMA, maxTokens: 900, temperature: 0.1 },
    settings,
    signal,
    (answer) => interpretLabel(answer, currentYear),
  );
  return value;
}

/* ------------------------------------------------------------------ */
/* Traitement par lots                                                 */
/* ------------------------------------------------------------------ */

/** Options des traitements par lots (`fetchDrinkWindows`, `fetchPairings`). */
export interface BatchOptions {
  signal?: AbortSignal;
  /** Appelé après chaque lot : nombre de vins traités, nombre total de vins à traiter. */
  onProgress?: (done: number, total: number) => void;
  /**
   * Appelé quand un lot échoue alors qu'au moins un lot précédent a réussi : le traitement
   * s'arrête et la fonction RENVOIE les résultats déjà obtenus au lieu de lever l'erreur.
   * (Si le tout premier lot échoue, ou si la demande est annulée, l'erreur est levée normalement.)
   */
  onPartialError?: (error: AiError) => void;
}

export const WINDOWS_BATCH_SIZE = 20;
export const PAIRINGS_BATCH_SIZE = 25;
/** Longueur maximale du texte de recherche web réinjecté dans une demande. */
const MAX_WEB_WINDOWS_CHARS = 6000;
const MAX_WEB_PAIRING_CHARS = 1500;
const MAX_WINDOW_NOTE_CHARS = 140;
const MAX_PAIRING_REASON_CHARS = 160;
/** Garde maximale admise : au-delà de millésime + 100 ans, la réponse est jugée incohérente. */
const MAX_CELLARING_YEARS = 100;

/** Erreurs de la recherche web qui interdisent le repli sur une demande sans recherche. */
const NO_WEB_FALLBACK: readonly AiErrorCode[] = ['annule', 'cle-invalide', 'code-acces', 'desactivee'];

function canFallBackWithoutWeb(error: unknown): boolean {
  return !(error instanceof AiError && NO_WEB_FALLBACK.includes(error.code));
}

/** Vins distincts (une entrée par `wineKey`), dans l'ordre de première apparition. */
function distinctByKey(wines: readonly WineFields[]): { key: string; wine: WineFields }[] {
  const seen = new Set<string>();
  const out: { key: string; wine: WineFields }[] = [];
  for (const wine of wines) {
    const key = wineKey(wine);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, wine });
  }
  return out;
}

/** Marge pour le raisonnement du modèle + budget par vin. */
function batchTokens(count: number): number {
  return Math.min(8192, 800 + 100 * count);
}

/**
 * Traite `entries` par lots successifs (jamais en parallèle : quotas du palier gratuit).
 * `runLot` renvoie les résultats du lot, indexés par position dans le lot.
 */
async function runBatches<T>(
  entries: readonly { key: string; wine: WineFields }[],
  size: number,
  opts: BatchOptions | undefined,
  runLot: (lot: WineFields[]) => Promise<Map<number, T>>,
): Promise<Map<string, T>> {
  const results = new Map<string, T>();
  const total = entries.length;
  let succeeded = 0;
  for (let start = 0; start < total; start += size) {
    const lot = entries.slice(start, start + size);
    try {
      if (opts?.signal?.aborted) throw new AiError('annule', 'Demande annulée.');
      const found = await runLot(lot.map((entry) => entry.wine));
      for (const [index, value] of found) {
        const entry = lot[index];
        if (entry) results.set(entry.key, value);
      }
      succeeded += 1;
    } catch (error) {
      const aiError = toAiError(error);
      if (succeeded === 0 || aiError.code === 'annule') throw aiError;
      opts?.onPartialError?.(aiError);
      return results;
    }
    opts?.onProgress?.(Math.min(start + size, total), total);
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Fenêtres de dégustation                                             */
/* ------------------------------------------------------------------ */

interface WindowAnswer {
  debut: number;
  fin: number;
  note?: string;
}

/**
 * Lit la réponse « fenêtres » d'un lot. Les entrées incohérentes sont ignorées
 * (il faut millésime ≤ debut ≤ fin ≤ millésime + 100). `null` si la réponse n'est pas conforme.
 */
export function interpretWindows(value: unknown, lot: readonly WineFields[]): Map<number, WindowAnswer> | null {
  const items = findArray(value, WINDOWS_KEY);
  if (items === null) return null;
  const out = new Map<number, WindowAnswer>();
  for (const item of items) {
    if (!isRecord(item)) continue;
    const index = asInteger(item.i);
    if (index === null || out.has(index)) continue;
    const annee = lot[index]?.annee;
    if (annee === null || annee === undefined) continue;
    const debut = asInteger(item.debut);
    const fin = asInteger(item.fin);
    if (debut === null || fin === null) continue;
    if (debut < annee || fin < debut || fin > annee + MAX_CELLARING_YEARS) continue;
    const answer: WindowAnswer = { debut, fin };
    const note = asText(item.note);
    if (note) answer.note = truncate(note, MAX_WINDOW_NOTE_CHARS);
    out.set(index, answer);
  }
  return out;
}

/**
 * Demande à l'IA la fenêtre de dégustation de chaque vin (millésimés uniquement).
 * Résultat indexé par `wineKey`. Les vins pour lesquels l'IA ne répond pas (ou répond de
 * façon incohérente) sont absents : l'appelant retombe sur l'estimation locale.
 *
 * Les vins sont dédoublonnés et traités par lots de 20, l'un après l'autre ;
 * `onProgress(faits, total)` est appelé après chaque lot.
 *
 * Avec `settings.rechercheWeb`, chaque lot est précédé d'une recherche sur internet dont le
 * résultat est structuré par un second appel (source `ia-web`). Si la recherche échoue,
 * le lot et les suivants sont traités sans elle (source `ia`), sans erreur.
 *
 * Si un lot échoue après qu'un autre a réussi, les résultats déjà obtenus sont renvoyés et
 * l'erreur est signalée par `opts.onPartialError` (voir `BatchOptions`).
 */
export async function fetchDrinkWindows(
  wines: readonly WineFields[],
  year: number,
  settings: AiSettings,
  opts?: BatchOptions,
): Promise<Map<string, DrinkWindow>> {
  const vintage = wines.filter((wine) => wine.annee !== null && Number.isInteger(wine.annee));
  const entries = distinctByKey(vintage);
  let useWeb = settings.rechercheWeb;
  const signal = opts?.signal;

  return runBatches<DrinkWindow>(entries, WINDOWS_BATCH_SIZE, opts, async (lot) => {
    let contexte: string | null = null;
    let source: DrinkWindow['source'] = 'ia';
    if (useWeb) {
      try {
        const found = await aiComplete(
          { role: 'web', messages: windowsWebMessages(lot, year), maxTokens: 2500 },
          settings,
          signal,
        );
        contexte = truncate(found.content, MAX_WEB_WINDOWS_CHARS);
        if (found.web) source = 'ia-web';
      } catch (error) {
        if (!canFallBackWithoutWeb(error)) throw error;
        // Recherche web indisponible : on continue sans elle, pour ce lot et les suivants.
        useWeb = false;
      }
    }
    const { value } = await completeJson(
      {
        role: 'texte',
        messages: windowsMessages(lot, year, contexte),
        json: WINDOWS_SCHEMA,
        maxTokens: batchTokens(lot.length),
      },
      settings,
      signal,
      (answer) => interpretWindows(answer, lot),
    );
    const out = new Map<number, DrinkWindow>();
    for (const [index, answer] of value) out.set(index, { ...answer, source });
    return out;
  });
}

/* ------------------------------------------------------------------ */
/* Accords mets-vin                                                    */
/* ------------------------------------------------------------------ */

interface PairingAnswer {
  score: number;
  raison: string;
}

/**
 * Lit la réponse « accords » d'un lot : scores ramenés entre 0 et 100, justification
 * limitée à 160 caractères. `null` si la réponse n'est pas conforme.
 */
export function interpretPairings(value: unknown, lotSize: number): Map<number, PairingAnswer> | null {
  const items = findArray(value, PAIRINGS_KEY);
  if (items === null) return null;
  const out = new Map<number, PairingAnswer>();
  for (const item of items) {
    if (!isRecord(item)) continue;
    const index = asInteger(item.i);
    if (index === null || index < 0 || index >= lotSize || out.has(index)) continue;
    const score = asNumber(item.score);
    if (score === null) continue;
    const raison = asText(item.raison);
    out.set(index, {
      score: clamp(Math.round(score), 0, 100),
      raison: raison ? truncate(raison, MAX_PAIRING_REASON_CHARS) : 'Accord évalué par l\'IA.',
    });
  }
  return out;
}

/**
 * Demande à l'IA de noter l'accord de chaque vin avec un plat (0–100 + justification).
 * Résultat indexé par `wineKey` ; vins sans réponse absents.
 *
 * Les vins sont dédoublonnés et traités par lots de 25, l'un après l'autre. Avec
 * `settings.rechercheWeb`, UNE recherche sur internet préalable (« que servir avec ce
 * plat ») sert de contexte à toutes les notations (source `ia-web`) ; si elle échoue, les
 * notations se font sans elle (source `ia`). Résultats partiels : voir `BatchOptions`.
 */
export async function fetchPairings(
  plat: string,
  wines: readonly WineFields[],
  year: number,
  settings: AiSettings,
  opts?: BatchOptions,
): Promise<Map<string, Pairing>> {
  const dish = plat.trim();
  const entries = distinctByKey(wines);
  if (!dish || entries.length === 0) return new Map<string, Pairing>();
  const signal = opts?.signal;

  let contexte: string | null = null;
  let source: Pairing['source'] = 'ia';
  if (settings.rechercheWeb && !settings.desactivee) {
    try {
      const found = await aiComplete(
        { role: 'web', messages: pairingWebMessages(dish), maxTokens: 1500 },
        settings,
        signal,
      );
      contexte = truncate(found.content, MAX_WEB_PAIRING_CHARS);
      if (found.web) source = 'ia-web';
    } catch (error) {
      if (!canFallBackWithoutWeb(error)) throw error;
    }
  }

  return runBatches<Pairing>(entries, PAIRINGS_BATCH_SIZE, opts, async (lot) => {
    const { value } = await completeJson(
      {
        role: 'texte',
        messages: pairingMessages(dish, lot, year, contexte),
        json: PAIRINGS_SCHEMA,
        maxTokens: batchTokens(lot.length),
      },
      settings,
      signal,
      (answer) => interpretPairings(answer, lot.length),
    );
    const out = new Map<number, Pairing>();
    for (const [index, answer] of value) out.set(index, { ...answer, source });
    return out;
  });
}
