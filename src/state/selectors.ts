import { allSlots, bottleAt, bottleById, isCompatible, isValidSlot, occupancy, slotKey } from '../domain/cellar';
import {
  compileCriteria,
  criteriaError,
  hasAnyCriteria,
  hasWineCriteria,
  parsePositiveInt,
} from '../domain/search';
import type { Bottle, Cellar, Criteria, DrinkStatus, SlotRef } from '../domain/types';
import type { AdviceReport, Mode, SlotMarker, SlotVisual, Target, View } from './types';

/** Emplacement désigné par le formulaire (clayette ET rang valides), sinon `null`. */
export function formSlot(cellar: Cellar, form: Criteria): SlotRef | null {
  const clayette = parsePositiveInt(form.clayette);
  const rang = parsePositiveInt(form.rang);
  if (clayette === null || rang === null || Number.isNaN(clayette) || Number.isNaN(rang)) return null;
  const slot = { clayette, rang };
  return isValidSlot(cellar, slot) ? slot : null;
}

/** Critères du formulaire sans la position (clayette / rang). */
export function wineCriteria(form: Criteria): Criteria {
  return { ...form, clayette: '', rang: '' };
}

/**
 * Cible des actions du formulaire.
 *  - clayette + rang désignent un emplacement occupé → cette bouteille (la désignation prime) ;
 *  - clayette + rang désignent un emplacement libre → cet emplacement ;
 *  - sinon → toutes les bouteilles correspondant aux critères ;
 *  - aucun critère → aucune cible.
 */
export function computeTarget(cellar: Cellar, form: Criteria): Target {
  const erreur = criteriaError(form, cellar);
  const slot = formSlot(cellar, form);
  if (slot) {
    const bottle = bottleAt(cellar, slot);
    if (bottle) {
      const horsCriteres = hasWineCriteria(form) && !compileCriteria(wineCriteria(form))(bottle);
      return { kind: 'bouteille', bottles: [bottle], slot, horsCriteres, erreur };
    }
    return { kind: 'emplacement', bottles: [], slot, horsCriteres: false, erreur };
  }
  if (erreur || !hasAnyCriteria(form)) {
    return { kind: 'aucune', bottles: [], slot: null, horsCriteres: false, erreur };
  }
  const test = compileCriteria(form);
  const bottles = cellar.bottles.filter(test).sort((a, b) => a.clayette - b.clayette || a.rang - b.rang);
  return { kind: 'selection', bottles, slot: null, horsCriteres: false, erreur: null };
}

/**
 * Bouteilles « mises en valeur » par les critères : avec un emplacement désigné,
 * seuls les critères « vin » comptent ; sinon tous les critères. `null` si rien à mettre en valeur.
 */
export function computeMatches(cellar: Cellar, form: Criteria): Bottle[] | null {
  if (criteriaError(form, cellar)) return null;
  const criteria = formSlot(cellar, form) ? wineCriteria(form) : form;
  if (!hasAnyCriteria(criteria)) return null;
  const test = compileCriteria(criteria);
  return cellar.bottles.filter(test).sort((a, b) => a.clayette - b.clayette || a.rang - b.rang);
}

/** Emplacements libres mis en valeur par « Places libres » (filtrés par forme, clayette et rang du formulaire). */
export function freeSlotsForForm(cellar: Cellar, form: Criteria): SlotRef[] {
  const occ = occupancy(cellar);
  const clayette = parsePositiveInt(form.clayette);
  const rang = parsePositiveInt(form.rang);
  return allSlots(cellar).filter((slot) => {
    if (occ.has(slotKey(slot))) return false;
    if (clayette !== null && !Number.isNaN(clayette) && slot.clayette !== clayette) return false;
    if (rang !== null && !Number.isNaN(rang) && slot.rang !== rang) return false;
    if (form.forme && !isCompatible(form.forme, cellar.shelves[slot.clayette - 1]!.type)) return false;
    return true;
  });
}

interface VisualInput {
  cellar: Cellar;
  form: Criteria;
  mode: Mode;
  view: View;
  advice: AdviceReport | null;
}

/**
 * Calcule l'apparence de chaque emplacement du schéma (une ligne par clayette),
 * selon le mode d'interaction, la vue et les critères du formulaire.
 */
