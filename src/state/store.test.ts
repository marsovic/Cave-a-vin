import { beforeEach, describe, expect, it } from 'vitest';
import { bottleAt, validateCellar } from '../domain/cellar';
import { cellarWith, shelves } from '../domain/testing';
import { EMPTY_CRITERIA, type Cellar } from '../domain/types';
import { computeMatches, computeTarget, computeVisuals } from './selectors';
import { useStore } from './store';

const initial = useStore.getState();

function setup(cellar: Cellar): void {
  useStore.setState({ ...initial, cellar, ready: true, toasts: [], past: [], future: [] }, true);
}

const s = () => useStore.getState();
const target = () => computeTarget(s().cellar, s().form);
const confirm = (): void => {
  const dialog = s().dialog;
  if (dialog?.kind !== 'confirm') throw new Error(`pas de confirmation en attente (${dialog?.kind})`);
  dialog.onConfirm();
};
const flat = () => computeVisuals({ cellar: s().cellar, form: s().form, mode: s().mode, view: s().view, advice: s().advice }).flat();

const demo = (): Cellar =>
  cellarWith(shelves([6, 'tout'], [6, 'bordeaux'], [4, 'bourgogne']), [
    [1, 1, { chateau: 'Château Margaux', appellation: 'Margaux', annee: 2015 }],
    [1, 2, { chateau: 'Château Margaux', appellation: 'Margaux', annee: 2015 }],
    [2, 3, { chateau: 'Château Palmer', appellation: 'Margaux', annee: 2010 }, true],
    [3, 1, { chateau: 'Domaine Leflaive', appellation: 'Puligny-Montrachet', annee: 2019, robe: 'blanc', forme: 'bourgogne', cepages: ['Chardonnay'] }],
    [1, 5, { chateau: 'Vieux', appellation: 'Bordeaux', annee: 1999 }],
  ]);

beforeEach(() => setup(demo()));

describe('recherche et cible', () => {
  it('sans critère : aucune cible, rien n\'est atténué', () => {
    expect(target().kind).toBe('aucune');
    expect(computeMatches(s().cellar, s().form)).toBeNull();
    expect(flat().every((v) => v.tone === 'normal')).toBe(true);
  });

  it('les critères mettent en valeur les correspondances et atténuent le reste', () => {
    s().setField('appellation', 'margaux');
    expect(target()).toMatchObject({ kind: 'selection' });
    expect(target().bottles).toHaveLength(3);
    const tones = flat().filter((v) => v.bottle).map((v) => v.tone);
    expect(tones.filter((t) => t === 'match')).toHaveLength(3);
    expect(tones.filter((t) => t === 'dim')).toHaveLength(2);
    s().setField('annee', '2015');
    expect(target().bottles).toHaveLength(2);
  });

  it('toucher une bouteille la désigne sans toucher aux critères « vin »', () => {
    s().setField('appellation', 'margaux');
    s().tapSlot({ clayette: 3, rang: 1 });
    expect(s().form).toMatchObject({ appellation: 'margaux', clayette: '3', rang: '1' });
    expect(target()).toMatchObject({ kind: 'bouteille', horsCriteres: true });
    expect(target().bottles[0]!.chateau).toBe('Domaine Leflaive');
    // Les correspondances restent mises en valeur ; la bouteille désignée n'est jamais atténuée.
    const visuals = flat();
    expect(visuals.filter((v) => v.tone === 'match')).toHaveLength(3);
    const selected = visuals.find((v) => v.selected)!;
    expect(selected.bottle?.chateau).toBe('Domaine Leflaive');
    expect(selected.tone).toBe('normal');
    // Retoucher le même emplacement retire la désignation.
    s().tapSlot({ clayette: 3, rang: 1 });
    expect(s().form).toMatchObject({ appellation: 'margaux', clayette: '', rang: '' });
  });

  it('toucher une place libre la désigne ; une clayette seule restreint la recherche', () => {
    s().tapSlot({ clayette: 2, rang: 1 });
    expect(target()).toMatchObject({ kind: 'emplacement', slot: { clayette: 2, rang: 1 } });
    s().deselect();
    s().toggleShelf(1);
    expect(s().form).toMatchObject({ clayette: '1', rang: '' });
    expect(target().bottles).toHaveLength(3);
    s().toggleShelf(1);
    expect(s().form.clayette).toBe('');
  });

  it('une erreur de saisie est signalée et ne cible rien', () => {
    s().setField('annee', 'abc');
    expect(target()).toMatchObject({ kind: 'aucune' });
    expect(target().erreur).toMatch(/Année/);
  });
});

