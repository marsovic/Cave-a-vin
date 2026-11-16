import { create } from 'zustand';
import { DEFAULT_AI_SETTINGS, type AiSettings, type AiStatus } from '../ai/types';
import {
  addBottles,
  bottleAt,
  bottleById,
  defaultCellar,
  moveBottle,
  removeBottles,
  setCollection,
  swapBottles,
  updateBottle,
  updateShelves,
} from '../domain/cellar';
import { suggestWineDefaults } from '../domain/knowledge';
import { formatSlot, formatSlotShort, formatWine } from '../domain/labels';
import { suggestSlots } from '../domain/placement';
import { applyReorgStep, planReorganization, revertReorgStep, type ReorgMode } from '../domain/reorg';
import { criteriaFromBottle, parsePositiveInt, wineFromCriteria } from '../domain/search';
import {
  EMPTY_CRITERIA,
  type Bottle,
  type Cellar,
  type Criteria,
  type DrinkWindow,
  type Shelf,
  type SlotRef,
} from '../domain/types';
import { computeTarget, formSlot } from './selectors';
import {
  DEFAULT_PREFS,
  type AdviceReport,
  type BusyState,
  type Dialog,
  type FileState,
  type HistoryEntry,
  type Mode,
  type Prefs,
  type Toast,
  type View,
} from './types';

const HISTORY_LIMIT = 100;
export const MAX_QUANTITY = 24;

export interface AppState {
  /** Les données ont été chargées depuis le navigateur. */
  ready: boolean;
  cellar: Cellar;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Numéro de révision de la cave : augmente à chaque modification, annulation ou rétablissement. */
  rev: number;

  /** Critères du formulaire. */
  form: Criteria;
  /** Plat saisi pour les accords mets-vin. */
  plat: string;

  mode: Mode;
  view: View;
  advice: AdviceReport | null;
  busy: BusyState | null;

  ai: AiSettings;
  aiStatus: AiStatus | null;
  /** Fenêtres de dégustation obtenues par l'IA, par clé de vin. */
  aiWindows: Record<string, DrinkWindow>;

  file: FileState;
  prefs: Prefs;
  toasts: Toast[];
  dialog: Dialog | null;
  /** Demande au schéma de faire défiler jusqu'à un emplacement. */
  reveal: { slot: SlotRef; nonce: number } | null;
  /** Panneau des résultats ouvert (utile sur téléphone, où il est repliable). */
  panelOpen: boolean;
  /** Clayette agrandie dans la « loupe » (téléphone) et rang visé, ou `null`. */
  loupe: SlotRef | null;

  /* ---------- formulaire ---------- */
  setField: <K extends keyof Criteria>(name: K, value: Criteria[K]) => void;
  /** Remplace plusieurs champs d'un coup (scan, valeurs déduites de l'appellation). */
  patchForm: (patch: Partial<Criteria>) => void;
  setPlat: (plat: string) => void;
  clearForm: () => void;
  /** Retire la désignation d'un emplacement (clayette + rang) ; les critères « vin » sont conservés. */
  deselect: () => void;
  /** Bascule le critère « clayette n » seul (clic sur l'étiquette d'une clayette). */
  toggleShelf: (clayette: number) => void;

  /* ---------- schéma ---------- */
  tapSlot: (slot: SlotRef) => void;
  /** Glisser-déposer : déplace (emplacement libre) ou échange (emplacement occupé). */
  dropBottle: (bottleId: string, to: SlotRef) => void;
  /** Désigne une bouteille (depuis une liste de résultats) et la montre dans le schéma. */
  pinBottle: (bottleId: string) => void;

  /* ---------- actions sur la cible ---------- */
  startAdd: () => void;
  confirmPlacement: () => void;
  /** Change le nombre de bouteilles identiques à ranger (mode placement). */
  setPlacementCount: (count: number) => void;
  removeTarget: () => void;
  /** Correction : charge la bouteille désignée dans le formulaire pour la modifier. */
  startEdit: () => void;
  saveEdit: () => void;
  /** Reprend la description d'une bouteille comme critères (pour retrouver ses semblables ou en ajouter une). */
  reuseBottle: (bottleId: string) => void;
  startMove: () => void;
  classify: (collection: boolean) => void;
  classifyBottles: (ids: string[], collection: boolean) => void;
  toggleFree: () => void;
  setView: (view: View) => void;
  cancelMode: () => void;

