import { useEffect, type ReactNode } from 'react';
import { useStore } from '../state/store';
import type { Toast } from '../state/types';
import { Icon } from './icons';

const DURATION: Record<Toast['kind'], number> = { info: 5000, succes: 6000, erreur: 9000 };

function ToastItem({ toast }: { toast: Toast }): ReactNode {
  const dismissToast = useStore((s) => s.dismissToast);
  const undo = useStore((s) => s.undo);
  // « Annuler » ne vaut que pour la toute dernière opération : on vérifie que l'historique n'a pas bougé.
  const canUndo = useStore((s) => s.past.length > 0 && s.rev === toast.rev && s.mode.kind === 'normal');

  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), DURATION[toast.kind]);
    return () => clearTimeout(timer);
  }, [toast.id, toast.kind, dismissToast]);

  return (
    <div className="toast" data-kind={toast.kind} role={toast.kind === 'erreur' ? 'alert' : 'status'}>
      <Icon name={toast.kind === 'erreur' ? 'warning' : toast.kind === 'succes' ? 'check' : 'info'} size={17} />
      <span className="toast-message">{toast.message}</span>
      {toast.undo && canUndo ? (
        <button
          type="button"
          className="btn btn-small toast-undo"
          onClick={() => {
            undo();
            dismissToast(toast.id);
          }}
        >
          Annuler
        </button>
      ) : null}
      <button
        type="button"
        className="btn btn-small btn-icon btn-ghost"
        onClick={() => dismissToast(toast.id)}
        aria-label="Fermer le message"
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}

/** Messages brefs (confirmation avec « Annuler », information, erreur). */
export function Toasts(): ReactNode {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-label="Messages">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
