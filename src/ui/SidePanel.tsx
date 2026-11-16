import { useMemo, type ReactNode } from 'react';
import { describeWindow, drinkStatus, estimateDrinkWindow, type AdviceItem } from '../domain/advisor';
import { cellarStats } from '../domain/cellar';
import {
  FORME_LABELS,
  ROBE_LABELS,
  TYPE_CLAYETTE_LABELS,
  formatSlotShort,
  formatWine,
} from '../domain/labels';
import { wineKey } from '../domain/normalize';
import type { ReorgMode, ReorgPlace, ReorgPlan } from '../domain/reorg';
import { ROBES, type Bottle, type DrinkStatus, type SlotRef } from '../domain/types';
import { ADVICE_TITLES } from '../state/advice';
import { computeTarget, freeSlotsForForm } from '../state/selectors';
import { useStore } from '../state/store';
import { Icon } from './icons';

const STATUS_BADGE: Record<DrinkStatus, { label: string; className: string }> = {
  'trop-jeune': { label: 'À attendre', className: 'badge badge-info' },
  'a-boire': { label: 'À boire', className: 'badge badge-ok' },
  'a-boire-vite': { label: 'À boire vite', className: 'badge badge-warn' },
  passe: { label: 'Apogée dépassée', className: 'badge badge-danger' },
  inconnu: { label: 'Sans millésime', className: 'badge' },
};

const SOURCE_LABEL = {
  local: 'Estimation locale',
  ia: 'Assistant IA',
  'ia-web': 'Assistant IA + recherche web',
} as const;

function SlotChip({ slot, onClick }: { slot: SlotRef; onClick: () => void }): ReactNode {
  return (
    <button type="button" className="slot-chip" onClick={onClick} title="Montrer dans le schéma">
      {formatSlotShort(slot)}
    </button>
  );
}