  /* ---------- réorganisation ---------- */
  openReorg: () => void;
  chooseReorg: (mode: ReorgMode) => void;
  /** Aperçu du schéma avant / après la réorganisation. */
  setReorgApercu: (apercu: 'avant' | 'apres') => void;
  startReorg: () => void;
  reorgNext: () => void;
  reorgPrev: () => void;
  quitReorg: () => void;

  /* ---------- cave ---------- */
  applyShelves: (shelves: Shelf[]) => boolean;
  replaceCellar: (cellar: Cellar, label: string) => void;
  /**
   * Charge une cave lue dans le fichier lié : l'historique est vidé, car « annuler » ferait
   * réécrire l'ancienne cave par-dessus le fichier qui fait désormais référence.
   */
  loadCellar: (cellar: Cellar) => void;
  undo: () => void;
  redo: () => void;

  /* ---------- divers ---------- */
  setAdvice: (advice: AdviceReport | null) => void;
  setBusy: (busy: BusyState | null) => void;
  setAi: (patch: Partial<AiSettings>) => void;
  setAiStatus: (status: AiStatus | null) => void;
  mergeAiWindows: (windows: Record<string, DrinkWindow>) => void;
  clearAiWindows: () => void;
  setFile: (patch: Partial<FileState>) => void;
  setPrefs: (patch: Partial<Prefs>) => void;
  openDialog: (dialog: Dialog) => void;
  closeDialog: () => void;
  toast: (kind: Toast['kind'], message: string, opts?: { undo?: boolean }) => void;
  dismissToast: (id: number) => void;
  setPanelOpen: (open: boolean) => void;
  setLoupe: (slot: SlotRef | null) => void;
  /** Initialisation (appelée une fois par la couche de persistance). */
  hydrate: (patch: Partial<AppState>) => void;
}

let toastId = 0;
let revealNonce = 0;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

const WINE_FIELDS: readonly (keyof Criteria)[] = ['chateau', 'appellation', 'annee', 'cepages', 'robe'];

