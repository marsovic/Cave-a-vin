import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetForTests,
  createLinkedFile,
  isFileLinkSupported,
  linkedFileModifiedAt,
  pickLinkedFile,
  readLinkedFile,
  requestLinkPermission,
  restoreLinkedFile,
  unlinkFile,
  writeLinkedFile,
  type FileHandleLike,
  type HandleStore,
} from './fileLink';
import { LEGACY_PREFIX, STORAGE_KEYS, loadJson, loadText, removeKey, saveJson, saveText } from './localStore';
import { buildMailto, canShareCsv, csvFile, datedFilename, decodeText, extractCsvFromText, shareCsv } from './transfer';

describe('stockage du navigateur', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('lit et écrit du texte et du JSON', () => {
    expect(loadText('k')).toBeNull();
    expect(saveText('k', 'valeur')).toBe(true);
    expect(loadText('k')).toBe('valeur');
    expect(saveJson('j', { a: 1 })).toBe(true);
    expect(loadJson('j', { a: 0 })).toEqual({ a: 1 });
    removeKey('j');
    expect(loadJson('j', { a: 0 })).toEqual({ a: 0 });
  });

  it('ne lève jamais : JSON corrompu, quota dépassé, stockage en panne', () => {
    saveText('j', '{pas du json');
    expect(loadJson('j', 'défaut')).toBe('défaut');
    saveText('n', 'null');
    expect(loadJson('n', 'défaut')).toBe('défaut');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('plein', 'QuotaExceededError');
    });
    expect(saveText('k', 'x')).toBe(false);
    expect(saveJson('k', { x: 1 })).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('panne');
    });
    expect(loadText('k')).toBeNull();
    expect(loadJson('k', 7)).toBe(7);
  });
});

describe('reprise des données enregistrées sous l’ancien nom de l’application', () => {
  beforeEach(() => localStorage.clear());

  it('lit l’ancienne clé, la déplace sous le nouveau préfixe, puis l’oublie', () => {
    localStorage.setItem(`${LEGACY_PREFIX}cave.csv`, 'type;id\r\n');
    expect(loadText(STORAGE_KEYS.csv)).toBe('type;id\r\n');
    expect(localStorage.getItem(STORAGE_KEYS.csv)).toBe('type;id\r\n');
    expect(localStorage.getItem(`${LEGACY_PREFIX}cave.csv`)).toBeNull();
    expect(loadText(STORAGE_KEYS.csv)).toBe('type;id\r\n');
  });

  it('toutes les clés de l’application sont reprises (JSON compris)', () => {
    for (const key of Object.values(STORAGE_KEYS)) {
      localStorage.setItem(key.replace('dumbcellar.', LEGACY_PREFIX), JSON.stringify({ cle: key }));
    }
    for (const key of Object.values(STORAGE_KEYS)) expect(loadJson(key, null)).toEqual({ cle: key });
    expect(Object.keys(localStorage).filter((k) => k.startsWith(LEGACY_PREFIX))).toEqual([]);
  });

  it('la valeur actuelle prime sur l’ancienne', () => {
    localStorage.setItem(`${LEGACY_PREFIX}prefs`, '{"theme":"sombre"}');
    localStorage.setItem(STORAGE_KEYS.prefs, '{"theme":"clair"}');
    expect(loadJson(STORAGE_KEYS.prefs, {})).toEqual({ theme: 'clair' });
  });

  it('écrire ou supprimer une clé efface aussi l’ancienne, qui ne peut plus revenir', () => {
    localStorage.setItem(`${LEGACY_PREFIX}reorg.session`, '{"index":3}');
    removeKey(STORAGE_KEYS.reorg);
    expect(loadText(STORAGE_KEYS.reorg)).toBeNull();

    localStorage.setItem(`${LEGACY_PREFIX}cave.csv`, 'ancienne');
    saveText(STORAGE_KEYS.csv, 'nouvelle');
    removeKey(STORAGE_KEYS.csv);
    expect(loadText(STORAGE_KEYS.csv)).toBeNull();
  });

  it('ne touche pas aux clés qui ne sont pas celles de l’application', () => {
    localStorage.setItem(`${LEGACY_PREFIX}autre`, 'x');
    expect(loadText('autre')).toBeNull();
    expect(localStorage.getItem(`${LEGACY_PREFIX}autre`)).toBe('x');
  });
});

