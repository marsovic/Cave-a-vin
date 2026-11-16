import type { ReactNode } from 'react';
import { loadDemo } from '../../state/persistence';
import { useStore } from '../../state/store';
import { BrandIcon } from '../BrandIcon';
import { Icon } from '../icons';
import { Modal } from './Modal';

/** Premier lancement : trois façons de commencer. */
export function WelcomeDialog(): ReactNode {
  const openDialog = useStore((s) => s.openDialog);
  const closeDialog = useStore((s) => s.closeDialog);
  const setPrefs = useStore((s) => s.setPrefs);

  const done = (next?: 'config' | 'fichier'): void => {
    setPrefs({ accueilVu: true });
    if (next) openDialog({ kind: next });
    else closeDialog();
  };

  return (
    <Modal title="Bienvenue dans Bacchus SmartCellar" onClose={() => done()} size="moyen">
      <div className="welcome">
        <BrandIcon size={56} />
        <p>
          Votre armoire à vin en un coup d'œil : cherchez, ajoutez, déplacez, réorganisez, et demandez conseil au
          sommelier. Comment voulez-vous commencer ?
        </p>
      </div>
      <div className="welcome-choices">
        <button type="button" className="welcome-choice" data-autofocus onClick={() => done('config')}>
          <Icon name="shelves" size={26} />
          <span>
            <strong>Configurer ma cave</strong>
            <span>Nombre de clayettes, emplacements et type de chacune.</span>
          </span>
        </button>
        <button
          type="button"
          className="welcome-choice"
          onClick={() => {
            setPrefs({ accueilVu: true });
            loadDemo();
          }}
        >
          <Icon name="bottle" size={26} />
          <span>
            <strong>Essayer avec une cave d'exemple</strong>
            <span>Une centaine de bouteilles pour découvrir toutes les fonctions.</span>
          </span>
        </button>
        <button type="button" className="welcome-choice" onClick={() => done('fichier')}>
          <Icon name="folder" size={26} />
          <span>
            <strong>Ouvrir mon fichier CSV</strong>
            <span>Reprendre une cave déjà enregistrée (OneDrive, courriel…).</span>
          </span>
        </button>
      </div>
      <p className="field-hint">
        Vous pourrez changer tout cela plus tard depuis le menu ☰. Vos données restent sur votre appareil.
      </p>
    </Modal>
  );
}
