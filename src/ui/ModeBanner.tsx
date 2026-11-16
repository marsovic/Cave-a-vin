import type { ReactNode } from 'react';
import { bottleById } from '../domain/cellar';
import { ROBE_LABELS, formatSlotShort, formatWine } from '../domain/labels';
import type { ReorgPlace } from '../domain/reorg';
import type { Bottle } from '../domain/types';
import { cancelBusy } from '../state/advice';
import {
  reconnectLinkedFile,
  resolveConflictWithFile,
  resolveConflictWithLocal,
  retryLinkedWrite,
} from '../state/persistence';
import { MAX_QUANTITY, useStore } from '../state/store';
import { Icon } from './icons';

function place(p: ReorgPlace): string {
  return p === 'hors-cave' ? 'hors de la cave' : formatSlotShort(p);
}

function BottleName({ bottle }: { bottle: Bottle | undefined }): ReactNode {
  if (!bottle) return <strong>la bouteille</strong>;
  return (
    <>
      <span className="robe-dot" data-robe={bottle.robe} title={ROBE_LABELS[bottle.robe]} />{' '}
      <strong>{formatWine(bottle)}</strong>
    </>
  );
}

/** Étape courante de la réorganisation guidée : consigne, progression, validation. */
function ReorgGuide(): ReactNode {
  const mode = useStore((s) => s.mode);
  const cellar = useStore((s) => s.cellar);
  const reorgNext = useStore((s) => s.reorgNext);
  const reorgPrev = useStore((s) => s.reorgPrev);
  const quitReorg = useStore((s) => s.quitReorg);
  if (mode.kind !== 'reorg') return null;

  const total = mode.plan.steps.length;
  const step = mode.plan.steps[mode.index];
  if (!step) return null;
  const bottle = bottleById(cellar, step.bottleId) ?? mode.horsCave.find((b) => b.id === step.bottleId);
  const last = mode.index === total - 1;

  let instruction: ReactNode;
  if (step.to === 'hors-cave') {
    instruction = (
      <>
        Sortez <BottleName bottle={bottle} /> de <span className="pill pill-source">{place(step.from)}</span> et
        gardez-la <strong>à côté de vous</strong> : elle reviendra dans quelques étapes.
      </>
    );
  } else if (step.from === 'hors-cave') {
    instruction = (
      <>
        Rangez <BottleName bottle={bottle} /> (posée à côté de vous) en{' '}
        <span className="pill pill-dest">{place(step.to)}</span>.
      </>
    );
  } else {
    instruction = (
      <>
        Prenez <BottleName bottle={bottle} /> en <span className="pill pill-source">{place(step.from)}</span> et
        posez-la en <span className="pill pill-dest">{place(step.to)}</span>
        {step.temporaire ? (
          <>
            {' '}
            <span className="muted">(place provisoire : elle bougera encore)</span>
          </>
        ) : null}
        .
      </>
    );
  }

  return (
    <div className="banner banner-reorg" role="region" aria-label="Réorganisation guidée">
      <div className="banner-progress" aria-hidden="true">
        <div className="banner-progress-bar" style={{ width: `${(mode.index / total) * 100}%` }} />
      </div>
      <div className="banner-main">
        <div className="banner-step">
          Étape <strong>{mode.index + 1}</strong> / {total}
        </div>
        <p className="banner-text" aria-live="polite">
          {instruction}
        </p>
        {mode.horsCave.length > 0 && step.from !== 'hors-cave' ? (
          <p className="banner-note">
            <Icon name="hand" size={14} /> À côté de vous : {mode.horsCave.map((b) => formatWine(b)).join(', ')}
          </p>
        ) : null}
      </div>
      <div className="banner-actions">
        <button
          type="button"
          className="btn btn-small"
          onClick={reorgPrev}
          disabled={mode.index === 0}
          title="Revenir à l'étape précédente (remettez la bouteille où elle était)"
        >
          <Icon name="chevronLeft" size={15} />
          Précédent
        </button>
        <button type="button" className="btn btn-primary banner-done" onClick={reorgNext} autoFocus>
          <Icon name="check" size={18} />
          {last ? 'Fait — terminer' : 'Fait'}
        </button>
        <button
          type="button"
          className="btn btn-small btn-ghost"
          onClick={quitReorg}
          title="Interrompre la réorganisation (la cave reste à jour)"
        >
          Quitter
        </button>
      </div>
    </div>
  );
}

