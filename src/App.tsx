import { useEffect, type ReactNode } from 'react';
import { computeTarget } from './state/selectors';
import { useStore } from './state/store';
import { ActionBar } from './ui/ActionBar';
import { AppHeader } from './ui/AppHeader';
import { BottleForm } from './ui/BottleForm';
import { CaveView } from './ui/CaveView';
import { Legend } from './ui/Legend';
import { ModeBanner } from './ui/ModeBanner';
import { SidePanel } from './ui/SidePanel';
import { TargetBar } from './ui/TargetBar';
import { Toasts } from './ui/Toasts';
import { Dialogs } from './ui/dialogs/Dialogs';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** Raccourcis clavier globaux (ordinateur). */
function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState();
      if (s.dialog) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key.toLowerCase() === 'z') {
        if (isTyping(e.target)) return; // laisse l'annulation native du champ
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 'y') {
        if (isTyping(e.target)) return;
        e.preventDefault();
        s.redo();
        return;
      }
      if (e.key === 'Escape') {
        // Déjà traitée ailleurs (fermeture du menu, par exemple).
        if (e.defaultPrevented) return;
        if (s.mode.kind !== 'normal') {
          s.cancelMode();
        } else if (s.view !== 'recherche') {
          s.setView('recherche');
        } else if (computeTarget(s.cellar, s.form).slot) {
          s.deselect();
        } else if (isTyping(e.target)) {
          (e.target as HTMLElement).blur();
        }
        return;
      }
      if (isTyping(e.target) || mod || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.f-chateau input')?.focus();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.mode.kind === 'normal') {
        // Uniquement si l'emplacement qui a le focus est bien celui que désigne le formulaire.
        const active = document.activeElement as HTMLElement | null;
        const target = computeTarget(s.cellar, s.form);
        if (
          active?.classList.contains('slot') &&
          target.kind === 'bouteille' &&
          target.slot &&
          active.dataset.key === `${target.slot.clayette}:${target.slot.rang}`
        ) {
          e.preventDefault();
          s.removeTarget();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Applique le thème choisi à la racine du document. */
function useTheme(): void {
  const theme = useStore((s) => s.prefs.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
}

/** Garde l'écran allumé pendant la réorganisation guidée (les mains sont prises). */
function useWakeLock(): void {
  const active = useStore((s) => s.mode.kind === 'reorg');
  useEffect(() => {
    if (!active) return;
    type Sentinel = { release: () => Promise<void> };
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } })
      .wakeLock;
    if (!wakeLock) return;
    let sentinel: Sentinel | null = null;
    let cancelled = false;
    const acquire = (): void => {
      wakeLock
        .request('screen')
        .then((s) => {
          if (cancelled) void s.release();
          else sentinel = s;
        })
        .catch(() => {
          /* refusé (économie d'énergie…) : sans gravité */
        });
    };
    acquire();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}

export function App(): ReactNode {
  const ready = useStore((s) => s.ready);
  const mode = useStore((s) => s.mode.kind);
  const panelOpen = useStore((s) => s.panelOpen);
  useShortcuts();
  useTheme();
  useWakeLock();

  if (!ready) {
    return (
      <div className="app-loading" role="status">
        Chargement de la cave…
      </div>
    );
  }

  return (
    <div className="app" data-mode={mode} data-panel={panelOpen ? 'ouvert' : 'ferme'}>
      <AppHeader />
      <main className="app-main">
        <section className="zone-form" aria-label="Formulaire et actions">
          <TargetBar />
          <BottleForm />
          <ActionBar />
        </section>
        <section className="zone-cave" aria-label="Schéma de la cave">
          <ModeBanner />
          <CaveView />
          <Legend />
        </section>
        <section className="zone-panel">
          <SidePanel />
        </section>
      </main>
      <Toasts />
      <Dialogs />
    </div>
  );
}