export const useStore = create<AppState>()((set, get) => {
  /** Enregistre une modification de la cave dans l'historique. */
  const commit = (next: Cellar, label: string, extra: Partial<AppState> = {}): void => {
    set((s) => ({
      cellar: next,
      past: [...s.past, { cellar: s.cellar, label }].slice(-HISTORY_LIMIT),
      future: [],
      rev: s.rev + 1,
      ...extra,
    }));
  };

  const notify = (kind: Toast['kind'], message: string, opts: { undo?: boolean } = {}): void => {
    toastId += 1;
    const toast: Toast = { id: toastId, kind, message, undo: opts.undo, rev: get().rev };
    set((s) => ({ toasts: [...s.toasts.slice(-3), toast] }));
  };

  const revealSlot = (slot: SlotRef): void => {
    revealNonce += 1;
    set({ reveal: { slot, nonce: revealNonce } });
  };

  /** Déplace ou échange, puis garde la bouteille déplacée désignée dans le formulaire. */
  const moveOrSwap = (bottleId: string, to: SlotRef): boolean => {
    const { cellar, form } = get();
    const bottle = bottleById(cellar, bottleId);
    if (!bottle) {
      notify('erreur', 'Cette bouteille n\'existe plus.');
      return false;
    }
    if (bottle.clayette === to.clayette && bottle.rang === to.rang) return false;
    const occupant = bottleAt(cellar, to);
    const from = { clayette: bottle.clayette, rang: bottle.rang };
    const wasPinned = formSlot(cellar, form);
    const followPin =
      wasPinned && wasPinned.clayette === from.clayette && wasPinned.rang === from.rang
        ? { form: { ...form, clayette: String(to.clayette), rang: String(to.rang) } }
        : {};
    if (occupant) {
      const res = swapBottles(cellar, bottle.id, occupant.id);
      if (!res.ok) {
        notify('erreur', res.error);
        return false;
      }
      commit(res.value, 'Échange de deux bouteilles', { mode: { kind: 'normal' }, ...followPin });
      notify(
        'succes',
        `Échange effectué : ${formatWine(bottle)} ⇄ ${formatWine(occupant)} (${formatSlotShort(from)} ⇄ ${formatSlotShort(to)}).`,
        { undo: true },
      );
    } else {
      const res = moveBottle(cellar, bottle.id, to);
      if (!res.ok) {
        notify('erreur', res.error);
        return false;
      }
      commit(res.value, 'Déplacement d\'une bouteille', { mode: { kind: 'normal' }, ...followPin });
      notify('succes', `${formatWine(bottle)} déplacée : ${formatSlotShort(from)} → ${formatSlotShort(to)}.`, {
        undo: true,
      });
    }
    return true;
  };

  const applyCollection = (ids: string[], collection: boolean): void => {
    const { cellar } = get();
    const concerned = cellar.bottles.filter((b) => ids.includes(b.id) && b.collection !== collection);
    if (concerned.length === 0) return;
    commit(
      setCollection(
        cellar,
        concerned.map((b) => b.id),
        collection,
      ),
      collection ? 'Classement en collection' : 'Déclassement de collection',
    );
    const what =
      concerned.length === 1 ? formatWine(concerned[0]!) : plural(concerned.length, 'bouteille', 'bouteilles');
    notify('succes', collection ? `${what} : classé en collection.` : `${what} : retiré de la collection.`, {
      undo: true,
    });
  };

  return {
    ready: false,
    cellar: defaultCellar(),
    past: [],
    future: [],
    rev: 0,
    form: { ...EMPTY_CRITERIA },
    plat: '',
    mode: { kind: 'normal' },
    view: 'recherche',
    advice: null,
    busy: null,
    ai: { ...DEFAULT_AI_SETTINGS },
    aiStatus: null,
    aiWindows: {},
    file: {
      linkSupported: false,
      linked: null,
      syncedMtime: null,
      dirty: false,
      conflict: false,
      error: null,
      lastName: null,
      savedAt: null,
    },
    prefs: { ...DEFAULT_PREFS },
    toasts: [],
    dialog: null,
    reveal: null,
    panelOpen: false,
    loupe: null,

    /* ---------------- formulaire ---------------- */

    setField: (name, value) => {
      set((s) => {
        const form = { ...s.form, [name]: value };
        // Saisir un critère de vin ramène à la vue « recherche » (mise en valeur en direct).
        const view: View = WINE_FIELDS.includes(name) && s.view !== 'recherche' ? 'recherche' : s.view;
        return { form, view };
      });
    },

    patchForm: (patch) => set((s) => ({ form: { ...s.form, ...patch } })),

    setPlat: (plat) => set({ plat }),

    clearForm: () => set({ form: { ...EMPTY_CRITERIA }, view: 'recherche' }),

    deselect: () => set((s) => ({ form: { ...s.form, clayette: '', rang: '' } })),

    toggleShelf: (clayette) => {
      const { form, mode } = get();
      if (mode.kind !== 'normal') return;
      const same = form.clayette.trim() === String(clayette) && !form.rang.trim();
      set({ form: { ...form, clayette: same ? '' : String(clayette), rang: '' } });
    },

    /* ---------------- schéma ---------------- */

    tapSlot: (slot) => {
      const { cellar, form, mode } = get();
      const bottle = bottleAt(cellar, slot);

      if (mode.kind === 'reorg' || mode.kind === 'reorg-apercu') return;

      if (mode.kind === 'deplacement') {
        if (bottle?.id === mode.bottleId) {
          set({ mode: { kind: 'normal' } });
          return;
        }
        moveOrSwap(mode.bottleId, slot);
        return;
      }

      if (mode.kind === 'placement') {
        if (bottle) {
          notify('erreur', `L'emplacement ${formatSlot(slot)} est occupé par ${formatWine(bottle)}.`);
          return;
        }
        // L'utilisateur désigne lui-même l'emplacement : la proposition repart de là
        // (les bouteilles suivantes continuent vers la droite sur la même clayette).
        const suggestion = suggestSlots(cellar, mode.wine, mode.count, slot);
        if (suggestion.slots.length === 0) {
          notify('erreur', suggestion.message);
          return;
        }
        set({
          mode: {
            ...mode,
            slots: suggestion.slots,
            complete: suggestion.complete,
            message: suggestion.message,
            prefer: { clayette: slot.clayette, rang: slot.rang },
          },
        });
        return;
      }

      if (mode.kind === 'correction') {
        notify('info', 'Enregistrez ou annulez d\'abord la correction en cours.');
        return;
      }

      // Mode normal : toucher un emplacement écrit sa clayette et son rang dans le formulaire
      // (les critères « vin » ne changent jamais) ; le retoucher retire la désignation.
      const current = formSlot(cellar, form);
      const same = current !== null && current.clayette === slot.clayette && current.rang === slot.rang;
      if (same) {
        get().deselect();
        return;
      }
      set({ form: { ...form, clayette: String(slot.clayette), rang: String(slot.rang) } });
    },

    dropBottle: (bottleId, to) => {
      const { mode } = get();
      if (mode.kind !== 'normal' && mode.kind !== 'deplacement') return;
      moveOrSwap(bottleId, to);
    },

    pinBottle: (bottleId) => {
      const { cellar, form, mode } = get();
      if (mode.kind !== 'normal') return;
      const bottle = bottleById(cellar, bottleId);
      if (!bottle) return;
      set({ form: { ...form, clayette: String(bottle.clayette), rang: String(bottle.rang) } });
      revealSlot(bottle);
    },

    /* ---------------- actions sur la cible ---------------- */

    startAdd: () => {
      const { cellar, form, mode } = get();
      if (mode.kind !== 'normal') return;
      // Robe, forme et cépages absents : on reprend les valeurs habituelles de l'appellation.
      let filled = form;
      if (form.appellation.trim() && (!form.robe || !form.forme || !form.cepages.trim())) {
        const d = suggestWineDefaults(form.appellation, form.robe);
        filled = {
          ...form,
          robe: form.robe || d.robe || '',
          forme: form.forme || d.forme || '',
          cepages: form.cepages.trim() ? form.cepages : (d.cepages ?? []).join(', '),
        };
      }
      const wine = wineFromCriteria(filled);
      if (!wine.ok) {
        notify('erreur', `Pour ajouter une bouteille : ${wine.error}`);
        return;
      }
      if (filled !== form) set({ form: filled });
      const count = 1;
      const slot = formSlot(cellar, form);
      const clayette = parsePositiveInt(form.clayette);
      const prefer: { clayette?: number; rang?: number } = {};
      const designated = slot !== null && !bottleAt(cellar, slot);
      if (designated && slot) {
        prefer.clayette = slot.clayette;
        prefer.rang = slot.rang;
      } else if (slot === null && clayette !== null && !Number.isNaN(clayette) && cellar.shelves[clayette - 1]) {
        prefer.clayette = clayette;
      }
      const suggestion = suggestSlots(cellar, wine.value, count, prefer);
      if (suggestion.slots.length === 0) {
        notify('erreur', suggestion.message);
        return;
      }
      set({
        mode: {
          kind: 'placement',
          wine: wine.value,
          count,
          slots: suggestion.slots,
          complete: suggestion.complete,
          message: suggestion.message,
          prefer,
        },
        view: 'recherche',
      });
      revealSlot(suggestion.slots[0]!);
    },

    setPlacementCount: (count) => {
      const { cellar, mode } = get();
      if (mode.kind !== 'placement') return;
      const n = Math.min(MAX_QUANTITY, Math.max(1, Math.round(count)));
      if (n === mode.count) return;
      let suggestion = suggestSlots(cellar, mode.wine, n, mode.prefer);
      let prefer = mode.prefer;
      // Pas assez de place à l'endroit imposé : on laisse l'application choisir librement.
      if (!suggestion.complete && (prefer.clayette !== undefined || prefer.rang !== undefined)) {
        const free = suggestSlots(cellar, mode.wine, n, {});
        if (free.slots.length > suggestion.slots.length) {
          suggestion = free;
          prefer = {};
        }
      }
      if (suggestion.slots.length === 0) {
        notify('erreur', suggestion.message);
        return;
      }
      set({
        mode: {
          ...mode,
          count: n,
          slots: suggestion.slots,
          complete: suggestion.complete,
          message: suggestion.message,
          prefer,
        },
      });
    },

    confirmPlacement: () => {
      const { cellar, mode, form } = get();
      if (mode.kind !== 'placement' || mode.slots.length === 0) return;
      const res = addBottles(cellar, mode.wine, mode.slots);
      if (!res.ok) {
        notify('erreur', res.error);
        return;
      }
      const where = mode.slots.map(formatSlotShort).join(', ');
      commit(res.value.cellar, `Ajout de ${plural(mode.slots.length, 'bouteille', 'bouteilles')}`, {
        mode: { kind: 'normal' },
        // On retire la position : le formulaire met alors en valeur toutes les bouteilles de ce vin.
        form: { ...form, clayette: '', rang: '' },
      });
      notify(
        'succes',
        mode.slots.length === 1
          ? `${formatWine(mode.wine)} ajoutée en ${where}.`
          : `${mode.slots.length} bouteilles de ${formatWine(mode.wine)} ajoutées : ${where}.`,
        { undo: true },
      );
      if (mode.slots.length < mode.count) {
        notify('info', `${mode.count - mode.slots.length} bouteille(s) n'ont pas pu être placées faute de place.`);
      }
    },

    removeTarget: () => {
      const { cellar, form, mode } = get();
      if (mode.kind !== 'normal') return;
      const target = computeTarget(cellar, form);
      if (target.bottles.length === 0) {
        notify(
          'info',
          'Touchez une bouteille dans le schéma, ou saisissez des critères, pour indiquer quoi supprimer.',
        );
        return;
      }
      const bottles = target.bottles;
      const run = (): void => {
        const current = get();
        commit(
          removeBottles(
            current.cellar,
            bottles.map((b) => b.id),
          ),
          `Suppression de ${plural(bottles.length, 'bouteille', 'bouteilles')}`,
          // La bouteille désignée n'existe plus : on retire la désignation.
          {
            dialog: null,
            ...(target.kind === 'bouteille' ? { form: { ...current.form, clayette: '', rang: '' } } : {}),
          },
        );
        notify(
          'succes',
          bottles.length === 1
            ? `${formatWine(bottles[0]!)} supprimée de la cave (${formatSlotShort(bottles[0]!)}).`
            : `${bottles.length} bouteilles supprimées de la cave.`,
          { undo: true },
        );
      };
      // Une bouteille ordinaire : suppression immédiate, annulable. Une bouteille de collection
      // ou plusieurs bouteilles : confirmation avec la liste nominative.
      const single = bottles[0]!;
      if (bottles.length === 1 && !single.collection) {
        run();
        return;
      }
      set({
        dialog:
          bottles.length === 1
            ? {
                kind: 'confirm',
                title: 'Supprimer cette bouteille de collection ?',
                message: `${formatWine(single)} (${formatSlot(single)}) est classée en collection.`,
                confirmLabel: 'Supprimer',
                danger: true,
                onConfirm: run,
              }
            : {
                kind: 'confirm',
                title: `Supprimer ${bottles.length} bouteilles ?`,
                message: 'Toutes les bouteilles correspondant aux critères seront supprimées de la cave.',
                details: bottles.map(
                  (b) => `${formatWine(b)} — ${formatSlot(b)}${b.collection ? ' — ★ collection' : ''}`,
                ),
                confirmLabel: `Supprimer les ${bottles.length} bouteilles`,
                danger: true,
                onConfirm: run,
              },
      });
    },

    startEdit: () => {
      const { cellar, form, mode } = get();
      if (mode.kind !== 'normal') return;
      const target = computeTarget(cellar, form);
      const bottle = target.bottles[0];
      if (target.kind !== 'bouteille' || !bottle) {
        notify('info', 'Touchez d\'abord dans le schéma la bouteille à corriger.');
        return;
      }
      set({
        mode: { kind: 'correction', bottleId: bottle.id, previous: form },
        form: criteriaFromBottle(bottle),
        view: 'recherche',
      });
    },

    saveEdit: () => {
      const { cellar, form, mode } = get();
      if (mode.kind !== 'correction') return;
      const bottle = bottleById(cellar, mode.bottleId);
      if (!bottle) {
        set({ mode: { kind: 'normal' }, form: mode.previous });
        return;
      }
      const wine = wineFromCriteria(form);
      if (!wine.ok) {
        notify('erreur', wine.error);
        return;
      }
      const res = updateBottle(cellar, bottle.id, wine.value);
      if (!res.ok) {
        notify('erreur', res.error);
        return;
      }
      // Retour à la recherche précédente, la bouteille corrigée restant désignée.
      commit(res.value, 'Correction d\'une bouteille', {
        mode: { kind: 'normal' },
        form: { ...mode.previous, clayette: String(bottle.clayette), rang: String(bottle.rang) },
      });
      notify('succes', `Bouteille ${formatSlotShort(bottle)} corrigée : ${formatWine(wine.value)}.`, { undo: true });
    },

    reuseBottle: (bottleId) => {
      const { cellar, mode } = get();
      if (mode.kind !== 'normal') return;
      const bottle = bottleById(cellar, bottleId);
      if (!bottle) return;
      set({ form: { ...criteriaFromBottle(bottle), clayette: '', rang: '' }, view: 'recherche' });
    },

    startMove: () => {
      const { cellar, form, mode } = get();
      if (mode.kind !== 'normal') return;
      const target = computeTarget(cellar, form);
      if (target.bottles.length !== 1) {
        notify(
          'info',
          target.bottles.length === 0
            ? 'Touchez d\'abord la bouteille à déplacer dans le schéma.'
            : `${target.bottles.length} bouteilles correspondent : touchez celle à déplacer dans le schéma.`,
        );
        return;
      }
      set({ mode: { kind: 'deplacement', bottleId: target.bottles[0]!.id }, view: 'recherche' });
    },

    classify: (collection) => {
      const { cellar, form, mode } = get();
      if (mode.kind !== 'normal') return;
      const target = computeTarget(cellar, form);
      if (target.bottles.length === 0) {
        notify(
          'info',
          'Touchez une bouteille dans le schéma, ou saisissez des critères, pour indiquer quoi classer.',
        );
        return;
      }
      const concerned = target.bottles.filter((b) => b.collection !== collection);
      if (concerned.length === 0) {
        notify(
          'info',
          collection
            ? 'Ces bouteilles sont déjà classées en collection.'
            : 'Aucune de ces bouteilles n\'est classée en collection.',
        );
        return;
      }
      const ids = concerned.map((b) => b.id);
      if (concerned.length === 1) {
        applyCollection(ids, collection);
        return;
      }
      set({
        dialog: {
          kind: 'confirm',
          title: collection
            ? `Classer ${concerned.length} bouteilles en collection ?`
            : `Retirer ${concerned.length} bouteilles de la collection ?`,
          message: collection
            ? 'Les bouteilles de collection sont exclues des conseils de dégustation.'
            : 'Ces bouteilles seront de nouveau prises en compte dans les conseils de dégustation.',
          details: concerned.map((b) => `${formatWine(b)} — ${formatSlot(b)}`),
          confirmLabel: collection ? 'Classer en collection' : 'Retirer de la collection',
          onConfirm: () => {
            set({ dialog: null });
            applyCollection(ids, collection);
          },
        },
      });
    },

    classifyBottles: (ids, collection) => applyCollection(ids, collection),

    toggleFree: () =>
      set((s) => (s.view === 'libres' ? { view: 'recherche' as View } : { view: 'libres' as View, panelOpen: true })),

    setView: (view) => set({ view }),

    cancelMode: () => {
      const { mode } = get();
      if (mode.kind === 'reorg') {
        get().quitReorg();
        return;
      }
      if (mode.kind === 'correction') {
        // On rend au formulaire les critères d'avant la correction.
        set({ mode: { kind: 'normal' }, form: mode.previous });
        return;
      }
      set({ mode: { kind: 'normal' } });
    },

    /* ---------------- réorganisation ---------------- */

    openReorg: () => {
      const { cellar, mode, prefs } = get();
      if (mode.kind !== 'normal') return;
      if (cellar.bottles.length === 0) {
        notify('info', 'La cave est vide : rien à réorganiser.');
        return;
      }
      const plans = {
        economique: planReorganization(cellar, { mode: 'economique' }),
        compact: planReorganization(cellar, { mode: 'compact' }),
      };
      set({
        mode: { kind: 'reorg-apercu', plans, choix: prefs.reorgMode, apercu: 'avant' },
        view: 'recherche',
        panelOpen: true,
      });
    },

    chooseReorg: (choix) => {
      const { mode } = get();
      if (mode.kind !== 'reorg-apercu') return;
      set((s) => ({ mode: { ...mode, choix }, prefs: { ...s.prefs, reorgMode: choix } }));
    },

    setReorgApercu: (apercu) => {
      const { mode } = get();
      if (mode.kind === 'reorg-apercu') set({ mode: { ...mode, apercu } });
    },

    startReorg: () => {
      const { mode, cellar } = get();
      if (mode.kind !== 'reorg-apercu') return;
      const plan = mode.plans[mode.choix];
      if (plan.steps.length === 0) {
        set({ mode: { kind: 'normal' } });
        notify('info', 'La cave est déjà rangée : aucun déplacement nécessaire.');
        return;
      }
      set({ mode: { kind: 'reorg', plan, index: 0, horsCave: [], depart: cellar } });
      const first = plan.steps[0]!;
      if (first.from !== 'hors-cave') revealSlot(first.from);
    },

    reorgNext: () => {
      const { mode, cellar } = get();
      if (mode.kind !== 'reorg') return;
      const step = mode.plan.steps[mode.index];
      if (!step) return;
      const res = applyReorgStep({ cellar, horsCave: mode.horsCave }, step);
      if (!res.ok) {
        notify('erreur', res.error);
        return;
      }
      const index = mode.index + 1;
      if (index >= mode.plan.steps.length) {
        // Terminé : toute la réorganisation devient une seule entrée d'historique.
        set((s) => ({
          cellar: res.value.cellar,
          past: [...s.past, { cellar: mode.depart, label: 'Réorganisation de la cave' }].slice(-HISTORY_LIMIT),
          future: [],
          rev: s.rev + 1,
          mode: { kind: 'normal' },
          form: { ...EMPTY_CRITERIA },
        }));
        notify(
          'succes',
          `Cave réorganisée en ${plural(mode.plan.steps.length, 'déplacement', 'déplacements')}. Bravo !`,
        );
        return;
      }
      set({ cellar: res.value.cellar, mode: { ...mode, index, horsCave: res.value.horsCave } });
      const next = mode.plan.steps[index]!;
      if (next.from !== 'hors-cave') revealSlot(next.from);
      else if (next.to !== 'hors-cave') revealSlot(next.to);
    },

    reorgPrev: () => {
      const { mode, cellar } = get();
      if (mode.kind !== 'reorg' || mode.index === 0) return;
      const step = mode.plan.steps[mode.index - 1]!;
      const res = revertReorgStep({ cellar, horsCave: mode.horsCave }, step);
      if (!res.ok) {
        notify('erreur', res.error);
        return;
      }
      set({ cellar: res.value.cellar, mode: { ...mode, index: mode.index - 1, horsCave: res.value.horsCave } });
      if (step.from !== 'hors-cave') revealSlot(step.from);
    },

    quitReorg: () => {
      const { mode } = get();
      if (mode.kind === 'reorg-apercu') {
        set({ mode: { kind: 'normal' } });
        return;
      }
      if (mode.kind !== 'reorg') return;
      if (mode.horsCave.length > 0) {
        notify(
          'erreur',
          `${formatWine(mode.horsCave[0]!)} est posée hors de la cave : terminez d'abord l'échange en cours (ou revenez en arrière) avant de quitter.`,
        );
        return;
      }
      if (mode.index === 0) {
        set({ mode: { kind: 'normal' } });
        return;
      }
      set((s) => ({
        past: [...s.past, { cellar: mode.depart, label: 'Réorganisation partielle de la cave' }].slice(-HISTORY_LIMIT),
        future: [],
        rev: s.rev + 1,
        mode: { kind: 'normal' },
      }));
      notify(
        'info',
        `Réorganisation interrompue après ${plural(mode.index, 'déplacement', 'déplacements')} sur ${mode.plan.steps.length}. La cave est à jour ; vous pourrez relancer la réorganisation plus tard.`,
      );
    },

    /* ---------------- cave ---------------- */

    applyShelves: (shelves) => {
      const { cellar, mode } = get();
      if (mode.kind !== 'normal') {
        // Un plan de réorganisation ou un placement en cours repose sur la configuration actuelle.
        notify('erreur', 'Terminez ou annulez d\'abord l\'opération en cours avant de modifier les clayettes.');
        return false;
      }
      const res = updateShelves(cellar, shelves);
      if (!res.ok) {
        notify('erreur', res.error);
        return false;
      }
      commit(res.value, 'Modification des clayettes');
      notify('succes', 'Configuration de la cave enregistrée.', { undo: true });
      return true;
    },

    replaceCellar: (cellar, label) => {
      commit(cellar, label, {
        mode: { kind: 'normal' },
        form: { ...EMPTY_CRITERIA },
        advice: null,
        view: 'recherche',
      });
    },

    loadCellar: (cellar) =>
      set((s) => ({
        cellar,
        past: [],
        future: [],
        rev: s.rev + 1,
        mode: { kind: 'normal' },
        form: { ...EMPTY_CRITERIA },
        advice: null,
        view: 'recherche',
      })),

    undo: () => {
      const { past, cellar, mode } = get();
      if (mode.kind !== 'normal') return;
      const entry = past[past.length - 1];
      if (!entry) return;
      set((s) => ({
        cellar: entry.cellar,
        past: s.past.slice(0, -1),
        future: [...s.future, { cellar, label: entry.label }],
        rev: s.rev + 1,
      }));
      notify('info', `Annulé : ${entry.label.toLowerCase()}.`);
    },

    redo: () => {
      const { future, cellar, mode } = get();
      if (mode.kind !== 'normal') return;
      const entry = future[future.length - 1];
      if (!entry) return;
      set((s) => ({
        cellar: entry.cellar,
        future: s.future.slice(0, -1),
        past: [...s.past, { cellar, label: entry.label }],
        rev: s.rev + 1,
      }));
      notify('info', `Rétabli : ${entry.label.toLowerCase()}.`);
    },

    /* ---------------- divers ---------------- */

    setAdvice: (advice) =>
      set((s) => ({ advice, view: advice ? 'conseil' : 'recherche', panelOpen: advice ? true : s.panelOpen })),
    setBusy: (busy) => set({ busy }),
    setAi: (patch) => set((s) => ({ ai: { ...s.ai, ...patch }, aiStatus: null })),
    setAiStatus: (aiStatus) => set({ aiStatus }),
    mergeAiWindows: (windows) => set((s) => ({ aiWindows: { ...s.aiWindows, ...windows } })),
    clearAiWindows: () => set({ aiWindows: {} }),
    setFile: (patch) => set((s) => ({ file: { ...s.file, ...patch } })),
    setPrefs: (patch) => set((s) => ({ prefs: { ...s.prefs, ...patch } })),
    openDialog: (dialog) => set({ dialog }),
    closeDialog: () => set({ dialog: null }),
    toast: notify,
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    setPanelOpen: (panelOpen) => set({ panelOpen }),
    setLoupe: (loupe) => set({ loupe }),
    hydrate: (patch) => set(patch),
  };
});

/** Bouteilles hors cave pendant la réorganisation (pour l'affichage). */
export function selectHorsCave(s: AppState): Bottle[] {
  return s.mode.kind === 'reorg' ? s.mode.horsCave : [];
}
