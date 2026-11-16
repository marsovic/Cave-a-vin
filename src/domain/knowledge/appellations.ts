import type { Forme, Robe } from '../types';
import type { AppellationInfo } from './index';

/**
 * Base d'appellations embarquée : région, robes produites (la plus courante d'abord),
 * forme de bouteille habituelle, cépages typiques et fenêtre de garde d'un vin « moyen »
 * de l'appellation (années après le millésime). Valeurs volontairement prudentes.
 */

/* ---------- Assemblages récurrents ---------- */

const MEDOC = ['Cabernet Sauvignon', 'Merlot', 'Cabernet franc', 'Petit Verdot'];
const BDX_ROUGE = ['Merlot', 'Cabernet Sauvignon', 'Cabernet franc'];
const LIBOURNAIS = ['Merlot', 'Cabernet franc', 'Cabernet Sauvignon'];
const BDX_BLANC = ['Sauvignon blanc', 'Sémillon', 'Muscadelle'];
const SAUTERNAIS = ['Sémillon', 'Sauvignon blanc', 'Muscadelle'];
const PINOT = ['Pinot noir'];
const CHARDO = ['Chardonnay'];
const GAMAY = ['Gamay'];
const SYRAH = ['Syrah'];
const MARS_ROUS = ['Marsanne', 'Roussanne'];
const GSM = ['Grenache', 'Syrah', 'Mourvèdre'];
const RHONE_SUD = ['Grenache', 'Syrah', 'Mourvèdre', 'Cinsault', 'Carignan'];
const RHONE_BLANC = ['Grenache blanc', 'Roussanne', 'Marsanne', 'Viognier', 'Clairette'];
const SAUV = ['Sauvignon blanc'];
const CHENIN = ['Chenin blanc'];
const CAB_FRANC = ['Cabernet franc'];
const MELON = ['Melon de Bourgogne'];
const LANGUEDOC = ['Syrah', 'Grenache', 'Mourvèdre', 'Carignan', 'Cinsault'];
const PROVENCE_ROSE = ['Grenache', 'Cinsault', 'Syrah', 'Mourvèdre'];
const CHAMPENOIS = ['Chardonnay', 'Pinot noir', 'Pinot Meunier'];
const MANSENG = ['Petit Manseng', 'Gros Manseng'];
const TEMPRANILLO = ['Tempranillo', 'Garnacha', 'Graciano'];
const SANGIOVESE = ['Sangiovese'];
const NEBBIOLO = ['Nebbiolo'];
const RIESLING = ['Riesling'];
const DOURO = ['Touriga Nacional', 'Touriga Franca', 'Tinta Roriz'];

type RobeSpec = [cepages: string[], debut: number, fin: number];
type Spec = Partial<Record<Robe, RobeSpec>>;

interface Options {
  alias?: string[];
  pays?: string;
  effervescent?: boolean;
}

function ap(nom: string, region: string, forme: Forme, spec: Spec, options: Options = {}): AppellationInfo {
  const robes = Object.keys(spec) as Robe[];
  const cepages: AppellationInfo['cepages'] = {};
  const garde: AppellationInfo['garde'] = {};
  for (const robe of robes) {
    const [c, debut, fin] = spec[robe]!;
    cepages[robe] = c;
    garde[robe] = [debut, fin];
  }
  return {
    nom,
    region,
    pays: options.pays ?? 'France',
    robes,
    forme,
    cepages,
    garde,
    ...(options.alias ? { alias: options.alias } : {}),
    ...(options.effervescent ? { effervescent: true } : {}),
  };
}

/* Raccourcis par région. */
const bdx = (nom: string, spec: Spec, alias?: string[]): AppellationInfo =>
  ap(nom, 'Bordeaux', 'bordeaux', spec, alias ? { alias } : {});
const bgn = (nom: string, spec: Spec, alias?: string[]): AppellationInfo =>
  ap(nom, 'Bourgogne', 'bourgogne', spec, alias ? { alias } : {});
const bjl = (nom: string, debut: number, fin: number): AppellationInfo =>
  ap(nom, 'Beaujolais', 'bourgogne', { rouge: [GAMAY, debut, fin] });
const rho = (nom: string, spec: Spec, alias?: string[]): AppellationInfo =>
  ap(nom, 'Vallée du Rhône', 'bourgogne', spec, alias ? { alias } : {});
const loi = (nom: string, spec: Spec, alias?: string[]): AppellationInfo =>
  ap(nom, 'Vallée de la Loire', 'bourgogne', spec, alias ? { alias } : {});
const als = (nom: string, spec: Spec, alias?: string[]): AppellationInfo =>
  ap(nom, 'Alsace', 'autre', spec, alias ? { alias } : {});
const lgd = (nom: string, spec: Spec, alias?: string[]): AppellationInfo =>
  ap(nom, 'Languedoc-Roussillon', 'bordeaux', spec, alias ? { alias } : {});
const prv = (nom: string, spec: Spec, alias?: string[]): AppellationInfo =>
  ap(nom, 'Provence', 'bordeaux', spec, alias ? { alias } : {});
const sow = (nom: string, spec: Spec, alias?: string[]): AppellationInfo =>
  ap(nom, 'Sud-Ouest', 'bordeaux', spec, alias ? { alias } : {});
const bulles = (nom: string, region: string, spec: Spec, options: Options = {}): AppellationInfo =>
  ap(nom, region, 'champagne', spec, { ...options, effervescent: true });