export function computeVisuals(input: VisualInput): SlotVisual[][] {
  const { form, mode, view, advice } = input;
  // Aperçu « après » d'une réorganisation : on dessine le rangement cible.
  const cellar =
    mode.kind === 'reorg-apercu' && mode.apercu === 'apres' ? mode.plans[mode.choix].target : input.cellar;
  const occ = occupancy(cellar);
  const rows: SlotVisual[][] = cellar.shelves.map((shelf, i) =>
    Array.from({ length: shelf.capacite }, (_, r) => {
      const slot = { clayette: i + 1, rang: r + 1 };
      return {
        slot,
        bottle: occ.get(slotKey(slot)) ?? null,
        tone: 'normal',
        selected: false,
        marker: null,
        status: null,
      } satisfies SlotVisual;
    }),
  );
  const at = (slot: SlotRef): SlotVisual | undefined => rows[slot.clayette - 1]?.[slot.rang - 1];
  const each = (fn: (v: SlotVisual) => void): void => rows.forEach((row) => row.forEach(fn));
  const mark = (slot: SlotRef, marker: SlotMarker): void => {
    const v = at(slot);
    if (v) v.marker = marker;
  };

  switch (mode.kind) {
    case 'reorg': {
      const step = mode.plan.steps[mode.index];
      each((v) => {
        v.tone = 'dim';
      });
      if (step) {
        if (step.from !== 'hors-cave') {
          mark(step.from, 'source');
          const v = at(step.from);
          if (v) v.tone = 'match';
        }
        if (step.to !== 'hors-cave') {
          mark(step.to, 'destination');
          const v = at(step.to);
          if (v) v.tone = 'match';
        }
      }
      return rows;
    }
    case 'reorg-apercu': {
      // Met en valeur les bouteilles qui devront bouger (ou auront bougé) avec le plan choisi.
      const moving = new Set(mode.plans[mode.choix].steps.map((s) => s.bottleId));
      each((v) => {
        if (v.bottle) v.tone = moving.has(v.bottle.id) ? 'match' : 'dim';
      });
      return rows;
    }
    case 'placement': {
      const proposed = new Set(mode.slots.map(slotKey));
      each((v) => {
        if (v.bottle) {
          v.tone = 'dim';
        } else if (proposed.has(slotKey(v.slot))) {
          v.marker = 'propose';
        } else if (isCompatible(mode.wine.forme, cellar.shelves[v.slot.clayette - 1]!.type)) {
          v.marker = 'possible';
        } else {
          v.marker = 'incompatible';
        }
      });
      return rows;
    }
    case 'deplacement': {
      const moving = bottleById(cellar, mode.bottleId);
      each((v) => {
        if (!moving) return;
        const shelfType = cellar.shelves[v.slot.clayette - 1]!.type;
        if (v.bottle?.id === moving.id) {
          v.marker = 'source';
          v.tone = 'match';
        } else if (!isCompatible(moving.forme, shelfType)) {
          v.marker = 'incompatible';
          if (v.bottle) v.tone = 'dim';
        } else if (!v.bottle) {
          v.marker = 'possible';
        } else if (isCompatible(v.bottle.forme, cellar.shelves[moving.clayette - 1]!.type)) {
          // Échange possible : la bouteille visée peut aller à la place de celle qu'on déplace.
          v.marker = 'possible';
        } else {
          v.marker = 'incompatible';
          v.tone = 'dim';
        }
      });
      return rows;
    }
    case 'correction': {
      // Seule la bouteille en cours de correction est marquée ; rien n'est atténué.
      const edited = bottleById(cellar, mode.bottleId);
      const v = edited ? at(edited) : undefined;
      if (v) v.selected = true;
      return rows;
    }
    case 'normal':
      break;
  }

  if (view === 'conseil' && advice) {
    const status = new Map<string, DrinkStatus>();
    for (const item of advice.items) for (const b of item.bottles) status.set(b.id, item.status);
    each((v) => {
      if (!v.bottle) return;
      const s = status.get(v.bottle.id);
      if (s === undefined) v.tone = 'dim';
      else {
        v.tone = 'match';
        v.status = s;
      }
    });
    const slot = formSlot(cellar, form);
    const sel = slot ? at(slot) : undefined;
    if (sel) sel.selected = true;
    return rows;
  }

  if (view === 'libres') {
    const free = new Set(freeSlotsForForm(cellar, form).map(slotKey));
    each((v) => {
      if (v.bottle) v.tone = 'dim';
      else if (free.has(slotKey(v.slot))) v.marker = 'libre';
    });
    const slot = formSlot(cellar, form);
    const sel = slot ? at(slot) : undefined;
    if (sel) sel.selected = true;
    return rows;
  }

  // Vue « recherche » : les correspondances sont mises en valeur, le reste est atténué ;
  // l'emplacement désigné porte le repère de sélection et reste toujours pleinement visible.
  const matches = computeMatches(cellar, form);
  if (matches) {
    const ids = new Set(matches.map((b) => b.id));
    each((v) => {
      if (v.bottle) v.tone = ids.has(v.bottle.id) ? 'match' : 'dim';
    });
  }
  const slot = formSlot(cellar, form);
  const sel = slot ? at(slot) : undefined;
  if (sel) {
    sel.selected = true;
    if (sel.tone === 'dim') sel.tone = 'normal';
  }
  return rows;
}

/** Y a-t-il de quoi décrire une bouteille à ajouter dans le formulaire ? */
export function canDescribeWine(form: Criteria): boolean {
  return Boolean(form.chateau.trim() || form.appellation.trim());
}

export { hasAnyCriteria, hasWineCriteria };
