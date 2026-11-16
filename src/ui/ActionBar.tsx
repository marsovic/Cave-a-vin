import { useMemo, type ReactNode } from 'react';
import { runAdvice } from '../state/advice';
import { canDescribeWine, computeTarget } from '../state/selectors';
import { useStore } from '../state/store';
import { Icon, type IconName } from './icons';

interface ActionProps {
  icon: IconName;
  label: string;
  /** Explication complète (infobulle et lecteur d'écran). */
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  primary?: boolean;
  badge?: number;
}

function Action({ icon, label, hint, onClick, disabled, active, primary, badge }: ActionProps): ReactNode {
  const toast = useStore((s) => s.toast);
  return (
    <button
      type="button"
      className="action"
      data-primary={primary ? '' : undefined}
      aria-pressed={active}
      // Un bouton indisponible reste cliquable : il explique alors ce qu'il attend.
      aria-disabled={disabled ? true : undefined}
      onClick={() => (disabled ? toast('info', hint) : onClick())}
      title={hint}
      aria-label={badge !== undefined && badge > 1 ? `${label} (${badge})` : label}
    >
      <span className="action-icon">
        <Icon name={icon} size={20} />
        {badge !== undefined && badge > 1 && !disabled ? <span className="action-badge">{badge}</span> : null}
      </span>
      <span className="action-label">{label}</span>
    </button>
  );
}

/**
 * Barre d'actions : toutes les fonctions agissent sur la cible décrite par le
 * formulaire (voir la barre de cible). Trois groupes : bouteille, cave, sommelier.
 */
export function ActionBar(): ReactNode {
  const cellar = useStore((s) => s.cellar);
  const form = useStore((s) => s.form);
  const mode = useStore((s) => s.mode);
  const view = useStore((s) => s.view);
  const busy = useStore((s) => s.busy !== null);
  const plat = useStore((s) => s.plat);
  const startAdd = useStore((s) => s.startAdd);
  const removeTarget = useStore((s) => s.removeTarget);
  const startMove = useStore((s) => s.startMove);
  const classify = useStore((s) => s.classify);
  const toggleFree = useStore((s) => s.toggleFree);
  const openReorg = useStore((s) => s.openReorg);

  const target = useMemo(() => computeTarget(cellar, form), [cellar, form]);
  const locked = mode.kind !== 'normal';
  const n = locked ? 0 : target.bottles.length;
  const canAdd = canDescribeWine(form);
  const hasPlat = plat.trim().length > 0;
  const toClass = target.bottles.filter((b) => !b.collection).length;
  const toUnclass = n - toClass;
  const empty = cellar.bottles.length === 0;

  return (
    <div className="action-bar" role="toolbar" aria-label="Actions">
      <div className="action-group" role="group" aria-label="Bouteille">
        <span className="action-group-title">Bouteille</span>
        <Action
          icon="plus"
          label="Ajouter"
          primary
          hint={
            canAdd
              ? 'Ajouter la bouteille décrite dans le formulaire (un emplacement est proposé)'
              : 'Pour ajouter une bouteille, indiquez au moins son château ou son appellation dans le formulaire.'
          }
          onClick={startAdd}
          disabled={locked || !canAdd}
        />
        <Action
          icon="trash"
          label="Supprimer"
          hint={
            n === 0
              ? 'Touchez une bouteille dans le schéma, ou saisissez des critères, pour indiquer quoi supprimer.'
              : n === 1
                ? 'Supprimer cette bouteille de la cave (bue, offerte…)'
                : `Supprimer les ${n} bouteilles correspondant aux critères (une confirmation est demandée)`
          }
          onClick={removeTarget}
          disabled={locked || n === 0}
          badge={n}
        />
        <Action
          icon="swap"
          label="Déplacer"
          hint={
            n === 1
              ? 'Déplacer cette bouteille vers une place libre, ou l\'échanger avec une autre'
              : 'Touchez d\'abord dans le schéma la bouteille à déplacer ou à échanger.'
          }
          onClick={startMove}
          disabled={locked || n !== 1}
        />
        <Action
          icon="star"
          label="Classer"
          hint={
            toClass === 0
              ? 'Pour classer en « collection », désignez une bouteille ou saisissez des critères (bouteilles non encore classées).'
              : toClass === 1
                ? 'Classer cette bouteille en « collection » (exclue des conseils de dégustation)'
                : `Classer ces ${toClass} bouteilles en « collection »`
          }
          onClick={() => classify(true)}
          disabled={locked || toClass === 0}
          badge={toClass}
        />
        <Action
          icon="starOff"
          label="Déclasser"
          hint={
            toUnclass === 0
              ? 'Pour déclasser, désignez une bouteille de collection ou saisissez des critères qui en contiennent.'
              : toUnclass === 1
                ? 'Retirer cette bouteille de la collection'
                : `Retirer ces ${toUnclass} bouteilles de la collection`
          }
          onClick={() => classify(false)}
          disabled={locked || toUnclass === 0}
          badge={toUnclass}
        />
      </div>

      <div className="action-group" role="group" aria-label="Cave">
        <span className="action-group-title">Cave</span>
        <Action
          icon="grid"
          label="Places libres"
          hint="Montrer les places libres (compatibles avec la forme et la clayette indiquées dans le formulaire)"
          onClick={toggleFree}
          disabled={locked}
          active={view === 'libres' && !locked}
        />
        <Action
          icon="sort"
          label="Réorganiser"
          hint="Ranger toute la cave par année, pas à pas, avec le moins de déplacements possible"
          onClick={openReorg}
          disabled={locked || empty}
        />
      </div>

      <div className="action-group" role="group" aria-label="Sommelier">
        <span className="action-group-title">Sommelier</span>
        <Action
          icon="glass"
          label="À boire"
          hint="Quelles bouteilles boire rapidement ? (hors collection)"
          onClick={() => void runAdvice('boire')}
          disabled={locked || busy || empty}
        />
        <Action
          icon="dish"
          label="Accord"
          hint={
            hasPlat
              ? `Quelles bouteilles conviennent à « ${plat.trim()} » ? (hors collection)`
              : 'Indiquez un plat dans le formulaire pour trouver les bouteilles qui l\'accompagnent'
          }
          onClick={() => void runAdvice('accord')}
          disabled={locked || busy || empty}
        />
        <Action
          icon="sparkles"
          label="À privilégier"
          hint={
            hasPlat
              ? `Bouteilles qui conviennent à « ${plat.trim()} » ET sont à boire rapidement (hors collection)`
              : 'Indiquez un plat : bouteilles qui lui conviennent ET sont à boire rapidement'
          }
          onClick={() => void runAdvice('privilegier')}
          disabled={locked || busy || empty}
        />
        <Action
          icon="hourglass"
          label="Trop vieilles ?"
          hint="Quelles bouteilles ont dépassé leur apogée et seraient à classer en collection ?"
          onClick={() => void runAdvice('collection')}
          disabled={locked || busy || empty}
        />
      </div>
    </div>
  );
}
