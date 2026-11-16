/**
 * Règles locales d'accords mets-vin : familles de plats reconnues par mots-clés,
 * note de base par profil de vin, bonus pour les accords régionaux classiques.
 */

/** Profils de vin, dans l'ordre des colonnes de `scores`. */
export const PROFILES = [
  'rougeLeger',
  'rougeMoyen',
  'rougePuissant',
  'blancVif',
  'blancRond',
  'blancAromatique',
  'liquoreux',
  'rose',
  'bulles',
  'rougeDoux',
] as const;
export type Profile = (typeof PROFILES)[number];

export const PROFILE_LABELS: Record<Profile, string> = {
  rougeLeger: 'rouge léger et fruité',
  rougeMoyen: 'rouge souple et rond',
  rougePuissant: 'rouge charpenté',
  blancVif: 'blanc sec et vif',
  blancRond: 'blanc ample',
  blancAromatique: 'blanc aromatique',
  liquoreux: 'blanc liquoreux',
  rose: 'rosé',
  bulles: 'vin effervescent',
  rougeDoux: 'vin doux naturel',
};

export interface DishRule {
  id: string;
  /** Complément de phrase : « … va bien avec {label} ». */
  label: string;
  /**
   * Mots-clés normalisés (sans accents, minuscules). Un mot-clé correspond au DÉBUT d'un mot
   * du plat (« agneau » reconnaît « agneaux ») ; terminé par `$`, il exige le mot entier.
   */
  mots: string[];
  /** Note de base (0–100) pour chaque profil, dans l'ordre de `PROFILES`. */
  scores: [number, number, number, number, number, number, number, number, number, number];
  /** Bonus : motif cherché dans « appellation région pays cépages » (normalisé) → points. */
  bonus?: [string, number][];
}

