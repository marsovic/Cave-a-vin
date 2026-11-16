import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  FORME_LABELS,
  ROBE_LABELS,
  TYPE_CLAYETTE_LABELS,
  TYPE_CLAYETTE_SHORT,
  formatSlotShort,
  formatWine,
} from '../domain/labels';
import type { DrinkStatus, Shelf, SlotRef } from '../domain/types';
import { computeVisuals } from '../state/selectors';
import { useStore } from '../state/store';
import type { Prefs, SlotVisual } from '../state/types';
import { Icon } from './icons';

const STATUS_LABELS: Record<DrinkStatus, string> = {
  'trop-jeune': 'à attendre',
  'a-boire': 'à boire',
  'a-boire-vite': 'à boire rapidement',
  passe: 'fenêtre dépassée',
  inconnu: 'sans millésime',
};

const MARKER_LABELS: Record<NonNullable<SlotVisual['marker']>, string> = {
  libre: 'place libre',
  propose: 'emplacement proposé',
  possible: 'destination possible',
  incompatible: 'incompatible',
  source: 'bouteille à prendre',
  destination: 'où la poser',
};

/** Codes de type sur deux lettres, pour l'armoire compacte (téléphone). */
const TYPE_CODES: Record<Shelf['type'], string> = { bordeaux: 'Bx', bourgogne: 'Bg', champagne: 'Ch', tout: 'Tt' };

const FIXED_SIZES: Record<Exclude<Prefs['zoom'], 'auto'>, number> = { petit: 22, moyen: 32, grand: 44 };
const SLOT_GAP = 3;
const MAX_AUTO = 50;
/** En dessous de cette largeur, l'armoire passe en présentation compacte (téléphone). */
const COMPACT_WIDTH = 520;

function describe(v: SlotVisual, shelf: Shelf): string {
  const where = formatSlotShort(v.slot);
  const parts: string[] = [];
  if (v.bottle) {
    const b = v.bottle;
    parts.push(formatWine(b));
    if (b.appellation && b.appellation !== b.chateau) parts.push(b.appellation);
    parts.push(ROBE_LABELS[b.robe]);
    if (b.cepages.length > 0) parts.push(b.cepages.join(', '));
    parts.push(`bouteille ${FORME_LABELS[b.forme]}`);
    if (b.collection) parts.push('★ collection');
    if (v.status) parts.push(STATUS_LABELS[v.status]);
  } else {
    parts.push(`vide (emplacement ${TYPE_CLAYETTE_LABELS[shelf.type]})`);
  }
  if (v.marker) parts.push(MARKER_LABELS[v.marker]);
  return `${where} — ${parts.join(' · ')}`;
}

function yearLabel(annee: number | null): string {
  return annee === null ? '·' : `’${String(annee % 100).padStart(2, '0')}`;
}

interface SlotProps {
  v: SlotVisual;
  shelf: Shelf;
  draggable: boolean;
  showYear: boolean;
  focusable: boolean;
  /** Réaction au toucher (par défaut : désigner l'emplacement). */
  onTap: (slot: SlotRef) => void;
  /** Vise cet emplacement dans la loupe (repère discret dans la vue d'ensemble). */
  aimed?: boolean;
}

const Slot = memo(function Slot({ v, shelf, draggable, showYear, focusable, onTap, aimed }: SlotProps): ReactNode {
  const dropBottle = useStore((s) => s.dropBottle);
  const b = v.bottle;
  const label = describe(v, shelf);
  return (
    <button
      type="button"
      className="slot"
      role="gridcell"
      data-key={`${v.slot.clayette}:${v.slot.rang}`}
      data-robe={b?.robe}
      data-collection={b?.collection ? '' : undefined}
      data-tone={v.tone}
      data-selected={v.selected ? '' : undefined}
      data-marker={v.marker ?? undefined}
      data-status={v.status ?? undefined}
      aria-label={label}
      aria-pressed={v.selected}
      title={label}
      tabIndex={focusable ? 0 : -1}
      draggable={draggable && b !== null}
      data-aimed={aimed ? '' : undefined}
      onClick={() => onTap(v.slot)}
      onDragStart={(e) => {
        if (!b) return;
        e.dataTransfer.setData('application/x-bacchus-bottle', b.id);
        e.dataTransfer.setData('text/plain', formatWine(b));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-bacchus-bottle')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
      }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('application/x-bacchus-bottle')) e.currentTarget.dataset.over = '';
      }}
      onDragLeave={(e) => {
        delete e.currentTarget.dataset.over;
      }}
      onDrop={(e) => {
        delete e.currentTarget.dataset.over;
        const id = e.dataTransfer.getData('application/x-bacchus-bottle');
        if (!id) return;
        e.preventDefault();
        dropBottle(id, v.slot);
      }}
    >
      {b ? (
        <span className="bottle" aria-hidden="true">
          {showYear ? <span className="bottle-year">{yearLabel(b.annee)}</span> : null}
        </span>
      ) : null}
    </button>
  );
}, sameSlotProps);

