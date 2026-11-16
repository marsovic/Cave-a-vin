import { bottlesInReadingOrder } from './cellar';
import { FORME_LABELS, ROBE_LABELS } from './labels';
import { joinCepages, norm, splitCepages } from './normalize';
import {
  EMPTY_CRITERIA,
  type Bottle,
  type Cellar,
  type Criteria,
  type Result,
  type WineFields,
} from './types';

/* ------------------------------------------------------------------ */
/* Expression d'année                                                  */
/* ------------------------------------------------------------------ */

export type YearFilter =
  | { ok: true; /** `true` si aucune contrainte. */ empty: boolean; test: (annee: number | null) => boolean; /** Année unique saisie, le cas échéant. */ single: number | null; /** `true` si l'expression désigne « sans millésime ». */ none: boolean }
  | { ok: false; error: string };

const NONE_WORDS = new Set(['sans', 'nm', 'nv', 'aucune', 'aucun', 'vide', 'non millesime', 'sans annee', 'sans millesime']);

function expandYear(text: string): number | null {
  if (!/^\d{2}$|^\d{4}$/.test(text)) return null;
  let y = Number(text);
  if (text.length === 2) {
    // « 15 » → 2015, « 98 » → 1998 : fenêtre glissante autour de l'année courante.
    const now = new Date().getFullYear();
    const pivot = (now % 100) + 1;
    y += y <= pivot ? 2000 : 1900;
  }
  return y;
}

/**
 * Analyse une expression d'année du formulaire.
 * Formes acceptées (séparées par des virgules ou des espaces = « ou ») :
 *  `2015` · `15` · `2010-2015` · `2010..2015` · `<2012` · `<=2012` · `>2018` · `>=2018`
 *  · `sans` / `NM` (bouteilles sans millésime).
 */
export function parseYearExpr(expr: string): YearFilter {
  const raw = expr.trim();
  if (!raw) return { ok: true, empty: true, test: () => true, single: null, none: false };

  const lowered = norm(raw);
  if (NONE_WORDS.has(lowered)) {
    return { ok: true, empty: false, test: (a) => a === null, single: null, none: true };
  }

  const tests: ((a: number | null) => boolean)[] = [];
  let single: number | null = null;
  let none = false;
  // Normalise les séparateurs de plage (« 2010 à 2015 », « 2010 – 2015 », « 2010..2015 »).
  const cleaned = raw
    .replace(/\s*(?:à|a|au|–|—|\.\.+)\s*/gi, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/([<>]=?)\s+/g, '$1');
  const parts = cleaned.split(/[,;\s]+/).filter(Boolean);
  for (const part of parts) {
    if (NONE_WORDS.has(norm(part))) {
      none = true;
      tests.push((a) => a === null);
      continue;
    }
    const cmp = /^(<=|>=|<|>|=)(\d{2}|\d{4})$/.exec(part);
    if (cmp) {
      const y = expandYear(cmp[2]!);
      if (y === null) return { ok: false, error: `Année non comprise : « ${part} ».` };
      const op = cmp[1]!;
      tests.push((a) => {
        if (a === null) return false;
        if (op === '<') return a < y;
        if (op === '<=') return a <= y;
        if (op === '>') return a > y;
        if (op === '>=') return a >= y;
        return a === y;
      });
      continue;
    }
    const range = /^(\d{2}|\d{4})-(\d{2}|\d{4})$/.exec(part);
    if (range) {
      const a0 = expandYear(range[1]!);
      const b0 = expandYear(range[2]!);
      if (a0 === null || b0 === null) return { ok: false, error: `Année non comprise : « ${part} ».` };
      const lo = Math.min(a0, b0);
      const hi = Math.max(a0, b0);
      tests.push((a) => a !== null && a >= lo && a <= hi);
      continue;
    }
    const y = expandYear(part);
    if (y === null) {
      return {
        ok: false,
        error: `Année non comprise : « ${part} ». Exemples : 2015, 2010-2015, <2012, >=2018, sans.`,
      };
    }
    if (parts.length === 1) single = y;
    tests.push((a) => a === y);
  }
  return { ok: true, empty: false, test: (a) => tests.some((t) => t(a)), single, none: none && parts.length === 1 };
}

/* ------------------------------------------------------------------ */
/* Critères                                                            */
/* ------------------------------------------------------------------ */

/** Au moins un critère décrivant le vin (château, appellation, année, cépages, robe, forme) ? */
export function hasWineCriteria(c: Criteria): boolean {
  return Boolean(
    c.chateau.trim() || c.appellation.trim() || c.annee.trim() || c.cepages.trim() || c.robe || c.forme,
  );
}

/** Au moins un critère de position (clayette, rang) ? */
export function hasPositionCriteria(c: Criteria): boolean {
  return Boolean(c.clayette.trim() || c.rang.trim());
}

export function hasAnyCriteria(c: Criteria): boolean {
  return hasWineCriteria(c) || hasPositionCriteria(c);
}

/** Lit un champ numérique entier positif (« 3 » → 3) ; `null` si vide, `NaN` si invalide. */
export function parsePositiveInt(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d{1,3}$/.test(t)) return Number.NaN;
  const n = Number(t);
  return n >= 1 ? n : Number.NaN;
}

