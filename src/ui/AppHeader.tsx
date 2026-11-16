import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import type { Theme } from '../state/types';
import { BrandIcon } from './BrandIcon';
import { Icon, type IconName } from './icons';

const THEMES: { value: Theme; label: string; icon: IconName }[] = [
  { value: 'auto', label: 'Auto', icon: 'settings' },
  { value: 'clair', label: 'Clair', icon: 'sun' },
  { value: 'sombre', label: 'Sombre', icon: 'moon' },
];

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** État de l'enregistrement de la cave (fichier lié, export, copie locale). */
function FileStatus(): ReactNode {
  const file = useStore((s) => s.file);
  const openDialog = useStore((s) => s.openDialog);

  let tone: 'ok' | 'warn' | 'neutre' = 'neutre';
  let label: string;
  let detail: string;
  if (file.linked) {
    const name = file.linked.name;
    if (file.conflict) {
      tone = 'warn';
      label = `${name} — conflit`;
      detail = 'Le fichier a été modifié ailleurs.';
    } else if (file.linked.permission !== 'granted') {
      tone = 'warn';
      label = `${name} — à reconnecter`;
      detail = 'Le fichier lié doit être reconnecté pour être tenu à jour.';
    } else if (file.error) {
      tone = 'warn';
      label = `${name} — erreur`;
      detail = file.error;
    } else if (file.dirty) {
      label = `${name} — enregistrement…`;
      detail = 'Écriture du fichier en cours.';
    } else {
      tone = 'ok';
      label = file.savedAt ? `${name} — enregistré ${formatTime(file.savedAt)}` : `${name} — à jour`;
      detail = 'La cave est enregistrée automatiquement dans ce fichier.';
    }
  } else if (file.dirty) {
    tone = 'warn';
    label = 'Non exporté';
    detail =
      'La cave est enregistrée dans ce navigateur, mais les dernières modifications ne sont dans aucun fichier. Ouvrez « Fichier » pour l\'enregistrer ou l\'envoyer.';
  } else if (file.savedAt) {
    tone = 'ok';
    label = `Exporté ${formatTime(file.savedAt)}`;
    detail = `Dernier fichier : ${file.lastName ?? 'cave'}`;
  } else {
    label = 'Copie locale';
    detail = 'La cave est enregistrée dans ce navigateur. Ouvrez « Fichier » pour la lier à un fichier CSV ou l\'exporter.';
  }

  return (
    <button
      type="button"
      className="file-status"
      data-tone={tone}
      onClick={() => openDialog({ kind: 'fichier' })}
      title={detail}
      aria-label={`Fichier : ${label}. ${detail}`}
    >
      <span className="file-status-dot" aria-hidden="true" />
      <Icon name="file" size={15} />
      <span className="file-status-label">{label}</span>
    </button>
  );
}

/** Bandeau discret : icône, titre, annuler / rétablir, état du fichier, menu. */
export function AppHeader(): ReactNode {
  const canUndo = useStore((s) => s.past.length > 0 && s.mode.kind === 'normal');
  const canRedo = useStore((s) => s.future.length > 0 && s.mode.kind === 'normal');
  const undoLabel = useStore((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useStore((s) => s.future[s.future.length - 1]?.label);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const openDialog = useStore((s) => s.openDialog);
  const theme = useStore((s) => s.prefs.theme);
  const zoom = useStore((s) => s.prefs.zoom);
  const setPrefs = useStore((s) => s.setPrefs);
  const aiStatus = useStore((s) => s.aiStatus);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') {
          // Échap ferme le menu, et rien d'autre (pas d'annulation du mode en cours).
          e.preventDefault();
          setMenuOpen(false);
        }
        return;
      }
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  const open = (kind: 'config' | 'fichier' | 'ia' | 'aide'): void => {
    setMenuOpen(false);
    openDialog({ kind });
  };

  return (
    <header className="app-header">
      <div className="brand">
        <BrandIcon size={26} />
        <h1 className="brand-title">DumbCellar</h1>
      </div>

      <div className="header-tools">
        <button
          type="button"
          className="btn btn-small btn-icon btn-ghost"
          onClick={undo}
          disabled={!canUndo}
          title={undoLabel ? `Annuler : ${undoLabel.toLowerCase()} (Ctrl+Z)` : 'Rien à annuler'}
          aria-label={undoLabel ? `Annuler : ${undoLabel.toLowerCase()}` : 'Annuler'}
        >
          <Icon name="undo" size={17} />
        </button>
        <button
          type="button"
          className="btn btn-small btn-icon btn-ghost"
          onClick={redo}
          disabled={!canRedo}
          title={redoLabel ? `Rétablir : ${redoLabel.toLowerCase()} (Ctrl+Y)` : 'Rien à rétablir'}
          aria-label={redoLabel ? `Rétablir : ${redoLabel.toLowerCase()}` : 'Rétablir'}
        >
          <Icon name="redo" size={17} />
        </button>

        <FileStatus />

        <div className="menu" ref={menuRef}>
          <button
            type="button"
            className="btn btn-small btn-icon btn-ghost"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Menu"
            title="Menu : fichier, configuration de la cave, assistant IA, aide"
          >
            <Icon name="menu" size={18} />
          </button>
          {menuOpen ? (
            <div className="menu-popover" role="menu">
              <button type="button" role="menuitem" className="menu-item" onClick={() => open('fichier')}>
                <Icon name="folder" size={17} />
                Fichier : ouvrir, enregistrer, envoyer…
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => open('config')}>
                <Icon name="shelves" size={17} />
                Configurer la cave (clayettes)
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => open('ia')}>
                <Icon name="bot" size={17} />
                Assistant IA
                <span className={aiStatus?.disponible ? 'badge badge-ok' : 'badge'}>
                  {aiStatus === null ? '…' : aiStatus.disponible ? 'prêt' : 'inactif'}
                </span>
              </button>
              <div className="menu-separator" role="separator" />
              <div className="menu-row" role="group" aria-label="Thème">
                <span className="menu-row-label">Thème</span>
                <div className="segmented">
                  {THEMES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      aria-pressed={theme === t.value}
                      onClick={() => setPrefs({ theme: t.value })}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="menu-row" role="group" aria-label="Taille du schéma">
                <span className="menu-row-label">Schéma</span>
                <div className="segmented">
                  {(
                    [
                      ['auto', 'Ajusté'],
                      ['moyen', 'Moyen'],
                      ['grand', 'Grand'],
                    ] as const
                  ).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={zoom === value} onClick={() => setPrefs({ zoom: value })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="menu-separator" role="separator" />
              <button type="button" role="menuitem" className="menu-item" onClick={() => open('aide')}>
                <Icon name="help" size={17} />
                Aide et légende
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
