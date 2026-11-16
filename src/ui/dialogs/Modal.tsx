import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from '../icons';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Boutons du pied de fenêtre. */
  footer?: ReactNode;
  size?: 'petit' | 'moyen' | 'grand';
  /** Empêche la fermeture par Échap / clic à l'extérieur (choix obligatoire). */
  sticky?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Fenêtre modale accessible : focus piégé, Échap pour fermer, focus rendu à la fermeture. */
export function Modal({ title, onClose, children, footer, size = 'moyen', sticky = false }: ModalProps): ReactNode {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    const first = box?.querySelector<HTMLElement>('[data-autofocus]') ?? box?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box)?.focus();
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' && !sticky) {
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...(boxRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !sticky) onClose();
      }}
    >
      <div
        ref={boxRef}
        className="modal"
        data-size={size}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="modal-header">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          {!sticky ? (
            <button type="button" className="btn btn-small btn-icon btn-ghost" onClick={onClose} aria-label="Fermer">
              <Icon name="x" size={18} />
            </button>
          ) : null}
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