/** Les objets `SlotVisual` sont recréés à chaque calcul : on compare leur contenu. */
function sameSlotProps(a: SlotProps, b: SlotProps): boolean {
  return (
    a.v.bottle === b.v.bottle &&
    a.v.tone === b.v.tone &&
    a.v.selected === b.v.selected &&
    a.v.marker === b.v.marker &&
    a.v.status === b.v.status &&
    a.v.slot.clayette === b.v.slot.clayette &&
    a.v.slot.rang === b.v.slot.rang &&
    a.shelf.type === b.shelf.type &&
    a.draggable === b.draggable &&
    a.showYear === b.showYear &&
    a.focusable === b.focusable &&
    a.onTap === b.onTap &&
    a.aimed === b.aimed
  );
}

/**
 * Schéma de la cave : une ligne par clayette (n° 1 en haut), un rond par emplacement.
 * Réagit en direct aux critères du formulaire et au mode d'interaction.
 */
export function CaveView(): ReactNode {
  const cellar = useStore((s) => s.cellar);
  const form = useStore((s) => s.form);
  const mode = useStore((s) => s.mode);
  const view = useStore((s) => s.view);
  const advice = useStore((s) => s.advice);
  const zoom = useStore((s) => s.prefs.zoom);
  const reveal = useStore((s) => s.reveal);
  const toggleShelf = useStore((s) => s.toggleShelf);
  const tapSlot = useStore((s) => s.tapSlot);
  const loupe = useStore((s) => s.loupe);
  const setLoupe = useStore((s) => s.setLoupe);
  // Clayette servant de critère seul (sans rang) : son étiquette est marquée.
  const shelfFilter = form.clayette.trim() && !form.rang.trim() ? Number(form.clayette) : null;

  const visuals = useMemo(
    () => computeVisuals({ cellar, form, mode, view, advice }),
    [cellar, form, mode, view, advice],
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = (): void => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const maxCap = Math.max(1, ...cellar.shelves.map((s) => s.capacite));
  const shelfCount = cellar.shelves.length;

  const slotSize = useMemo(() => {
    if (zoom !== 'auto') return FIXED_SIZES[zoom];
    if (box.width === 0) return 30;
    // Mêmes mesures que la feuille de style (cave.css) : marges de l'armoire, étiquette, filet de clayette.
    const compact = box.width < COMPACT_WIDTH;
    const chromeX = compact ? 2 * 10 + 34 + 5 + 6 : 2 * 15 + 52 + 8 + 6;
    const chromeY = compact ? 2 * 8 + 6 : 2 * 12 + 8;
    const rowChrome = compact ? 3 : 9;
    const fitWidth = Math.floor((box.width - chromeX + SLOT_GAP) / maxCap) - SLOT_GAP;
    const fitHeight = Math.floor((box.height - chromeY) / Math.max(1, shelfCount)) - rowChrome;
    // La cave entière reste visible tant que les emplacements gardent une taille utilisable.
    const min = compact ? 15 : 20;
    return Math.max(min, Math.min(MAX_AUTO, fitWidth, fitHeight));
  }, [zoom, box.width, box.height, maxCap, shelfCount]);

  // Fait défiler jusqu'à l'emplacement demandé (étape de réorganisation, résultat choisi…).
  useEffect(() => {
    if (!reveal) return;
    const el = viewportRef.current?.querySelector<HTMLElement>(
      `[data-key="${reveal.slot.clayette}:${reveal.slot.rang}"]`,
    );
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [reveal]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const delta: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const d = delta[e.key];
    if (!d) return;
    const active = document.activeElement as HTMLElement | null;
    const key = active?.dataset.key;
    if (!key) return;
    const [c, r] = key.split(':').map(Number) as [number, number];
    const clayette = Math.min(shelfCount, Math.max(1, c + d[0]));
    const cap = cellar.shelves[clayette - 1]?.capacite ?? 1;
    const rang = Math.min(cap, Math.max(1, r + d[1]));
    const next = viewportRef.current?.querySelector<HTMLElement>(`[data-key="${clayette}:${rang}"]`);
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  const draggable = mode.kind === 'normal';
  const showYear = slotSize >= 23;
  const compactLabels = box.width > 0 && box.width < COMPACT_WIDTH;

  // Téléphone : les emplacements de la vue d'ensemble sont petits. Les toucher amène la « loupe »
  // sur la clayette visée ; quand un toucher déclenche une action (déplacement, choix d'une place),
  // c'est dans la loupe qu'on la valide, sur des cibles de bonne taille.
  const loupeModes = mode.kind === 'normal' || mode.kind === 'deplacement' || mode.kind === 'placement';
  const loupeActive = compactLabels && zoom === 'auto' && loupeModes;
  const aimOnly = loupeActive && mode.kind !== 'normal';
  const onOverviewTap = useCallback(
    (slot: SlotRef): void => {
      if (loupeActive) setLoupe(slot);
      if (!aimOnly) tapSlot(slot);
    },
    [loupeActive, aimOnly, setLoupe, tapSlot],
  );
  const onLoupeTap = useCallback(
    (slot: SlotRef): void => {
      setLoupe(slot);
      tapSlot(slot);
    },
    [setLoupe, tapSlot],
  );
  const loupeShelf = loupeActive && loupe ? cellar.shelves[loupe.clayette - 1] : undefined;
  const loupeRow = loupeShelf && loupe ? visuals[loupe.clayette - 1] : undefined;
  const loupeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!loupe) return;
    const cell = loupeRef.current?.querySelector<HTMLElement>(`[data-key="${loupe.clayette}:${loupe.rang}"]`);
    cell?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }, [loupe, loupeShelf]);
  // Un seul emplacement est dans l'ordre de tabulation (les flèches font le reste).
  const selectedKey = visuals.flat().find((v) => v.selected)?.slot;
  const focusKey = selectedKey ?? { clayette: 1, rang: 1 };

  return (
    <>
    <div className="cave-viewport" ref={viewportRef}>
      <div
        className="cabinet"
        role="grid"
        aria-label={`Schéma de la cave : ${shelfCount} clayettes`}
        data-mode={mode.kind}
        data-compact={compactLabels ? '' : undefined}
        style={{ '--slot': `${slotSize}px`, '--slot-gap': `${SLOT_GAP}px` } as React.CSSProperties}
        onKeyDown={onKeyDown}
      >
        {visuals.map((row, i) => {
          const shelf = cellar.shelves[i]!;
          return (
            <div className="shelf" role="row" key={i} data-type={shelf.type}>
              <button
                type="button"
                className="shelf-label"
                aria-pressed={shelfFilter === i + 1}
                onClick={() => toggleShelf(i + 1)}
                tabIndex={-1}
                title={`Clayette ${i + 1} — ${shelf.capacite} emplacements ${TYPE_CLAYETTE_LABELS[shelf.type]}. Cliquez pour limiter la recherche à cette clayette.`}
              >
                <span className="shelf-num">{i + 1}</span>
                <span className="shelf-type">
                  {compactLabels ? TYPE_CODES[shelf.type] : TYPE_CLAYETTE_SHORT[shelf.type]}
                </span>
              </button>
              <div className="shelf-slots">
                {row.map((v) => (
                  <Slot
                    key={v.slot.rang}
                    v={v}
                    shelf={shelf}
                    draggable={draggable}
                    showYear={showYear}
                    focusable={v.slot.clayette === focusKey.clayette && v.slot.rang === focusKey.rang}
                    onTap={onOverviewTap}
                    aimed={Boolean(loupeShelf && loupe && sameAim(loupe, v.slot))}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    {loupeShelf && loupeRow && loupe ? (
      <div className="loupe" role="group" aria-label={`Loupe : clayette ${loupe.clayette}`}>
        <div className="loupe-head">
          <span className="loupe-title">
            Clayette <strong>{loupe.clayette}</strong>
            <span className="muted"> · {TYPE_CLAYETTE_LABELS[loupeShelf.type]}</span>
            {aimOnly ? <span className="loupe-hint"> — choisissez ici</span> : null}
          </span>
          <button
            type="button"
            className="btn btn-small btn-icon btn-ghost"
            onClick={() => setLoupe({ clayette: Math.max(1, loupe.clayette - 1), rang: loupe.rang })}
            disabled={loupe.clayette <= 1}
            aria-label="Clayette du dessus"
          >
            <Icon name="chevronUp" size={16} />
          </button>
          <button
            type="button"
            className="btn btn-small btn-icon btn-ghost"
            onClick={() => setLoupe({ clayette: Math.min(shelfCount, loupe.clayette + 1), rang: loupe.rang })}
            disabled={loupe.clayette >= shelfCount}
            aria-label="Clayette du dessous"
          >
            <Icon name="chevronDown" size={16} />
          </button>
          <button
            type="button"
            className="btn btn-small btn-icon btn-ghost"
            onClick={() => setLoupe(null)}
            aria-label="Fermer la loupe"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="loupe-row cabinet" ref={loupeRef} data-mode={mode.kind}>
          {loupeRow.map((v) => (
            <div className="loupe-cell" key={v.slot.rang}>
              <Slot v={v} shelf={loupeShelf} draggable={false} showYear focusable={false} onTap={onLoupeTap} />
              <span className="loupe-rang">R{v.slot.rang}</span>
            </div>
          ))}
        </div>
      </div>
    ) : null}
    </>
  );
}

function sameAim(a: SlotRef, b: SlotRef): boolean {
  return a.clayette === b.clayette && a.rang === b.rang;
}