describe('ajout', () => {
  it('propose un emplacement, puis ajoute après confirmation', () => {
    s().patchForm({ chateau: 'Château Margaux', appellation: 'Margaux', annee: '2015', robe: 'rouge', forme: 'bordeaux' });
    s().startAdd();
    const mode = s().mode;
    expect(mode.kind).toBe('placement');
    if (mode.kind !== 'placement') return;
    // À côté des deux bouteilles identiques (clayette 1, rangs 1 et 2).
    expect(mode.slots).toEqual([{ clayette: 1, rang: 3 }]);
    s().confirmPlacement();
    expect(s().mode.kind).toBe('normal');
    expect(bottleAt(s().cellar, { clayette: 1, rang: 3 })?.chateau).toBe('Château Margaux');
    expect(validateCellar(s().cellar)).toEqual([]);
    s().undo();
    expect(bottleAt(s().cellar, { clayette: 1, rang: 3 })).toBeUndefined();
    s().redo();
    expect(bottleAt(s().cellar, { clayette: 1, rang: 3 })).toBeDefined();
  });

  it('complète robe, forme et cépages d\'après l\'appellation', () => {
    s().patchForm({ chateau: 'Nouveau', appellation: 'Pauillac', annee: '2018' });
    s().startAdd();
    const mode = s().mode;
    expect(mode.kind === 'placement' && mode.wine).toMatchObject({ robe: 'rouge', forme: 'bordeaux' });
    expect(mode.kind === 'placement' && mode.wine.cepages).toContain('Cabernet Sauvignon');
  });

  it('refuse une description incomplète avec un message', () => {
    s().patchForm({ chateau: 'Sans appellation connue' });
    s().startAdd();
    expect(s().mode.kind).toBe('normal');
    expect(s().toasts.at(-1)).toMatchObject({ kind: 'erreur' });
  });

  it('quantité et changement d\'emplacement pendant le placement', () => {
    s().patchForm({ chateau: 'Lot', appellation: 'Pauillac', annee: '2018', robe: 'rouge', forme: 'bordeaux' });
    s().startAdd();
    s().setPlacementCount(3);
    let mode = s().mode;
    expect(mode.kind === 'placement' && mode.slots).toHaveLength(3);
    s().tapSlot({ clayette: 2, rang: 4 });
    mode = s().mode;
    expect(mode.kind === 'placement' && mode.slots).toEqual([
      { clayette: 2, rang: 4 },
      { clayette: 2, rang: 5 },
      { clayette: 2, rang: 6 },
    ]);
    // Une clayette incompatible est refusée, la proposition ne change pas.
    s().tapSlot({ clayette: 3, rang: 2 });
    expect(s().toasts.at(-1)?.kind).toBe('erreur');
    s().confirmPlacement();
    expect(s().cellar.bottles.filter((b) => b.chateau === 'Lot')).toHaveLength(3);
    s().undo();
    expect(s().cellar.bottles.filter((b) => b.chateau === 'Lot')).toHaveLength(0);
  });

  it('un emplacement libre désigné sert de destination', () => {
    s().patchForm({ chateau: 'Ici', appellation: 'Pauillac', annee: '2018', robe: 'rouge', forme: 'bordeaux' });
    s().tapSlot({ clayette: 2, rang: 6 });
    s().startAdd();
    const mode = s().mode;
    expect(mode.kind === 'placement' && mode.slots).toEqual([{ clayette: 2, rang: 6 }]);
  });
});

describe('suppression', () => {
  it('une bouteille ordinaire désignée : immédiate, annulable, la désignation est retirée', () => {
    s().tapSlot({ clayette: 1, rang: 5 });
    s().removeTarget();
    expect(s().cellar.bottles).toHaveLength(4);
    expect(s().form).toMatchObject({ clayette: '', rang: '' });
    s().undo();
    expect(s().cellar.bottles).toHaveLength(5);
  });

  it('une bouteille de collection demande confirmation', () => {
    s().tapSlot({ clayette: 2, rang: 3 });
    s().removeTarget();
    expect(s().cellar.bottles).toHaveLength(5);
    expect(s().dialog?.kind).toBe('confirm');
    confirm();
    expect(s().cellar.bottles).toHaveLength(4);
  });

  it('par critères : confirmation avec la liste, une seule annulation', () => {
    s().setField('appellation', 'margaux');
    s().removeTarget();
    const dialog = s().dialog;
    expect(dialog?.kind === 'confirm' && dialog.details).toHaveLength(3);
    confirm();
    expect(s().cellar.bottles).toHaveLength(2);
    s().undo();
    expect(s().cellar.bottles).toHaveLength(5);
  });

  it('sans cible : rien n\'est supprimé', () => {
    s().removeTarget();
    expect(s().cellar.bottles).toHaveLength(5);
    expect(s().dialog).toBeNull();
  });
});

