import { parseCellarCsv } from './csv';
import type { Cellar } from './types';

/**
 * Cave d'exemple : une armoire de 12 clayettes (144 emplacements) garnie de 94 bouteilles
 * de vins réels — Bordeaux des deux rives, Bourgogne, Rhône, Loire, Alsace, Champagne,
 * Sauternes, Provence et quelques étrangers — telle qu'un amateur la remplit au fil des
 * achats, c'est-à-dire en désordre : millésimes mélangés, lots de bouteilles identiques
 * dispersés sur plusieurs clayettes, champagnes et flûtes là où il restait de la place.
 * La réorganisation automatique a ainsi de quoi faire. La cave reste valide : types de
 * clayettes respectés, une seule bouteille par emplacement.
 *
 * Le texte est au format canonique de `serializeCellar` (clayettes, puis bouteilles dans
 * l'ordre de lecture) ; `public/exemple-cave.csv` en est la copie exacte, précédée d'un
 * BOM UTF-8 pour Excel.
 */
const LIGNES = `
enregistrement;clayette;rang;emplacements;type;chateau;appellation;annee;cepages;robe;forme;collection
clayette;1;;12;Tout;;;;;;;
clayette;2;;12;Bordeaux;;;;;;;
clayette;3;;12;Bordeaux;;;;;;;
clayette;4;;12;Bourgogne;;;;;;;
clayette;5;;14;Bordeaux;;;;;;;
clayette;6;;12;Tout;;;;;;;
clayette;7;;12;Bourgogne;;;;;;;
clayette;8;;12;Bordeaux;;;;;;;
clayette;9;;13;Tout;;;;;;;
clayette;10;;10;Champagne;;;;;;;
clayette;11;;12;Tout;;;;;;;
clayette;12;;11;Tout;;;;;;;
bouteille;1;1;;;Maison Trimbach;Alsace;2019;Riesling;Blanc;Autre;non
bouteille;1;3;;;Château Puygueraud;Francs Côtes de Bordeaux;2020;Merlot, Cabernet franc, Malbec;Rouge;Bordeaux;non
bouteille;1;4;;;Louis Roederer;Champagne;2015;Pinot noir, Chardonnay;Blanc;Champagne;non
bouteille;1;5;;;Louis Roederer;Champagne;2015;Pinot noir, Chardonnay;Blanc;Champagne;non
bouteille;1;7;;;Château Gruaud Larose;Saint-Julien;1989;Cabernet Sauvignon, Merlot, Cabernet franc, Petit Verdot;Rouge;Bordeaux;oui
bouteille;1;9;;;E. Guigal;Côte-Rôtie;2015;Syrah, Viognier;Rouge;Bourgogne;non
bouteille;1;10;;;E. Guigal;Côte-Rôtie;2015;Syrah, Viognier;Rouge;Bourgogne;non
bouteille;1;11;;;Domaine Leflaive;Puligny-Montrachet;2017;Chardonnay;Blanc;Bourgogne;non
bouteille;1;12;;;Domaine Leflaive;Puligny-Montrachet;2017;Chardonnay;Blanc;Bourgogne;non
bouteille;2;1;;;Château La Tour de By;Médoc;1988;Cabernet Sauvignon, Merlot, Petit Verdot;Rouge;Bordeaux;non
bouteille;2;3;;;Château Léoville Barton;Saint-Julien;2016;Cabernet Sauvignon, Merlot, Cabernet franc;Rouge;Bordeaux;non
bouteille;2;4;;;Château Phélan Ségur;Saint-Estèphe;2018;Cabernet Sauvignon, Merlot;Rouge;Bordeaux;non
bouteille;2;5;;;Château Phélan Ségur;Saint-Estèphe;2018;Cabernet Sauvignon, Merlot;Rouge;Bordeaux;non
bouteille;2;6;;;Château Fombrauge;Saint-Émilion Grand Cru;2018;Merlot, Cabernet franc;Rouge;Bordeaux;non
bouteille;2;7;;;Château Fombrauge;Saint-Émilion Grand Cru;2018;Merlot, Cabernet franc;Rouge;Bordeaux;non
bouteille;2;8;;;Château Fontenil;Fronsac;2016;Merlot, Cabernet Sauvignon;Rouge;Bordeaux;non
bouteille;2;10;;;Marqués de Riscal;Rioja;2017;Tempranillo, Graciano, Mazuelo;Rouge;Bordeaux;non
bouteille;2;11;;;Château Chasse-Spleen;Moulis-en-Médoc;2014;Cabernet Sauvignon, Merlot, Petit Verdot;Rouge;Bordeaux;non
bouteille;2;12;;;Château Chasse-Spleen;Moulis-en-Médoc;2014;Cabernet Sauvignon, Merlot, Petit Verdot;Rouge;Bordeaux;non
bouteille;3;1;;;Château Léoville Barton;Saint-Julien;2016;Cabernet Sauvignon, Merlot, Cabernet franc;Rouge;Bordeaux;non
bouteille;3;2;;;Marqués de Riscal;Rioja;2017;Tempranillo, Graciano, Mazuelo;Rouge;Bordeaux;non
bouteille;3;3;;;Château Haut-Bailly;Pessac-Léognan;2012;Cabernet Sauvignon, Merlot, Cabernet franc;Rouge;Bordeaux;non
bouteille;3;4;;;Château Suduiraut;Sauternes;2009;Sémillon, Sauvignon blanc;Blanc liquoreux;Bordeaux;non
bouteille;3;5;;;Château Suduiraut;Sauternes;2009;Sémillon, Sauvignon blanc;Blanc liquoreux;Bordeaux;non
bouteille;3;6;;;Château Cantemerle;Haut-Médoc;2019;Cabernet Sauvignon, Merlot, Cabernet franc, Petit Verdot;Rouge;Bordeaux;non
bouteille;3;7;;;Château Cantemerle;Haut-Médoc;2019;Cabernet Sauvignon, Merlot, Cabernet franc, Petit Verdot;Rouge;Bordeaux;non
bouteille;3;8;;;Château Margaux;Margaux;1996;Cabernet Sauvignon, Merlot, Petit Verdot, Cabernet franc;Rouge;Bordeaux;oui
bouteille;3;11;;;Château Figeac;Saint-Émilion Grand Cru;2005;Cabernet Sauvignon, Cabernet franc, Merlot;Rouge;Bordeaux;oui
bouteille;4;2;;;Georges Dubœuf;Beaujolais-Villages;2012;Gamay;Rouge;Bourgogne;non
bouteille;4;3;;;Domaine Michel Lafarge;Volnay;2015;Pinot noir;Rouge;Bourgogne;non
bouteille;4;4;;;Domaine Michel Lafarge;Volnay;2015;Pinot noir;Rouge;Bourgogne;non
bouteille;4;6;;;Domaine du Vieux Télégraphe;Châteauneuf-du-Pape;2016;Grenache, Mourvèdre, Syrah, Cinsault;Rouge;Bourgogne;non
bouteille;4;7;;;Domaine William Fèvre;Chablis Premier Cru;2020;Chardonnay;Blanc;Bourgogne;non
bouteille;4;9;;;Marcel Lapierre;Morgon;2022;Gamay;Rouge;Bourgogne;non
bouteille;4;10;;;Marcel Lapierre;Morgon;2022;Gamay;Rouge;Bourgogne;non
bouteille;4;11;;;Pio Cesare;Barolo;2016;Nebbiolo;Rouge;Bourgogne;non
bouteille;5;1;;;Château Haut-Bailly;Pessac-Léognan;2012;Cabernet Sauvignon, Merlot, Cabernet franc;Rouge;Bordeaux;non
bouteille;5;3;;;Château Carbonnieux;Pessac-Léognan;2020;Sauvignon blanc, Sémillon;Blanc;Bordeaux;non
bouteille;5;5;;;Château Fontenil;Fronsac;2016;Merlot, Cabernet Sauvignon;Rouge;Bordeaux;non
bouteille;5;6;;;Château Fontenil;Fronsac;2016;Merlot, Cabernet Sauvignon;Rouge;Bordeaux;non
bouteille;5;8;;;Château Figeac;Saint-Émilion Grand Cru;2005;Cabernet Sauvignon, Cabernet franc, Merlot;Rouge;Bordeaux;oui
bouteille;5;11;;;Mouton Cadet;Bordeaux;1995;Merlot, Cabernet Sauvignon, Cabernet franc;Rouge;Bordeaux;non
bouteille;5;12;;;Château Lynch-Bages;Pauillac;2015;Cabernet Sauvignon, Merlot, Cabernet franc, Petit Verdot;Rouge;Bordeaux;non
bouteille;5;13;;;Château d'Yquem;Sauternes;2001;Sémillon, Sauvignon blanc;Blanc liquoreux;Bordeaux;oui
bouteille;5;14;;;Marqués de Riscal;Rioja;2017;Tempranillo, Graciano, Mazuelo;Rouge;Bordeaux;non
bouteille;6;2;;;Château Cantemerle;Haut-Médoc;2019;Cabernet Sauvignon, Merlot, Cabernet franc, Petit Verdot;Rouge;Bordeaux;non
bouteille;6;3;;;Château Cantemerle;Haut-Médoc;2019;Cabernet Sauvignon, Merlot, Cabernet franc, Petit Verdot;Rouge;Bordeaux;non
bouteille;6;4;;;Château Cantemerle;Haut-Médoc;2019;Cabernet Sauvignon, Merlot, Cabernet franc, Petit Verdot;Rouge;Bordeaux;non
bouteille;6;5;;;Dom Pérignon;Champagne;2008;Chardonnay, Pinot noir;Blanc;Champagne;oui
bouteille;6;6;;;Billecart-Salmon;Champagne;;Chardonnay, Pinot noir, Meunier;Rosé;Champagne;non
bouteille;6;8;;;Château Lynch-Bages;Pauillac;2015;Cabernet Sauvignon, Merlot, Cabernet franc, Petit Verdot;Rouge;Bordeaux;non
bouteille;6;9;;;Château Lynch-Bages;Pauillac;2015;Cabernet Sauvignon, Merlot, Cabernet franc, Petit Verdot;Rouge;Bordeaux;non
bouteille;6;10;;;Domaine de la Pépière;Muscadet Sèvre et Maine;2013;Melon de Bourgogne;Blanc;Bourgogne;non
bouteille;7;1;;;Domaine Bernard Baudry;Chinon;2019;Cabernet franc;Rouge;Bourgogne;non
bouteille;7;2;;;Domaine Bernard Baudry;Chinon;2019;Cabernet franc;Rouge;Bourgogne;non
bouteille;7;6;;;Domaine Faiveley;Mercurey;2019;Pinot noir;Rouge;Bourgogne;non
bouteille;7;7;;;Domaine Faiveley;Mercurey;2019;Pinot noir;Rouge;Bourgogne;non
bouteille;7;8;;;Domaine Armand Rousseau;Gevrey-Chambertin;2014;Pinot noir;Rouge;Bourgogne;oui
bouteille;7;10;;;Domaine William Fèvre;Chablis Premier Cru;2020;Chardonnay;Blanc;Bourgogne;non
bouteille;7;11;;;Domaine William Fèvre;Chablis Premier Cru;2020;Chardonnay;Blanc;Bourgogne;non
bouteille;7;12;;;Marcel Lapierre;Morgon;2022;Gamay;Rouge;Bourgogne;non
bouteille;8;4;;;Château Cantemerle;Haut-Médoc;2019;Cabernet Sauvignon, Merlot, Cabernet franc, Petit Verdot;Rouge;Bordeaux;non
bouteille;8;6;;;Château Sociando-Mallet;Haut-Médoc;2010;Cabernet Sauvignon, Merlot, Cabernet franc;Rouge;Bordeaux;non
bouteille;8;11;;;Château Puygueraud;Francs Côtes de Bordeaux;2020;Merlot, Cabernet franc, Malbec;Rouge;Bordeaux;non
bouteille;9;3;;;Château Puygueraud;Francs Côtes de Bordeaux;2020;Merlot, Cabernet franc, Malbec;Rouge;Bordeaux;non
bouteille;9;4;;;Maison Trimbach;Alsace;2019;Riesling;Blanc;Autre;non
bouteille;9;5;;;Maison Trimbach;Alsace;2019;Riesling;Blanc;Autre;non
bouteille;9;6;;;Château Minuty;Côtes de Provence;2024;Grenache, Cinsault, Syrah;Rosé;Autre;non
bouteille;9;7;;;Château Gruaud Larose;Saint-Julien;1989;Cabernet Sauvignon, Merlot, Cabernet franc, Petit Verdot;Rouge;Bordeaux;oui
bouteille;9;8;;;Domaine Vacheron;Sancerre;2022;Sauvignon blanc;Blanc;Bourgogne;non
bouteille;9;11;;;Château Fombrauge;Saint-Émilion Grand Cru;2018;Merlot, Cabernet franc;Rouge;Bordeaux;non
bouteille;9;12;;;Château Fombrauge;Saint-Émilion Grand Cru;2018;Merlot, Cabernet franc;Rouge;Bordeaux;non
bouteille;10;3;;;Bollinger;Champagne;;Pinot noir, Chardonnay, Meunier;Blanc;Champagne;non
bouteille;10;5;;;Bollinger;Champagne;;Pinot noir, Chardonnay, Meunier;Blanc;Champagne;non
bouteille;10;8;;;Bollinger;Champagne;;Pinot noir, Chardonnay, Meunier;Blanc;Champagne;non
bouteille;10;9;;;Mionetto;Prosecco;;Glera;Blanc;Champagne;non
bouteille;10;10;;;Mionetto;Prosecco;;Glera;Blanc;Champagne;non
bouteille;11;1;;;Château Carbonnieux;Pessac-Léognan;2020;Sauvignon blanc, Sémillon;Blanc;Bordeaux;non
bouteille;11;2;;;Château La Tour de By;Médoc;1988;Cabernet Sauvignon, Merlot, Petit Verdot;Rouge;Bordeaux;non
bouteille;11;3;;;Domaine Faiveley;Mercurey;2019;Pinot noir;Rouge;Bourgogne;non
bouteille;11;5;;;Clos Rougeard;Saumur-Champigny;2011;Cabernet franc;Rouge;Bourgogne;oui
bouteille;11;9;;;Château Sociando-Mallet;Haut-Médoc;2010;Cabernet Sauvignon, Merlot, Cabernet franc;Rouge;Bordeaux;non
bouteille;11;10;;;Château Sociando-Mallet;Haut-Médoc;2010;Cabernet Sauvignon, Merlot, Cabernet franc;Rouge;Bordeaux;non
bouteille;11;11;;;Château Sociando-Mallet;Haut-Médoc;2010;Cabernet Sauvignon, Merlot, Cabernet franc;Rouge;Bordeaux;non
bouteille;12;1;;;Domaine Vacheron;Sancerre;2022;Sauvignon blanc;Blanc;Bourgogne;non
bouteille;12;2;;;Domaine Vacheron;Sancerre;2022;Sauvignon blanc;Blanc;Bourgogne;non
bouteille;12;3;;;Château Chasse-Spleen;Moulis-en-Médoc;2014;Cabernet Sauvignon, Merlot, Petit Verdot;Rouge;Bordeaux;non
bouteille;12;4;;;Famille Hugel;Alsace;2007;Gewurztraminer;Blanc liquoreux;Autre;non
bouteille;12;5;;;Château Minuty;Côtes de Provence;2024;Grenache, Cinsault, Syrah;Rosé;Autre;non
bouteille;12;6;;;Château Minuty;Côtes de Provence;2024;Grenache, Cinsault, Syrah;Rosé;Autre;non
bouteille;12;7;;;Domaine du Vieux Télégraphe;Châteauneuf-du-Pape;2016;Grenache, Mourvèdre, Syrah, Cinsault;Rouge;Bourgogne;non
bouteille;12;8;;;Domaine du Vieux Télégraphe;Châteauneuf-du-Pape;2016;Grenache, Mourvèdre, Syrah, Cinsault;Rouge;Bourgogne;non
bouteille;12;10;;;Billecart-Salmon;Champagne;;Chardonnay, Pinot noir, Meunier;Rosé;Champagne;non
bouteille;12;11;;;Pio Cesare;Barolo;2016;Nebbiolo;Rouge;Bourgogne;non
`;

/** La cave d'exemple au format CSV de l'application : lignes terminées par CRLF, sans BOM. */
export const DEMO_CSV: string = LIGNES.trim()
  .split(/\r?\n/)
  .map((ligne) => `${ligne}\r\n`)
  .join('');

/** La cave d'exemple, lue depuis `DEMO_CSV` (nouveaux identifiants de bouteille à chaque appel). */
export function demoCellar(): Cellar {
  const { cellar, errors } = parseCellarCsv(DEMO_CSV);
  if (!cellar) throw new Error(`Cave d'exemple illisible : ${errors.join(' ')}`);
  return cellar;
}
