import { useId, useMemo, useRef, type ChangeEvent, type ReactNode } from 'react';
import { appellationNames, cepageNames, suggestWineDefaults } from '../domain/knowledge';
import { FORME_LABELS, ROBE_LABELS } from '../domain/labels';
import { joinCepages, norm, splitCepages } from '../domain/normalize';
import { parseYearExpr } from '../domain/search';
import { FORMES, ROBES, type Criteria, type Forme, type Robe } from '../domain/types';
import { runScan } from '../state/advice';
import { useStore } from '../state/store';
import { Icon } from './icons';

const ROBE_SHORT: Record<Robe, string> = {
  rouge: 'Rouge',
  blanc: 'Blanc',
  'blanc-liquoreux': 'Liquoreux',
  rose: 'Rosé',
};

function uniqueSorted(values: Iterable<string>): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const key = norm(v);
    if (key && !seen.has(key)) seen.set(key, v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Dernier cépage en cours de saisie (après la dernière virgule). */
function lastCepageFragment(text: string): string {
  const parts = text.split(/[,;]/);
  return (parts[parts.length - 1] ?? '').trim();
}

/**
 * Le formulaire permanent : critères de recherche, description de la bouteille
 * à ajouter ou à modifier, position, plat pour les accords.
 */
export function BottleForm(): ReactNode {
  const form = useStore((s) => s.form);
  const plat = useStore((s) => s.plat);
  const cellar = useStore((s) => s.cellar);
  const mode = useStore((s) => s.mode);
  const busy = useStore((s) => s.busy !== null);
  const setField = useStore((s) => s.setField);
  const patchForm = useStore((s) => s.patchForm);
  const setPlat = useStore((s) => s.setPlat);

  const id = useId();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const locked = mode.kind !== 'normal';

  const chateaux = useMemo(() => uniqueSorted(cellar.bottles.map((b) => b.chateau)), [cellar]);
  const appellations = useMemo(
    () => uniqueSorted([...cellar.bottles.map((b) => b.appellation), ...appellationNames()]),
    [cellar],
  );
  const cepages = useMemo(
    () => uniqueSorted([...cellar.bottles.flatMap((b) => b.cepages), ...cepageNames()]),
    [cellar],
  );

  const year = parseYearExpr(form.annee);
  const maxClayette = cellar.shelves.length;

  // Valeurs habituelles de l'appellation saisie, proposées (jamais imposées).
  const suggestion = useMemo(() => {
    if (!form.appellation.trim()) return null;
    const d = suggestWineDefaults(form.appellation, form.robe);
    const patch: Partial<Criteria> = {};
    const parts: string[] = [];
    if (!form.robe && d.robe) {
      patch.robe = d.robe;
      parts.push(ROBE_LABELS[d.robe]);
    }
    if (!form.forme && d.forme) {
      patch.forme = d.forme;
      parts.push(`bouteille ${FORME_LABELS[d.forme]}`);
    }
    if (!form.cepages.trim() && d.cepages && d.cepages.length > 0) {
      patch.cepages = joinCepages(d.cepages);
      parts.push(d.cepages.slice(0, 3).join(', ') + (d.cepages.length > 3 ? '…' : ''));
    }
    return parts.length > 0 ? { patch, text: parts.join(' · ') } : null;
  }, [form.appellation, form.robe, form.forme, form.cepages]);

  // Complétion du cépage en cours de saisie.
  const cepageHints = useMemo(() => {
    const fragment = norm(lastCepageFragment(form.cepages));
    if (fragment.length < 2) return [];
    const already = new Set(splitCepages(form.cepages).map(norm));
    return cepages
      .filter((c) => norm(c).startsWith(fragment) && norm(c) !== fragment && !already.has(norm(c)))
      .slice(0, 4);
  }, [form.cepages, cepages]);

  const completeCepage = (name: string): void => {
    const parts = form.cepages.split(/[,;]/).slice(0, -1).map((p) => p.trim()).filter(Boolean);
    setField('cepages', `${[...parts, name].join(', ')}, `);
  };

  const onPhoto = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    // Remise à zéro : permet de reprendre la même photo ensuite.
    e.target.value = '';
    if (file) void runScan(file);
  };

  const toggleRobe = (robe: Robe): void => setField('robe', form.robe === robe ? '' : robe);
  const toggleForme = (forme: Forme): void => setField('forme', form.forme === forme ? '' : forme);

  return (
    <form
      className="bottle-form"
      aria-label="Critères et description de la bouteille"
      onSubmit={(e) => e.preventDefault()}
      autoComplete="off"
    >
      <fieldset className="form-fields" disabled={locked}>
        <legend className="sr-only">Formulaire</legend>

        <div className="field f-chateau">
          <label className="field-label" htmlFor={`${id}-chateau`}>
            Château<span className="only-desktop"> / domaine</span>
          </label>
          <div className="input-with-actions">
            <input
              id={`${id}-chateau`}
              className="input"
              type="text"
              value={form.chateau}
              onChange={(e) => setField('chateau', e.target.value)}
              placeholder="ex. Château Margaux"
              list={`${id}-chateaux`}
              enterKeyHint="search"
              autoCapitalize="words"
              spellCheck={false}
            />
            <button
              type="button"
              className="btn btn-icon scan-btn"
              onClick={() => cameraRef.current?.click()}
              disabled={busy}
              title="Scanner une étiquette avec l'appareil photo"
              aria-label="Scanner une étiquette avec l'appareil photo"
            >
              <Icon name="camera" size={20} />
            </button>
            <button
              type="button"
              className="btn btn-icon scan-btn only-desktop"
              onClick={() => galleryRef.current?.click()}
              disabled={busy}
              title="Lire l'étiquette sur une photo existante"
              aria-label="Lire l'étiquette sur une photo existante"
            >
              <Icon name="image" size={20} />
            </button>
          </div>
          <datalist id={`${id}-chateaux`}>
            {chateaux.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="field f-appellation">
          <label className="field-label" htmlFor={`${id}-appellation`}>
            Appellation
          </label>
          <input
            id={`${id}-appellation`}
            className="input"
            type="text"
            value={form.appellation}
            onChange={(e) => setField('appellation', e.target.value)}
            placeholder="ex. Haut-Médoc"
            list={`${id}-appellations`}
            enterKeyHint="search"
            autoCapitalize="words"
            spellCheck={false}
          />
          <datalist id={`${id}-appellations`}>
            {appellations.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>

        <div className="field f-annee">
          <label className="field-label" htmlFor={`${id}-annee`}>
            Année
          </label>
          <input
            id={`${id}-annee`}
            className="input"
            type="text"
            inputMode="text"
            value={form.annee}
            onChange={(e) => setField('annee', e.target.value)}
            placeholder="2015"
            aria-invalid={!year.ok}
            aria-describedby={`${id}-annee-aide`}
            title="Une année (2015), une période (2010-2015), <2012, >=2018, ou « sans » pour les non millésimés"
            enterKeyHint="search"
            autoCapitalize="off"
            spellCheck={false}
          />
          <span id={`${id}-annee-aide`} className="sr-only">
            Une année (2015), une période (2010-2015), une comparaison (&lt;2012, &gt;=2018) ou « sans » pour les
            bouteilles non millésimées.
          </span>
        </div>

        <div className="field f-cepages">
          <label className="field-label" htmlFor={`${id}-cepages`}>
            Cépages
          </label>
          <input
            id={`${id}-cepages`}
            className="input"
            type="text"
            value={form.cepages}
            onChange={(e) => setField('cepages', e.target.value)}
            placeholder="ex. Merlot, Cabernet franc"
            enterKeyHint="search"
            autoCapitalize="words"
            spellCheck={false}
          />
          {cepageHints.length > 0 && !locked ? (
            <div className="hint-chips" aria-label="Cépages proposés">
              {cepageHints.map((c) => (
                <button key={c} type="button" className="chip chip-hint" onClick={() => completeCepage(c)}>
                  {c}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="field f-robe" role="group" aria-label="Robe">
          <span className="field-label">Robe</span>
          <select
            className="select only-phone"
            value={form.robe}
            onChange={(e) => setField('robe', e.target.value as Robe | '')}
            aria-label="Robe"
          >
            <option value="">Toutes</option>
            {ROBES.map((robe) => (
              <option key={robe} value={robe}>
                {ROBE_SHORT[robe]}
              </option>
            ))}
          </select>
          <div className="chips only-desktop">
            {ROBES.map((robe) => (
              <button
                key={robe}
                type="button"
                className="chip"
                aria-pressed={form.robe === robe}
                onClick={() => toggleRobe(robe)}
                title={ROBE_LABELS[robe]}
              >
                <span className="robe-dot" data-robe={robe} aria-hidden="true" />
                {ROBE_SHORT[robe]}
              </button>
            ))}
          </div>
        </div>

        <div className="field f-forme" role="group" aria-label="Forme de la bouteille">
          <span className="field-label">
            Forme<span className="only-desktop"> de bouteille</span>
          </span>
          <select
            className="select only-phone"
            value={form.forme}
            onChange={(e) => setField('forme', e.target.value as Forme | '')}
            aria-label="Forme de la bouteille"
          >
            <option value="">Toutes</option>
            {FORMES.map((forme) => (
              <option key={forme} value={forme}>
                {FORME_LABELS[forme]}
              </option>
            ))}
          </select>
          <div className="chips only-desktop">
            {FORMES.map((forme) => (
              <button
                key={forme}
                type="button"
                className="chip"
                aria-pressed={form.forme === forme}
                onClick={() => toggleForme(forme)}
                title={
                  forme === 'autre'
                    ? 'Autre forme (flûte d\'Alsace, magnum…) : uniquement sur une clayette « Tout »'
                    : `Bouteille de type ${FORME_LABELS[forme]}`
                }
              >
                {FORME_LABELS[forme]}
              </button>
            ))}
          </div>
        </div>

        {suggestion && !locked ? (
          <div className="form-suggestion">
            <Icon name="sparkles" size={15} />
            <span className="form-suggestion-text">
              <strong>{form.appellation.trim()}</strong> : {suggestion.text}
            </span>
            <button type="button" className="btn btn-small" onClick={() => patchForm(suggestion.patch)}>
              Compléter
            </button>
          </div>
        ) : null}

        <div className="field f-clayette">
          <label className="field-label" htmlFor={`${id}-clayette`}>
            Clay<span className="only-desktop">ette n°</span>
            <span className="only-phone">.</span>
          </label>
          <input
            id={`${id}-clayette`}
            className="input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.clayette}
            onChange={(e) => setField('clayette', e.target.value.replace(/\D/g, '').slice(0, 2))}
            placeholder={`1–${maxClayette}`}
            enterKeyHint="done"
          />
        </div>

        <div className="field f-rang">
          <label className="field-label" htmlFor={`${id}-rang`}>
            Rang<span className="only-desktop"> n°</span>
          </label>
          <input
            id={`${id}-rang`}
            className="input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.rang}
            onChange={(e) => setField('rang', e.target.value.replace(/\D/g, '').slice(0, 2))}
            placeholder="1–…"
            enterKeyHint="done"
          />
        </div>

        <div className="field f-plat">
          <label className="field-label" htmlFor={`${id}-plat`}>
            Plat<span className="only-desktop"> (pour les accords)</span>
          </label>
          <input
            id={`${id}-plat`}
            className="input"
            type="text"
            value={plat}
            onChange={(e) => setPlat(e.target.value)}
            placeholder="ex. gigot d'agneau, plateau de fromages"
            enterKeyHint="done"
            maxLength={120}
          />
        </div>
      </fieldset>

      {/* Appareil photo (téléphone) et choix d'une photo existante. */}
      <input
        ref={cameraRef}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPhoto}
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        ref={galleryRef}
        className="sr-only"
        type="file"
        accept="image/*"
        onChange={onPhoto}
        tabIndex={-1}
        aria-hidden="true"
      />
    </form>
  );
}