describe('décodage des fichiers', () => {
  const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

  it('UTF-8 avec ou sans BOM', () => {
    const utf8 = new TextEncoder().encode('Château;Rosé');
    expect(decodeText(utf8)).toBe('Château;Rosé');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe('Château;Rosé');
  });

  it('Windows-1252 (fichiers enregistrés par Excel)', () => {
    // « Château Rosé » : â = 0xE2, é = 0xE9 en Windows-1252 (séquences invalides en UTF-8).
    expect(decodeText(bytes(0x43, 0x68, 0xe2, 0x74, 0x65, 0x61, 0x75, 0x20, 0x52, 0x6f, 0x73, 0xe9))).toBe('Château Rosé');
  });

  it('UTF-16 avec BOM', () => {
    expect(decodeText(bytes(0xff, 0xfe, 0x41, 0x00, 0xe9, 0x00))).toBe('Aé');
    expect(decodeText(bytes(0xfe, 0xff, 0x00, 0x41, 0x00, 0xe9))).toBe('Aé');
  });
});

describe('export', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('nom de fichier daté et fichier avec BOM', async () => {
    expect(datedFilename(new Date(2026, 10, 6))).toBe('dumbcellar-2026-11-06.csv');
    const file = csvFile('a;b', 'cave.csv');
    expect(file.name).toBe('cave.csv');
    expect(file.type).toBe('text/csv');
    const data = new Uint8Array(await file.arrayBuffer());
    expect([...data.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('courriel : CSV dans le message s\'il est court, sinon invitation à joindre le fichier', () => {
    const short = buildMailto('a;b\r\n1;2', { subject: 'Ma cave', intro: 'Bonjour' });
    expect(short.inline).toBe(true);
    expect(short.href.startsWith('mailto:?subject=Ma%20cave&body=')).toBe(true);
    expect(decodeURIComponent(short.href)).toContain('a;b\r\n1;2');
    const long = buildMailto('x;y\r\n'.repeat(800), { subject: 'Ma cave', intro: 'Bonjour' });
    expect(long.inline).toBe(false);
    expect(long.href.length).toBeLessThanOrEqual(1800);
    expect(decodeURIComponent(long.href)).toMatch(/joindre/);
  });

  it('partage : seul le fichier est transmis ; annulation et absence d\'API sont distinguées', async () => {
    expect(canShareCsv()).toBe(false);
    expect(await shareCsv('a;b', 'cave.csv')).toBe('unsupported');

    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
    expect(canShareCsv()).toBe(true);
    expect(await shareCsv('a;b', 'cave.csv', { title: 't', text: 'x' })).toBe('shared');
    expect(Object.keys(share.mock.calls[0]![0])).toEqual(['files']);

    share.mockRejectedValueOnce(new DOMException('annulé', 'AbortError'));
    expect(await shareCsv('a;b', 'cave.csv')).toBe('cancelled');
    share.mockRejectedValueOnce(new DOMException('refusé', 'NotAllowedError'));
    expect(await shareCsv('a;b', 'cave.csv')).toBe('unsupported');
  });

  it('partage : repli en texte brut si le navigateur refuse text/csv', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn(({ files }: { files: File[] }) => files[0]!.type === 'text/plain');
    vi.stubGlobal('navigator', { ...navigator, canShare, share });
    expect(await shareCsv('a;b', 'cave.csv')).toBe('shared');
    expect((share.mock.calls[0]![0] as { files: File[] }).files[0]!.type).toBe('text/plain');
  });
});

describe('extraction d\'un CSV collé', () => {
  const header = 'enregistrement;clayette;rang;emplacements;type;chateau;appellation;annee;cepages;robe;forme;collection';

  it('retire le texte du courriel autour du tableau', () => {
    const text = `Bonjour,\n\nVoici ma cave :\n\n${header}\nclayette;1;;6;Tout;;;;;;;\nbouteille;1;1;;;A;Margaux;2015;;Rouge;Bordeaux;non\n\nBien cordialement,\nPhilippe`;
    expect(extractCsvFromText(text)?.split('\r\n')).toEqual([header, 'clayette;1;;6;Tout;;;;;;;', 'bouteille;1;1;;;A;Margaux;2015;;Rouge;Bordeaux;non']);
  });

  it('accepte les citations « > », les lignes vides intercalées et d\'autres séparateurs', () => {
    const quoted = `> ${header}\n>\n> bouteille;1;1;;;A;Margaux;2015;;Rouge;Bordeaux;non`;
    expect(extractCsvFromText(quoted)?.split('\r\n')).toHaveLength(2);
    const comma = 'Château,Appellation,Année\nA,Margaux,2015\nB,Pauillac,2010';
    expect(extractCsvFromText(comma)?.split('\r\n')).toHaveLength(3);
  });

  it('garde les champs entre guillemets qui contiennent un retour à la ligne', () => {
    const text = `${header}\nbouteille;1;1;;;"Château\nen deux lignes";Margaux;2015;;Rouge;Bordeaux;non\nbouteille;1;2;;;B;Margaux;2015;;Rouge;Bordeaux;non`;
    expect(extractCsvFromText(text)?.split('\r\n')).toHaveLength(4);
  });

  it('reconnaît les mêmes en-têtes que l\'import de fichier', () => {
    expect(extractCsvFromText('Domaine;AOC;Millésime;Couleur\nChâteau Margaux;Margaux;2015;Rouge')?.split('\r\n')).toHaveLength(2);
    expect(extractCsvFromText('Château;AOC;Année\nA;Margaux;2015')).not.toBeNull();
  });

  it('une phrase d\'introduction qui cite les colonnes n\'est pas prise pour l\'en-tête', () => {
    const text = `Voici ma cave : château, appellation et année de chaque bouteille.\n${header}\nbouteille;1;1;;;A;Margaux;2015;;Rouge;Bordeaux;non`;
    expect(extractCsvFromText(text)?.split('\r\n')[0]).toBe(header);
  });

  it('ne coupe pas le tableau sur un commentaire ou des lignes vides', () => {
    expect(extractCsvFromText('chateau;appellation;annee\nA;Margaux;2015\n# note\nB;Pauillac;2010')).toContain('B;Pauillac;2010');
    expect(extractCsvFromText('chateau;appellation;annee\nA;Margaux;2015\n\n\n\nB;Pauillac;2010')).toContain('B;Pauillac;2010');
    // … mais s'arrête avant la signature du courriel.
    const mail = extractCsvFromText('Château,Appellation,Année\nA,Margaux,2015\n\nCordialement, Philippe');
    expect(mail).not.toContain('Cordialement');
  });

  it('conserve les cellules vides en tête de ligne (tabulations)', () => {
    const text = 'Clayette\tRang\tChâteau\tAppellation\tAnnée\n1\t1\tChâteau Margaux\tMargaux\t2015\n\t\tChâteau Latour\tPauillac\t2010';
    expect(extractCsvFromText(text)?.split('\r\n')[2]).toBe('\t\tChâteau Latour\tPauillac\t2010');
  });

  it('renvoie null sans en-tête reconnaissable ou sans données', () => {
    expect(extractCsvFromText('Bonjour, rien à voir ici.')).toBeNull();
    expect(extractCsvFromText(header)).toBeNull();
  });
});

describe('fichier lié', () => {
  function fakeHandle(initial = 'contenu') {
    const state = { text: initial, mtime: 1000, permission: 'granted' as PermissionState, failWrite: null as string | null, aborted: false };
    const handle: FileHandleLike = {
      name: 'cave.csv',
      getFile: async () => new File([state.text], 'cave.csv', { lastModified: state.mtime }),
      createWritable: async () => {
        let pending = '';
        return {
          write: async (data) => {
            if (state.failWrite) throw new DOMException('échec', state.failWrite);
            pending = String(data);
          },
          close: async () => {
            state.text = pending;
            state.mtime += 1000;
          },
          abort: async () => {
            state.aborted = true;
          },
        };
      },
      queryPermission: async () => state.permission,
      requestPermission: async () => {
        state.permission = 'granted';
        return state.permission;
      },
    };
    return { handle, state };
  }

  function memoryStore(): HandleStore & { saved: FileHandleLike | null } {
    const store = {
      saved: null as FileHandleLike | null,
      get: async () => store.saved,
      set: async (h: FileHandleLike) => {
        store.saved = h;
      },
      clear: async () => {
        store.saved = null;
      },
    };
    return store;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetForTests();
  });

  it('n\'est pas disponible sans File System Access API', () => {
    expect(isFileLinkSupported()).toBe(false);
  });

  it('choisit, lit, écrit (avec BOM) et retrouve le fichier d\'une session à l\'autre', async () => {
    const { handle, state } = fakeHandle('a;b');
    const store = memoryStore();
    __resetForTests(store);
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue([handle]));
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue(handle));
    expect(isFileLinkSupported()).toBe(true);

    expect(await pickLinkedFile()).toEqual({ name: 'cave.csv', permission: 'granted' });
    expect(store.saved).toBe(handle);
    expect(await readLinkedFile()).toEqual({ text: 'a;b', lastModified: 1000 });
    expect(await writeLinkedFile('x;y')).toBe(2000);
    expect(state.text).toBe('﻿x;y');
    expect(await linkedFileModifiedAt()).toBe(2000);

    // Nouvelle session : le descripteur est retrouvé, la permission est à redemander.
    __resetForTests(store);
    state.permission = 'prompt';
    expect(await restoreLinkedFile()).toEqual({ name: 'cave.csv', permission: 'prompt' });
    expect(await requestLinkPermission()).toBe('granted');

    await unlinkFile();
    expect(store.saved).toBeNull();
    expect(await restoreLinkedFile()).toBeNull();
  });

  it('annulation du sélecteur : aucun fichier lié', async () => {
    __resetForTests(memoryStore());
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockRejectedValue(new DOMException('annulé', 'AbortError')));
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(new DOMException('annulé', 'AbortError')));
    expect(await pickLinkedFile()).toBeNull();
    expect(await createLinkedFile('cave.csv')).toBeNull();
  });

  it('explique les échecs d\'écriture et n\'abîme pas le fichier', async () => {
    const { handle, state } = fakeHandle('intact');
    __resetForTests(memoryStore());
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue([handle]));
    vi.stubGlobal('showSaveFilePicker', vi.fn());
    await pickLinkedFile();
    state.failWrite = 'NoModificationAllowedError';
    await expect(writeLinkedFile('nouveau')).rejects.toThrow(/Excel|OneDrive/);
    expect(state.aborted).toBe(true);
    expect(state.text).toBe('intact');
    state.failWrite = 'NotAllowedError';
    await expect(writeLinkedFile('nouveau')).rejects.toThrow(/reconnectez/);
    state.failWrite = 'NotFoundError';
    await expect(writeLinkedFile('nouveau')).rejects.toThrow(/introuvable/);
  });

  it('sans fichier lié, lecture et écriture échouent proprement', async () => {
    await expect(readLinkedFile()).rejects.toThrow(/Aucun fichier/);
    await expect(writeLinkedFile('x')).rejects.toThrow(/Aucun fichier/);
    expect(await linkedFileModifiedAt()).toBeNull();
    expect(await requestLinkPermission()).toBe('denied');
  });
});