const ita = (nom: string, region: string, forme: Forme, spec: Spec, alias?: string[]): AppellationInfo =>
  ap(nom, region, forme, spec, { pays: 'Italie', ...(alias ? { alias } : {}) });
const esp = (nom: string, region: string, spec: Spec, alias?: string[]): AppellationInfo =>
  ap(nom, region, 'bordeaux', spec, { pays: 'Espagne', ...(alias ? { alias } : {}) });

const r = (c: string[], debut: number, fin: number): Spec => ({ rouge: [c, debut, fin] });
const b = (c: string[], debut: number, fin: number): Spec => ({ blanc: [c, debut, fin] });
const liq = (c: string[], debut: number, fin: number): Spec => ({ 'blanc-liquoreux': [c, debut, fin] });

export const APPELLATIONS: AppellationInfo[] = [
  /* ============================ BORDEAUX ============================ */
  bdx('Bordeaux', { rouge: [BDX_ROUGE, 2, 7], blanc: [BDX_BLANC, 1, 4], rose: [BDX_ROUGE, 0, 2] }),
  bdx('Bordeaux Supérieur', r(BDX_ROUGE, 3, 8)),
  bdx('Médoc', r(MEDOC, 4, 12)),
  bdx('Haut-Médoc', r(MEDOC, 5, 15)),
  bdx('Margaux', r(MEDOC, 8, 25)),
  bdx('Pauillac', r(MEDOC, 10, 30)),
  bdx('Saint-Julien', r(MEDOC, 8, 25)),
  bdx('Saint-Estèphe', r(MEDOC, 8, 25)),
  bdx('Moulis-en-Médoc', r(MEDOC, 5, 15), ['Moulis']),
  bdx('Listrac-Médoc', r(MEDOC, 5, 15), ['Listrac']),
  bdx('Pessac-Léognan', {
    rouge: [['Cabernet Sauvignon', 'Merlot', 'Cabernet franc'], 6, 20],
    blanc: [['Sauvignon blanc', 'Sémillon'], 4, 15],
  }),
  bdx('Graves', { rouge: [['Merlot', 'Cabernet Sauvignon', 'Cabernet franc'], 4, 12], blanc: [BDX_BLANC, 2, 8] }),
  bdx('Saint-Émilion', r(LIBOURNAIS, 5, 15)),
  bdx('Saint-Émilion Grand Cru', r(LIBOURNAIS, 7, 22), ['Saint-Émilion Grand Cru Classé']),
  bdx('Montagne-Saint-Émilion', r(LIBOURNAIS, 3, 10)),
  bdx('Lussac-Saint-Émilion', r(LIBOURNAIS, 3, 10)),
  bdx('Puisseguin-Saint-Émilion', r(LIBOURNAIS, 3, 10)),
  bdx('Saint-Georges-Saint-Émilion', r(LIBOURNAIS, 3, 10)),
  bdx('Pomerol', r(LIBOURNAIS, 8, 25)),
  bdx('Lalande-de-Pomerol', r(LIBOURNAIS, 4, 12)),
  bdx('Fronsac', r(LIBOURNAIS, 5, 15)),
  bdx('Canon-Fronsac', r(LIBOURNAIS, 5, 15)),
  bdx('Côtes de Bourg', r(BDX_ROUGE, 3, 10), ['Bourg']),
  bdx('Blaye Côtes de Bordeaux', { rouge: [BDX_ROUGE, 3, 8], blanc: [BDX_BLANC, 1, 4] }, [
    'Côtes de Blaye',
    'Premières Côtes de Blaye',
    'Blaye',
  ]),
  bdx('Castillon Côtes de Bordeaux', r(LIBOURNAIS, 3, 10), ['Côtes de Castillon']),
  bdx('Francs Côtes de Bordeaux', r(LIBOURNAIS, 3, 10), ['Côtes de Francs']),
  bdx('Cadillac Côtes de Bordeaux', r(BDX_ROUGE, 3, 10), ['Premières Côtes de Bordeaux']),
  bdx('Entre-Deux-Mers', b(BDX_BLANC, 1, 4)),
  bdx('Sauternes', liq(SAUTERNAIS, 8, 40)),
  bdx('Barsac', liq(SAUTERNAIS, 8, 40)),
  bdx('Loupiac', liq(SAUTERNAIS, 5, 20)),
  bdx('Sainte-Croix-du-Mont', liq(SAUTERNAIS, 5, 20)),
  bdx('Cadillac', liq(SAUTERNAIS, 5, 20)),
  bdx('Cérons', liq(SAUTERNAIS, 5, 20)),
  bulles('Crémant de Bordeaux', 'Bordeaux', b(['Sémillon', 'Sauvignon blanc'], 0, 3)),

  /* ============================ BOURGOGNE ============================ */
  bgn('Bourgogne', { rouge: [PINOT, 2, 7], blanc: [CHARDO, 2, 6] }),
  bgn('Bourgogne Aligoté', b(['Aligoté'], 1, 4)),
  bgn('Bourgogne Hautes-Côtes de Nuits', { rouge: [PINOT, 3, 8], blanc: [CHARDO, 2, 6] }, ['Hautes-Côtes de Nuits']),
  bgn('Bourgogne Hautes-Côtes de Beaune', { rouge: [PINOT, 3, 8], blanc: [CHARDO, 2, 6] }, [
    'Hautes-Côtes de Beaune',
  ]),
  bgn('Petit Chablis', b(CHARDO, 1, 4)),
  bgn('Chablis', b(CHARDO, 2, 8)),
  bgn('Chablis Premier Cru', b(CHARDO, 4, 12)),
  bgn('Chablis Grand Cru', b(CHARDO, 6, 20)),
  bgn('Marsannay', { rouge: [PINOT, 3, 10], rose: [PINOT, 0, 3], blanc: [CHARDO, 2, 6] }),
  bgn('Fixin', r(PINOT, 4, 12)),
  bgn('Gevrey-Chambertin', r(PINOT, 6, 18)),
  bgn('Chambertin', r(PINOT, 10, 30), ['Chambertin-Clos de Bèze', 'Charmes-Chambertin', 'Mazis-Chambertin']),
  bgn('Morey-Saint-Denis', r(PINOT, 6, 18)),
  bgn('Clos de la Roche', r(PINOT, 10, 30), ['Clos Saint-Denis', 'Clos de Tart', 'Clos des Lambrays']),
  bgn('Chambolle-Musigny', r(PINOT, 6, 18)),
  bgn('Musigny', r(PINOT, 10, 30), ['Bonnes-Mares']),
  bgn('Vougeot', r(PINOT, 6, 18)),
  bgn('Clos de Vougeot', r(PINOT, 10, 25), ['Clos Vougeot']),
  bgn('Vosne-Romanée', r(PINOT, 7, 20)),
  bgn('Échezeaux', r(PINOT, 10, 25), ['Grands Échezeaux', 'Richebourg', 'Romanée-Saint-Vivant', 'La Tâche']),
  bgn('Nuits-Saint-Georges', r(PINOT, 6, 18)),
  bgn('Côte de Nuits-Villages', r(PINOT, 4, 12)),
  bgn('Ladoix', { rouge: [PINOT, 4, 12], blanc: [CHARDO, 3, 8] }),
  bgn('Aloxe-Corton', r(PINOT, 5, 15)),
  bgn('Corton', r(PINOT, 8, 25)),
  bgn('Corton-Charlemagne', b(CHARDO, 7, 20)),
  bgn('Pernand-Vergelesses', { rouge: [PINOT, 4, 12], blanc: [CHARDO, 3, 10] }),
  bgn('Savigny-lès-Beaune', { rouge: [PINOT, 4, 12], blanc: [CHARDO, 3, 8] }),
  bgn('Chorey-lès-Beaune', r(PINOT, 3, 8)),
  bgn('Beaune', { rouge: [PINOT, 5, 15], blanc: [CHARDO, 3, 10] }),
  bgn('Pommard', r(PINOT, 6, 18)),
  bgn('Volnay', r(PINOT, 5, 15)),
  bgn('Monthélie', { rouge: [PINOT, 4, 12], blanc: [CHARDO, 3, 8] }),
  bgn('Auxey-Duresses', { rouge: [PINOT, 4, 12], blanc: [CHARDO, 3, 8] }),
  bgn('Saint-Romain', { blanc: [CHARDO, 3, 8], rouge: [PINOT, 3, 8] }),
  bgn('Meursault', b(CHARDO, 4, 12)),
  bgn('Puligny-Montrachet', b(CHARDO, 5, 15)),
  bgn('Chassagne-Montrachet', { blanc: [CHARDO, 5, 15], rouge: [PINOT, 4, 12] }),
  bgn('Montrachet', b(CHARDO, 10, 30), ['Le Montrachet']),
  bgn('Bâtard-Montrachet', b(CHARDO, 8, 25), ['Chevalier-Montrachet', 'Bienvenues-Bâtard-Montrachet']),
  bgn('Saint-Aubin', { blanc: [CHARDO, 3, 10], rouge: [PINOT, 3, 8] }),
  bgn('Santenay', { rouge: [PINOT, 4, 12], blanc: [CHARDO, 3, 8] }),
  bgn('Maranges', r(PINOT, 4, 10)),
  bgn('Côte de Beaune-Villages', r(PINOT, 3, 10)),
  bgn('Rully', { blanc: [CHARDO, 2, 7], rouge: [PINOT, 3, 8] }),
  bgn('Mercurey', { rouge: [PINOT, 4, 12], blanc: [CHARDO, 3, 8] }),
  bgn('Givry', { rouge: [PINOT, 4, 10], blanc: [CHARDO, 2, 7] }),
  bgn('Montagny', b(CHARDO, 2, 7)),
  bgn('Bouzeron', b(['Aligoté'], 1, 5)),
  bgn('Mâcon', { blanc: [CHARDO, 1, 4], rouge: [GAMAY, 1, 4] }),
  bgn('Mâcon-Villages', b(CHARDO, 1, 5)),
  bgn('Pouilly-Fuissé', b(CHARDO, 3, 10)),
  bgn('Pouilly-Vinzelles', b(CHARDO, 2, 7), ['Pouilly-Loché']),
  bgn('Saint-Véran', b(CHARDO, 2, 6)),
  bgn('Viré-Clessé', b(CHARDO, 2, 7)),
  bulles('Crémant de Bourgogne', 'Bourgogne', b(['Chardonnay', 'Pinot noir'], 0, 4)),

  /* ============================ BEAUJOLAIS ============================ */
  bjl('Beaujolais', 0, 3),
  bjl('Beaujolais Nouveau', 0, 1),
  bjl('Beaujolais-Villages', 1, 4),
  bjl('Brouilly', 2, 6),
  bjl('Côte de Brouilly', 3, 8),
  bjl('Chénas', 3, 10),
  bjl('Chiroubles', 1, 5),
  bjl('Fleurie', 2, 8),
  bjl('Juliénas', 3, 8),
  bjl('Morgon', 3, 10),
  bjl('Moulin-à-Vent', 4, 12),
  bjl('Régnié', 2, 5),
  bjl('Saint-Amour', 2, 6),

  /* ============================ VALLÉE DU RHÔNE ============================ */
  rho('Côte-Rôtie', r(['Syrah', 'Viognier'], 6, 20)),
  rho('Condrieu', b(['Viognier'], 1, 5)),
  rho('Château-Grillet', b(['Viognier'], 3, 10)),
  rho('Saint-Joseph', { rouge: [SYRAH, 4, 12], blanc: [MARS_ROUS, 2, 7] }),
  rho('Crozes-Hermitage', { rouge: [SYRAH, 3, 10], blanc: [MARS_ROUS, 2, 6] }),
  rho('Hermitage', { rouge: [SYRAH, 10, 30], blanc: [MARS_ROUS, 5, 20] }, ['Ermitage']),
  rho('Cornas', r(SYRAH, 7, 20)),
  rho('Saint-Péray', b(MARS_ROUS, 2, 6)),
  rho('Côtes du Rhône', { rouge: [GSM, 1, 5], blanc: [RHONE_BLANC, 1, 3], rose: [GSM, 0, 2] }),
  rho('Côtes du Rhône Villages', r(GSM, 2, 7)),
  rho('Châteauneuf-du-Pape', {
    rouge: [['Grenache', 'Syrah', 'Mourvèdre', 'Cinsault'], 5, 18],
    blanc: [['Grenache blanc', 'Roussanne', 'Clairette', 'Bourboulenc'], 2, 8],
  }),
  rho('Gigondas', r(GSM, 5, 15)),
  rho('Vacqueyras', r(GSM, 4, 12)),
  rho('Rasteau', r(GSM, 4, 12)),
  rho('Cairanne', r(GSM, 3, 10)),
  rho('Vinsobres', r(GSM, 3, 10)),
  rho('Lirac', { rouge: [GSM, 3, 10], blanc: [RHONE_BLANC, 1, 4], rose: [GSM, 0, 2] }),
  rho('Tavel', { rose: [['Grenache', 'Cinsault', 'Syrah'], 0, 3] }),
  rho('Beaumes-de-Venise', r(GSM, 3, 10)),
  rho('Muscat de Beaumes-de-Venise', liq(['Muscat à petits grains'], 0, 6)),
  rho('Ventoux', { rouge: [RHONE_SUD, 1, 5], rose: [RHONE_SUD, 0, 2] }, ['Côtes du Ventoux']),
  rho('Luberon', { rouge: [RHONE_SUD, 1, 5], blanc: [RHONE_BLANC, 1, 3], rose: [RHONE_SUD, 0, 2] }, [
    'Côtes du Luberon',
  ]),
  rho('Costières de Nîmes', { rouge: [RHONE_SUD, 2, 6], rose: [RHONE_SUD, 0, 2] }),
  rho('Grignan-les-Adhémar', r(GSM, 2, 6)),

  /* ============================ VALLÉE DE LA LOIRE ============================ */
  loi('Sancerre', { blanc: [SAUV, 1, 6], rouge: [PINOT, 2, 6], rose: [PINOT, 0, 2] }),
  loi('Pouilly-Fumé', b(SAUV, 2, 7), ['Blanc Fumé de Pouilly']),
  loi('Menetou-Salon', { blanc: [SAUV, 1, 5], rouge: [PINOT, 2, 5] }),
  loi('Quincy', b(SAUV, 1, 4)),
  loi('Reuilly', { blanc: [SAUV, 1, 4], rouge: [PINOT, 1, 4] }),
  loi('Touraine', { blanc: [SAUV, 1, 3], rouge: [['Gamay', 'Cabernet franc', 'Côt'], 1, 4] }),
  loi('Cheverny', { blanc: [['Sauvignon blanc', 'Chardonnay'], 1, 3], rouge: [['Pinot noir', 'Gamay'], 1, 4] }),
  loi('Chinon', r(CAB_FRANC, 3, 12)),
  loi('Bourgueil', r(CAB_FRANC, 3, 12)),
  loi('Saint-Nicolas-de-Bourgueil', r(CAB_FRANC, 2, 8)),
  loi('Saumur-Champigny', r(CAB_FRANC, 2, 8)),
  loi('Saumur', { rouge: [CAB_FRANC, 2, 6], blanc: [CHENIN, 2, 7] }),
  loi('Anjou', { rouge: [CAB_FRANC, 2, 6], blanc: [CHENIN, 2, 7] }),
  loi('Rosé d\'Anjou', { rose: [['Grolleau', 'Cabernet franc'], 0, 2] }),
  loi('Cabernet d\'Anjou', { rose: [['Cabernet franc', 'Cabernet Sauvignon'], 0, 3] }),
  loi('Savennières', b(CHENIN, 4, 15)),
  loi('Vouvray', b(CHENIN, 3, 15)),
  loi('Montlouis-sur-Loire', b(CHENIN, 3, 12), ['Montlouis']),
  loi('Coteaux du Layon', liq(CHENIN, 5, 25)),
  loi('Quarts de Chaume', liq(CHENIN, 8, 40)),
  loi('Bonnezeaux', liq(CHENIN, 8, 40)),
  loi('Muscadet', b(MELON, 1, 4), ['Muscadet Sèvre et Maine', 'Muscadet Sèvre-et-Maine sur lie']),
  bulles('Crémant de Loire', 'Vallée de la Loire', b(['Chenin blanc', 'Chardonnay'], 0, 4)),

  /* ============================ ALSACE ============================ */
  als('Alsace', b(['Riesling', 'Pinot blanc', 'Sylvaner', 'Gewurztraminer'], 1, 5), ['Vin d\'Alsace']),
  als('Alsace Riesling', b(RIESLING, 2, 10), ['Riesling d\'Alsace']),
  als('Alsace Gewurztraminer', b(['Gewurztraminer'], 2, 8), ['Gewurztraminer d\'Alsace']),
  als('Alsace Pinot Gris', b(['Pinot gris'], 2, 8), ['Pinot Gris d\'Alsace']),
  als('Alsace Pinot Blanc', b(['Pinot blanc'], 1, 4)),
  als('Alsace Sylvaner', b(['Sylvaner'], 1, 4)),
  als('Alsace Muscat', b(['Muscat'], 1, 4)),
  als('Alsace Pinot Noir', r(PINOT, 2, 7)),
  als('Alsace Grand Cru', b(['Riesling', 'Gewurztraminer', 'Pinot gris', 'Muscat'], 4, 15)),
  als('Alsace Vendanges Tardives', liq(['Gewurztraminer', 'Riesling', 'Pinot gris'], 5, 20), ['Vendanges Tardives']),
  als(
    'Alsace Sélection de Grains Nobles',
    liq(['Gewurztraminer', 'Riesling', 'Pinot gris'], 8, 30),
    ['Sélection de Grains Nobles'],
  ),
  bulles('Crémant d\'Alsace', 'Alsace', b(['Pinot blanc', 'Riesling', 'Chardonnay'], 0, 3)),

  /* ============================ CHAMPAGNE ============================ */
  bulles('Champagne', 'Champagne', { blanc: [CHAMPENOIS, 4, 15], rose: [CHAMPENOIS, 3, 10] }),

  /* ============================ LANGUEDOC-ROUSSILLON ============================ */
  lgd('Languedoc', { rouge: [LANGUEDOC, 2, 6], blanc: [RHONE_BLANC, 1, 3], rose: [LANGUEDOC, 0, 2] }, [
    'Coteaux du Languedoc',
  ]),
  lgd('Corbières', r(LANGUEDOC, 3, 8)),
  lgd('Minervois', r(LANGUEDOC, 3, 8)),
  lgd('Minervois-La Livinière', r(LANGUEDOC, 4, 12)),
  lgd('Fitou', r(['Carignan', 'Grenache', 'Syrah'], 3, 8)),
  lgd('Saint-Chinian', r(LANGUEDOC, 3, 8)),
  lgd('Faugères', r(LANGUEDOC, 3, 10)),
  lgd('Pic Saint-Loup', r(GSM, 3, 10)),
  lgd('Terrasses du Larzac', r(LANGUEDOC, 4, 12)),
  lgd('La Clape', { rouge: [GSM, 3, 10], blanc: [['Bourboulenc', 'Grenache blanc'], 2, 6] }),
  lgd('Picpoul de Pinet', b(['Piquepoul'], 0, 3)),
  lgd('Limoux', b(['Chardonnay', 'Mauzac', 'Chenin blanc'], 2, 6)),
  bulles('Blanquette de Limoux', 'Languedoc-Roussillon', b(['Mauzac'], 0, 3)),
  bulles('Crémant de Limoux', 'Languedoc-Roussillon', b(['Chardonnay', 'Chenin blanc', 'Mauzac'], 0, 4)),
  lgd('Côtes du Roussillon', { rouge: [LANGUEDOC, 2, 6], rose: [LANGUEDOC, 0, 2] }),
  lgd('Côtes du Roussillon Villages', r(LANGUEDOC, 3, 10)),
  lgd('Collioure', { rouge: [GSM, 3, 10], rose: [GSM, 0, 2] }),
  lgd('Banyuls', r(['Grenache'], 5, 30)),
  lgd('Maury', r(['Grenache'], 5, 25)),
  lgd('Rivesaltes', liq(['Grenache blanc', 'Macabeu', 'Muscat'], 5, 40)),
  lgd('Muscat de Rivesaltes', liq(['Muscat à petits grains', 'Muscat d\'Alexandrie'], 0, 5)),
  lgd('Pays d\'Oc', { rouge: [['Merlot', 'Cabernet Sauvignon', 'Syrah'], 1, 4], blanc: [['Chardonnay', 'Viognier'], 1, 3], rose: [['Grenache', 'Cinsault'], 0, 2] }, [
    'Vin de Pays d\'Oc',
    'IGP Pays d\'Oc',
  ]),

  /* ============================ PROVENCE ET CORSE ============================ */
  prv('Côtes de Provence', {
    rose: [PROVENCE_ROSE, 0, 2],
    rouge: [['Syrah', 'Grenache', 'Mourvèdre'], 2, 6],
    blanc: [['Rolle', 'Clairette'], 1, 3],
  }),
  prv('Coteaux d\'Aix-en-Provence', { rose: [PROVENCE_ROSE, 0, 2], rouge: [['Grenache', 'Syrah', 'Cabernet Sauvignon'], 2, 6] }),
  prv('Coteaux Varois en Provence', { rose: [PROVENCE_ROSE, 0, 2], rouge: [GSM, 2, 6] }, ['Coteaux Varois']),
  prv('Bandol', {
    rouge: [['Mourvèdre', 'Grenache', 'Cinsault'], 6, 20],
    rose: [['Mourvèdre', 'Grenache', 'Cinsault'], 1, 4],
    blanc: [['Clairette', 'Ugni blanc', 'Bourboulenc'], 1, 4],
  }),
  prv('Cassis', b(['Marsanne', 'Clairette'], 1, 4)),
  prv('Les Baux-de-Provence', { rouge: [['Grenache', 'Syrah', 'Cabernet Sauvignon'], 3, 10], rose: [PROVENCE_ROSE, 0, 2] }),
  prv('Palette', { rouge: [['Grenache', 'Mourvèdre', 'Cinsault'], 4, 12], blanc: [['Clairette'], 3, 10] }),
  prv('Bellet', { rouge: [['Folle noire', 'Braquet'], 3, 8], blanc: [['Rolle'], 2, 6] }),
  ap('Patrimonio', 'Corse', 'bordeaux', {
    rouge: [['Nielluccio'], 3, 10],
    blanc: [['Vermentino'], 1, 4],
    rose: [['Nielluccio'], 0, 2],
  }),
  ap('Ajaccio', 'Corse', 'bordeaux', { rouge: [['Sciaccarello'], 3, 8], rose: [['Sciaccarello'], 0, 2] }),
  ap('Vin de Corse', 'Corse', 'bordeaux', {
    rouge: [['Nielluccio', 'Sciaccarello', 'Grenache'], 2, 6],
    rose: [['Sciaccarello', 'Nielluccio'], 0, 2],
    blanc: [['Vermentino'], 1, 3],
  }, { alias: ['Corse'] }),
  ap('Muscat du Cap Corse', 'Corse', 'bordeaux', liq(['Muscat à petits grains'], 0, 6)),

  /* ============================ SUD-OUEST ============================ */
  sow('Cahors', r(['Malbec', 'Merlot', 'Tannat'], 5, 15)),
  sow('Madiran', r(['Tannat', 'Cabernet franc', 'Cabernet Sauvignon'], 6, 18)),
  sow('Pacherenc du Vic-Bilh', liq(MANSENG, 3, 12)),
  sow('Jurançon', liq(MANSENG, 4, 20)),
  sow('Jurançon Sec', b(['Gros Manseng', 'Petit Manseng'], 2, 7)),
  sow('Bergerac', { rouge: [BDX_ROUGE, 2, 6], blanc: [BDX_BLANC, 1, 4], rose: [BDX_ROUGE, 0, 2] }),
  sow('Côtes de Bergerac', r(BDX_ROUGE, 3, 8)),
  sow('Pécharmant', r(BDX_ROUGE, 4, 12)),
  sow('Monbazillac', liq(SAUTERNAIS, 5, 20)),
  sow('Saussignac', liq(SAUTERNAIS, 5, 20)),
  sow('Gaillac', { rouge: [['Braucol', 'Duras', 'Syrah'], 2, 7], blanc: [['Mauzac', 'Len de l\'El'], 1, 4] }),
  sow('Fronton', r(['Négrette'], 2, 6)),
  sow('Irouléguy', { rouge: [['Tannat', 'Cabernet franc'], 3, 10], blanc: [MANSENG, 2, 6] }),
  sow('Buzet', r(BDX_ROUGE, 3, 8)),
  sow('Saint-Mont', r(['Tannat', 'Cabernet Sauvignon', 'Pinenc'], 3, 8)),
  sow('Marcillac', r(['Fer Servadou'], 2, 6)),
  sow('Côtes de Duras', { rouge: [BDX_ROUGE, 2, 6], blanc: [BDX_BLANC, 1, 3] }),
  sow('Côtes du Marmandais', r(['Merlot', 'Cabernet franc', 'Abouriou'], 2, 6)),
  sow('Côtes de Gascogne', b(['Colombard', 'Ugni blanc', 'Gros Manseng'], 0, 2), ['IGP Côtes de Gascogne']),

  /* ============================ JURA ET SAVOIE ============================ */
  ap('Arbois', 'Jura', 'bourgogne', {
    rouge: [['Poulsard', 'Trousseau', 'Pinot noir'], 2, 8],
    blanc: [['Chardonnay', 'Savagnin'], 3, 10],
  }),
  ap('Côtes du Jura', 'Jura', 'bourgogne', {
    blanc: [['Chardonnay', 'Savagnin'], 3, 10],
    rouge: [['Poulsard', 'Trousseau', 'Pinot noir'], 2, 8],
  }),
  ap('L\'Étoile', 'Jura', 'bourgogne', b(['Chardonnay', 'Savagnin'], 3, 10)),
  ap('Château-Chalon', 'Jura', 'autre', b(['Savagnin'], 10, 50)),
  ap('Vin Jaune', 'Jura', 'autre', b(['Savagnin'], 10, 50), { alias: ['Arbois Vin Jaune', 'Côtes du Jura Vin Jaune'] }),
  ap('Vin de Paille', 'Jura', 'autre', liq(['Savagnin', 'Chardonnay', 'Poulsard'], 5, 30)),
  bulles('Crémant du Jura', 'Jura', b(['Chardonnay'], 0, 4)),
  ap('Vin de Savoie', 'Savoie', 'bourgogne', {
    blanc: [['Jacquère', 'Altesse'], 1, 4],
    rouge: [['Mondeuse', 'Gamay'], 2, 6],
  }, { alias: ['Savoie', 'Apremont', 'Chignin'] }),
  ap('Roussette de Savoie', 'Savoie', 'bourgogne', b(['Altesse'], 2, 6)),
  ap('Bugey', 'Savoie', 'bourgogne', { blanc: [['Chardonnay'], 1, 4], rouge: [['Gamay', 'Mondeuse'], 1, 4] }),

  /* ============================ ITALIE ============================ */
  ita('Barolo', 'Piémont', 'bordeaux', r(NEBBIOLO, 8, 25)),
  ita('Barbaresco', 'Piémont', 'bordeaux', r(NEBBIOLO, 6, 20)),
  ita('Langhe', 'Piémont', 'bordeaux', r(NEBBIOLO, 3, 8), ['Langhe Nebbiolo', 'Nebbiolo d\'Alba']),
  ita('Barbera d\'Asti', 'Piémont', 'bordeaux', r(['Barbera'], 2, 8), ['Barbera d\'Alba']),
  ita('Dolcetto d\'Alba', 'Piémont', 'bordeaux', r(['Dolcetto'], 1, 4)),
  ita('Gavi', 'Piémont', 'bordeaux', b(['Cortese'], 1, 4)),
  ita('Moscato d\'Asti', 'Piémont', 'champagne', liq(['Moscato bianco'], 0, 2), ['Asti']),
  ita('Chianti', 'Toscane', 'bordeaux', r(SANGIOVESE, 2, 6)),
  ita('Chianti Classico', 'Toscane', 'bordeaux', r(SANGIOVESE, 4, 12)),
  ita('Brunello di Montalcino', 'Toscane', 'bordeaux', r(SANGIOVESE, 8, 25)),
  ita('Rosso di Montalcino', 'Toscane', 'bordeaux', r(SANGIOVESE, 3, 8)),
  ita('Vino Nobile di Montepulciano', 'Toscane', 'bordeaux', r(SANGIOVESE, 5, 15)),
  ita('Bolgheri', 'Toscane', 'bordeaux', r(['Cabernet Sauvignon', 'Merlot', 'Cabernet franc'], 5, 18)),
  ita('Toscana', 'Toscane', 'bordeaux', r(['Sangiovese', 'Cabernet Sauvignon', 'Merlot'], 3, 12), ['Toscana IGT']),
  ita('Montepulciano d\'Abruzzo', 'Abruzzes', 'bordeaux', r(['Montepulciano'], 2, 7)),
  ita('Amarone della Valpolicella', 'Vénétie', 'bordeaux', r(['Corvina', 'Rondinella', 'Molinara'], 8, 25), ['Amarone']),
  ita('Valpolicella', 'Vénétie', 'bordeaux', r(['Corvina', 'Rondinella'], 1, 5)),
  ita('Valpolicella Ripasso', 'Vénétie', 'bordeaux', r(['Corvina', 'Rondinella'], 3, 10), ['Ripasso']),
  ita('Soave', 'Vénétie', 'bordeaux', b(['Garganega'], 1, 4)),
  ita('Pinot Grigio delle Venezie', 'Vénétie', 'bordeaux', b(['Pinot gris'], 0, 3), ['Pinot Grigio']),
  ap('Prosecco', 'Vénétie', 'champagne', b(['Glera'], 0, 2), { pays: 'Italie', effervescent: true }),
  ap('Franciacorta', 'Lombardie', 'champagne', b(['Chardonnay', 'Pinot noir'], 2, 8), { pays: 'Italie', effervescent: true }),
  ap('Lambrusco', 'Émilie-Romagne', 'champagne', r(['Lambrusco'], 0, 2), { pays: 'Italie', effervescent: true }),
  ita('Etna', 'Sicile', 'bourgogne', { rouge: [['Nerello Mascalese'], 3, 10], blanc: [['Carricante'], 2, 7] }),
  ita('Primitivo di Manduria', 'Pouilles', 'bordeaux', r(['Primitivo'], 2, 7)),
  ita('Taurasi', 'Campanie', 'bordeaux', r(['Aglianico'], 6, 20)),

  /* ============================ ESPAGNE ET PORTUGAL ============================ */
  esp('Rioja', 'La Rioja', { rouge: [TEMPRANILLO, 4, 15], blanc: [['Viura'], 1, 6] }),
  esp('Ribera del Duero', 'Castille-et-León', r(['Tempranillo'], 5, 18)),
  esp('Toro', 'Castille-et-León', r(['Tempranillo'], 4, 12)),
  esp('Bierzo', 'Castille-et-León', r(['Mencía'], 3, 10)),
  esp('Rueda', 'Castille-et-León', b(['Verdejo'], 0, 3)),
  esp('Priorat', 'Catalogne', r(['Garnacha', 'Cariñena'], 5, 15)),
  esp('Penedès', 'Catalogne', { rouge: [['Tempranillo', 'Cabernet Sauvignon'], 2, 8], blanc: [['Xarel·lo', 'Macabeo'], 1, 3] }),
  esp('Rías Baixas', 'Galice', b(['Albariño'], 1, 4)),
  esp('Navarra', 'Navarre', { rouge: [['Garnacha', 'Tempranillo'], 2, 7], rose: [['Garnacha'], 0, 2] }),
  esp('Jerez', 'Andalousie', b(['Palomino'], 0, 10), ['Xérès', 'Sherry']),
  ap('Cava', 'Catalogne', 'champagne', b(['Macabeo', 'Xarel·lo', 'Parellada'], 0, 4), { pays: 'Espagne', effervescent: true }),
  ap('Porto', 'Douro', 'bordeaux', r(DOURO, 15, 50), { pays: 'Portugal', alias: ['Port', 'Vinho do Porto'] }),
  ap('Douro', 'Douro', 'bordeaux', r(DOURO, 4, 15), { pays: 'Portugal' }),
  ap('Dão', 'Dão', 'bordeaux', r(['Touriga Nacional', 'Tinta Roriz'], 3, 10), { pays: 'Portugal' }),
  ap('Alentejo', 'Alentejo', 'bordeaux', r(['Aragonez', 'Trincadeira', 'Alicante Bouschet'], 2, 8), { pays: 'Portugal' }),
  ap('Vinho Verde', 'Minho', 'bordeaux', b(['Alvarinho', 'Loureiro'], 0, 2), { pays: 'Portugal' }),
  ap('Madère', 'Madère', 'bordeaux', liq(['Malvoisie', 'Boal', 'Verdelho', 'Sercial'], 5, 80), { pays: 'Portugal', alias: ['Madeira'] }),

  /* ============================ ALLEMAGNE, AUTRICHE, HONGRIE ============================ */
  ap('Mosel', 'Moselle', 'autre', b(RIESLING, 3, 15), { pays: 'Allemagne', alias: ['Moselle', 'Mosel-Saar-Ruwer'] }),
  ap('Rheingau', 'Rheingau', 'autre', b(RIESLING, 3, 15), { pays: 'Allemagne' }),
  ap('Pfalz', 'Palatinat', 'autre', b(RIESLING, 2, 10), { pays: 'Allemagne', alias: ['Palatinat'] }),
  ap('Nahe', 'Nahe', 'autre', b(RIESLING, 3, 12), { pays: 'Allemagne' }),
  ap('Rheinhessen', 'Hesse rhénane', 'autre', b(RIESLING, 2, 8), { pays: 'Allemagne' }),
  ap('Wachau', 'Basse-Autriche', 'autre', b(['Grüner Veltliner', 'Riesling'], 2, 10), { pays: 'Autriche' }),
  ap('Kamptal', 'Basse-Autriche', 'autre', b(['Grüner Veltliner', 'Riesling'], 2, 8), { pays: 'Autriche' }),
  ap('Burgenland', 'Burgenland', 'bordeaux', r(['Blaufränkisch', 'Zweigelt'], 3, 10), { pays: 'Autriche' }),
  ap('Tokaj', 'Tokaj', 'autre', liq(['Furmint', 'Hárslevelű'], 5, 40), { pays: 'Hongrie', alias: ['Tokaji', 'Tokay'] }),

  /* ============================ NOUVEAU MONDE ET AUTRES ============================ */
  ap('Napa Valley', 'Californie', 'bordeaux', {
    rouge: [['Cabernet Sauvignon', 'Merlot'], 5, 20],
    blanc: [CHARDO, 2, 7],
  }, { pays: 'États-Unis', alias: ['Napa'] }),
  ap('Sonoma', 'Californie', 'bourgogne', {
    rouge: [['Pinot noir', 'Zinfandel'], 3, 10],
    blanc: [CHARDO, 2, 7],
  }, { pays: 'États-Unis', alias: ['Sonoma Coast', 'Sonoma County', 'Russian River Valley'] }),
  ap('Willamette Valley', 'Oregon', 'bourgogne', r(PINOT, 4, 12), { pays: 'États-Unis' }),
  ap('Mendoza', 'Mendoza', 'bordeaux', r(['Malbec', 'Cabernet Sauvignon'], 3, 12), { pays: 'Argentine' }),
  ap('Maipo', 'Vallée centrale', 'bordeaux', r(['Cabernet Sauvignon', 'Carménère'], 4, 12), { pays: 'Chili', alias: ['Valle del Maipo'] }),
  ap('Colchagua', 'Vallée centrale', 'bordeaux', r(['Carménère', 'Cabernet Sauvignon', 'Syrah'], 3, 10), { pays: 'Chili' }),
  ap('Marlborough', 'Marlborough', 'bourgogne', {
    blanc: [SAUV, 0, 3],
    rouge: [PINOT, 2, 7],
  }, { pays: 'Nouvelle-Zélande' }),
  ap('Central Otago', 'Otago', 'bourgogne', r(PINOT, 3, 10), { pays: 'Nouvelle-Zélande' }),
  ap('Barossa Valley', 'Australie-Méridionale', 'bordeaux', r(['Shiraz'], 5, 18), { pays: 'Australie', alias: ['Barossa'] }),
  ap('Coonawarra', 'Australie-Méridionale', 'bordeaux', r(['Cabernet Sauvignon'], 5, 18), { pays: 'Australie' }),
  ap('Margaret River', 'Australie-Occidentale', 'bordeaux', {
    rouge: [['Cabernet Sauvignon', 'Merlot'], 5, 15],
    blanc: [CHARDO, 2, 8],
  }, { pays: 'Australie' }),
  ap('Stellenbosch', 'Le Cap', 'bordeaux', {
    rouge: [['Cabernet Sauvignon', 'Pinotage', 'Syrah'], 4, 12],
    blanc: [CHENIN, 1, 5],
  }, { pays: 'Afrique du Sud' }),
  ap('Vallée de la Bekaa', 'Bekaa', 'bordeaux', r(['Cabernet Sauvignon', 'Cinsault', 'Carignan'], 5, 20), { pays: 'Liban', alias: ['Bekaa', 'Bekaa Valley'] }),
];
