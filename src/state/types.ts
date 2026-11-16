import type { AiSettings, AiStatus, ScanResult } from '../ai/types';
import type { AdviceItem } from '../domain/advisor';
import type { ReorgMode, ReorgPlan } from '../domain/reorg';
import type { Bottle, Cellar, Criteria, DrinkStatus, SlotRef, WineFields } from '../domain/types';
import type { LinkPermission } from '../storage/fileLink';

/* ------------------------------------------------------------------ */
/* Modes d'interaction                                                 */
/* ------------------------------------------------------------------ */

/**
 * Mode d'interaction courant. Hors du mode `normal`, un bandeau explique quoi
 * faire et propose toujours « Annuler » (ou « Quitter » pour la réorganisation).
 */
export type Mode =
  | { kind: 'normal' }
  /** Ajout : des emplacements sont proposés, l'utilisateur confirme ou en touche d'autres. */
  | {
      kind: 'placement';
      wine: WineFields;
      /** Nombre de bouteilles identiques à ranger. */
      count: number;
      slots: SlotRef[];
      complete: boolean;
      message: string;
      /** Clayette / rang imposés par l'utilisateur (formulaire ou emplacement touché). */
      prefer: { clayette?: number; rang?: number };
    }
  /** Déplacement / échange : en attente de la destination. */
  | { kind: 'deplacement'; bottleId: string }
  /** Réorganisation : aperçu des plans avant de commencer. */
  | {
      kind: 'reorg-apercu';
      plans: Record<ReorgMode, ReorgPlan>;
      choix: ReorgMode;
      /** Ce que montre le schéma : la cave actuelle, ou le rangement une fois terminé. */
      apercu: 'avant' | 'apres';
    }
  /** Réorganisation guidée pas à pas. `index` = prochaine étape à faire. */
  | { kind: 'reorg'; plan: ReorgPlan; index: number; horsCave: Bottle[]; depart: Cellar };

/** Ce que le schéma met en valeur en mode normal. */
export type View = 'recherche' | 'libres' | 'conseil';

/* ------------------------------------------------------------------ */
/* Conseils du sommelier                                               */
/* ------------------------------------------------------------------ */

export type AdviceKind = 'boire' | 'accord' | 'privilegier' | 'collection';

export interface AdviceReport {
  kind: AdviceKind;
  /** Plat demandé (accord / à privilégier). */
  plat: string;
  items: AdviceItem[];
  /** Origine dominante des informations. */
  source: 'local' | 'ia' | 'ia-web';
  /** Message d'information (repli local, résultat partiel…). */
  note: string | null;
  /** Année de référence du calcul. */
  annee: number;
}

/** Tâche longue en cours (IA), affichée avec une barre de progression et un bouton Annuler. */
export interface BusyState {
  label: string;
  /** 0…1, ou `null` si indéterminé. */
  progress: number | null;
}

/* ------------------------------------------------------------------ */
/* Fichier                                                             */
/* ------------------------------------------------------------------ */

export interface FileState {
  /** La File System Access API est disponible (Chrome / Edge sur ordinateur). */
  linkSupported: boolean;
  /** Fichier CSV lié, le cas échéant. */
  linked: { name: string; permission: LinkPermission } | null;
  /** Date (ms) de modification du fichier lié lors de la dernière lecture / écriture réussie. */
  syncedMtime: number | null;
  /** La cave a changé depuis le dernier enregistrement dans un fichier (lié, téléchargé ou partagé). */
  dirty: boolean;
  /** Le fichier lié a été modifié ailleurs alors que la cave locale a changé aussi. */
  conflict: boolean;
  /** Dernière erreur d'écriture / lecture (français), ou `null`. */
  error: string | null;
  /** Nom du dernier fichier ouvert / enregistré (sans lien). */
  lastName: string | null;
  /** Date (ms) du dernier enregistrement réussi. */
  savedAt: number | null;
}

/* ------------------------------------------------------------------ */
/* Interface                                                           */
/* ------------------------------------------------------------------ */

export interface Toast {
  id: number;
  kind: 'info' | 'succes' | 'erreur';
  message: string;
  /** Propose « Annuler » (annule la dernière opération). */
  undo?: boolean;
  /** Profondeur de l'historique au moment du message : « Annuler » n'est proposé que si elle n'a pas changé. */
  depth?: number;
}

export type Dialog =
  | { kind: 'config' }
  | { kind: 'fichier' }
  | { kind: 'ia' }
  | { kind: 'aide' }
  | { kind: 'bienvenue' }
  | { kind: 'scan'; result: ScanResult; imageUrl: string | null }
  /** Compte rendu (import, erreurs détaillées…). */
  | { kind: 'info'; title: string; message: string; details?: string[] }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      /** Lignes détaillées (liste de bouteilles…). */
      details?: string[];
      confirmLabel: string;
      danger?: boolean;
      onConfirm: () => void;
    };

export type Theme = 'auto' | 'clair' | 'sombre';

export interface Prefs {
  theme: Theme;
  /** Taille des emplacements du schéma. */
  zoom: 'auto' | 'petit' | 'moyen' | 'grand';
  /** Mode de réorganisation préféré. */
  reorgMode: ReorgMode;
  /** L'écran de bienvenue a déjà été vu. */
  accueilVu: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'auto',
  zoom: 'auto',
  reorgMode: 'economique',
  accueilVu: false,
};

/** Entrée de l'historique (annuler / rétablir). */
export interface HistoryEntry {
  cellar: Cellar;
  /** Description de l'opération qui a mené de cette cave à la suivante. */
  label: string;
}

/* ------------------------------------------------------------------ */
/* Rendu du schéma                                                     */
/* ------------------------------------------------------------------ */

export type SlotTone = 'normal' | 'match' | 'dim';

export type SlotMarker =
  /** Place libre mise en valeur (fonction « Places libres »). */
  | 'libre'
  /** Emplacement proposé pour l'ajout. */
  | 'propose'
  /** Destination possible (ajout / déplacement). */
  | 'possible'
  /** Emplacement incompatible avec la bouteille en cours de déplacement. */
  | 'incompatible'
  /** Bouteille à prendre (déplacement, étape de réorganisation). */
  | 'source'
  /** Emplacement où poser la bouteille (étape de réorganisation). */
  | 'destination';

/** Tout ce qu'il faut pour dessiner un emplacement. */
export interface SlotVisual {
  slot: SlotRef;
  bottle: Bottle | null;
  tone: SlotTone;
  /** Emplacement désigné par le formulaire (clayette + rang). */
  selected: boolean;
  marker: SlotMarker | null;
  /** Statut de dégustation (affiché dans la vue « conseil »). */
  status: DrinkStatus | null;
}

/** Cible des actions du formulaire. */
export interface Target {
  /**
   * - `bouteille` : une bouteille précise (désignée par clayette + rang) ;
   * - `selection` : les bouteilles correspondant aux critères ;
   * - `emplacement` : un emplacement libre désigné par clayette + rang ;
   * - `aucune` : pas de critère.
   */
  kind: 'bouteille' | 'selection' | 'emplacement' | 'aucune';
  bottles: Bottle[];
  slot: SlotRef | null;
  /** Vrai si le formulaire décrit autre chose que la bouteille désignée (modification en attente). */
  modifie: boolean;
  /** Erreur de saisie dans les critères, le cas échéant. */
  erreur: string | null;
}

export type FormState = Criteria;

export type { AiSettings, AiStatus };
