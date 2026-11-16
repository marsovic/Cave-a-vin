import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initApp } from './state/persistence';
import { useStore } from './state/store';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/cave.css';
import './styles/form.css';
import './styles/panel.css';
import './styles/dialogs.css';

void initApp();

// Application installable / hors ligne : signale les mises à jour sans interrompre l'utilisateur.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        const s = useStore.getState();
        if (s.dialog || s.mode.kind !== 'normal') {
          s.toast('info', 'Une nouvelle version de l\'application sera utilisée au prochain lancement.');
          return;
        }
        s.openDialog({
          kind: 'confirm',
          title: 'Nouvelle version disponible',
          message: 'Bacchus SmartCellar a été mis à jour. Vos données sont conservées.',
          confirmLabel: 'Mettre à jour maintenant',
          onConfirm: () => void update(true),
        });
      },
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
