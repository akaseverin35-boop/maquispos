import 'dotenv/config';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { db, DB_FILE, migrate, ecrireParametres } from './lib/db.js';

const reset = process.argv.includes('--reset');

if (reset) {
  db.close();
  for (const suffixe of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${suffixe}`, { force: true });
  console.log('Base supprimée. Relancez « npm run seed » pour la recréer.');
  process.exit(0);
}

migrate();

if (db.prepare('SELECT COUNT(*) AS n FROM employes').get().n > 0) {
  console.log('La base contient déjà des données — amorçage ignoré.');
  console.log('Pour repartir de zéro : npm run reset && npm run seed');
  process.exit(0);
}

const hash = (mdp) => bcrypt.hashSync(mdp, 10);

db.transaction(() => {
  ecrireParametres({
    nom_entreprise: 'BeChic Restaurant',
    adresse: 'Cocody Angré, Abidjan',
    telephone: '+225 07 00 00 00 00',
    devise: 'Fcfa',
    taux_taxe: '0',
    pied_recu: 'Merci de votre confiance — à bientôt !',
  });

  /* Points de vente : les deux noms visibles dans le guide Gesta+. */
  const pointVente = db.prepare(
    'INSERT INTO points_vente (nom, adresse, telephone) VALUES (?, ?, ?)',
  );
  const bechic = Number(pointVente.run('BeChic', 'Cocody Angré, Abidjan', '+225 07 00 00 00 00').lastInsertRowid);
  const depot = Number(pointVente.run('Depot principal', 'Yopougon, Abidjan', null).lastInsertRowid);

  /* Employés — un compte par rôle. */
  const employe = db.prepare(
    `INSERT INTO employes (nom_complet, identifiant, mot_de_passe, role, telephone, point_vente_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  employe.run('Administrateur', 'admin', hash('admin'), 'admin', null, bechic);
  employe.run('Awa Koné', 'gerant', hash('gerant'), 'gerant', '+225 01 02 03 04 05', bechic);
  employe.run('Sery Bertrand', 'caissier', hash('caissier'), 'caissier', null, bechic);
  employe.run('Fatou Diarra', 'serveur', hash('serveur'), 'serveur', null, bechic);

  /* Catégories reprises du guide. */
  const categorie = db.prepare(
    'INSERT INTO categories (libelle, couleur, position, point_vente_id) VALUES (?, ?, ?, ?)',
  );
  const petitDej = Number(categorie.run('Petit-déjeuner', '#f59e0b', 1, bechic).lastInsertRowid);
  const plats = Number(categorie.run('PLATS', '#16a34a', 2, bechic).lastInsertRowid);
  const boissons = Number(categorie.run('Boissons', '#0ea5e9', 3, bechic).lastInsertRowid);
  categorie.run('Marchandises', '#8b5cf6', 1, depot);

  /* Articles : ceux listés dans les captures, avec leurs prix. */
  const article = db.prepare(
    `INSERT INTO articles
       (libelle, categorie_id, point_vente_id, vendu_par, unite, prix_vente, cout, suivi_stock,
        stock, alerte_stock, image)
     VALUES (@libelle, @categorie_id, @point_vente_id, @vendu_par, @unite, @prix_vente, @cout,
             @suivi_stock, @stock, @alerte_stock, @image)`,
  );

  const catalogue = [
    { libelle: 'Ananas',        categorie_id: petitDej, prix_vente: 1000, cout: 400,  image: '🍍' },
    { libelle: 'croissant',     categorie_id: petitDej, prix_vente: 1000, cout: 350,  image: '🥐' },
    { libelle: 'healthy',       categorie_id: petitDej, prix_vente: 2000, cout: 900,  image: '🥗' },
    { libelle: 'Mafé',          categorie_id: plats,    prix_vente: 7000, cout: 3000, image: '🍲' },
    { libelle: 'placali',       categorie_id: plats,    prix_vente: 2000, cout: 800,  image: '🍛' },
    { libelle: 'atieke',        categorie_id: plats,    prix_vente: 1500, cout: 600,  image: '🥘' },
    { libelle: 'poulet kfc',    categorie_id: plats,    prix_vente: 4000, cout: 1800, image: '🍗' },
    { libelle: 'quesadilla',    categorie_id: plats,    prix_vente: 4000, cout: 1700, image: '🌮' },
  ];
  for (const a of catalogue) {
    article.run({
      ...a,
      point_vente_id: bechic,
      vendu_par: 'chaque',
      unite: 'pièce',
      suivi_stock: 0,
      stock: 0,
      alerte_stock: 0,
    });
  }

  /* Boissons : suivi de stock activé, pour illustrer les alertes et les entrées. */
  const boissonsStock = [
    { libelle: 'Bière 66cl',   prix_vente: 1500, cout: 900,  stock: 48, alerte_stock: 12, image: '🍺' },
    { libelle: 'Sucrerie 33cl', prix_vente: 700, cout: 350,  stock: 60, alerte_stock: 24, image: '🥤' },
    { libelle: 'Eau minérale',  prix_vente: 500, cout: 200,  stock: 8,  alerte_stock: 20, image: '💧' },
  ];
  for (const b of boissonsStock) {
    article.run({
      ...b,
      categorie_id: boissons,
      point_vente_id: bechic,
      vendu_par: 'chaque',
      unite: 'bouteille',
      suivi_stock: 1,
    });
  }

  /* Un article vendu au poids, et un à prix libre : les deux cas décrits au §4.1. */
  article.run({
    libelle: 'Poisson braisé (au kg)',
    categorie_id: plats,
    point_vente_id: bechic,
    vendu_par: 'poids_volume',
    unite: 'kg',
    prix_vente: 6000,
    cout: 3500,
    suivi_stock: 1,
    stock: 12.5,
    alerte_stock: 3,
    image: '🐟',
  });
  article.run({
    libelle: 'Plat du jour (prix libre)',
    categorie_id: plats,
    point_vente_id: bechic,
    vendu_par: 'chaque',
    unite: 'pièce',
    prix_vente: 0,
    cout: 0,
    suivi_stock: 0,
    stock: 0,
    alerte_stock: 0,
    image: '🍽️',
  });

  /* Tables de service. */
  const table = db.prepare(
    'INSERT INTO tables_service (nom, zone, places, point_vente_id) VALUES (?, ?, ?, ?)',
  );
  for (let i = 1; i <= 6; i += 1) table.run(`Table ${i}`, 'Salle', 4, bechic);
  for (let i = 1; i <= 4; i += 1) table.run(`Terrasse ${i}`, 'Terrasse', 6, bechic);

  /* Clients. */
  const client = db.prepare('INSERT INTO clients (nom, telephone, adresse) VALUES (?, ?, ?)');
  client.run('Client comptoir', null, null);
  client.run('Konan Yao', '+225 05 44 33 22 11', 'Riviera 2');
  client.run('Société AGL', '+225 27 20 30 40 50', 'Plateau, Abidjan');

  /* Quelques dépenses. */
  const depense = db.prepare(
    `INSERT INTO depenses (libelle, categorie, montant, beneficiaire, point_vente_id, employe_id, date_depense)
     VALUES (?, ?, ?, ?, ?, ?, date('now'))`,
  );
  depense.run('Achat casiers de boisson', 'Achat marchandise', 45000, 'Brassivoire', bechic, 2);
  depense.run('Facture électricité', 'Électricité / Eau', 32000, 'CIE', bechic, 2);
  depense.run('Transport marché', 'Transport', 5000, null, bechic, 2);
})();

console.log('Données de démonstration créées.');
console.log('');
console.log('  Comptes disponibles (identifiant / mot de passe) :');
console.log('    admin    / admin      — accès complet');
console.log('    gerant   / gerant     — gestion, rapports, employés');
console.log('    caissier / caissier   — caisse et ventes');
console.log('    serveur  / serveur    — prise de commande');
console.log('');
console.log(`  Base : ${DB_FILE}`);
