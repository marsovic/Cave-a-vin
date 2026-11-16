import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { createCellar } from '../../domain/cellar';
import {
  canShareCsv,
  exportDownload,
  exportMail,
  exportShare,
  importFile,
  importPastedText,
  loadDemo,
  loadReference,
  openLinkedFile,
  reconnectLinkedFile,
  saveAsLinkedFile,
  unlinkLinkedFile,
} from '../../state/persistence';
import { useStore } from '../../state/store';
import { Icon } from '../icons';
import { Modal } from './Modal';

/** Fichier : lier un CSV, enregistrer / partager / envoyer par courriel, ouvrir / importer / coller. */
export function FileDialog(): ReactNode {
  const file = useStore((s) => s.file);
  const count = useStore((s) => s.cellar.bottles.length);
  const closeDialog = useStore((s) => s.closeDialog);
  const openDialog = useStore((s) => s.openDialog);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const shareable = canShareCsv();

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void importFile(f);
  };

  const clearCellar = (): void => {
    openDialog({
      kind: 'confirm',
      title: 'Vider la cave ?',
      message: `Les ${count} bouteille(s) seront retirées ; la configuration des clayettes est conservée. Vous pourrez annuler juste après.`,
      confirmLabel: 'Vider la cave',
      danger: true,
      onConfirm: () => {
        const s = useStore.getState();
        s.replaceCellar(createCellar(s.cellar.shelves), 'Vidage de la cave');
        s.closeDialog();
        s.toast('succes', 'Cave vidée.', { undo: true });
      },
    });
  };

  return (
    <Modal title="Fichier de la cave" onClose={closeDialog} size="moyen">
      <p className="muted">
        La cave est un simple fichier texte <strong>CSV</strong> (lisible dans Excel). Elle est aussi conservée dans ce
        navigateur pour que rien ne se perde entre deux enregistrements.
      </p>

      <section className="dialog-section">
        <h3>
          <Icon name="link" size={17} /> Fichier lié — enregistrement automatique
        </h3>
        {file.linkSupported ? (
          <>
            {file.linked ? (
              <p>
                Fichier lié : <strong>{file.linked.name}</strong>{' '}
                {file.linked.permission === 'granted' ? (
                  <span className="badge badge-ok">connecté</span>
                ) : (
                  <span className="badge badge-warn">à reconnecter</span>
                )}
              </p>
            ) : (
              <p className="muted">
                Choisissez un fichier dans votre dossier OneDrive (ou ailleurs) : chaque modification y sera écrite
                automatiquement, et le fichier sera relu s'il change sur un autre appareil.
              </p>
            )}
            <div className="button-row">
              <button type="button" className="btn" onClick={() => void openLinkedFile()}>
                <Icon name="folder" size={17} />
                Ouvrir un CSV et le lier
              </button>
              <button type="button" className="btn" onClick={() => void saveAsLinkedFile()}>
                <Icon name="download" size={17} />
                Enregistrer sous… et lier
              </button>
              {file.linked && file.linked.permission !== 'granted' ? (
                <button type="button" className="btn btn-primary" onClick={() => void reconnectLinkedFile()}>
                  Reconnecter
                </button>
              ) : null}
              {file.linked ? (
                <button type="button" className="btn btn-ghost" onClick={() => void unlinkLinkedFile()}>
                  <Icon name="unlink" size={17} />
                  Délier
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="muted">
            Ce navigateur ne permet pas d'écrire directement dans un fichier (c'est le cas sur iPhone, Safari et
            Firefox). Utilisez « Partager / enregistrer » ci-dessous pour déposer la cave dans Fichiers ou OneDrive, et
            « Ouvrir un fichier » pour la reprendre. Sur ordinateur, Chrome ou Edge permettent de lier un fichier.
          </p>
        )}
      </section>

      <section className="dialog-section">
        <h3>
          <Icon name="share" size={17} /> Enregistrer, partager, envoyer
        </h3>
        <div className="button-row">
          {shareable ? (
            <button type="button" className="btn btn-primary" onClick={() => void exportShare()}>
              <Icon name="share" size={17} />
              Partager / enregistrer…
            </button>
          ) : null}
          <button type="button" className={shareable ? 'btn' : 'btn btn-primary'} onClick={exportDownload}>
            <Icon name="download" size={17} />
            Télécharger le CSV
          </button>
          <button type="button" className="btn" onClick={() => void exportMail()}>
            <Icon name="mail" size={17} />
            Envoyer par courriel
          </button>
        </div>
        {shareable ? (
          <p className="field-hint">
            « Partager » ouvre la feuille de partage : Enregistrer dans Fichiers, OneDrive, Mail, AirDrop…
          </p>
        ) : null}
      </section>

      <section className="dialog-section">
        <h3>
          <Icon name="upload" size={17} /> Ouvrir, importer
        </h3>
        <div className="button-row">
          <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
            <Icon name="folder" size={17} />
            Ouvrir un fichier (CSV ou Excel)…
          </button>
          <button type="button" className="btn" onClick={() => setPasteOpen((v) => !v)} aria-expanded={pasteOpen}>
            <Icon name="clipboard" size={17} />
            Coller un CSV
          </button>
        </div>
        {/* Pas d'attribut accept : sur iPhone il grise les fichiers CSV de certains fournisseurs (OneDrive). */}
        <input ref={inputRef} className="sr-only" type="file" onChange={onPick} tabIndex={-1} aria-hidden="true" />
        {pasteOpen ? (
          <div className="paste-zone">
            <label className="field-label" htmlFor="paste-csv">
              Collez ici le contenu du fichier (par exemple reçu par courriel), ligne d'en-tête comprise
            </label>
            <textarea
              id="paste-csv"
              className="textarea"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="enregistrement;clayette;rang;emplacements;type;chateau;appellation;annee;cepages;robe;forme;collection"
              spellCheck={false}
            />
            <div className="button-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!pasted.trim()}
                onClick={() => {
                  if (importPastedText(pasted)) setPasted('');
                }}
              >
                Importer le texte collé
              </button>
            </div>
          </div>
        ) : null}
        <p className="field-hint">L'import remplace la cave affichée (annulable).</p>
      </section>

      <section className="dialog-section">
        <h3>
          <Icon name="bottle" size={17} /> Caves fournies et remise à zéro
        </h3>
        <div className="button-row">
          <button type="button" className="btn" onClick={loadReference}>
            Charger la cave Bacchus (139 bouteilles)
          </button>
          <button type="button" className="btn" onClick={loadDemo}>
            Charger la cave d'exemple
          </button>
          <a className="btn btn-ghost" href="/cave-bacchus.csv" download="bacchus-smartcellar.csv">
            <Icon name="download" size={17} />
            Fichier CSV de la cave Bacchus
          </a>
          <a className="btn btn-ghost" href="/exemple-cave.csv" download="exemple-cave.csv">
            <Icon name="download" size={17} />
            Modèle de fichier CSV
          </a>
          <button type="button" className="btn btn-ghost" onClick={clearCellar} disabled={count === 0}>
            <Icon name="trash" size={17} />
            Vider la cave
          </button>
        </div>
      </section>
    </Modal>
  );
}
