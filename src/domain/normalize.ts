import type { Forme, Robe, TypeClayette, WineFields } from './types';

/**
 * Normalise un texte pour les comparaisons : minuscules, sans accents,
 * apostrophes/tirets/ponctuation ramenés à des espaces, espaces compactés.
 * `"Château  d'Yquem"` → `"chateau d yquem"`.
 */
export function norm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[œ]/g, 'oe')
    .replace(/[æ]/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Découpe une saisie « Merlot, Cabernet franc ; Malbec » en liste de cépages nettoyés, sans doublons. */
export function splitCepages(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,;/\n]+|\s+et\s+|\s+&\s+/i)) {
    const clean = part.replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const key = norm(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

export function joinCepages(cepages: readonly string[]): string {
  return cepages.join(', ');
}

/** Interprète un libellé libre de robe (« Rouge », « blanc liquoreux », « rosé », « moelleux »…). */
export function parseRobe(text: string): Robe | null {
  const t = norm(text);
  if (!t) return null;
  if (/liquoreux|moelleux|doux|sauternes/.test(t)) return 'blanc-liquoreux';
  if (/^ro(se|ses)?$|rose/.test(t)) return 'rose';
  if (/rouge|red|rosso|tinto/.test(t)) return 'rouge';
  if (/blanc|white|bianco|blanco|effervescent|petillant|mousseux/.test(t)) return 'blanc';
  return null;
}

/** Interprète un libellé libre de forme de bouteille. */
export function parseForme(text: string): Forme | null {
  const t = norm(text);
  if (!t) return null;
  if (/bordeaux|bordelaise|bdx/.test(t)) return 'bordeaux';
  if (/bourgogne|bourguignonne|bgn|burgund/.test(t)) return 'bourgogne';
  if (/champagne|champenoise|chp|effervescent/.test(t)) return 'champagne';
  if (/autre|flute|alsace|magnum|tout|other/.test(t)) return 'autre';
  return null;
}

/** Interprète un libellé libre de type de clayette. */
export function parseTypeClayette(text: string): TypeClayette | null {
  const t = norm(text);
  if (!t) return null;
  if (/tout|toutes|tous|mixte|universel|all|any/.test(t)) return 'tout';
  if (/bordeaux|bordelaise|bdx/.test(t)) return 'bordeaux';
  if (/bourgogne|bourguignonne|bgn/.test(t)) return 'bourgogne';
  if (/champagne|champenoise|chp/.test(t)) return 'champagne';
  return null;
}

/**
 * Clé de GROUPE pour le rangement : même château et même année
 * (les bouteilles d'un groupe doivent être côte à côte).
 */
export function groupKey(w: Pick<WineFields, 'chateau' | 'annee'>): string {
  return `${norm(w.chateau)}|${w.annee ?? ''}`;
}

/**
 * Clé de VIN : identifie un vin (pour les conseils de l'IA, le cache des
 * fenêtres de dégustation…), indépendamment de la forme et des cépages saisis.
 */
export function wineKey(w: Pick<WineFields, 'chateau' | 'appellation' | 'annee' | 'robe'>): string {
  return `${norm(w.chateau)}|${norm(w.appellation)}|${w.annee ?? ''}|${w.robe}`;
}

/**
 * Clé d'INTERCHANGEABILITÉ : deux bouteilles de même clé sont physiquement
 * identiques (même vin, même forme, même statut collection) et peuvent être
 * substituées l'une à l'autre lors d'une réorganisation.
 */
export function identityKey(b: WineFields & { collection: boolean }): string {
  const cep = b.cepages.map(norm).filter(Boolean).sort().join('+');
  return `${wineKey(b)}|${b.forme}|${cep}|${b.collection ? 'C' : ''}`;
}
