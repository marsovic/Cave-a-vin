import { getAiStatus } from '../ai/client';
import { fetchDrinkWindows, fetchPairings, scanLabel } from '../ai/tasks';
import { AiError, type ScanResult } from '../ai/types';
import {
  distinctWines,
  drinkStatus,
  estimateDrinkWindow,
  reportCollectionCandidates,
  reportDrinkSoon,
  reportPairing,
  reportPrioritize,
  type AdviceItem,
  type Pairing,
} from '../domain/advisor';
import { wineKey } from '../domain/normalize';
import type { Cellar, Criteria, DrinkWindow, WineFields } from '../domain/types';
import { useStore } from './store';
import type { AdviceKind, AdviceReport } from './types';

/** Annulation de la tâche IA en cours. */
let controller: AbortController | null = null;

/** Sources du dernier rapport, pour le recalculer quand la cave change. */
let lastSources: { windows: Map<string, DrinkWindow>; pairings: Map<string, Pairing> | undefined } | null = null;

export function cancelBusy(): void {
  controller?.abort();
}

export const ADVICE_TITLES: Record<AdviceKind, string> = {
  boire: 'À boire rapidement',
  accord: 'Accord mets-vin',
  privilegier: 'À privilégier',
  collection: 'Candidates à la collection',
};

function buildItems(
  kind: AdviceKind,
  cellar: Cellar,
  plat: string,
  year: number,
  sources: { windows: Map<string, DrinkWindow>; pairings: Map<string, Pairing> | undefined },
): AdviceItem[] {
  switch (kind) {
    case 'boire':
      return reportDrinkSoon(cellar, year, sources);
    case 'accord':
      return reportPairing(cellar, plat, year, sources);
    case 'privilegier':
      return reportPrioritize(cellar, plat, year, sources);
    case 'collection':
      return reportCollectionCandidates(cellar, year, sources);
  }
}

function dominantSource(items: AdviceItem[]): AdviceReport['source'] {
  let source: AdviceReport['source'] = 'local';
  for (const item of items) {
    for (const s of [item.window?.source, item.pairing?.source]) {
      if (s === 'ia-web') return 'ia-web';
      if (s === 'ia') source = 'ia';
    }
  }
  return source;
}

/** Recalcule le rapport affiché après une modification de la cave (mêmes sources). */
export function refreshAdvice(): void {
  const { advice, cellar } = useStore.getState();
  if (!advice || !lastSources) return;
  const items = buildItems(advice.kind, cellar, advice.plat, advice.annee, lastSources);
  useStore.setState({ advice: { ...advice, items } });
}

/**
 * Lance une fonction du sommelier : interroge l'IA si elle est disponible
 * (fenêtres de dégustation, accords), sinon — ou en cas d'échec — utilise la
 * base de connaissances locale. Toujours hors bouteilles de collection.
 */
