import { useState, type ReactNode } from 'react';
import { aiComplete, getAiStatus, resetAiStatusCache } from '../../ai/client';
import { AiError } from '../../ai/types';
import { useStore } from '../../state/store';
import { Icon } from '../icons';
import { Modal } from './Modal';

type TestState = { state: 'idle' } | { state: 'run' } | { state: 'ok'; message: string } | { state: 'ko'; message: string };

/** Réglages de l'assistant IA (Groq) : activation, recherche web, clé personnelle, code d'accès. */
export function AiDialog(): ReactNode {
  const ai = useStore((s) => s.ai);
  const aiStatus = useStore((s) => s.aiStatus);
  const cached = useStore((s) => Object.keys(s.aiWindows).length);
  const setAi = useStore((s) => s.setAi);
  const clearAiWindows = useStore((s) => s.clearAiWindows);
  const closeDialog = useStore((s) => s.closeDialog);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ state: 'idle' });

  const runTest = async (): Promise<void> => {
    setTest({ state: 'run' });
    try {
      resetAiStatusCache();
      const current = useStore.getState().ai;
      const status = await getAiStatus(current);
      useStore.getState().setAiStatus(status);
      if (!status.disponible) {
        setTest({ state: 'ko', message: status.message });
        return;
      }
      const res = await aiComplete(
        {
          role: 'texte',
          messages: [{ role: 'user', content: 'Réponds uniquement par le mot : santé' }],
          maxTokens: 200,
        },
        current,
      );
      setTest({ state: 'ok', message: `L'assistant répond (modèle ${res.modele}).` });
    } catch (error) {
      setTest({
        state: 'ko',
        message: error instanceof AiError ? error.message : 'Le test a échoué pour une raison inconnue.',
      });
    }
  };

  return (
    <Modal
      title="Assistant IA"
      onClose={closeDialog}
      size="moyen"
      footer={
        <button type="button" className="btn btn-primary" onClick={closeDialog}>
          Terminé
        </button>
      }
    >
      <p className="muted">
        L'assistant (IA Groq) lit les étiquettes photographiées et affine les conseils : fenêtres de dégustation,
        accords mets-vin. Sans lui, l'application utilise sa base de connaissances embarquée — tout fonctionne, sauf
        le scan.
      </p>

      <div className="status-line" data-ok={aiStatus?.disponible ? '' : undefined}>
        <Icon name={aiStatus?.disponible ? 'check' : 'info'} size={17} />
        <span>{aiStatus ? aiStatus.message : 'Vérification de l\'assistant…'}</span>
      </div>

      <section className="dialog-section">
        <label className="switch-row">
          <input
            type="checkbox"
            checked={!ai.desactivee}
            onChange={(e) => {
              setAi({ desactivee: !e.target.checked });
              setTest({ state: 'idle' });
            }}
          />
          <span>
            <strong>Utiliser l'assistant IA</strong>
            <span className="field-hint">Décoché : conseils locaux uniquement, aucune donnée envoyée.</span>
          </span>
        </label>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={ai.rechercheWeb}
            disabled={ai.desactivee}
            onChange={(e) => setAi({ rechercheWeb: e.target.checked })}
          />
          <span>
            <strong>Compléter par une recherche sur internet</strong>
            <span className="field-hint">
              Plus précis pour les fenêtres de dégustation, mais plus lent ; repli automatique si la recherche échoue.
            </span>
          </span>
        </label>
      </section>

      <section className="dialog-section">
        <h3>Clé Groq personnelle (facultatif)</h3>
        <p className="muted">
          Si le site n'a pas de clé configurée, créez une clé gratuite sur{' '}
          <a className="link" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
            console.groq.com/keys
          </a>{' '}
          et collez-la ici. Elle reste dans ce navigateur et n'est envoyée qu'à Groq.
        </p>
        <div className="input-with-actions">
          <input
            className="input"
            type={showKey ? 'text' : 'password'}
            value={ai.cleGroq}
            onChange={(e) => {
              setAi({ cleGroq: e.target.value.trim() });
              setTest({ state: 'idle' });
            }}
            placeholder="gsk_…"
            aria-label="Clé API Groq personnelle"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={ai.desactivee}
          />
          <button
            type="button"
            className="btn"
            onClick={() => setShowKey((v) => !v)}
            aria-pressed={showKey}
            disabled={ai.desactivee}
          >
            {showKey ? 'Masquer' : 'Afficher'}
          </button>
        </div>
      </section>

      {aiStatus?.codeRequis || ai.codeAcces ? (
        <section className="dialog-section">
          <h3>Code d'accès</h3>
          <p className="muted">Ce site protège son assistant par un code : demandez-le à son propriétaire.</p>
          <input
            className="input"
            type="password"
            value={ai.codeAcces}
            onChange={(e) => {
              setAi({ codeAcces: e.target.value });
              setTest({ state: 'idle' });
            }}
            aria-label="Code d'accès à l'assistant"
            autoComplete="off"
            disabled={ai.desactivee}
          />
        </section>
      ) : null}

      <section className="dialog-section">
        <div className="button-row">
          <button
            type="button"
            className="btn"
            onClick={() => void runTest()}
            disabled={test.state === 'run' || ai.desactivee}
          >
            <Icon name="refresh" size={17} />
            {test.state === 'run' ? 'Test en cours…' : 'Tester l\'assistant'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={clearAiWindows} disabled={cached === 0}>
            Oublier les estimations mémorisées ({cached})
          </button>
        </div>
        {test.state === 'ok' ? (
          <p className="notice notice-ok" role="status">
            <Icon name="check" size={16} /> {test.message}
          </p>
        ) : null}
        {test.state === 'ko' ? (
          <p className="notice notice-danger" role="alert">
            <Icon name="warning" size={16} /> {test.message}
          </p>
        ) : null}
      </section>
    </Modal>
  );
}
