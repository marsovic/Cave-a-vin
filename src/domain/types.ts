/**
 * Modèle de données de DumbCellar.
 *
 * Conventions :
 *  - les numéros de clayette et de rang sont en base 1 (clayette 1 = tout en haut,
 *    rang 1 = tout à gauche), comme l'utilisateur les lit sur l'armoire ;
 *  - toutes les fonctions du domaine sont pures : elles ne modifient jamais leurs
 *    arguments et renvoient de nouvelles valeurs.
 */

/** Robes (couleurs) possibles d'un vin. */
export const ROBES = ['rouge', 'blanc', 'blanc-liquoreux', 'rose'] as const;
export type Robe = (typeof ROBES)[number];

/** Formes de bouteille. `autre` (flûte, magnum…) ne tient que dans une clayette « tout ». */
export const FORMES = ['bordeaux', 'bourgogne', 'champagne', 'autre'] as const;
export type Forme = (typeof FORMES)[number];

/** Types d'emplacements d'une clayette. */
export const TYPES_CLAYETTE = ['bordeaux', 'bourgogne', 'champagne', 'tout'] as const;
export type TypeClayette = (typeof TYPES_CLAYETTE)[number];

/** Position d'un emplacement dans la cave (base 1). */
export interface SlotRef {
  clayette: number;
  rang: number;
}

/** Description d'un vin, indépendamment de la bouteille physique. */
export interface WineFields {
  /** Nom du château / domaine / producteur. */
  chateau: string;
  /** Appellation (Haut-Médoc, Margaux, Champagne, Prosecco…). */
  appellation: string;
  /** Millésime, ou `null` si non millésimé / inconnu. */
  annee: number | null;
  /** Cépages, dans l'ordre saisi. */
  cepages: string[];
  robe: Robe;
  forme: Forme;
}

/** Une bouteille physique rangée dans la cave. */
export interface Bottle extends WineFields {
  /** Identifiant technique stable (non affiché). */
  id: string;
  /** Bouteille « de collection » : exclue des conseils de dégustation. */
  collection: boolean;
  clayette: number;
  rang: number;
}

/** Une clayette : nombre d'emplacements et type d'emplacements. */
export interface Shelf {
  capacite: number;
  type: TypeClayette;
}

/**
 * La cave. Invariants (voir `validateCellar`) :
 *  - chaque bouteille occupe un emplacement existant ;
 *  - deux bouteilles n'occupent jamais le même emplacement ;
 *  - la forme de chaque bouteille est compatible avec le type de sa clayette ;
 *  - les identifiants sont uniques.
 */
export interface Cellar {
  /** `shelves[0]` est la clayette n° 1 (en haut). */
  shelves: Shelf[];
  bottles: Bottle[];
}

/** Résultat d'une opération pouvant échouer, avec message en français affichable tel quel. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Critères du formulaire, tels que saisis (chaînes brutes).
 * Une chaîne vide signifie « pas de critère ».
 */
export interface Criteria {
  chateau: string;
  appellation: string;
  /** Expression d'année : `2015`, `2010-2015`, `<2012`, `>=2018`, `2010, 2012`, `sans` (non millésimé). */
  annee: string;
  /** Cépages séparés par des virgules ; tous doivent être présents. */
  cepages: string;
  robe: Robe | '';
  forme: Forme | '';
  /** N° de clayette (base 1) ou vide. */
  clayette: string;
  /** N° de rang (base 1) ou vide. */
  rang: string;
}

export const EMPTY_CRITERIA: Criteria = {
  chateau: '',
  appellation: '',
  annee: '',
  cepages: '',
  robe: '',
  forme: '',
  clayette: '',
  rang: '',
};

/** Fenêtre de dégustation estimée d'un vin. */
export interface DrinkWindow {
  /** Première année où le vin est agréable à boire. */
  debut: number;
  /** Dernière année conseillée. */
  fin: number;
  /** Origine de l'estimation. */
  source: 'local' | 'ia' | 'ia-web';
  /** Courte justification en français (facultative). */
  note?: string;
}

/**
 * Statut de dégustation à une date donnée :
 *  - `trop-jeune` : à attendre ;
 *  - `a-boire` : dans sa fenêtre, sans urgence ;
 *  - `a-boire-vite` : fin de fenêtre proche ;
 *  - `passe` : fenêtre dépassée (candidate « collection ») ;
 *  - `inconnu` : pas de millésime ni d'information.
 */
export type DrinkStatus = 'trop-jeune' | 'a-boire' | 'a-boire-vite' | 'passe' | 'inconnu';

export const SHELF_LIMITS = {
  minShelves: 1,
  maxShelves: 30,
  minCapacity: 1,
  maxCapacity: 20,
  defaultShelves: 12,
  defaultCapacity: 12,
} as const;