describe('déplacement et échange', () => {
  it('déplace vers une place libre ; la désignation suit la bouteille', () => {
    s().tapSlot({ clayette: 1, rang: 5 });
    s().startMove();
    expect(s().mode.kind).toBe('deplacement');
    s().tapSlot({ clayette: 2, rang: 1 });
    expect(s().mode.kind).toBe('normal');
    expect(bottleAt(s().cellar, { clayette: 2, rang: 1 })?.chateau).toBe('Vieux');
    expect(s().form).toMatchObject({ clayette: '2', rang: '1' });
  });

  it('échange avec une autre bouteille si les formes le permettent', () => {
    s().tapSlot({ clayette: 1, rang: 5 });
    s().startMove();
    s().tapSlot({ clayette: 2, rang: 3 });
    expect(bottleAt(s().cellar, { clayette: 2, rang: 3 })?.chateau).toBe('Vieux');
    expect(bottleAt(s().cellar, { clayette: 1, rang: 5 })?.chateau).toBe('Château Palmer');
    expect(validateCellar(s().cellar)).toEqual([]);
  });

  it('refuse une destination incompatible et reste en attente', () => {
    s().tapSlot({ clayette: 1, rang: 5 });
    s().startMove();
    s().tapSlot({ clayette: 3, rang: 2 });
    expect(s().mode.kind).toBe('deplacement');
    expect(s().toasts.at(-1)?.kind).toBe('erreur');
    s().cancelMode();
    expect(s().mode.kind).toBe('normal');
  });

  it('exige une seule bouteille ciblée', () => {
    s().setField('appellation', 'margaux');
    s().startMove();
    expect(s().mode.kind).toBe('normal');
  });

  it('glisser-déposer', () => {
    const id = bottleAt(s().cellar, { clayette: 1, rang: 5 })!.id;
    s().dropBottle(id, { clayette: 1, rang: 6 });
    expect(bottleAt(s().cellar, { clayette: 1, rang: 6 })?.id).toBe(id);
  });
});

describe('collection', () => {
  it('classe la bouteille désignée immédiatement', () => {
    s().tapSlot({ clayette: 1, rang: 5 });
    s().classify(true);
    expect(bottleAt(s().cellar, { clayette: 1, rang: 5 })?.collection).toBe(true);
    s().classify(false);
    expect(bottleAt(s().cellar, { clayette: 1, rang: 5 })?.collection).toBe(false);
  });

  it('par critères : confirmation, seules les bouteilles concernées changent', () => {
    s().setField('appellation', 'margaux');
    s().classify(true);
    const dialog = s().dialog;
    // Palmer est déjà en collection : deux bouteilles à classer.
    expect(dialog?.kind === 'confirm' && dialog.details).toHaveLength(2);
    confirm();
    expect(s().cellar.bottles.filter((b) => b.collection)).toHaveLength(3);
    // Restreint par clayette : une seule bouteille de collection sur la clayette 2.
    s().setField('clayette', '2');
    s().classify(false);
    expect(s().cellar.bottles.filter((b) => b.collection)).toHaveLength(2);
  });

  it('jamais d\'action de groupe sans critère', () => {
    s().classify(true);
    expect(s().dialog).toBeNull();
    expect(s().cellar.bottles.filter((b) => b.collection)).toHaveLength(1);
  });
});