export async function runAdvice(kind: AdviceKind): Promise<void> {
  const store = useStore.getState();
  if (store.busy || store.mode.kind !== 'normal') return;
  const plat = store.plat.trim();
  const needsPlat = kind === 'accord' || kind === 'privilegier';
  if (needsPlat && !plat) {
    store.toast('info', 'Indiquez d\'abord le plat prévu dans le champ « Plat ».');
    return;
  }
  const cellar = store.cellar;
  const wines = distinctWines(cellar);
  if (wines.length === 0) {
    store.toast(
      'info',
      cellar.bottles.length === 0
        ? 'La cave est vide.'
        : 'Toutes les bouteilles sont classées en collection : aucun conseil à donner.',
    );
    return;
  }

  const year = new Date().getFullYear();
  const windows = new Map<string, DrinkWindow>(Object.entries(store.aiWindows));
  let pairings: Map<string, Pairing> | undefined;
  let note: string | null = null;

  const abort = new AbortController();
  controller = abort;
  store.setBusy({ label: 'Le sommelier réfléchit…', progress: null });
  try {
    const status = await getAiStatus(store.ai, abort.signal);
    useStore.getState().setAiStatus(status);
    if (status.disponible) {
      try {
        if (kind !== 'accord') {
          const missing = wines.filter((w) => w.annee !== null && !windows.has(wineKey(w)));
          if (missing.length > 0) {
            useStore.getState().setBusy({ label: 'Recherche des fenêtres de dégustation…', progress: 0 });
            const found = await fetchDrinkWindows(missing, year, store.ai, {
              signal: abort.signal,
              onProgress: (done, total) =>
                useStore.getState().setBusy({
                  label: 'Recherche des fenêtres de dégustation…',
                  progress: total > 0 ? done / total : null,
                }),
            });
            for (const [key, value] of found) windows.set(key, value);
            useStore.getState().mergeAiWindows(Object.fromEntries(found));
          }
        }
        if (needsPlat) {
          let candidates: WineFields[] = wines;
          if (kind === 'privilegier') {
            // Seuls les vins à boire rapidement ont besoin d'un avis d'accord.
            candidates = wines.filter((w) => {
              const window = windows.get(wineKey(w)) ?? estimateDrinkWindow(w);
              return drinkStatus(window, year) === 'a-boire-vite';
            });
          }
          if (candidates.length > 0) {
            useStore.getState().setBusy({ label: `Recherche des accords avec « ${plat} »…`, progress: 0 });
            pairings = await fetchPairings(plat, candidates, year, store.ai, {
              signal: abort.signal,
              onProgress: (done, total) =>
                useStore.getState().setBusy({
                  label: `Recherche des accords avec « ${plat} »…`,
                  progress: total > 0 ? done / total : null,
                }),
            });
          }
        }
      } catch (error) {
        if (error instanceof AiError && error.code === 'annule') return;
        const message = error instanceof AiError ? error.message : 'L\'assistant IA n\'a pas répondu.';
        note = `${message} Conseils établis avec la base de connaissances locale.`;
      }
    } else if (!store.ai.desactivee) {
      note = `${status.message} Conseils établis avec la base de connaissances locale.`;
    }
    if (abort.signal.aborted) return;

    const sources = { windows, pairings };
    // La cave a pu changer pendant l'attente : on calcule sur l'état courant.
    const current = useStore.getState().cellar;
    const items = buildItems(kind, current, plat, year, sources);
    lastSources = sources;
    useStore.getState().setAdvice({ kind, plat, items, source: dominantSource(items), note, annee: year });
  } finally {
    if (controller === abort) controller = null;
    useStore.getState().setBusy(null);
  }
}

/** Met à jour l'état de disponibilité de l'IA (pastille, boutons). */
export async function refreshAiStatus(): Promise<void> {
  const { ai } = useStore.getState();
  try {
    const status = await getAiStatus(ai);
    // Les réglages ont pu changer entre-temps.
    if (useStore.getState().ai === ai) useStore.getState().setAiStatus(status);
  } catch {
    /* getAiStatus ne lève pas ; par sécurité on ignore. */
  }
}

/** Lit une étiquette photographiée et propose de préremplir le formulaire. */
export async function runScan(image: Blob): Promise<void> {
  const store = useStore.getState();
  if (store.busy) return;
  const abort = new AbortController();
  controller = abort;
  store.setBusy({ label: 'Lecture de l\'étiquette…', progress: null });
  try {
    const status = await getAiStatus(store.ai, abort.signal);
    useStore.getState().setAiStatus(status);
    if (!status.disponible) {
      useStore.getState().toast('erreur', `Le scan d'étiquette a besoin de l'assistant IA. ${status.message}`);
      useStore.getState().openDialog({ kind: 'ia' });
      return;
    }
    const result = await scanLabel(image, store.ai, abort.signal);
    let imageUrl: string | null = null;
    try {
      imageUrl = URL.createObjectURL(image);
    } catch {
      imageUrl = null;
    }
    useStore.getState().openDialog({ kind: 'scan', result, imageUrl });
  } catch (error) {
    if (error instanceof AiError && error.code === 'annule') return;
    useStore
      .getState()
      .toast('erreur', error instanceof AiError ? error.message : 'La lecture de l\'étiquette a échoué.');
  } finally {
    if (controller === abort) controller = null;
    useStore.getState().setBusy(null);
  }
}

/** Reporte dans le formulaire les champs retenus après un scan (la position est conservée). */
export function applyScan(result: ScanResult, keep: readonly (keyof ScanResult['fields'])[]): void {
  const patch: Partial<Criteria> = {};
  for (const key of keep) {
    const value = result.fields[key];
    if (value === undefined) continue;
    // Chaque champ a son type propre ; l'affectation indexée est sûre ici.
    (patch as Record<string, unknown>)[key] = value;
  }
  // Les champs « vin » non retenus sont vidés pour ne pas mélanger deux bouteilles.
  const cleared: Partial<Criteria> = { chateau: '', appellation: '', annee: '', cepages: '', robe: '', forme: '' };
  useStore.getState().patchForm({ ...cleared, ...patch });
  useStore.getState().setView('recherche');
  useStore.getState().closeDialog();
}
