import type { Bottle, Cellar, SlotRef } from '../types';

/**
 * Mode de répartition des places libres dans le rangement cible :
 *  - `economique` : les places libres restent là où elles minimisent les déplacements ;
 *  - `compact` : les bouteilles sont tassées vers le haut (places libres en bas).
 */
export type ReorgMode = 'economique' | 'compact';

export interface ReorgOptions {
  mode: ReorgMode;
}

/** Lieu d'une bouteille pendant la réorganisation : un emplacement, ou posée hors de la cave. */
export type ReorgPlace = SlotRef | 'hors-cave';

/** Un déplacement élémentaire à faire par l'utilisateur. */
export interface ReorgStep {
  /** Numéro d'ordre (base 0). */
  index: number;
  bottleId: string;
  from: ReorgPlace;
  to: ReorgPlace;
  /**
   * `true` si la destination est provisoire (emplacement tampon ou hors cave) :
   * la bouteille sera de nouveau déplacée plus tard.
   */
  temporaire: boolean;
}

export interface ReorgStats {
  /** Nombre de bouteilles dans la cave. */
  bouteilles: number;
  /** Bouteilles qui ne bougent pas. */
  dejaEnPlace: number;
  /** Bouteilles qui changent d'emplacement. */
  aDeplacer: number;
  /** Nombre total de déplacements élémentaires (= `steps.length`). */
  deplacements: number;
  /** Paires adjacentes (ordre de lecture) du rangement cible où l'année décroît — dues aux types de clayettes. */
  exceptionsOrdre: number;
  /** Groupes (même château + même année) qui ne sont pas d'un seul tenant sur une même clayette dans la cible. */
  groupesSepares: number;
}

export interface ReorgPlan {
  options: ReorgOptions;
  /** Déplacements à effectuer, dans l'ordre. Vide si la cave est déjà rangée. */
  steps: ReorgStep[];
  /** La cave une fois tous les déplacements effectués. */
  target: Cellar;
  stats: ReorgStats;
  /** Remarques en français à afficher dans le résumé (exceptions d'ordre, groupes séparés…). */
  notes: string[];
}

/** État courant pendant l'exécution pas à pas d'un plan. */
export interface ReorgState {
  cellar: Cellar;
  /** Bouteilles momentanément posées hors de la cave (au plus une avec le planificateur fourni). */
  horsCave: Bottle[];
}
