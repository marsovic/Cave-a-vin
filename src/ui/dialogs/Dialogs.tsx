import type { ReactNode } from 'react';
import { useStore } from '../../state/store';
import { AiDialog } from './AiDialog';
import { ConfigDialog } from './ConfigDialog';
import { FileDialog } from './FileDialog';
import { HelpDialog } from './HelpDialog';
import { Modal } from './Modal';
import { ScanDialog } from './ScanDialog';
import { WelcomeDialog } from './WelcomeDialog';

/** Affiche la fenêtre de dialogue demandée par le store, le cas échéant. */
export function Dialogs(): ReactNode {
  const dialog = useStore((s) => s.dialog);
  const closeDialog = useStore((s) => s.closeDialog);
  if (!dialog) return null;

  switch (dialog.kind) {
    case 'config':
      return <ConfigDialog />;
    case 'fichier':
      return <FileDialog />;
    case 'ia':
      return <AiDialog />;
    case 'aide':
      return <HelpDialog />;
    case 'bienvenue':
      return <WelcomeDialog />;
    case 'scan':
      return <ScanDialog result={dialog.result} imageUrl={dialog.imageUrl} />;
    case 'info':
      return (
        <Modal
          title={dialog.title}
          onClose={closeDialog}
          size="petit"
          footer={
            <button type="button" className="btn btn-primary" data-autofocus onClick={closeDialog}>
              Fermer
            </button>
          }
        >
          <p className="dialog-message">{dialog.message}</p>
          {dialog.details && dialog.details.length > 0 ? (
            <ul className="detail-list">
              {dialog.details.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : null}
        </Modal>
      );
    case 'confirm':
      return (
        <Modal
          title={dialog.title}
          onClose={closeDialog}
          size="petit"
          footer={
            <>
              <button type="button" className="btn" data-autofocus onClick={closeDialog}>
                Annuler
              </button>
              <button
                type="button"
                className={dialog.danger ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={dialog.onConfirm}
              >
                {dialog.confirmLabel}
              </button>
            </>
          }
        >
          <p className="dialog-message">{dialog.message}</p>
          {dialog.details && dialog.details.length > 0 ? (
            <ul className="detail-list">
              {dialog.details.slice(0, 40).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
              {dialog.details.length > 40 ? <li>… et {dialog.details.length - 40} autre(s).</li> : null}
            </ul>
          ) : null}
        </Modal>
      );
  }
}