/** Première erreur de saisie dans les critères (année illisible, n° de clayette invalide…), sinon `null`. */
export function criteriaError(c: Criteria, cellar?: Cellar): string | null {
  const year = parseYearExpr(c.annee);
  if (!year.ok) return year.error;
  const clayette = parsePositiveInt(c.clayette);
  if (Number.isNaN(clayette)) return 'Le n° de clayette doit être un nombre entier.';
  const rang = parsePositiveInt(c.rang);
  if (Number.isNaN(rang)) return 'Le n° de rang doit être un nombre entier.';
  if (cellar && clayette !== null) {
    const shelf = cellar.shelves[clayette - 1];
    if (!shelf) return `La cave n'a que ${cellar.shelves.length} clayette(s).`;
    if (rang !== null && rang > shelf.capacite) {
      return `La clayette ${clayette} n'a que ${shelf.capacite} emplacement(s).`;
    }
  }
  if (cellar && clayette === null && rang !== null) {
    const max = Math.max(...cellar.shelves.map((s) => s.capacite));
    if (rang > max) return `Aucune clayette n'a de rang ${rang}.`;
  }
  return null;
}

/**
 * Compile des critères en prédicat. Les textes sont comparés sans tenir compte
 * de la casse ni des accents ; château et appellation par inclusion ; tous les
 * cépages saisis doivent figurer dans la bouteille. Des critères invalides ne
 * correspondent à aucune bouteille.
 */
export function compileCriteria(c: Criteria): (b: Bottle) => boolean {
  const year = parseYearExpr(c.annee);
  const clayette = parsePositiveInt(c.clayette);
  const rang = parsePositiveInt(c.rang);
  if (!year.ok || Number.isNaN(clayette) || Number.isNaN(rang)) return () => false;
  const chateau = norm(c.chateau);
  const appellation = norm(c.appellation);
  const cepages = splitCepages(c.cepages).map(norm);
  return (b) => {
    if (clayette !== null && b.clayette !== clayette) return false;
    if (rang !== null && b.rang !== rang) return false;
    if (c.robe && b.robe !== c.robe) return false;
    if (c.forme && b.forme !== c.forme) return false;
    if (!year.empty && !year.test(b.annee)) return false;
    if (chateau && !norm(b.chateau).includes(chateau)) return false;
    if (appellation && !norm(b.appellation).includes(appellation)) return false;
    if (cepages.length > 0) {
      const own = b.cepages.map(norm);
      if (!cepages.every((q) => own.some((o) => o.includes(q)))) return false;
    }
    return true;
  };
}

export function matchBottle(b: Bottle, c: Criteria): boolean {
  return compileCriteria(c)(b);
}

/** Bouteilles correspondant aux critères, dans l'ordre de lecture de la cave. */
export function searchBottles(cellar: Cellar, c: Criteria): Bottle[] {
  const test = compileCriteria(c);
  return bottlesInReadingOrder(cellar).filter(test);
}

/** Résumé lisible des critères : « Rouge · Margaux · 2010-2015 · clayette 3 ». */
export function describeCriteria(c: Criteria): string {
  const parts: string[] = [];
  if (c.chateau.trim()) parts.push(`« ${c.chateau.trim()} »`);
  if (c.appellation.trim()) parts.push(c.appellation.trim());
  if (c.annee.trim()) parts.push(c.annee.trim());
  if (c.robe) parts.push(ROBE_LABELS[c.robe]);
  if (c.cepages.trim()) parts.push(splitCepages(c.cepages).join(' + '));
  if (c.forme) parts.push(`forme ${FORME_LABELS[c.forme]}`);
  if (c.clayette.trim()) parts.push(`clayette ${c.clayette.trim()}`);
  if (c.rang.trim()) parts.push(`rang ${c.rang.trim()}`);
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ */
/* Formulaire ↔ bouteille                                              */
/* ------------------------------------------------------------------ */

/** Remplit le formulaire avec les données d'une bouteille (position comprise). */
export function criteriaFromBottle(b: Bottle): Criteria {
  return {
    chateau: b.chateau,
    appellation: b.appellation,
    annee: b.annee === null ? '' : String(b.annee),
    cepages: joinCepages(b.cepages),
    robe: b.robe,
    forme: b.forme,
    clayette: String(b.clayette),
    rang: String(b.rang),
  };
}

/** Critères « vin » d'une description de vin (sans position). */
export function criteriaFromWine(w: Partial<WineFields>): Criteria {
  return {
    ...EMPTY_CRITERIA,
    chateau: w.chateau ?? '',
    appellation: w.appellation ?? '',
    annee: w.annee == null ? '' : String(w.annee),
    cepages: w.cepages ? joinCepages(w.cepages) : '',
    robe: w.robe ?? '',
    forme: w.forme ?? '',
  };
}

/**
 * Convertit le formulaire en description de vin, pour ajouter ou modifier une
 * bouteille. Exige : château ou appellation, robe, forme ; l'année doit être
 * une année unique ou vide.
 */
export function wineFromCriteria(c: Criteria): Result<WineFields> {
  const chateau = c.chateau.replace(/\s+/g, ' ').trim();
  const appellation = c.appellation.replace(/\s+/g, ' ').trim();
  if (!chateau && !appellation) {
    return { ok: false, error: 'Indiquez au moins le château ou l\'appellation.' };
  }
  const year = parseYearExpr(c.annee);
  if (!year.ok) return { ok: false, error: year.error };
  let annee: number | null = null;
  if (!year.empty && !year.none) {
    if (year.single === null) {
      return { ok: false, error: 'Pour une bouteille, indiquez une seule année (ex. 2015) ou laissez vide.' };
    }
    const max = new Date().getFullYear() + 1;
    if (year.single < 1800 || year.single > max) {
      return { ok: false, error: `L'année doit être comprise entre 1800 et ${max}.` };
    }
    annee = year.single;
  }
  if (!c.robe) return { ok: false, error: 'Choisissez la robe (Rouge, Blanc, Blanc liquoreux ou Rosé).' };
  if (!c.forme) return { ok: false, error: 'Choisissez la forme de la bouteille.' };
  return {
    ok: true,
    value: { chateau, appellation, annee, cepages: splitCepages(c.cepages), robe: c.robe, forme: c.forme },
  };
}
