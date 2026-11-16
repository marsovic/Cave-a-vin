import type { ReactNode } from 'react';
import { ROBE_LABELS } from '../domain/labels';
import { ROBES } from '../domain/types';
import { useStore } from '../state/store';

/** Légende du schéma ; s'adapte à ce qui est affiché (statuts de dégustation, réorganisation…). */
export function Legend(): ReactNode {
  const view = useStore((s) => s.view);
  const mode = useStore((s) => s.mode.kind);
  const hasAdvice = useStore((s) => s.advice !== null);

  if (mode === 'reorg') {
    return (
      <ul className="legend" aria-label="Légende">
        <li className="legend-item">
          <span className="legend-swatch" style={{ boxShadow: '0 0 0 2px var(--mark-source)' }} />
          Bouteille à prendre
        </li>
        <li className="legend-item">
          <span className="legend-swatch" style={{ boxShadow: '0 0 0 2px var(--mark-dest)', background: 'transparent' }} />
          Où la poser
        </li>
      </ul>
    );
  }

  if (mode === 'normal' && view === 'conseil' && hasAdvice) {
    return (
      <ul className="legend" aria-label="Légende">
        <li className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--st-vite)' }} />À boire vite
        </li>
        <li className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--st-boire)' }} />À boire
        </li>
        <li className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--st-jeune)' }} />À attendre
        </li>
        <li className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--st-passe)' }} />
          Apogée dépassée
        </li>
        <li className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--st-inconnu)' }} />
          Sans millésime
        </li>
      </ul>
    );
  }

  return (
    <ul className="legend" aria-label="Légende">
      {ROBES.map((robe) => (
        <li key={robe} className="legend-item">
          <span className="robe-dot" data-robe={robe} />
          {ROBE_LABELS[robe]}
        </li>
      ))}
      <li className="legend-item">
        <span className="legend-swatch" data-kind="collection" />
        Collection
      </li>
      <li className="legend-item">
        <span className="legend-swatch" data-kind="libre" />
        Libre
      </li>
    </ul>
  );
}
