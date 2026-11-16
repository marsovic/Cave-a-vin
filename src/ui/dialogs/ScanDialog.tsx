import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ScanResult } from '../../ai/types';
import { FORME_LABELS, ROBE_LABELS } from '../../domain/labels';
import { searchBottles } from '../../domain/search';
import { EMPTY_CRITERIA, type Forme, type Robe } from '../../domain/types';
import { applyScan } from '../../state/advice';
import { useStore } from '../../state/store';
import { Icon } from '../icons';
import { Modal } from './Modal';

type FieldKey = keyof ScanResult['fields'];

const FIELD_LABELS: Record<FieldKey, string> = {
  chateau: 'Château / domaine',
  appellation: 'Appellation',
  annee: 'Année',
  cepages: 'Cépages',
  robe: 'Robe',
  forme: 'Forme de bouteille',
};

const ORDER: FieldKey[] = ['chateau', 'appellation', 'annee', 'robe', 'cepages', 'forme'];

function display(key: FieldKey, value: string): string {
  if (key === 'robe') return ROBE_LABELS[value as Robe] ?? value;
  if (key === 'forme') return FORME_LABELS[value as Forme] ?? value;
  return value;
}

/** Résultat de la lecture d'une étiquette : l'utilisateur confirme les champs à reporter dans le formulaire. */
export function ScanDialog({ result, imageUrl }: { result: ScanResult; imageUrl: string | null }): ReactNode {
  const cellar = useStore((s) => s.cellar);
  const closeDialog = useStore((s) => s.closeDialog);
  const found = ORDER.filter((key) => {
    const value = result.fields[key];
    return typeof value === 'string' && value.trim() !== '';
  });
  const [keep, setKeep] = useState<Set<FieldKey>>(() => new Set(found));

  // Libère la photo à la fermeture.
  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
    [imageUrl],
  );

  const existing = useMemo(() => {
    const { chateau, appellation, annee } = result.fields;
    if (!chateau && !appellation) return 0;
    return searchBottles(cellar, {
      ...EMPTY_CRITERIA,
      chateau: chateau ?? '',
      appellation: chateau ? '' : (appellation ?? ''),
      annee: annee ?? '',
    }).length;
  }, [cellar, result]);

  const toggle = (key: FieldKey): void =>
    setKeep((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Modal
      title="Étiquette lue"
      onClose={closeDialog}
      size="petit"
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-autofocus
            disabled={keep.size === 0}
            onClick={() => applyScan(result, [...keep])}
          >
            <Icon name="check" size={17} />
            Remplir le formulaire
          </button>
        </>
      }
    >
      <div className="scan-result">
        {imageUrl ? <img className="scan-thumb" src={imageUrl} alt="Photo de l'étiquette" /> : null}
        <div className="scan-fields">
          {found.length === 0 ? (
            <p className="notice notice-danger">Aucune information n'a pu être lue sur cette photo.</p>
          ) : (
            <ul className="check-list">
              {found.map((key) => (
                <li key={key}>
                  <label className="check-row">
                    <input type="checkbox" checked={keep.has(key)} onChange={() => toggle(key)} />
                    <span>
                      <span className="field-label">{FIELD_LABELS[key]}</span>
                      <strong>{display(key, result.fields[key] ?? '')}</strong>
                      {result.deduits.includes(key) ? (
                        <span className="badge" title="Valeur habituelle de l'appellation, non lue sur l'étiquette">
                          déduit
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {result.note ? <p className="field-hint">{result.note}</p> : null}
        </div>
      </div>
      {found.length > 0 ? (
        <p className="notice notice-info">
          <Icon name="info" size={16} />{' '}
          {existing > 0
            ? `${existing} bouteille${existing > 1 ? 's' : ''} de ce vin ${existing > 1 ? 'sont' : 'est'} déjà dans la cave : ${existing > 1 ? 'elles seront mises' : 'elle sera mise'} en valeur dans le schéma.`
            : 'Ce vin n\'est pas encore dans la cave : après vérification, touchez « Ajouter ».'}
        </p>
      ) : null}
      <p className="field-hint">Vérifiez toujours les valeurs : une étiquette peut être mal lue.</p>
    </Modal>
  );
}