/**
 * Bandeau contextuel au-dessus du schéma : consigne du mode en cours
 * (ajout, déplacement, réorganisation), tâche IA en cours, alerte de fichier.
 */
export function ModeBanner(): ReactNode {
  const mode = useStore((s) => s.mode);
  const cellar = useStore((s) => s.cellar);
  const busy = useStore((s) => s.busy);
  const file = useStore((s) => s.file);
  const confirmPlacement = useStore((s) => s.confirmPlacement);
  const setPlacementCount = useStore((s) => s.setPlacementCount);
  const saveEdit = useStore((s) => s.saveEdit);
  const cancelMode = useStore((s) => s.cancelMode);
  const startReorg = useStore((s) => s.startReorg);

  const banners: ReactNode[] = [];

  if (file.linked && file.conflict) {
    banners.push(
      <div className="banner banner-warn" role="alert" key="conflit">
        <div className="banner-main">
          <p className="banner-text">
            <Icon name="warning" size={16} /> <strong>{file.linked.name}</strong> a été modifié ailleurs (autre
            appareil, OneDrive, tableur) alors que la cave a aussi changé ici.
          </p>
        </div>
        <div className="banner-actions">
          <button type="button" className="btn btn-small" onClick={() => void resolveConflictWithFile()}>
            Charger le fichier
          </button>
          <button type="button" className="btn btn-small" onClick={() => void resolveConflictWithLocal()}>
            Garder ma version
          </button>
        </div>
      </div>,
    );
  } else if (file.linked && file.linked.permission !== 'granted') {
    banners.push(
      <div className="banner banner-info" key="reconnecter">
        <div className="banner-main">
          <p className="banner-text">
            <Icon name="link" size={16} /> Le fichier <strong>{file.linked.name}</strong> n'est plus connecté : les
            modifications restent enregistrées dans ce navigateur.
          </p>
        </div>
        <div className="banner-actions">
          <button type="button" className="btn btn-small btn-primary" onClick={() => void reconnectLinkedFile()}>
            Reconnecter le fichier
          </button>
        </div>
      </div>,
    );
  } else if (file.linked && file.error) {
    banners.push(
      <div className="banner banner-warn" role="alert" key="erreur-fichier">
        <div className="banner-main">
          <p className="banner-text">
            <Icon name="warning" size={16} /> {file.error}
          </p>
        </div>
        <div className="banner-actions">
          <button type="button" className="btn btn-small" onClick={() => void retryLinkedWrite()}>
            Réessayer
          </button>
        </div>
      </div>,
    );
  }

  if (busy) {
    banners.push(
      <div className="banner banner-busy" role="status" key="busy">
        <div className="banner-progress" aria-hidden="true">
          <div
            className="banner-progress-bar"
            data-indeterminate={busy.progress === null ? '' : undefined}
            style={busy.progress === null ? undefined : { width: `${Math.round(busy.progress * 100)}%` }}
          />
        </div>
        <div className="banner-main">
          <p className="banner-text">
            <Icon name="bot" size={16} /> {busy.label}
          </p>
        </div>
        <div className="banner-actions">
          <button type="button" className="btn btn-small" onClick={cancelBusy}>
            Annuler
          </button>
        </div>
      </div>,
    );
  }

  if (mode.kind === 'placement') {
    const n = mode.slots.length;
    banners.push(
      <div className="banner banner-mode" role="region" aria-label="Ajout en cours" key="placement">
        <div className="banner-main">
          <p className="banner-text" aria-live="polite">
            Ajout de <strong>{mode.count > 1 ? `${mode.count} × ` : ''}{formatWine(mode.wine)}</strong> —{' '}
            {n === 1 ? 'emplacement proposé' : `${n} emplacements proposés`} :{' '}
            <span className="pill pill-free">{mode.slots.map(formatSlotShort).join(', ')}</span>
          </p>
          <p className="banner-note">
            {mode.message} Touchez une autre place libre du schéma pour changer.
            {!mode.complete ? ` Seules ${n} bouteille(s) sur ${mode.count} peuvent être placées ici.` : ''}
          </p>
        </div>
        <div className="banner-actions">
          <div className="stepper" role="group" aria-label="Nombre de bouteilles identiques à ranger">
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setPlacementCount(mode.count - 1)}
              disabled={mode.count <= 1}
              aria-label="Une bouteille de moins"
            >
              <Icon name="minus" size={16} />
            </button>
            <output className="stepper-value" title="Nombre de bouteilles identiques">
              ×{mode.count}
            </output>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setPlacementCount(mode.count + 1)}
              disabled={mode.count >= MAX_QUANTITY}
              aria-label="Une bouteille de plus"
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
          <button type="button" className="btn btn-primary" onClick={confirmPlacement} autoFocus>
            <Icon name="check" size={17} />
            {n > 1 ? `Ranger les ${n} bouteilles` : 'Ranger ici'}
          </button>
          <button type="button" className="btn btn-small" onClick={cancelMode}>
            Annuler
          </button>
        </div>
      </div>,
    );
  } else if (mode.kind === 'deplacement') {
    const bottle = bottleById(cellar, mode.bottleId);
    banners.push(
      <div className="banner banner-mode" role="region" aria-label="Déplacement en cours" key="deplacement">
        <div className="banner-main">
          <p className="banner-text" aria-live="polite">
            Déplacement de <BottleName bottle={bottle} />
            {bottle ? (
              <>
                {' '}
                <span className="pill pill-source">{formatSlotShort(bottle)}</span>
              </>
            ) : null}{' '}
            : touchez l'emplacement d'arrivée.
          </p>
          <p className="banner-note only-desktop">
            Une place libre → la bouteille y est déplacée. Une autre bouteille → les deux sont échangées. Les
            emplacements hachurés ne conviennent pas à sa forme.
          </p>
          <p className="banner-note only-phone">Place libre : déplacement. Autre bouteille : échange.</p>
        </div>
        <div className="banner-actions">
          <button type="button" className="btn btn-small" onClick={cancelMode} autoFocus>
            Annuler
          </button>
        </div>
      </div>,
    );
  } else if (mode.kind === 'correction') {
    const bottle = bottleById(cellar, mode.bottleId);
    banners.push(
      <div className="banner banner-mode" role="region" aria-label="Correction en cours" key="correction">
        <div className="banner-main">
          <p className="banner-text" aria-live="polite">
            <Icon name="pencil" size={16} /> Correction de <BottleName bottle={bottle} />
            {bottle ? (
              <>
                {' '}
                <span className="pill pill-source">{formatSlotShort(bottle)}</span>
              </>
            ) : null}
          </p>
          <p className="banner-note">
            Le formulaire contient la description de cette bouteille : modifiez-la, puis enregistrez. Pour changer
            son emplacement, utilisez « Déplacer ».
          </p>
        </div>
        <div className="banner-actions">
          <button type="button" className="btn btn-primary" onClick={saveEdit}>
            <Icon name="check" size={17} />
            Enregistrer
          </button>
          <button type="button" className="btn btn-small" onClick={cancelMode}>
            Annuler
          </button>
        </div>
      </div>,
    );
  } else if (mode.kind === 'reorg-apercu') {
    const plan = mode.plans[mode.choix];
    banners.push(
      <div className="banner banner-mode" role="region" aria-label="Réorganisation" key="apercu">
        <div className="banner-main">
          <p className="banner-text">
            <Icon name="sort" size={16} /> Réorganisation par année :{' '}
            {plan.steps.length === 0 ? (
              <strong>la cave est déjà rangée.</strong>
            ) : (
              <>
                <strong>{plan.steps.length} déplacement{plan.steps.length > 1 ? 's' : ''}</strong> — les bouteilles à
                déplacer sont mises en valeur.
              </>
            )}
          </p>
        </div>
        <div className="banner-actions">
          <button type="button" className="btn btn-primary" onClick={startReorg} disabled={plan.steps.length === 0}>
            Commencer
          </button>
          <button type="button" className="btn btn-small" onClick={cancelMode}>
            Annuler
          </button>
        </div>
      </div>,
    );
  } else if (mode.kind === 'reorg') {
    banners.push(<ReorgGuide key="reorg" />);
  }

  if (banners.length === 0) return null;
  return <div className="banners">{banners}</div>;
}
