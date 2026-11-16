import { useMemo, useState, type ReactNode } from 'react';
import { shelfChangeBlockers } from '../../domain/cellar';
import { TYPE_CLAYETTE_LABELS, formatSlotShort, formatWine } from '../../domain/labels';
import { SHELF_LIMITS, TYPES_CLAYETTE, type Shelf, type TypeClayette } from '../../domain/types';
import { useStore } from '../../state/store';
import { Icon } from '../icons';
import { Modal } from './Modal';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Configuration de la cave : nombre de clayettes, emplacements et type de chacune. */
export function ConfigDialog(): ReactNode {
  const cellar = useStore((s) => s.cellar);
  const applyShelves = useStore((s) => s.applyShelves);
  const closeDialog = useStore((s) => s.closeDialog);
  const [shelves, setShelves] = useState<Shelf[]>(() => cellar.shelves.map((s) => ({ ...s })));
  const [allCap, setAllCap] = useState<number>(cellar.shelves[0]?.capacite ?? SHELF_LIMITS.defaultCapacity);
  const [allType, setAllType] = useState<TypeClayette>(cellar.shelves[0]?.type ?? 'tout');

  const blockers = useMemo(() => shelfChangeBlockers(cellar, shelves), [cellar, shelves]);
  const occupied = useMemo(() => {
    const counts = new Map<number, number>();
    for (const b of cellar.bottles) counts.set(b.clayette, (counts.get(b.clayette) ?? 0) + 1);
    return counts;
  }, [cellar]);
  const blockedShelves = new Set(blockers.map((b) => b.bottle.clayette));
  const total = shelves.reduce((n, s) => n + s.capacite, 0);
  const changed = JSON.stringify(shelves) !== JSON.stringify(cellar.shelves);

  const setCount = (count: number): void => {
    const n = clamp(count, SHELF_LIMITS.minShelves, SHELF_LIMITS.maxShelves);
    setShelves((prev) => {
      if (n <= prev.length) return prev.slice(0, n);
      const model = prev[prev.length - 1] ?? { capacite: SHELF_LIMITS.defaultCapacity, type: 'tout' as TypeClayette };
      return [...prev, ...Array.from({ length: n - prev.length }, () => ({ ...model }))];
    });
  };

  const update = (index: number, patch: Partial<Shelf>): void => {
    setShelves((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const save = (): void => {
    if (applyShelves(shelves)) closeDialog();
  };

  return (
    <Modal
      title="Configurer la cave"
      onClose={closeDialog}
      size="moyen"
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!changed || blockers.length > 0}>
            <Icon name="check" size={17} />
            Enregistrer
          </button>
        </>
      }
    >
      <p className="muted">
        La clayette 1 est celle du haut. Chaque clayette a son nombre d'emplacements et un type : une bouteille
        Bordeaux va sur une clayette « Bordeaux » ou « Tout », mais pas sur une clayette « Bourgogne ».
      </p>

      <div className="config-top">
        <div className="field">
          <span className="field-label" id="cfg-count">
            Nombre de clayettes
          </span>
          <div className="stepper" role="group" aria-labelledby="cfg-count">
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setCount(shelves.length - 1)}
              disabled={shelves.length <= SHELF_LIMITS.minShelves}
              aria-label="Retirer la dernière clayette"
            >
              <Icon name="minus" />
            </button>
            <output className="stepper-value" aria-live="polite">
              {shelves.length}
            </output>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setCount(shelves.length + 1)}
              disabled={shelves.length >= SHELF_LIMITS.maxShelves}
              aria-label="Ajouter une clayette en bas"
            >
              <Icon name="plus" />
            </button>
          </div>
        </div>
        <div className="config-total">
          <strong>{total}</strong> emplacements au total
        </div>
      </div>

      <div className="config-all">
        <span className="field-label">Régler toutes les clayettes d'un coup</span>
        <div className="config-all-row">
          <input
            className="input config-num"
            type="number"
            min={SHELF_LIMITS.minCapacity}
            max={SHELF_LIMITS.maxCapacity}
            value={allCap}
            onChange={(e) => setAllCap(Number(e.target.value))}
            aria-label="Emplacements par clayette"
          />
          <select
            className="select"
            value={allType}
            onChange={(e) => setAllType(e.target.value as TypeClayette)}
            aria-label="Type de toutes les clayettes"
          >
            {TYPES_CLAYETTE.map((t) => (
              <option key={t} value={t}>
                {TYPE_CLAYETTE_LABELS[t]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={() =>
              setShelves((prev) =>
                prev.map(() => ({
                  capacite: clamp(allCap || 1, SHELF_LIMITS.minCapacity, SHELF_LIMITS.maxCapacity),
                  type: allType,
                })),
              )
            }
          >
            Appliquer à toutes
          </button>
        </div>
      </div>

      <table className="config-table">
        <thead>
          <tr>
            <th scope="col">Clayette</th>
            <th scope="col">Emplacements</th>
            <th scope="col">Type</th>
            <th scope="col">Occupés</th>
          </tr>
        </thead>
        <tbody>
          {shelves.map((shelf, i) => (
            <tr key={i} data-blocked={blockedShelves.has(i + 1) ? '' : undefined}>
              <th scope="row">{i + 1}</th>
              <td>
                <input
                  className="input config-num"
                  type="number"
                  inputMode="numeric"
                  min={SHELF_LIMITS.minCapacity}
                  max={SHELF_LIMITS.maxCapacity}
                  value={shelf.capacite}
                  onChange={(e) =>
                    update(i, {
                      capacite: clamp(Number(e.target.value) || 1, SHELF_LIMITS.minCapacity, SHELF_LIMITS.maxCapacity),
                    })
                  }
                  aria-label={`Emplacements de la clayette ${i + 1}`}
                />
              </td>
              <td>
                <select
                  className="select"
                  value={shelf.type}
                  onChange={(e) => update(i, { type: e.target.value as TypeClayette })}
                  aria-label={`Type de la clayette ${i + 1}`}
                >
                  {TYPES_CLAYETTE.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_CLAYETTE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="config-occupied">{occupied.get(i + 1) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {blockers.length > 0 ? (
        <div className="notice notice-danger" role="alert">
          <p>
            <strong>
              {blockers.length} bouteille{blockers.length > 1 ? 's' : ''} empêche{blockers.length > 1 ? 'nt' : ''} cette
              modification.
            </strong>{' '}
            Déplacez-les ou retirez-les d'abord :
          </p>
          <ul>
            {blockers.slice(0, 8).map((b) => (
              <li key={b.bottle.id}>
                {formatWine(b.bottle)} ({formatSlotShort(b.bottle)}) — {b.reason}
              </li>
            ))}
            {blockers.length > 8 ? <li>… et {blockers.length - 8} autre(s).</li> : null}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}
