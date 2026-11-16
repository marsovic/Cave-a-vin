import type { Criteria } from '../domain/types';

/** Réglages de l'assistant IA, conservés dans ce navigateur uniquement. */
export interface AiSettings {
  /** Clé API Groq personnelle. Vide = passer par la fonction serveur `/api/ai`. */
  cleGroq: string;
  /** Code d'accès à la fonction serveur, si le déploiement en exige un. */
  codeAcces: string;
  /** Compléter les conseils par une recherche sur internet (modèle avec recherche intégrée). */
  rechercheWeb: boolean;
  /** Ne jamais appeler l'IA : conseils locaux uniquement, scan désactivé. */
  desactivee: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  cleGroq: '',
  codeAcces: '',
  rechercheWeb: true,
  desactivee: false,
};

/** Rôle de modèle demandé ; l'identifiant réel du modèle est résolu côté serveur / client. */
export type AiRole = 'texte' | 'vision' | 'web';

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AiContentPart[];
}

export interface AiRequest {
  role: AiRole;
  messages: AiMessage[];
  /** Demander une réponse JSON (mode JSON si le modèle le permet). */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface AiResponse {
  /** Texte de la réponse du modèle. */
  content: string;
  /** Identifiant du modèle qui a répondu. */
  modele: string;
  /** `true` si une recherche web a effectivement été utilisée. */
  web: boolean;
}

/** Disponibilité de l'IA, pour l'affichage (pastille d'état, boutons grisés). */
export interface AiStatus {
  disponible: boolean;
  /** `serveur` : via /api/ai ; `cle-perso` : appel direct avec la clé de l'utilisateur ; `aucun` : pas d'IA. */
  mode: 'serveur' | 'cle-perso' | 'aucun';
  /** Le serveur exige un code d'accès qui n'a pas (ou mal) été fourni. */
  codeRequis: boolean;
  /** Message en français expliquant l'état (« IA prête », « Aucune clé Groq configurée »…). */
  message: string;
}

export type AiErrorCode =
  | 'desactivee'
  | 'indisponible'
  | 'cle-invalide'
  | 'code-acces'
  | 'quota'
  | 'trop-volumineux'
  | 'reseau'
  | 'annule'
  | 'reponse-invalide';

/** Erreur de l'assistant IA, avec message en français affichable tel quel. */
export class AiError extends Error {
  readonly code: AiErrorCode;
  /** Délai conseillé avant de réessayer (secondes), si connu. */
  readonly retryAfter?: number;
  constructor(code: AiErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** Résultat de la lecture d'une étiquette par l'IA. */
export interface ScanResult {
  /** Champs reconnus (seuls les champs lus sont renseignés ; jamais clayette / rang). */
  fields: Partial<Pick<Criteria, 'chateau' | 'appellation' | 'annee' | 'cepages' | 'robe' | 'forme'>>;
  /** Champs que l'IA a déduits plutôt que lus (ex. cépages typiques de l'appellation). */
  deduits: (keyof ScanResult['fields'])[];
  /** Remarque éventuelle (« étiquette peu lisible »…). */
  note?: string;
}
