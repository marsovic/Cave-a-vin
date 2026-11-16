// Fonction serverless Vercel (runtime Node.js) : relais vers l'API Groq.
// GET  /api/ai → état du service ; POST /api/ai → requête IA (voir shared/aiHandler.js).
// La clé GROQ_API_KEY reste côté serveur. Ne rien ajouter d'autre dans api/ :
// chaque fichier de ce dossier devient une fonction publique.
import { handleAiRequest } from '../shared/aiHandler.js';

export default {
  /** @param {Request} request */
  async fetch(request) {
    return handleAiRequest(request, process.env, fetch, { log: (message) => console.error(message) });
  },
};
