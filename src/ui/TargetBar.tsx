import { useMemo, type ReactNode } from 'react';
import { cellarStats } from '../domain/cellar';
import { FORME_LABELS, ROBE_LABELS, TYPE_CLAYETTE_LABELS, formatSlotShort, formatWine } from '../domain/labels';
import { computeTarget, freeSlotsForForm, hasAnyCriteria } from '../state/selectors';
import { useStore } from '../state/store';
import { Icon } from './icons';

function plural(n: number, one: string, many: string): string {
  return n > 1 ? many : one;
}

/**
 * Barre de cible : dit en clair sur quoi porteront les actions du formulaire
 * (une bouteille désignée, les bouteilles correspondant aux critères, un emplacement libre…).
 */
export function TargetBar(): ReactNode {
  const cellar = useStore((s) => s.cellar);
  const form = useStore((s) => s.form);
  const view = useStore((s) => s.view);
  const mode = useStore((s) => s.mode);
  const panelOpen = useStore((s) => s.panelOpen);
  const deselect = useStore((s) => s.deselect);
  const setPanelOpen = useStore((s) => s.setPanelOpen);
  const clearForm = useStore((s) => s.clearForm);

  const target = useMemo(() => computeTarget(cellar, form), [cellar, form]);
  const stats = useMemo(() => cellarStats(cellar), [cellar]);
  const locked = mode.kind !== 'normal';

  let tone: 'neutre' | 'cible' | 'erreur' | 'modif' = 'neutre';
  let text: ReactNode;
  let actions: ReactNode = null;

  const listToggle = (
    <button
      type="button"
      className="btn btn-small btn-ghost target-list-toggle"
      onClick={() => setPanelOpen(!panelOpen)}
      aria-expanded={panelOpen}
    >
      {panelOpen ? 'Masquer' : 'Détails'}
      <Icon name={panelOpen ? 'chevronDown' : 'chevronUp'} size={14} />
    </button>
  );

  const deselectButton = (
    <button
      type="button"
      className="btn btn-small btn-icon btn-ghost"
      onClick={deselect}
      disabled={locked}
      aria-label="Ne plus désigner cet emplacement"
      title="Ne plus désigner cet emplacement (Échap)"
    >
      <Icon name="x" size={16} />
    </button>
  );

  if (mode.kind === 'correction') {
    tone = 'modif';
    text = (
      <>
        <strong>Correction</strong> de la bouteille <strong>{form.clayette && form.rang ? `C${form.clayette}·R${form.rang}` : ''}</strong> :
        modifiez les champs puis enregistrez.
      </>
    );
  } else if (target.erreur) {
    tone = 'erreur';
    text = target.erreur;
  } else if (view === 'libres' && !locked) {
    const free = freeSlotsForForm(cellar, form);
    tone = 'cible';
    text = (
      <>
        <strong>{free.length}</strong> {plural(free.length, 'place libre', 'places libres')}
        {form.forme ? ` pour une bouteille ${FORME_LABELS[form.forme]}` : ''}
        {form.clayette && !form.rang ? ` sur la clayette ${form.clayette}` : ''}
      </>
    );
    actions = listToggle;
  } else if (target.kind === 'bouteille') {
    const b = target.bottles[0]!;
    tone = 'cible';
    text = (
      <>
        <strong>{formatSlotShort(b)}</strong> —{' '}
        <span className="robe-dot" data-robe={b.robe} title={ROBE_LABELS[b.robe]} />
        <strong>{formatWine(b)}</strong>
        {b.collection ? <span className="badge badge-gold">★ collection</span> : null}
        {target.horsCriteres ? (
          <span className="badge badge-warn" title="Cette bouteille ne correspond pas aux critères saisis">
            hors critères
          </span>
        ) : null}
      </>
    );
    actions = (
      <>
        {listToggle}
        {deselectButton}
      </>
    );
  } else if (target.kind === 'emplacement' && target.slot) {
    const shelf = cellar.shelves[target.slot.clayette - 1]!;
    tone = 'cible';
    text = (
      <>
        <strong>{formatSlotShort(target.slot)}</strong> — place libre
        <span className="muted"> ({TYPE_CLAYETTE_LABELS[shelf.type]})</span>
      </>
    );
    actions = deselectButton;
  } else if (target.kind === 'selection') {
    const n = target.bottles.length;
    const stars = target.bottles.filter((b) => b.collection).length;
    tone = n > 0 ? 'cible' : 'neutre';
    text =
      n === 0 ? (
        <>Aucune bouteille ne correspond à ces critères.</>
      ) : (
        <>
          <strong>{n}</strong> {plural(n, 'bouteille correspond', 'bouteilles correspondent')}
          {stars > 0 ? <span className="muted"> · dont {stars} ★</span> : null}
        </>
      );
    actions = n > 0 ? listToggle : null;
  } else {
    text = (
      <span className="muted">
        {stats.total} {plural(stats.total, 'bouteille', 'bouteilles')} en cave · {stats.libres}{' '}
        {plural(stats.libres, 'place libre', 'places libres')}
      </span>
    );
  }

  return (
    <div className="target-bar" data-tone={tone} role="status" aria-live="polite">
      <Icon name={tone === 'erreur' ? 'warning' : 'target'} size={16} className="target-icon" />
      <div className="target-text">{text}</div>
      <div className="target-actions">
        {actions}
        {hasAnyCriteria(form) && mode.kind !== 'correction' ? (
          <button
            type="button"
            className="btn btn-small btn-icon btn-ghost"
            onClick={clearForm}
            disabled={locked}
            aria-label="Effacer le formulaire"
            title="Effacer tous les critères du formulaire"
          >
            <Icon name="eraser" size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