//                                                  rL  rM  rP  bV  bR  bA  liq ros bul rDx
export const DISH_RULES: DishRule[] = [
  {
    id: 'boeuf',
    label: 'le bœuf et les viandes rouges grillées',
    mots: ['boeuf', 'entrecote', 'steak', 'bavette', 'onglet', 'rumsteck', 'tournedos', 'faux filet', 'viande rouge', 'burger', 'hamburger', 'rosbif', 'chateaubriand', 'cote a l os'],
    scores: [68, 84, 92, 20, 30, 15, 5, 45, 30, 15],
    bonus: [['medoc', 5], ['pauillac', 5], ['saint julien', 5], ['margaux', 5], ['saint estephe', 5], ['cahors', 4], ['madiran', 4], ['cabernet sauvignon', 3], ['malbec', 4]],
  },
  {
    id: 'agneau',
    label: 'l\'agneau',
    mots: ['agneau', 'gigot', 'navarin', 'mouton', 'mechoui'],
    scores: [62, 84, 93, 18, 28, 12, 5, 45, 28, 12],
    bonus: [['pauillac', 7], ['medoc', 5], ['saint julien', 5], ['bandol', 5], ['rioja', 4], ['chateauneuf', 4], ['ribera', 4]],
  },
  {
    id: 'gibier',
    label: 'le gibier',
    mots: ['gibier', 'chevreuil', 'sanglier', 'cerf', 'biche', 'lievre', 'faisan', 'perdrix', 'perdreau', 'civet', 'marcassin', 'venaison', 'becasse', 'colvert', 'pigeon'],
    scores: [60, 80, 93, 10, 22, 12, 5, 25, 25, 20],
    bonus: [['cote rotie', 6], ['hermitage', 6], ['cornas', 6], ['chateauneuf', 5], ['gigondas', 5], ['bourgogne', 6], ['barolo', 5], ['madiran', 4], ['cahors', 4], ['pomerol', 4], ['bandol', 4]],
  },
  {
    id: 'canard',
    label: 'le canard',
    mots: ['canard', 'magret', 'confit', 'aiguillette', 'oie'],
    scores: [70, 86, 86, 15, 30, 25, 20, 45, 30, 25],
    bonus: [['sud ouest', 6], ['saint emilion', 5], ['pomerol', 5], ['bourgogne', 3], ['cahors', 2], ['madiran', 2]],
  },
  {
    id: 'cassoulet',
    label: 'le cassoulet et les plats roboratifs du Sud-Ouest',
    mots: ['cassoulet', 'garbure', 'saucisse de toulouse', 'haricots tarbais'],
    scores: [50, 84, 90, 10, 22, 10, 5, 40, 22, 5],
    bonus: [['sud ouest', 7], ['cahors', 3], ['madiran', 3], ['corbieres', 7], ['minervois', 7], ['fitou', 6], ['languedoc', 4]],
  },
  {
    id: 'mijote',
    label: 'les plats mijotés et en sauce au vin',
    mots: ['bourguignon', 'daube', 'coq au vin', 'pot au feu', 'ragout', 'mijote', 'braise', 'joue de', 'carbonade', 'estouffade', 'gardiane', 'paleron', 'queue de boeuf', 'osso buco'],
    scores: [65, 88, 88, 10, 25, 10, 5, 30, 20, 10],
    bonus: [['bourgogne', 6], ['vallee du rhone', 5], ['languedoc', 4], ['beaujolais', 3]],
  },
  {
    id: 'volaille',
    label: 'la volaille rôtie',
    mots: ['poulet', 'volaille', 'pintade', 'dinde', 'poularde', 'coquelet', 'poule$', 'caille'],
    scores: [82, 78, 58, 60, 86, 55, 15, 62, 60, 5],
    bonus: [['bourgogne', 5], ['beaujolais', 5], ['chardonnay', 3], ['jura', 3]],
  },
  {
    id: 'fetes',
    label: 'les volailles de fête',
    mots: ['chapon', 'marron', 'noel', 'reveillon', 'fetes$'],
    scores: [78, 84, 72, 40, 86, 45, 20, 35, 80, 10],
    bonus: [['bourgogne', 6], ['saint emilion', 5], ['pomerol', 5], ['champagne', 4]],
  },
  {
    id: 'creme',
    label: 'les plats à la crème',
    mots: ['blanquette', 'a la creme', 'sauce creme', 'vol au vent', 'fricassee', 'bouchee a la reine', 'sauce supreme', 'vin jaune'],
    scores: [55, 50, 30, 62, 92, 60, 15, 45, 60, 5],
    bonus: [['bourgogne', 5], ['jura', 7], ['chenin', 3], ['savagnin', 5]],
  },
  {
    id: 'veau',
    label: 'le veau',
    mots: ['veau', 'escalope', 'saltimbocca', 'paupiette'],
    scores: [80, 82, 60, 50, 85, 45, 10, 55, 50, 5],
    bonus: [['bourgogne', 4], ['italie', 3]],
  },
  {
    id: 'lapin',
    label: 'le lapin et les viandes blanches à la moutarde',
    mots: ['lapin', 'moutarde'],
    scores: [82, 80, 50, 55, 80, 45, 5, 55, 50, 0],
    bonus: [['bourgogne', 5], ['vallee de la loire', 4], ['beaujolais', 4]],
  },
  {
    id: 'porc',
    label: 'le porc et la charcuterie',
    mots: ['porc', 'filet mignon', 'charcuterie', 'saucisson', 'jambon', 'terrine', 'pate$', 'pate en croute', 'rillettes', 'saucisse', 'boudin blanc', 'lard', 'travers', 'echine', 'jarret', 'petit sale', 'cochon', 'potee'],
    scores: [86, 80, 55, 55, 62, 50, 10, 72, 60, 5],
    bonus: [['beaujolais', 7], ['chinon', 5], ['bourgueil', 5], ['saumur', 5], ['alsace', 3]],
  },
  {
    id: 'abats',
    label: 'les abats et l\'andouillette',
    mots: ['tripes', 'andouillette', 'rognon', 'foie de veau', 'langue', 'tete de veau', 'boudin noir', 'abats', 'pieds paquets', 'ris de veau'],
    scores: [84, 78, 55, 62, 68, 40, 5, 50, 45, 0],
    bonus: [['beaujolais', 6], ['chablis', 5], ['vallee de la loire', 4], ['bourgogne', 3]],
  },
  {
    id: 'barbecue',
    label: 'les grillades et le barbecue',
    mots: ['barbecue', 'brochette', 'merguez', 'grillade', 'chipolata', 'plancha', 'ribs', 'kebab'],
    scores: [70, 88, 80, 30, 35, 25, 5, 85, 40, 0],
    bonus: [['languedoc', 5], ['cotes du rhone', 5], ['provence', 5], ['zinfandel', 5], ['malbec', 5], ['shiraz', 5], ['bandol', 3]],
  },
  {
    id: 'tartare',
    label: 'le tartare et le carpaccio',
    mots: ['tartare', 'carpaccio'],
    scores: [86, 72, 45, 50, 45, 30, 5, 78, 55, 0],
    bonus: [['beaujolais', 5], ['vallee de la loire', 5]],
  },
  {
    id: 'choucroute',
    label: 'la choucroute et les plats alsaciens',
    mots: ['choucroute', 'baeckeoffe', 'flammekueche', 'tarte flambee', 'alsacien'],
    scores: [45, 35, 15, 82, 70, 86, 10, 45, 60, 0],
    bonus: [['alsace', 12], ['riesling', 6], ['sylvaner', 4]],
  },
  {
    id: 'raclette',
    label: 'la raclette, la fondue et la tartiflette',
    mots: ['raclette', 'fondue', 'tartiflette', 'reblochon', 'croziflette'],
    scores: [62, 45, 20, 86, 75, 60, 5, 50, 62, 0],
    bonus: [['savoie', 12], ['jura', 7], ['jacquere', 5], ['chasselas', 5], ['aligote', 3]],
  },
  {
    id: 'poisson',
    label: 'le poisson',
    mots: ['poisson', 'bar$', 'dorade', 'daurade', 'sole', 'cabillaud', 'lieu', 'merlu', 'colin', 'turbot', 'lotte', 'truite', 'sandre', 'brochet', 'saint pierre', 'raie', 'fletan', 'loup de mer', 'rouget', 'merlan', 'limande', 'fish'],
    scores: [35, 20, 5, 90, 82, 62, 10, 62, 72, 0],
    bonus: [['sancerre', 5], ['pouilly fume', 5], ['chablis', 6], ['muscadet', 5], ['bourgogne', 4], ['cassis', 3], ['sauvignon', 3]],
  },
  {
    id: 'poisson-noble',
    label: 'les crustacés nobles et les poissons en sauce',
    mots: ['beurre blanc', 'homard', 'langouste', 'saint jacques', 'quenelle', 'sauce hollandaise', 'armoricaine', 'americaine'],
    scores: [20, 12, 5, 72, 94, 62, 15, 45, 80, 0],
    bonus: [['meursault', 7], ['puligny', 7], ['chassagne', 7], ['corton charlemagne', 7], ['bourgogne', 4], ['champagne', 5], ['savennieres', 4], ['vouvray', 4], ['condrieu', 4], ['pessac', 4]],
  },
  {
    id: 'poisson-gras',
    label: 'le saumon et les poissons gras',
    mots: ['saumon', 'thon', 'sardine', 'maquereau', 'anguille', 'hareng', 'espadon'],
    scores: [58, 30, 10, 84, 80, 62, 10, 72, 80, 0],
    bonus: [['champagne', 4], ['sancerre', 4], ['provence', 3], ['riesling', 4], ['pinot noir', 4]],
  },
  {
    id: 'fruits-de-mer',
    label: 'les fruits de mer',
    mots: ['fruits de mer', 'huitre', 'coquillage', 'crevette', 'langoustine', 'crabe', 'moule', 'bulot', 'palourde', 'gambas', 'tourteau', 'bigorneau', 'oursin', 'calamar', 'encornet', 'poulpe', 'seiche', 'coque$', 'coques$'],
    scores: [15, 8, 2, 95, 68, 50, 5, 55, 85, 0],
    bonus: [['muscadet', 7], ['chablis', 7], ['picpoul', 7], ['entre deux mers', 5], ['sancerre', 4], ['champagne', 5], ['albarino', 5], ['riesling', 3]],
  },
  {
    id: 'cru',
    label: 'les sushis et les poissons crus',
    mots: ['sushi', 'sashimi', 'maki', 'ceviche', 'poke', 'tataki', 'gravlax'],
    scores: [25, 10, 2, 88, 62, 75, 10, 62, 88, 0],
    bonus: [['champagne', 5], ['riesling', 6], ['sancerre', 3], ['gruner veltliner', 4]],
  },
  {
    id: 'bouillabaisse',
    label: 'la bouillabaisse et la cuisine de la mer provençale',
    mots: ['bouillabaisse', 'bourride', 'soupe de poisson', 'rouille', 'aioli', 'brandade'],
    scores: [25, 15, 5, 82, 80, 50, 5, 90, 55, 0],
    bonus: [['cassis', 10], ['bandol', 8], ['provence', 6], ['rolle', 4], ['vermentino', 4], ['picpoul', 3]],
  },
  {
    id: 'foie-gras',
    label: 'le foie gras',
    mots: ['foie gras'],
    scores: [25, 30, 30, 35, 60, 82, 96, 20, 80, 55],
    bonus: [['sauternes', 4], ['barsac', 4], ['jurancon', 4], ['monbazillac', 3], ['coteaux du layon', 3], ['gewurztraminer', 6], ['champagne', 4]],
  },
  {
    id: 'fromage-dur',
    label: 'les fromages à pâte pressée',
    mots: ['comte', 'beaufort', 'gruyere', 'emmental', 'abondance', 'cantal', 'salers', 'mimolette', 'parmesan', 'tomme', 'ossau', 'manchego', 'gouda', 'cheddar', 'laguiole', 'morbier'],
    scores: [70, 68, 50, 62, 88, 55, 40, 30, 62, 45],
    bonus: [['jura', 12], ['savoie', 5], ['bourgogne', 4], ['jurancon', 5], ['irouleguy', 5], ['porto', 4]],
  },
  {
    id: 'bleu',
    label: 'les fromages bleus',
    mots: ['roquefort', 'bleu', 'fourme', 'gorgonzola', 'stilton'],
    scores: [20, 30, 35, 25, 40, 55, 95, 10, 40, 90],
    bonus: [['sauternes', 5], ['porto', 6], ['banyuls', 6], ['maury', 6], ['jurancon', 4], ['monbazillac', 4]],
  },
  {
    id: 'chevre',
    label: 'les fromages de chèvre',
    mots: ['chevre', 'crottin', 'sainte maure', 'valencay', 'selles sur cher', 'picodon', 'pelardon', 'cabecou', 'rocamadour', 'feta', 'chabichou'],
    scores: [50, 30, 10, 94, 68, 55, 20, 55, 60, 5],
    bonus: [['sancerre', 6], ['pouilly fume', 6], ['menetou', 6], ['quincy', 6], ['touraine', 6], ['sauvignon', 4], ['chenin', 3]],
  },
  {
    id: 'pate-molle',
    label: 'les fromages à croûte fleurie',
    mots: ['camembert', 'brie', 'coulommiers', 'chaource', 'brillat savarin', 'saint marcellin', 'saint felicien', 'neufchatel'],
    scores: [78, 60, 30, 62, 72, 45, 15, 40, 80, 10],
    bonus: [['champagne', 6], ['beaujolais', 4], ['bourgogne', 4]],
  },
  {
    id: 'croute-lavee',
    label: 'les fromages à croûte lavée',
    mots: ['munster', 'epoisses', 'maroilles', 'livarot', 'pont l eveque', 'langres', 'mont d or', 'vacherin'],
    scores: [45, 45, 30, 50, 62, 92, 45, 20, 55, 20],
    bonus: [['gewurztraminer', 8], ['alsace', 5], ['bourgogne', 4], ['pinot gris', 4]],
  },
  {
    id: 'fromage-frais',
    label: 'les fromages frais',
    mots: ['mozzarella', 'burrata', 'ricotta', 'fromage frais', 'faisselle', 'brousse'],
    scores: [45, 25, 5, 86, 68, 55, 15, 85, 72, 0],
  },
  {
    id: 'fromages',
    label: 'un plateau de fromages',
    mots: ['fromage'],
    scores: [70, 62, 45, 72, 82, 62, 50, 35, 68, 40],
  },
  {
    id: 'chocolat',
    label: 'les desserts au chocolat',
    mots: ['chocolat', 'fondant', 'brownie', 'foret noire', 'opera$', 'cacao', 'profiterole'],
    scores: [15, 20, 30, 5, 10, 20, 45, 10, 30, 97],
    bonus: [['banyuls', 3], ['maury', 3], ['porto', 3], ['rivesaltes', 5], ['rasteau', 3]],
  },
  {
    id: 'noix-caramel',
    label: 'les desserts aux fruits secs, au café ou au caramel',
    mots: ['noix', 'noisette', 'cafe$', 'tiramisu', 'caramel', 'praline', 'pain d epices', 'fruits secs', 'amande', 'nougat', 'frangipane', 'galette des rois'],
    scores: [10, 12, 20, 5, 15, 35, 80, 5, 40, 92],
    bonus: [['rivesaltes', 5], ['banyuls', 4], ['maury', 4], ['porto', 4], ['madere', 6], ['jura', 6], ['jerez', 6], ['tokaj', 5]],
  },
  {
    id: 'dessert-fruits',
    label: 'les desserts aux fruits et les pâtisseries',
    mots: ['tarte', 'dessert', 'fruit', 'fraise', 'framboise', 'pomme$', 'pommes$', 'poire', 'abricot', 'peche$', 'peches$', 'sorbet', 'crumble', 'clafoutis', 'tatin', 'creme brulee', 'ile flottante', 'patisserie', 'gateau', 'macaron', 'buche', 'glace', 'vanille', 'mangue', 'ananas', 'agrume', 'citron'],
    scores: [10, 5, 2, 20, 25, 62, 92, 45, 85, 45],
    bonus: [['muscat', 6], ['coteaux du layon', 5], ['vouvray', 5], ['moscato', 7], ['champagne', 3], ['sauternes', 3], ['gewurztraminer', 4], ['jurancon', 4]],
  },
  {
    id: 'epice',
    label: 'la cuisine épicée et asiatique',
    mots: ['curry', 'epice', 'thai', 'indien', 'chinois', 'asiatique', 'wok', 'piment', 'tandoori', 'tikka', 'colombo', 'nems', 'sichuan', 'harissa', 'mexicain', 'chili', 'fajitas', 'tacos', 'gingembre', 'laque', 'aigre doux', 'vietnamien', 'coreen', 'japonais', 'ramen', 'bo bun', 'satay', 'massala', 'creole', 'rougail'],
    scores: [50, 40, 15, 62, 60, 92, 55, 72, 60, 10],
    bonus: [['gewurztraminer', 6], ['riesling', 16], ['pinot gris', 6], ['viognier', 3], ['alsace', 3], ['tavel', 3]],
  },
  {
    id: 'oriental',
    label: 'le couscous, les tajines et la cuisine orientale',
    mots: ['couscous', 'tajine', 'tagine', 'oriental', 'pastilla', 'kefta', 'marocain', 'libanais', 'mezze', 'falafel', 'chawarma'],
    scores: [62, 86, 72, 30, 40, 55, 15, 86, 35, 5],
    bonus: [['languedoc', 5], ['vallee du rhone', 4], ['tavel', 5], ['bandol', 5], ['bekaa', 7], ['corse', 3], ['grenache', 3]],
  },
  {
    id: 'italien',
    label: 'les pizzas et les pâtes',
    mots: ['pizza', 'pates$', 'spaghetti', 'lasagne', 'bolognaise', 'tagliatelle', 'ravioli', 'penne', 'tomate', 'gnocchi', 'cannelloni', 'carbonara', 'italien', 'pesto', 'parmigiana', 'linguine', 'macaroni'],
    scores: [82, 88, 55, 50, 50, 30, 5, 72, 45, 0],
    bonus: [['italie', 8], ['cotes du rhone', 4], ['languedoc', 3]],
  },
  {
    id: 'champignons',
    label: 'les champignons, la truffe et le risotto',
    mots: ['risotto', 'champignon', 'cepe', 'girolle', 'morille', 'truffe', 'trompette', 'bolet', 'pleurote', 'chanterelle'],
    scores: [84, 82, 68, 45, 88, 40, 10, 35, 62, 5],
    bonus: [['pomerol', 6], ['saint emilion', 6], ['bourgogne', 6], ['barolo', 6], ['barbaresco', 6], ['nebbiolo', 4], ['hermitage', 3], ['chateauneuf', 3]],
  },
  {
    id: 'espagnol',
    label: 'la paella et la cuisine espagnole',
    mots: ['paella', 'riz$', 'zarzuela', 'chorizo', 'iberique', 'pata negra', 'espagnol', 'tortilla'],
    scores: [68, 80, 50, 72, 62, 45, 5, 86, 62, 0],
    bonus: [['espagne', 8], ['provence', 3]],
  },
  {
    id: 'oeufs',
    label: 'les œufs',
    mots: ['oeuf', 'omelette', 'meurette'],
    scores: [78, 55, 25, 68, 75, 45, 5, 62, 68, 0],
    bonus: [['beaujolais', 5], ['bourgogne', 4]],
  },
  {
    id: 'escargots',
    label: 'les escargots et le beurre persillé',
    mots: ['escargot', 'grenouille', 'beurre persille', 'persillade'],
    scores: [45, 30, 10, 88, 80, 45, 5, 45, 62, 0],
    bonus: [['chablis', 8], ['aligote', 6], ['macon', 6], ['bourgogne', 3]],
  },
  {
    id: 'gratin',
    label: 'les gratins et les plats familiaux',
    mots: ['gratin', 'parmentier', 'pomme de terre', 'puree', 'frites', 'croque', 'endive', 'quiche', 'tourte', 'crepe', 'galette$', 'galettes$'],
    scores: [80, 80, 55, 58, 72, 40, 5, 62, 55, 0],
    bonus: [['beaujolais', 4], ['cotes du rhone', 4], ['savoie', 3]],
  },
  {
    id: 'melon',
    label: 'le melon, les figues et le jambon cru',
    mots: ['melon', 'jambon cru', 'prosciutto', 'figue', 'jambon de parme', 'jambon de bayonne'],
    scores: [55, 40, 15, 62, 60, 72, 72, 80, 78, 62],
    bonus: [['muscat', 6], ['rivesaltes', 4], ['porto', 6]],
  },
  {
    id: 'legumes',
    label: 'les légumes et la cuisine végétarienne',
    mots: ['legume', 'vegetarien', 'vegan', 'ratatouille', 'courgette', 'aubergine', 'poivron', 'tian', 'lentille', 'pois chiche', 'tofu', 'quinoa', 'asperge', 'artichaut', 'poireau', 'soupe', 'veloute', 'potage', 'epinard', 'chou', 'haricot', 'courge', 'potiron', 'avocat'],
    scores: [72, 60, 25, 82, 78, 62, 10, 82, 62, 0],
    bonus: [['provence', 4], ['vallee de la loire', 4], ['gamay', 3], ['muscat', 3]],
  },
  {
    id: 'apero',
    label: 'l\'apéritif et les entrées fraîches',
    mots: ['salade', 'crudite', 'aperitif', 'apero', 'tapas', 'antipasti', 'gaspacho', 'houmous', 'olive', 'tapenade', 'anchoiade', 'feuillete', 'amuse bouche', 'toast', 'canape', 'pique nique', 'sandwich', 'cake sale', 'wrap', 'buffet', 'entree$', 'entrees$'],
    scores: [58, 40, 15, 86, 68, 62, 20, 90, 92, 5],
    bonus: [['provence', 5], ['champagne', 4], ['cremant', 4], ['prosecco', 4], ['cava', 4], ['muscadet', 3], ['sauvignon', 3]],
  },
];
