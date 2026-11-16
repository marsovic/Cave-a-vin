import type { ReactNode } from 'react';
import { ROBE_LABELS } from '../../domain/labels';
import { ROBES } from '../../domain/types';
import { useStore } from '../../state/store';
import { Modal } from './Modal';

/** Aide : légende du schéma, mode d'emploi des fonctions, raccourcis, stockage. */
export function HelpDialog(): ReactNode {
  const closeDialog = useStore((s) => s.closeDialog);
  return (
    <Modal
      title="Aide et légende"
      onClose={closeDialog}
      size="grand"
      footer={
        <button type="button" className="btn btn-primary" onClick={closeDialog}>
          Fermer
        </button>
      }
    >
      <section className="dialog-section">
        <h3>Lire le schéma</h3>
        <p>
          Chaque ligne est une clayette (la n° 1 est en haut), chaque rond un emplacement vu de face. À gauche : le
          numéro de la clayette et son type d'emplacements (Bdx = Bordeaux, Bgn = Bourgogne, Chp = Champagne, Tout).
        </p>
        <ul className="legend legend-help">
          {ROBES.map((robe) => (
            <li key={robe} className="legend-item">
              <span className="robe-dot" data-robe={robe} />
              {ROBE_LABELS[robe]}
            </li>
          ))}
          <li className="legend-item">
            <span className="legend-swatch" data-kind="collection" />
            Anneau doré et ★ : bouteille de collection
          </li>
          <li className="legend-item">
            <span className="legend-swatch" data-kind="libre" />
            Pointillés : place libre
          </li>
          <li className="legend-item">
            <span className="legend-swatch" data-kind="match" />
            Halo clair : correspond aux critères
          </li>
        </ul>
        <p className="muted">
          Le nombre dans un rond est le millésime sur deux chiffres (’15 = 2015). Le liquoreux porte un double anneau
          et le rosé un anneau pointillé, pour les distinguer sans la couleur.
        </p>
      </section>

      <section className="dialog-section">
        <h3>Le formulaire sert à tout</h3>
        <dl className="help-list">
          <dt>Chercher</dt>
          <dd>
            Saisissez un ou plusieurs critères : les bouteilles qui les satisfont <em>tous</em> s'illuminent aussitôt,
            les autres s'estompent. L'année accepte <code>2015</code>, <code>2010-2015</code>, <code>&lt;2012</code>,{' '}
            <code>&gt;=2018</code> et <code>sans</code> (non millésimé).
          </dd>
          <dt>Désigner une bouteille</dt>
          <dd>
            Touchez-la dans le schéma : le formulaire affiche sa fiche (clayette et rang compris) et les actions
            portent sur elle seule. Effacez la clayette et le rang pour viser toutes les bouteilles identiques.
          </dd>
          <dt>Ajouter</dt>
          <dd>
            Décrivez la bouteille (ou scannez l'étiquette), indiquez la quantité, puis « Ajouter » : l'application
            propose le meilleur emplacement (à côté du même vin, dans l'ordre des années, type de clayette respecté).
            Touchez une autre place libre pour en changer, puis confirmez.
          </dd>
          <dt>Corriger</dt>
          <dd>Désignez la bouteille, modifiez les champs, puis « Enregistrer » dans la barre de cible.</dd>
          <dt>Retirer</dt>
          <dd>Désignez la bouteille (ou plusieurs par critères), puis « Retirer ». « Annuler » la remet.</dd>
          <dt>Déplacer, échanger</dt>
          <dd>
            Désignez la bouteille, « Déplacer », puis touchez l'arrivée : une place libre (déplacement) ou une autre
            bouteille (échange). À la souris, vous pouvez aussi faire glisser une bouteille.
          </dd>
          <dt>Collection</dt>
          <dd>
            « Collection » classe la bouteille désignée, ou toutes celles qui correspondent aux critères (restreignez
            avec la clayette et le rang si besoin). « Déclasser » fait l'inverse. Les bouteilles de collection sont
            exclues des conseils de dégustation.
          </dd>
          <dt>Places libres</dt>
          <dd>Montre les places libres compatibles avec la forme et la clayette indiquées.</dd>
          <dt>Réorganiser</dt>
          <dd>
            Calcule le rangement par année (anciennes en haut, récentes en bas, même vin côte à côte, types de
            clayettes respectés) et vous guide déplacement par déplacement, avec le minimum de manipulations.
          </dd>
          <dt>Sommelier</dt>
          <dd>
            « À boire » : bouteilles en fin de fenêtre de dégustation. « Accord » : bouteilles adaptées au plat saisi.
            « À privilégier » : les deux à la fois. « Trop vieilles ? » : bouteilles ayant dépassé leur apogée, à
            classer en collection. Toujours hors bouteilles de collection.
          </dd>
        </dl>
      </section>

      <section className="dialog-section">
        <h3>Raccourcis clavier</h3>
        <ul className="shortcut-list">
          <li>
            <kbd>/</kbd> aller au champ Château
          </li>
          <li>
            <kbd>Échap</kbd> quitter le mode en cours ou désélectionner
          </li>
          <li>
            <kbd>Ctrl</kbd>+<kbd>Z</kbd> annuler, <kbd>Ctrl</kbd>+<kbd>Y</kbd> rétablir
          </li>
          <li>
            <kbd>←</kbd> <kbd>↑</kbd> <kbd>↓</kbd> <kbd>→</kbd> se déplacer dans le schéma, <kbd>Entrée</kbd> désigner
          </li>
          <li>
            <kbd>Suppr</kbd> retirer la bouteille désignée (focus dans le schéma)
          </li>
        </ul>
      </section>

      <section className="dialog-section">
        <h3>Où sont mes données ?</h3>
        <p>
          Dans ce navigateur, et dans le fichier CSV que vous liez ou exportez (menu « Fichier »). Rien n'est stocké
          sur un serveur. Sur iPhone, ajoutez l'application à l'écran d'accueil (bouton Partager de Safari → « Sur
          l'écran d'accueil ») : elle s'ouvre en plein écran et ses données ne sont pas effacées par Safari. Pensez à
          enregistrer régulièrement le CSV dans OneDrive ou Fichiers.
        </p>
      </section>
    </Modal>
  );
}
