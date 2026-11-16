import { parseCellarCsv } from './csv';
import type { Cellar } from './types';

/**
 * Cave de référence : l'armoire réelle que l'application modélise — 11 clayettes
 * (9 de 13 places « bordeaux », 1 de 12 places « bourgogne », 1 de 10 places « champagne »,
 * soit 139 emplacements) et ses 139 bouteilles, telles qu'exportées le 14 novembre 2026.
 *
 * Le texte est au format du fichier de l'application (voir `csv.ts`) : clayettes, puis
 * bouteilles dans l'ordre de lecture, identifiants d'origine conservés.
 * `public/cave-reference.csv` en est la copie exacte, précédée d'un BOM UTF-8 pour Excel.
 */
const LIGNES = `
type;id;capacite;type_clayette;nom;appellation;millesime;cepages;robe;forme;clayette;place;collection
clayette;;13;bordeaux;;;;;;;1;;
clayette;;13;bordeaux;;;;;;;2;;
clayette;;13;bordeaux;;;;;;;3;;
clayette;;13;bordeaux;;;;;;;4;;
clayette;;13;bordeaux;;;;;;;5;;
clayette;;13;bordeaux;;;;;;;6;;
clayette;;13;bordeaux;;;;;;;7;;
clayette;;13;bordeaux;;;;;;;8;;
clayette;;13;bordeaux;;;;;;;9;;
clayette;;12;bourgogne;;;;;;;10;;
clayette;;10;champagne;;;;;;;11;;
bouteille;f6f34cd4-8a6f-4440-a862-264cc123066b;;;Château Haut Brion;Graves;1983;Cabernet Sauvignon, Merlot, Cabernet Franc;Rouge;bordeaux;1;1;oui
bouteille;5b4de640-fb29-43e6-8a7c-3759285376fc;;;Château Tayac;Margaux;1975;Cabernet Sauvignon, Merlot, Petit Verdot;Rouge;bordeaux;1;2;oui
bouteille;d0492146-0482-4aa9-bf9d-c40e9da89e72;;;Château Tayac;Margaux;1995;Cabernet Sauvignon, Merlot, Petit Verdot;Rouge;bordeaux;1;3;oui
bouteille;d3ee2994-fa51-4554-9fb5-d3e0570e586f;;;Château Recougne;Bordeaux;1973;Merlot, Cabernet Sauvignon, Cabernet Franc;Rouge;bordeaux;1;4;oui
bouteille;cee6eb4b-19f5-4955-af4a-1cc9d63be5fa;;;Château de Carolle;Graves;2019;Cabernet Sauvignon, Merlot, Cabernet Franc;Rouge;bordeaux;1;5;oui
bouteille;f7e12867-0812-4f0b-b466-97be48032212;;;Château Mouton Baron Philippe;Pauillac;1973;;Rouge;bordeaux;1;6;oui
bouteille;425ada55-20b3-4f53-aef9-5acd6a1ecdda;;;Château Larose-Trintaudon;Haut-Médoc;1998;;Rouge;bordeaux;1;7;oui
bouteille;53962383-53ee-4bef-ad5a-6c9113f828b6;;;Château de Camensac;Haut-Médoc;1973;;Rouge;bordeaux;1;8;oui
bouteille;0b28c5a1-92dd-4127-83d3-80bab714c762;;;Seigneurerie d'Olivier;Pessac-Léognan;2000;;Rouge;bordeaux;1;9;oui
bouteille;5640fb5d-9302-4bd6-b2b0-de8217d3cec6;;;Château Larose-Trintaudon;Haut-Médoc;1973;;Rouge;bordeaux;1;10;oui
bouteille;1669af0f-f6bc-4bc7-b1ab-7e7890b5a853;;;Seigneurerie d'Olivier;Pessac-Léognan;2003;;Rouge;bordeaux;1;11;oui
bouteille;d077e34d-462e-4b14-a205-fae66b851b4a;;;Château Talbot;Haut-Médoc;1970;;Rouge;bordeaux;1;12;oui
bouteille;5219eabc-82c3-4bb4-b6b3-72279ecd2695;;;Cuvée Millenium;Bordeaux;1999;;Rouge;bordeaux;1;13;oui
bouteille;81f2e979-db24-46ce-b91a-f2cae1503b2a;;;Château Larose-Trintaudon;Haut-Médoc;2002;;Rouge;bordeaux;2;1;non
bouteille;9b71cd46-334e-4aaf-af4b-41832437d81a;;;Château Larose-Trintaudon;Haut-Médoc;2002;;Rouge;bordeaux;2;2;non
bouteille;868be4ac-f2da-4fbd-a569-dcff353b333c;;;Château Larose-Trintaudon;Haut-Médoc;2004;;Rouge;bordeaux;2;3;non
bouteille;1db4ca95-8872-486c-aaf6-e5acc7cf0689;;;Château Larose-Trintaudon;Haut-Médoc;2004;;Rouge;bordeaux;2;4;non
bouteille;454867f9-6e50-4492-8f53-d88123ef3ebc;;;Château Larose-Trintaudon;Haut-Médoc;2005;;Rouge;bordeaux;2;5;non
bouteille;5b860cd6-25a2-4d1f-8841-1659b1843b5d;;;Château Larose-Trintaudon;Haut-Médoc;2006;;Rouge;bordeaux;2;6;non
bouteille;1f298257-d380-4ed5-9b7e-dbcee6fafcb8;;;Château Larose-Trintaudon;Haut-Médoc;2008;;Rouge;bordeaux;2;7;non
bouteille;58cea12f-d9d7-45c2-b0a8-235bfae3b4a6;;;Château Pédesclaux;Pauillac;2008;;Rouge;bordeaux;2;8;non
bouteille;2631fc70-5c9a-4aa2-aad5-959b7aadfcea;;;Château Larose-Trintaudon;Haut-Médoc;2009;;Rouge;bordeaux;2;9;non
bouteille;13c4eb8e-371c-4433-925c-5f74ffc74bc7;;;Château Larose-Trintaudon;Haut-Médoc;2009;;Rouge;bordeaux;2;10;non
bouteille;caa21387-cd54-4a6c-9fda-05c14c500d3b;;;Château Simon;Sauternes;2011;;Blanc liquoreux;bordeaux;2;11;non
bouteille;4af749e2-92f1-41ea-b3f0-01dce09fbe82;;;Château Simon;Sauternes;2011;;Blanc liquoreux;bordeaux;2;12;non
bouteille;f000f131-ae0a-4a0f-ada8-04b38c4607de;;;Château Olivier;Pessac-Léognan;2013;;Rouge;bordeaux;2;13;non
bouteille;aa82cacb-b746-44de-97ae-a6640c4a43d0;;;Château Larose-Trintaudon;Haut-Médoc;2013;;Rouge;bordeaux;3;1;non
bouteille;ddfd1a21-cddb-490f-8ec3-48a21437da80;;;Château Larose-Trintaudon;Haut-Médoc;2014;;Rouge;bordeaux;3;2;non
bouteille;2dcb3727-6651-4045-b1d9-7b88ec68b681;;;Château Larose-Trintaudon;Haut-Médoc;2014;;Rouge;bordeaux;3;3;non
bouteille;037ef1b6-aecd-4983-91aa-49582fcb7cbe;;;Château Larose-Trintaudon;Haut-Médoc;2014;;Rouge;bordeaux;3;4;non
bouteille;14dc362c-2d9b-4bda-9c9d-a993821de559;;;Château Larose-Trintaudon;Haut-Médoc;2015;;Rouge;bordeaux;3;5;non
bouteille;441a1b7e-61e5-4c02-8d17-f8911730306e;;;Château Larose-Trintaudon;Haut-Médoc;2015;;Rouge;bordeaux;3;6;non
bouteille;fbbe0380-7a07-4f47-990f-d818a197a460;;;Château Larose-Trintaudon;Haut-Médoc;2016;;Rouge;bordeaux;3;7;non
bouteille;fadceb49-b1b1-4a9c-8526-f4b45ca8aab6;;;Château Larose-Trintaudon;Haut-Médoc;2016;;Rouge;bordeaux;3;8;non
bouteille;1727f8ee-4e6d-4372-af09-b234113c55a4;;;Château Laborde;Haut-Médoc;2016;;Rouge;bordeaux;3;9;non
bouteille;0e4e82b1-2224-4064-9980-d76eff235509;;;Chapelle de Potensac;Médoc;2016;;Rouge;bordeaux;3;10;non
bouteille;1e73be6e-3ce9-4042-b1da-d92bd9941569;;;L de La Louvière;Pessac-Léognan;2017;;Blanc;bordeaux;3;11;non
bouteille;d6d25238-d574-4a20-8225-6630f00217a2;;;Les Douves de La Tour Carnet;Haut-Médoc;2017;;Rouge;bordeaux;3;12;non
bouteille;d7d32e6c-6515-4ca5-99c4-235e6e01d96a;;;Les Douves de La Tour Carnet;Haut-Médoc;2017;;Rouge;bordeaux;3;13;non
bouteille;1945e5b1-9de5-4482-a595-ba8738ec9017;;;Château Tour Prignac;Médoc;2017;;Rouge;bordeaux;4;1;non
bouteille;e386eec9-fb5a-4652-950c-27322d3793e5;;;Château Tour Prignac;Médoc;2017;;Rouge;bordeaux;4;2;non
bouteille;2be5f2ee-d930-4018-8a3b-d19863eb1b73;;;Château de Carolle;Graves;2017;Cabernet Sauvignon, Merlot, Cabernet Franc;Rouge;bordeaux;4;3;non
bouteille;75c22b5b-3e70-404b-b4be-91ce91d83929;;;Château de Carolle;Graves;2017;Cabernet Sauvignon, Merlot, Cabernet Franc;Rouge;bordeaux;4;4;non
bouteille;9e839cfd-75ae-4d88-92f0-561d27e4fd0d;;;Sarget de Gruaud Larose;Saint-Julien;2018;;Rouge;bordeaux;4;5;non
bouteille;a37cb450-6748-4d5e-833d-21a980ca09ba;;;Château Tour du Haut Moulin;Haut-Médoc;2018;;Rouge;bordeaux;4;6;non
bouteille;7762a511-04c4-464f-8471-73a97c0ea182;;;Château Lamarzelle Cormey;Saint-Emilion;2018;;Rouge;bordeaux;4;7;non
bouteille;98e52bd3-40ef-4efc-a708-5bd8e9a173c3;;;Puy Laroque;Graves;2018;;Rouge;bordeaux;4;8;non
bouteille;1500c3bd-1684-4370-806f-214143d31e77;;;Puy Laroque;Graves;2018;;Rouge;bordeaux;4;9;non
bouteille;db6818de-82d9-40ad-aef5-d97bfe169e26;;;Château de Carolle;Graves;2018;Cabernet Sauvignon, Merlot, Cabernet Franc;Rouge;bordeaux;4;10;non
bouteille;1538ddbd-938e-45ff-bc53-f2fb0e276aa1;;;Château de Carolle;Graves;2018;;Rouge;bordeaux;4;11;non
bouteille;4cda9739-2c0e-4ae5-b74b-22538ffe423d;;;Château de Carolle;Graves;2018;;Rouge;bordeaux;4;12;non
bouteille;537697e4-da1b-43a8-98b2-8c31cb5c527f;;;Château de Carolle;Graves;2018;Cabernet Sauvignon, Merlot, Cabernet Franc;Rouge;bordeaux;4;13;non
bouteille;149848b1-252a-417e-8446-7e605430a2fe;;;La Demoiselle de By;Médoc;2018;;Rouge;bordeaux;5;1;non
bouteille;030b4ecf-93d1-4d0b-8890-9f309a945d09;;;La Demoiselle de By;Médoc;2018;;Rouge;bordeaux;5;2;non
bouteille;260fa0fe-d27d-4b55-a8db-3ab0db80b75e;;;La Demoiselle de By;Médoc;2018;;Rouge;bordeaux;5;3;non
bouteille;981548ea-9398-4469-b196-663bccd42250;;;La Demoiselle de By;Médoc;2018;;Rouge;bordeaux;5;4;non
bouteille;e0d2f9ac-dacb-4207-9912-88e14284f175;;;La Demoiselle de By;Médoc;2018;;Rouge;bordeaux;5;5;non
bouteille;27aef256-3209-4c48-a2f4-9587e629d605;;;La Croix de Carbonnieux;Pessac-Léognan;2018;;Blanc;bordeaux;5;6;non
bouteille;8c5be487-bfd5-4670-86a2-addd64e27e2d;;;La Croix de Carbonnieux;Pessac-Léognan;2018;;Blanc;bordeaux;5;7;non
bouteille;381a1fda-2ead-4432-820d-7ef2e44ce414;;;La Croix de Carbonnieux;Pessac-Léognan;2018;;Blanc;bordeaux;5;8;non
bouteille;57fa2fd8-20d9-4d69-b94a-67195b525080;;;La Croix de Carbonnieux;Pessac-Léognan;2018;;Blanc;bordeaux;5;9;non
bouteille;9852c9e2-491c-49fe-a026-be54f659ba33;;;La Croix de Carbonnieux;Pessac-Léognan;2018;;Blanc;bordeaux;5;10;non
bouteille;3689676a-c1ba-4e55-816a-ff3f7be1e098;;;Le Dauphin d'Olivier;Graves;2019;;Rouge;bordeaux;5;11;non
bouteille;c9de7cdd-9079-4f81-ab1d-0768e2eb1692;;;Château Champ de Lalande;Lalande-de-Pomerol;2019;;Rouge;bordeaux;5;12;non
bouteille;f10a181b-100e-4e75-a705-7c50344f2151;;;Héritage de Chasse-Spleen;Haut-Médoc;2019;;Rouge;bordeaux;5;13;non
bouteille;e28ff64f-4709-45f1-a314-60416c298e16;;;Château Jacques Blanc;Saint-Emilion;2020;;Rouge;bordeaux;6;1;non
bouteille;79183308-f3aa-4fbb-831f-f11e4da55485;;;Château Amour;Médoc;2020;;Rouge;bordeaux;6;2;non
bouteille;2e09e092-29e3-41b8-84ad-160d81c131fc;;;Château de Carolle;Graves;2020;Sémillon, Sauvignon blanc;Blanc;bordeaux;6;3;non
bouteille;7150fd2d-a832-4b81-83bd-8cf815a9591b;;;Les Fiefs de Lagrange;Saint-Julien;2020;;Rouge;bordeaux;6;4;non
bouteille;faf625b2-c22d-435c-a6d1-f22c69e6558c;;;Château Voigny;Sauternes;2020;;Blanc liquoreux;bordeaux;6;5;non
bouteille;e3beb14c-8898-4895-ba11-dd4c92666465;;;Château Larose-Trintaudon;Haut-Médoc;2020;;Rouge;bordeaux;6;6;non
bouteille;f13b616b-19ee-4b9a-a998-a5fd4db5f618;;;Château Larose-Trintaudon;Haut-Médoc;2020;;Rouge;bordeaux;6;7;non
bouteille;c9720ea3-0072-4f13-b4fa-f9697fc34a15;;;Château Larose-Trintaudon;Haut-Médoc;2020;;Rouge;bordeaux;6;8;non
bouteille;2ba0c5ae-951e-474e-b9b8-b76725c2c96c;;;Château Larose-Trintaudon;Haut-Médoc;2020;;Rouge;bordeaux;6;9;non
bouteille;2a48c6d4-10d6-4620-adc4-ca1f28544a19;;;La Sirène de Giscours;Margaux;2020;;Rouge;bordeaux;6;10;non
bouteille;5107a3ab-2911-4684-aec6-9d9538fcd731;;;La Sirène de Giscours;Margaux;2020;;Rouge;bordeaux;6;11;non
bouteille;ea00fa21-9d58-4d0b-a5ab-b2b4f759027c;;;Château Belgrave;Haut-Médoc;2020;;Rouge;bordeaux;6;12;non
bouteille;4263673e-0d2d-4d2e-a326-36c6d596969c;;;Château Belgrave;Haut-Médoc;2020;;Rouge;bordeaux;6;13;non
bouteille;8a300efa-2e36-46ec-b2c6-cef1b14439d8;;;Château La Louvière;Pessac-Léognan;2020;;Rouge;bordeaux;7;1;non
bouteille;e99521a8-a761-4fc4-bef5-c1e2ced07481;;;Château La Louvière;Pessac-Léognan;2020;;Rouge;bordeaux;7;2;non
bouteille;7bece807-3e6e-4dd4-933e-f4b3998a7407;;;Château Chasse-Spleen;Moulis en Médoc;2020;;Rouge;bordeaux;7;3;non
bouteille;437e0efd-43c4-406e-8a76-263fae74b40c;;;Château Chasse-Spleen;Moulis en Médoc;2020;;Rouge;bordeaux;7;4;non
bouteille;2a7bc7ea-f849-4d9f-8385-eb7d05030009;;;Château de Camensac;Haut-Médoc;2020;;Rouge;bordeaux;7;5;non
bouteille;e392d9ee-4545-49ad-abcb-11695aadf8b0;;;Château de Camensac;Haut-Médoc;2020;;Rouge;bordeaux;7;6;non
bouteille;4a540ec8-aca5-4963-a53a-99a45fea6bc4;;;La Closerie  de Camensac;Haut-Médoc;2020;;Rouge;bordeaux;7;7;non
bouteille;ce616460-65f3-44ce-b32b-0181cf956691;;;L'Esprit de Chevalier;Pessac-Léognan;2020;;Blanc;bordeaux;7;8;non
bouteille;a2ad4301-894e-4a6f-98d6-734f7a58fa71;;;L'Esprit de Chevalier;Pessac-Léognan;2020;;Blanc;bordeaux;7;9;non
bouteille;42b39b58-19f2-40ae-9dc4-31e96eec4252;;;L'Esprit de Chevalier;Pessac-Léognan;2020;;Rouge;bordeaux;7;10;non
bouteille;18fc6428-8257-42e8-bd1a-952f4f9b080c;;;L'Esprit de Chevalier;Pessac-Léognan;2020;;Rouge;bordeaux;7;11;non
bouteille;141975b2-81bf-4372-b2cb-fdfb15cd8c0f;;;Château La Branne;Médoc;2020;;Rouge;bordeaux;7;12;non
bouteille;4073aa9c-129f-4044-bd8d-26c751d14258;;;Château La Branne;Médoc;2020;;Rouge;bordeaux;7;13;non
bouteille;093b8298-94c0-44f9-bd3d-9da75be6b66c;;;Château Cantemerle;Haut-Médoc;2020;;Rouge;bordeaux;8;1;non
bouteille;1aef086a-fa7c-4722-b708-e63f106a3c30;;;Château Cantemerle;Haut-Médoc;2020;;Rouge;bordeaux;8;2;non
bouteille;8b4fb3ca-d134-4d59-b202-a31569bc5e08;;;Château Maucaillou;Moulis en Médoc;2020;;Rouge;bordeaux;8;3;non
bouteille;9c328eec-b230-4c0d-a50b-67459bba3f11;;;Château Maucaillou;Moulis en Médoc;2020;;Rouge;bordeaux;8;4;non
bouteille;f968a390-3bdf-488d-ad01-e5be3b8b94f2;;;Connétable Talbot;Saint-Julien;2020;;Rouge;bordeaux;8;5;non
bouteille;1a703a40-8e6c-45e5-8314-5e4c618a0975;;;Connétable Talbot;Saint-Julien;2020;;Rouge;bordeaux;8;6;non
bouteille;65926c03-6ee0-46f8-837e-a142bc1f89f4;;;Château Olivier;Pessac-Léognan;2020;;Rouge;bordeaux;8;7;non
bouteille;d962ebc2-8ec8-49ea-a77b-307f45e9e365;;;Château Olivier;Pessac-Léognan;2020;;Rouge;bordeaux;8;8;non
bouteille;e3f45bce-6a39-4d33-b6e6-f361a7f535b7;;;Le Difese;Toscana;2020;;Rouge;bordeaux;8;9;non
bouteille;6329978c-2394-4aaa-947c-e10bfd7c3c9a;;;Château Cambon La Pelouse;Haut-Médoc;2020;;Rouge;bordeaux;8;10;non
bouteille;ba656252-1cba-465e-94dd-2b75f87a52f4;;;Château Cambon La Pelouse;Haut-Médoc;2020;;Rouge;bordeaux;8;11;non
bouteille;5ec12beb-8f24-4dbd-9498-ee1495e62139;;;Duluc de Branaire-Ducru;Saint-Julien;2020;;Rouge;bordeaux;8;12;non
bouteille;ed14ce06-e3f5-47d1-bf01-df41d90015ee;;;Duluc de Branaire-Ducru;Saint-Julien;2020;;Rouge;bordeaux;8;13;non
bouteille;528665c0-9e75-492b-ba88-e0107251365b;;;Château Belle-Vue;Haut-Médoc;2020;;Rouge;bordeaux;9;1;non
bouteille;b643a03e-5ece-41d1-98b7-6ec53e5e55b9;;;Château Belle-Vue;Haut-Médoc;2020;;Rouge;bordeaux;9;2;non
bouteille;ef32ced2-648c-4338-a4dc-5499bd2fde6c;;;Domaine de Larrivet Haut-Brion;Pessac-Léognan;2020;;Rouge;bordeaux;9;3;non
bouteille;513bdafa-26f7-46ba-b884-b85e4d25521e;;;Domaine de Larrivet Haut-Brion;Pessac-Léognan;2020;;Rouge;bordeaux;9;4;non
bouteille;36e9fc0f-c429-42b9-af04-6a006c230c18;;;Château Grave Lacour;Saint-Esthèphe;2020;;Rouge;bordeaux;9;5;non
bouteille;d3e8e4b9-8dde-4c60-983b-41dcea265b53;;;Château Laborde;Haut-Médoc;2020;;Rouge;bordeaux;9;6;non
bouteille;2a412fdb-5b6e-412c-9b5f-5067b195f261;;;Enclos de la Collégiale;Lussac Saint-Emilion;2020;;Rouge;bordeaux;9;7;non
bouteille;9bafcaaf-e51c-422a-b46d-d5c25461a4eb;;;Enclos de la Collégiale;Lussac Saint-Emilion;2020;;Rouge;bordeaux;9;8;non
bouteille;6da2c2d5-56b9-4883-88b9-9411ecaf967c;;;Château Bouscaut;Pessac-Léognan;2020;;Rouge;bordeaux;9;9;non
bouteille;634181a1-d1bd-44f7-956f-a5789eb0b4b9;;;Château Bouscaut;Pessac-Léognan;2020;;Rouge;bordeaux;9;10;non
bouteille;71bca835-715a-44bf-88ac-d7b46c5a07ca;;;Château Citran;Bordeaux;2022;;Rouge;bordeaux;9;11;non
bouteille;9579a64d-4bd0-41b7-8126-268bd84a27bf;;;Château L'étoile de Viaud;Lalande-de-Pomerol;2023;;Rouge;bordeaux;9;12;non
bouteille;e5dc4101-728d-4830-9bfa-df637b121c29;;;Magali Signature;Côtes de Provence;2024;;Rosé;bordeaux;9;13;non
bouteille;d6f43a16-ced0-4895-b435-a70f2916d828;;;Gewurtztraminer Vendanges tardives;Alsace;;;Blanc liquoreux;bourgogne;10;1;non
bouteille;ffbb0813-d256-47dc-aac9-2a0b0e56ffce;;;Chiroubles;Beaujolais;1973;;Rouge;bourgogne;10;2;non
bouteille;aa79def6-faa2-47a1-8536-43e3797c82f4;;;Gewurtztraminer Vendanges tardives;Alsace;;;Blanc liquoreux;bourgogne;10;3;non
bouteille;57122abe-6e3b-4dc7-92c4-fe3885b24faf;;;Chassagne-Montrachet;Chassagne-Montrachet;1973;;Rouge;bourgogne;10;4;non
bouteille;3d45b04e-b277-4d7e-9f2e-2d5e74c4b969;;;Pinot Noir;Bourgogne;2020;;Rouge;bourgogne;10;5;non
bouteille;6c6e99a1-48a6-481c-bb9d-a30a2d7031da;;;Mercurey;Mercurey;1970;;Rouge;bourgogne;10;6;non
bouteille;bfee5c4a-19d4-4bd8-ba46-810472b21be8;;;Amarone della Valpolicella;Santi;2010;;Rouge;bourgogne;10;7;non
bouteille;982e8896-7dbf-47b0-862f-96a662ae3885;;;Amarone della Valpolicella;Santi;2010;;Rouge;bourgogne;10;8;non
bouteille;2ef90ade-e80c-44e3-98a6-0760b2a4a0e9;;;Gewurtztraminer;Alsace;;;Blanc;bourgogne;10;9;non
bouteille;98a61246-3df6-48f4-ae47-6bc0dcf53355;;;Riesling;Alsace;2022;;Blanc;bourgogne;10;10;non
bouteille;6a5080b3-004b-4374-8378-9b3559367b27;;;Riesling Grand Cru;Alsace;2017;;Blanc;bourgogne;10;11;non
bouteille;96a70015-5874-4b70-ad4f-276e2e55b8d8;;;Le B par Maucaillou;Bordeaux;2021;;Rouge;bourgogne;10;12;non
bouteille;28b8adaf-52cc-4264-bbf0-72c5d4078879;;;G.H.Mumm;Champagne;2019;;Blanc;champagne;11;1;non
bouteille;c94ca279-c739-41dc-8c98-afd1b5054919;;;Taittinger;Champagne;;;Blanc;champagne;11;2;non
bouteille;d080d128-5f8f-46a1-9eb7-3b503208deaf;;;Perrier-Jouet;Champagne;;;Blanc;champagne;11;3;non
bouteille;1efbabde-1790-4c66-88df-13f97831de53;;;Boizel;Champagne;;;Blanc;champagne;11;4;non
bouteille;87ee95dc-8a1c-463f-a00a-77e3ab0ddef9;;;Ruinart;Champagne;;;Blanc;champagne;11;5;non
bouteille;f9a572a7-92d5-45ea-9589-b29642c33c02;;;EFREI;Champagne;1996;;Blanc;champagne;11;6;non
bouteille;8e0fcdf9-bbb6-468c-83e6-b57e697654c9;;;Bosco del Conte;Prosecco;;;Blanc;champagne;11;7;non
bouteille;757a60c8-09ac-472e-8824-64b73e4de3c0;;;Bosco del Conte;Prosecco;;;Blanc;champagne;11;8;non
bouteille;ac314a7d-2fb6-41cb-a936-b610a601308c;;;Bosco del Conte;Prosecco;;;Blanc;champagne;11;9;non
bouteille;5cd1a63e-6840-4325-9f3c-579e99ea7660;;;Bosco del Conte;Prosecco;;;Blanc;champagne;11;10;non
`;

/** La cave de référence au format CSV de l'application : lignes terminées par CRLF, sans BOM. */
export const REFERENCE_CSV: string = LIGNES.trim()
  .split(/\r?\n/)
  .map((ligne) => `${ligne}\r\n`)
  .join('');

/** Disposition de l'armoire de référence (sert aussi de configuration par défaut). */
export const REFERENCE_LAYOUT = {
  bordeaux: { clayettes: 9, capacite: 13 },
  bourgogne: { clayettes: 1, capacite: 12 },
  champagne: { clayettes: 1, capacite: 10 },
} as const;

/** La cave de référence, lue depuis `REFERENCE_CSV` (identifiants du fichier conservés). */
export function referenceCellar(): Cellar {
  const { cellar, errors } = parseCellarCsv(REFERENCE_CSV);
  if (!cellar) throw new Error(`Cave de référence illisible : ${errors.join(' ')}`);
  return cellar;
}