function PanelHeader({
  title,
  subtitle,
  onClose,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose?: () => void;
}): ReactNode {
  return (
    <header className="panel-header">
      <div className="panel-heading">
        <h2 className="panel-title">{title}</h2>
        {subtitle ? <p className="panel-subtitle">{subtitle}</p> : null}
      </div>
      {onClose ? (
        <button type="button" className="btn btn-small btn-icon btn-ghost" onClick={onClose} aria-label="Fermer">
          <Icon name="x" size={16} />
        </button>
      ) : null}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Fiche d'une bouteille                                               */
/* ------------------------------------------------------------------ */

function BottleCard({ bottle }: { bottle: Bottle }): ReactNode {
  const cellar = useStore((s) => s.cellar);
  const aiWindows = useStore((s) => s.aiWindows);
  const pinBottle = useStore((s) => s.pinBottle);
  const year = new Date().getFullYear();
  const window = aiWindows[wineKey(bottle)] ?? estimateDrinkWindow(bottle);
  const status = drinkStatus(window, year);
  const twins = cellar.bottles.filter((b) => b.id !== bottle.id && wineKey(b) === wineKey(bottle));
  const shelf = cellar.shelves[bottle.clayette - 1];
  return (
    <div className="bottle-card">
      <div className="bottle-card-title">
        <span className="robe-dot" data-robe={bottle.robe} />
        <strong>{formatWine(bottle)}</strong>
        {bottle.collection ? <span className="badge badge-gold">★ collection</span> : null}
      </div>
      <dl className="bottle-card-facts">
        {bottle.appellation ? (
          <>
            <dt>Appellation</dt>
            <dd>{bottle.appellation}</dd>
          </>
        ) : null}
        <dt>Millésime</dt>
        <dd>{bottle.annee ?? 'non millésimé'}</dd>
        <dt>Robe</dt>
        <dd>{ROBE_LABELS[bottle.robe]}</dd>
        {bottle.cepages.length > 0 ? (
          <>
            <dt>Cépages</dt>
            <dd>{bottle.cepages.join(', ')}</dd>
          </>
        ) : null}
        <dt>Bouteille</dt>
        <dd>{FORME_LABELS[bottle.forme]}</dd>
        <dt>Emplacement</dt>
        <dd>
          Clayette {bottle.clayette}, rang {bottle.rang}
          {shelf ? <span className="muted"> ({TYPE_CLAYETTE_LABELS[shelf.type]})</span> : null}
        </dd>
      </dl>
      <div className="bottle-card-window">
        <span className={STATUS_BADGE[status].className}>{STATUS_BADGE[status].label}</span>
        <span className="muted">{describeWindow(window, year)}</span>
      </div>
      {twins.length > 0 ? (
        <div className="bottle-card-twins">
          <span className="muted">
            {twins.length === 1 ? '1 autre bouteille identique :' : `${twins.length} autres bouteilles identiques :`}
          </span>
          <span className="chip-row">
            {twins.map((b) => (
              <SlotChip key={b.id} slot={b} onClick={() => pinBottle(b.id)} />
            ))}
          </span>
        </div>
      ) : null}
      <p className="panel-tip">
        Modifiez les champs du formulaire pour corriger cette bouteille, ou utilisez les actions Retirer, Déplacer,
        Collection.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Résultats de recherche                                              */
/* ------------------------------------------------------------------ */

interface WineGroup {
  key: string;
  sample: Bottle;
  bottles: Bottle[];
}

function groupByWine(bottles: readonly Bottle[]): WineGroup[] {
  const map = new Map<string, WineGroup>();
  for (const b of bottles) {
    const key = wineKey(b);
    const group = map.get(key);
    if (group) group.bottles.push(b);
    else map.set(key, { key, sample: b, bottles: [b] });
  }
  return [...map.values()];
}

function ResultsList({ bottles }: { bottles: Bottle[] }): ReactNode {
  const pinBottle = useStore((s) => s.pinBottle);
  const groups = useMemo(() => groupByWine(bottles), [bottles]);
  return (
    <ul className="result-list">
      {groups.map((g) => (
        <li key={g.key} className="result-item">
          <div className="result-main">
            <span className="robe-dot" data-robe={g.sample.robe} title={ROBE_LABELS[g.sample.robe]} />
            <span className="result-name">{formatWine(g.sample)}</span>
            {g.bottles.length > 1 ? <span className="badge">×{g.bottles.length}</span> : null}
            {g.bottles.some((b) => b.collection) ? (
              <span className="badge badge-gold" title="Bouteille(s) de collection">
                ★
              </span>
            ) : null}
          </div>
          <div className="result-sub">
            {[g.sample.appellation, g.sample.cepages.join(', ')].filter(Boolean).join(' · ')}
          </div>
          <div className="chip-row">
            {g.bottles.map((b) => (
              <SlotChip key={b.id} slot={b} onClick={() => pinBottle(b.id)} />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Places libres                                                       */
/* ------------------------------------------------------------------ */

function FreePanel(): ReactNode {
  const cellar = useStore((s) => s.cellar);
  const form = useStore((s) => s.form);
  const tapSlot = useStore((s) => s.tapSlot);
  const toggleFree = useStore((s) => s.toggleFree);
  const free = useMemo(() => freeSlotsForForm(cellar, form), [cellar, form]);
  const byShelf = useMemo(() => {
    const map = new Map<number, SlotRef[]>();
    for (const slot of free) {
      const list = map.get(slot.clayette);
      if (list) list.push(slot);
      else map.set(slot.clayette, [slot]);
    }
    return [...map.entries()];
  }, [free]);
  return (
    <>
      <PanelHeader
        title={`Places libres (${free.length})`}
        subtitle={
          form.forme
            ? `Compatibles avec une bouteille ${FORME_LABELS[form.forme]}`
            : 'Indiquez une forme de bouteille pour ne voir que les places compatibles'
        }
        onClose={toggleFree}
      />
      <div className="panel-body">
        {free.length === 0 ? (
          <p className="panel-empty">Aucune place libre ne correspond.</p>
        ) : (
          <ul className="result-list">
            {byShelf.map(([clayette, slots]) => (
              <li key={clayette} className="result-item">
                <div className="result-main">
                  <span className="result-name">Clayette {clayette}</span>
                  <span className="badge">{TYPE_CLAYETTE_LABELS[cellar.shelves[clayette - 1]!.type]}</span>
                  <span className="muted">
                    {slots.length} place{slots.length > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="chip-row">
                  {slots.map((slot) => (
                    <SlotChip key={slot.rang} slot={slot} onClick={() => tapSlot(slot)} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Conseils du sommelier                                               */
/* ------------------------------------------------------------------ */

function scoreLabel(score: number): string {
  if (score >= 85) return 'Excellent accord';
  if (score >= 70) return 'Bon accord';
  if (score >= 60) return 'Accord possible';
  return 'Accord incertain';
}

function AdviceRow({ item, canClassify }: { item: AdviceItem; canClassify: boolean }): ReactNode {
  const pinBottle = useStore((s) => s.pinBottle);
  const classifyBottles = useStore((s) => s.classifyBottles);
  const sample = item.bottles[0];
  if (!sample) return null;
  return (
    <li className="result-item">
      <div className="result-main">
        <span className="robe-dot" data-robe={sample.robe} title={ROBE_LABELS[sample.robe]} />
        <span className="result-name">{formatWine(sample)}</span>
        {item.bottles.length > 1 ? <span className="badge">×{item.bottles.length}</span> : null}
      </div>
      <div className="result-sub">{sample.appellation}</div>
      <div className="advice-badges">
        <span className={STATUS_BADGE[item.status].className}>{STATUS_BADGE[item.status].label}</span>
        {item.pairing ? (
          <span className="badge badge-accent" title={`Note d'accord : ${Math.round(item.pairing.score)} / 100`}>
            {scoreLabel(item.pairing.score)} · {Math.round(item.pairing.score)}
          </span>
        ) : null}
      </div>
      <p className="advice-reason">{item.raison}</p>
      <div className="chip-row">
        {item.bottles.map((b) => (
          <SlotChip key={b.id} slot={b} onClick={() => pinBottle(b.id)} />
        ))}
        {canClassify ? (
          <button
            type="button"
            className="btn btn-small"
            onClick={() =>
              classifyBottles(
                item.bottles.map((b) => b.id),
                true,
              )
            }
          >
            <Icon name="star" size={14} />
            Classer en collection
          </button>
        ) : null}
      </div>
    </li>
  );
}

function AdvicePanel(): ReactNode {
  const advice = useStore((s) => s.advice);
  const setAdvice = useStore((s) => s.setAdvice);
  const classifyBottles = useStore((s) => s.classifyBottles);
  if (!advice) return null;
  const count = advice.items.reduce((n, item) => n + item.bottles.length, 0);
  const emptyText: Record<typeof advice.kind, string> = {
    boire: 'Aucune bouteille n\'arrive en fin de fenêtre de dégustation : rien ne presse.',
    accord: `Aucune bouteille de la cave ne s'accorde vraiment avec « ${advice.plat} ».`,
    privilegier: `Aucune bouteille à boire rapidement ne convient à « ${advice.plat} ». Essayez « Accord » pour voir toutes les bouteilles adaptées.`,
    collection: 'Aucune bouteille ne semble avoir dépassé son apogée.',
  };
  return (
    <>
      <PanelHeader
        title={
          <>
            {ADVICE_TITLES[advice.kind]}
            {advice.plat && advice.kind !== 'boire' && advice.kind !== 'collection' ? ` — ${advice.plat}` : ''}
          </>
        }
        subtitle={
          <>
            {count} bouteille{count > 1 ? 's' : ''} · hors collection ·{' '}
            <span className={advice.source === 'local' ? 'badge' : 'badge badge-accent'}>
              {SOURCE_LABEL[advice.source]}
            </span>
          </>
        }
        onClose={() => setAdvice(null)}
      />
      <div className="panel-body">
        {advice.note ? (
          <p className="panel-note">
            <Icon name="info" size={15} /> {advice.note}
          </p>
        ) : null}
        {advice.items.length === 0 ? (
          <p className="panel-empty">{emptyText[advice.kind]}</p>
        ) : (
          <>
            {advice.kind === 'collection' ? (
              <div className="panel-toolbar">
                <span className="muted">Ces bouteilles ont sans doute passé leur apogée.</span>
                <button
                  type="button"
                  className="btn btn-small btn-primary"
                  onClick={() =>
                    classifyBottles(
                      advice.items.flatMap((i) => i.bottles.map((b) => b.id)),
                      true,
                    )
                  }
                >
                  <Icon name="star" size={14} />
                  Tout classer en collection
                </button>
              </div>
            ) : null}
            <ul className="result-list">
              {advice.items.map((item) => (
                <AdviceRow key={item.key} item={item} canClassify={advice.kind === 'collection'} />
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Réorganisation                                                      */
/* ------------------------------------------------------------------ */

const REORG_MODES: { mode: ReorgMode; title: string; text: string }[] = [
  {
    mode: 'economique',
    title: 'Le moins de déplacements',
    text: 'Les bouteilles déjà bien placées ne bougent pas ; les places libres restent où elles sont.',
  },
  {
    mode: 'compact',
    title: 'Tout tasser vers le haut',
    text: 'Les bouteilles sont serrées depuis la clayette 1 ; les places libres se retrouvent en bas.',
  },
];

function PlanStats({ plan }: { plan: ReorgPlan }): ReactNode {
  const s = plan.stats;
  return (
    <ul className="plan-stats">
      <li>
        <strong>{s.deplacements}</strong> déplacement{s.deplacements > 1 ? 's' : ''}
      </li>
      <li>
        <strong>{s.dejaEnPlace}</strong> / {s.bouteilles} bouteilles ne bougent pas
      </li>
      {s.exceptionsOrdre > 0 ? (
        <li title="Le type des clayettes empêche un ordre parfait">
          {s.exceptionsOrdre} exception{s.exceptionsOrdre > 1 ? 's' : ''} à l'ordre des années
        </li>
      ) : (
        <li>ordre des années parfait</li>
      )}
      {s.groupesSepares > 0 ? (
        <li>
          {s.groupesSepares} lot{s.groupesSepares > 1 ? 's' : ''} réparti{s.groupesSepares > 1 ? 's' : ''} sur
          plusieurs endroits
        </li>
      ) : null}
    </ul>
  );
}

function ReorgPreviewPanel(): ReactNode {
  const mode = useStore((s) => s.mode);
  const chooseReorg = useStore((s) => s.chooseReorg);
  const setReorgApercu = useStore((s) => s.setReorgApercu);
  const startReorg = useStore((s) => s.startReorg);
  const cancelMode = useStore((s) => s.cancelMode);
  if (mode.kind !== 'reorg-apercu') return null;
  const plan = mode.plans[mode.choix];
  return (
    <>
      <PanelHeader
        title="Réorganiser la cave"
        subtitle="Plus anciennes en haut, plus récentes en bas, de gauche à droite ; même château et même année côte à côte ; type des clayettes respecté."
        onClose={cancelMode}
      />
      <div className="panel-body">
        <div className="plan-options" role="radiogroup" aria-label="Façon de ranger">
          {REORG_MODES.map((opt) => {
            const p = mode.plans[opt.mode];
            const active = mode.choix === opt.mode;
            return (
              <button
                key={opt.mode}
                type="button"
                role="radio"
                aria-checked={active}
                className="plan-option"
                onClick={() => chooseReorg(opt.mode)}
              >
                <span className="plan-option-title">
                  {opt.title}
                  <span className="badge badge-accent">
                    {p.steps.length} déplacement{p.steps.length > 1 ? 's' : ''}
                  </span>
                </span>
                <span className="plan-option-text">{opt.text}</span>
              </button>
            );
          })}
        </div>

        <PlanStats plan={plan} />
        {plan.notes.map((note) => (
          <p key={note} className="panel-note">
            <Icon name="info" size={15} /> {note}
          </p>
        ))}

        <div className="segmented" role="group" aria-label="Aperçu sur le schéma">
          <button type="button" aria-pressed={mode.apercu === 'avant'} onClick={() => setReorgApercu('avant')}>
            Avant
          </button>
          <button type="button" aria-pressed={mode.apercu === 'apres'} onClick={() => setReorgApercu('apres')}>
            Après
          </button>
        </div>
        <p className="panel-tip">
          Le schéma montre la cave {mode.apercu === 'avant' ? 'actuelle' : 'une fois rangée'} ; les bouteilles
          concernées par un déplacement sont mises en valeur.
        </p>

        <div className="panel-actions">
          <button type="button" className="btn btn-primary" onClick={startReorg} disabled={plan.steps.length === 0}>
            <Icon name="check" size={17} />
            Commencer le guidage
          </button>
          <button type="button" className="btn" onClick={cancelMode}>
            Annuler
          </button>
        </div>
        <p className="panel-tip">
          Vous validerez chaque déplacement un par un. Vous pouvez vous arrêter à tout moment : la cave affichée reste
          fidèle à la cave réelle.
        </p>
      </div>
    </>
  );
}

function placeLabel(p: ReorgPlace): string {
  return p === 'hors-cave' ? 'à côté' : formatSlotShort(p);
}

function ReorgStepsPanel(): ReactNode {
  const mode = useStore((s) => s.mode);
  const cellar = useStore((s) => s.cellar);
  if (mode.kind !== 'reorg') return null;
  const names = new Map<string, string>();
  for (const b of [...cellar.bottles, ...mode.horsCave, ...mode.depart.bottles]) names.set(b.id, formatWine(b));
  const total = mode.plan.steps.length;
  // Fenêtre glissante autour de l'étape courante.
  const from = Math.max(0, mode.index - 2);
  const to = Math.min(total, mode.index + 12);
  return (
    <>
      <PanelHeader
        title="Réorganisation guidée"
        subtitle={`${mode.index} déplacement${mode.index > 1 ? 's' : ''} fait${mode.index > 1 ? 's' : ''} sur ${total}`}
      />
      <div className="panel-body">
        <ol className="step-list" start={from + 1}>
          {mode.plan.steps.slice(from, to).map((step) => (
            <li
              key={step.index}
              className="step-item"
              data-state={step.index < mode.index ? 'fait' : step.index === mode.index ? 'courant' : 'avenir'}
              aria-current={step.index === mode.index ? 'step' : undefined}
            >
              <span className="step-num">{step.index + 1}</span>
              <span className="step-text">
                <span className="step-name">{names.get(step.bottleId) ?? 'Bouteille'}</span>
                <span className="step-move">
                  {placeLabel(step.from)} <Icon name="arrowRight" size={13} /> {placeLabel(step.to)}
                  {step.temporaire && step.to !== 'hors-cave' ? ' (provisoire)' : ''}
                </span>
              </span>
              {step.index < mode.index ? <Icon name="check" size={15} /> : null}
            </li>
          ))}
        </ol>
        {to < total ? <p className="panel-tip">… puis {total - to} autre(s) déplacement(s).</p> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Accueil du panneau                                                  */
/* ------------------------------------------------------------------ */

function IdlePanel(): ReactNode {
  const cellar = useStore((s) => s.cellar);
  const stats = useMemo(() => cellarStats(cellar), [cellar]);
  return (
    <>
      <PanelHeader title="Ma cave" subtitle={`${cellar.shelves.length} clayettes · ${stats.capacite} emplacements`} />
      <div className="panel-body">
        <ul className="stat-grid">
          <li>
            <strong>{stats.total}</strong>
            <span>bouteille{stats.total > 1 ? 's' : ''}</span>
          </li>
          <li>
            <strong>{stats.libres}</strong>
            <span>place{stats.libres > 1 ? 's' : ''} libre{stats.libres > 1 ? 's' : ''}</span>
          </li>
          <li>
            <strong>{stats.collection}</strong>
            <span>de collection</span>
          </li>
        </ul>
        <ul className="robe-stats">
          {ROBES.map((robe) => (
            <li key={robe}>
              <span className="robe-dot" data-robe={robe} />
              {ROBE_LABELS[robe]}
              <strong>{stats.parRobe[robe]}</strong>
            </li>
          ))}
        </ul>
        <div className="panel-help">
          <p>
            <strong>Chercher</strong> : saisissez un château, une appellation, une année, un cépage… Les bouteilles
            correspondantes s'illuminent aussitôt dans le schéma.
          </p>
          <p>
            <strong>Désigner</strong> : touchez une bouteille pour voir sa fiche, puis utilisez Retirer, Déplacer ou
            Collection.
          </p>
          <p>
            <strong>Ajouter</strong> : décrivez la bouteille (ou scannez son étiquette), puis « Ajouter » : un
            emplacement vous est proposé.
          </p>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Panneau                                                             */
/* ------------------------------------------------------------------ */

/**
 * Panneau contextuel : résultats de recherche, fiche de la bouteille désignée,
 * places libres, conseils du sommelier, plan et suivi de la réorganisation.
 */
export function SidePanel(): ReactNode {
  const cellar = useStore((s) => s.cellar);
  const form = useStore((s) => s.form);
  const mode = useStore((s) => s.mode);
  const view = useStore((s) => s.view);
  const advice = useStore((s) => s.advice);
  const setView = useStore((s) => s.setView);
  const target = useMemo(() => computeTarget(cellar, form), [cellar, form]);

  let content: ReactNode;
  if (mode.kind === 'reorg-apercu') content = <ReorgPreviewPanel />;
  else if (mode.kind === 'reorg') content = <ReorgStepsPanel />;
  else if (view === 'libres') content = <FreePanel />;
  else if (view === 'conseil' && advice) content = <AdvicePanel />;
  else if (target.kind === 'bouteille' && target.bottles[0]) {
    content = (
      <>
        <PanelHeader title="Bouteille désignée" subtitle={formatSlotShort(target.bottles[0])} />
        <div className="panel-body">
          <BottleCard bottle={target.bottles[0]} />
        </div>
      </>
    );
  } else if (target.kind === 'selection' && target.bottles.length > 0) {
    content = (
      <>
        <PanelHeader
          title={`Résultats (${target.bottles.length})`}
          subtitle="Touchez un emplacement pour désigner la bouteille."
        />
        <div className="panel-body">
          <ResultsList bottles={target.bottles} />
        </div>
      </>
    );
  } else if (target.kind === 'selection') {
    content = (
      <>
        <PanelHeader title="Résultats (0)" />
        <div className="panel-body">
          <p className="panel-empty">
            Aucune bouteille ne correspond à tous ces critères. Retirez un critère pour élargir la recherche.
          </p>
        </div>
      </>
    );
  } else content = <IdlePanel />;

  const showAdviceTab = advice !== null && mode.kind === 'normal' && view !== 'conseil';

  return (
    <aside className="side-panel" aria-label="Résultats et conseils">
      {showAdviceTab && advice ? (
        <button type="button" className="panel-return" onClick={() => setView('conseil')}>
          <Icon name="glass" size={15} />
          Revenir aux conseils « {ADVICE_TITLES[advice.kind]} »
        </button>
      ) : null}
      {content}
    </aside>
  );
}