describe('correction d\'une bouteille', () => {
  it('charge la bouteille, enregistre, puis rend les critères précédents', () => {
    s().setField('appellation', 'margaux');
    s().tapSlot({ clayette: 1, rang: 5 });
    s().startEdit();
    expect(s().mode.kind).toBe('correction');
    expect(s().form).toMatchObject({ chateau: 'Vieux', appellation: 'Bordeaux', annee: '1999' });
    s().setField('chateau', 'Vieux Château Certan');
    s().setField('annee', '1998');
    s().saveEdit();
    expect(s().mode.kind).toBe('normal');
    expect(bottleAt(s().cellar, { clayette: 1, rang: 5 })).toMatchObject({ chateau: 'Vieux Château Certan', annee: 1998 });
    expect(s().form).toMatchObject({ appellation: 'margaux', chateau: '', clayette: '1', rang: '5' });
  });

  it('annuler rend le formulaire tel qu\'il était, sans rien modifier', () => {
    s().tapSlot({ clayette: 1, rang: 5 });
    const before = s().form;
    s().startEdit();
    s().setField('chateau', 'Autre');
    s().cancelMode();
    expect(s().form).toEqual(before);
    expect(bottleAt(s().cellar, { clayette: 1, rang: 5 })?.chateau).toBe('Vieux');
  });

  it('refuse une forme incompatible avec la clayette', () => {
    s().tapSlot({ clayette: 3, rang: 1 });
    s().startEdit();
    s().setField('forme', 'bordeaux');
    s().saveEdit();
    expect(s().mode.kind).toBe('correction');
    expect(s().toasts.at(-1)?.kind).toBe('erreur');
  });
});

describe('réorganisation guidée', () => {
  it('aperçu, guidage complet, puis une seule annulation', () => {
    const before = s().cellar;
    s().openReorg();
    let mode = s().mode;
    expect(mode.kind).toBe('reorg-apercu');
    if (mode.kind !== 'reorg-apercu') return;
    const steps = mode.plans[mode.choix].steps.length;
    expect(steps).toBeGreaterThan(0);
    s().startReorg();
    for (let i = 0; i < steps; i++) {
      expect(s().mode.kind).toBe('reorg');
      s().reorgNext();
      expect(validateCellar(s().cellar)).toEqual([]);
    }
    expect(s().mode.kind).toBe('normal');
    expect(s().cellar.bottles).toHaveLength(5);
    // La plus ancienne se retrouve avant les plus récentes parmi les bordeaux.
    const reds = s().cellar.bottles.filter((b) => b.forme === 'bordeaux').sort((a, b) => a.clayette - b.clayette || a.rang - b.rang);
    expect(reds.map((b) => b.annee)).toEqual([...reds.map((b) => b.annee)].sort((a, b) => (a ?? 9999) - (b ?? 9999)));
    // Rangée : plus rien à faire.
    s().openReorg();
    mode = s().mode;
    expect(mode.kind === 'reorg-apercu' && mode.plans.economique.steps).toHaveLength(0);
    s().cancelMode();
    s().undo();
    expect(s().cellar).toBe(before);
  });

  it('étape précédente, interruption : la cave reste cohérente', () => {
    s().openReorg();
    s().startReorg();
    const afterStart = s().cellar;
    s().reorgNext();
    s().reorgPrev();
    expect(s().cellar.bottles.map((b) => [b.id, b.clayette, b.rang])).toEqual(afterStart.bottles.map((b) => [b.id, b.clayette, b.rang]));
    s().reorgNext();
    s().quitReorg();
    expect(s().mode.kind).toBe('normal');
    expect(validateCellar(s().cellar)).toEqual([]);
    expect(s().cellar.bottles).toHaveLength(5);
  });

  it('les autres actions sont inactives pendant le guidage', () => {
    s().openReorg();
    s().startReorg();
    const cellar = s().cellar;
    s().tapSlot({ clayette: 1, rang: 5 });
    s().removeTarget();
    s().startAdd();
    s().undo();
    expect(s().cellar).toBe(cellar);
    expect(s().mode.kind).toBe('reorg');
  });
});

describe('divers', () => {
  it('places libres : vue à bascule, filtrée par la forme du formulaire', () => {
    s().toggleFree();
    expect(s().view).toBe('libres');
    expect(flat().filter((v) => v.marker === 'libre')).toHaveLength(16 - 5);
    s().setField('forme', 'bourgogne');
    expect(s().view).toBe('libres');
    // Clayette « tout » (3 libres) + clayette bourgogne (3 libres).
    expect(flat().filter((v) => v.marker === 'libre')).toHaveLength(6);
    s().toggleFree();
    expect(s().view).toBe('recherche');
  });

  it('configuration des clayettes : refus si des bouteilles seraient orphelines', () => {
    expect(s().applyShelves(shelves([6, 'tout'], [6, 'bordeaux']))).toBe(false);
    expect(s().applyShelves(shelves([6, 'tout'], [6, 'bordeaux'], [4, 'bourgogne'], [8, 'champagne']))).toBe(true);
    expect(s().cellar.shelves).toHaveLength(4);
  });

  it('effacer le formulaire', () => {
    s().patchForm({ chateau: 'x', clayette: '1' });
    s().clearForm();
    expect(s().form).toEqual(EMPTY_CRITERIA);
  });
});
