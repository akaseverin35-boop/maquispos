import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultFile = path.join(here, '..', '..', 'data', 'gestaplus.db');
const file = process.env.DATABASE_FILE
  ? path.resolve(process.cwd(), process.env.DATABASE_FILE)
  : defaultFile;

fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const DB_FILE = file;

/**
 * Les montants sont stockés en entiers, dans l'unité de base de la devise
 * (le franc CFA n'a pas de sous-unité), pour éviter les arrondis flottants.
 * Les quantités sont réelles : un article « vendu par poids/volume » se vend
 * en 1,5 kg ou 0,75 L.
 */
export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS points_vente (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nom        TEXT    NOT NULL UNIQUE,
      adresse    TEXT,
      telephone  TEXT,
      actif      INTEGER NOT NULL DEFAULT 1,
      cree_le    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS employes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nom_complet   TEXT    NOT NULL,
      identifiant   TEXT    NOT NULL UNIQUE,
      mot_de_passe  TEXT    NOT NULL,
      role          TEXT    NOT NULL CHECK (role IN ('admin','gerant','caissier','serveur')),
      telephone     TEXT,
      point_vente_id INTEGER REFERENCES points_vente(id) ON DELETE SET NULL,
      actif         INTEGER NOT NULL DEFAULT 1,
      cree_le       TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      libelle        TEXT    NOT NULL,
      couleur        TEXT    NOT NULL DEFAULT '#16a34a',
      position       INTEGER NOT NULL DEFAULT 0,
      point_vente_id INTEGER REFERENCES points_vente(id) ON DELETE CASCADE,
      cree_le        TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (libelle, point_vente_id)
    );

    CREATE TABLE IF NOT EXISTS articles (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      libelle        TEXT    NOT NULL,
      code           TEXT,
      categorie_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      point_vente_id INTEGER REFERENCES points_vente(id) ON DELETE CASCADE,
      -- 'chaque' : quantité entière ; 'poids_volume' : quantité décimale saisie en vente
      vendu_par      TEXT    NOT NULL DEFAULT 'chaque' CHECK (vendu_par IN ('chaque','poids_volume')),
      unite          TEXT    NOT NULL DEFAULT 'pièce',
      -- prix_vente = 0 signifie « prix libre », demandé au moment de la vente
      prix_vente     INTEGER NOT NULL DEFAULT 0,
      cout           INTEGER NOT NULL DEFAULT 0,
      suivi_stock    INTEGER NOT NULL DEFAULT 0,
      stock          REAL    NOT NULL DEFAULT 0,
      alerte_stock   REAL    NOT NULL DEFAULT 0,
      image          TEXT,
      actif          INTEGER NOT NULL DEFAULT 1,
      cree_le        TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_articles_cat ON articles(categorie_id);
    CREATE INDEX IF NOT EXISTS idx_articles_pv  ON articles(point_vente_id);

    CREATE TABLE IF NOT EXISTS mouvements_stock (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id  INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      type        TEXT    NOT NULL CHECK (type IN ('entree','sortie','ajustement','vente','annulation')),
      quantite    REAL    NOT NULL,
      stock_avant REAL    NOT NULL DEFAULT 0,
      stock_apres REAL    NOT NULL DEFAULT 0,
      cout_unitaire INTEGER NOT NULL DEFAULT 0,
      motif       TEXT,
      employe_id  INTEGER REFERENCES employes(id),
      vente_id    INTEGER REFERENCES ventes(id) ON DELETE SET NULL,
      cree_le     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mouv_article ON mouvements_stock(article_id);

    -- Une vente doit se rattacher à une période de travail ouverte (caisse ouverte).
    CREATE TABLE IF NOT EXISTS periodes_travail (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      point_vente_id INTEGER NOT NULL REFERENCES points_vente(id) ON DELETE CASCADE,
      employe_id     INTEGER NOT NULL REFERENCES employes(id),
      fond_caisse    INTEGER NOT NULL DEFAULT 0,
      montant_compte INTEGER,
      statut         TEXT    NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte','fermee')),
      note           TEXT,
      ouverte_le     TEXT    NOT NULL DEFAULT (datetime('now')),
      fermee_le      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_periodes_pv ON periodes_travail(point_vente_id, statut);

    CREATE TABLE IF NOT EXISTS ventes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      reference      TEXT    NOT NULL UNIQUE,
      point_vente_id INTEGER NOT NULL REFERENCES points_vente(id),
      periode_id     INTEGER REFERENCES periodes_travail(id) ON DELETE SET NULL,
      employe_id     INTEGER NOT NULL REFERENCES employes(id),
      client_id      INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      table_id       INTEGER REFERENCES tables_service(id) ON DELETE SET NULL,
      sous_total     INTEGER NOT NULL DEFAULT 0,
      remise_type    TEXT    NOT NULL DEFAULT 'montant' CHECK (remise_type IN ('montant','pourcentage')),
      remise_valeur  REAL    NOT NULL DEFAULT 0,
      remise_montant INTEGER NOT NULL DEFAULT 0,
      taxe           INTEGER NOT NULL DEFAULT 0,
      total          INTEGER NOT NULL DEFAULT 0,
      montant_recu   INTEGER NOT NULL DEFAULT 0,
      monnaie        INTEGER NOT NULL DEFAULT 0,
      mode_paiement  TEXT    NOT NULL DEFAULT 'especes'
                     CHECK (mode_paiement IN ('especes','mobile_money','carte','credit')),
      statut         TEXT    NOT NULL DEFAULT 'payee' CHECK (statut IN ('payee','annulee')),
      note           TEXT,
      cree_le        TEXT    NOT NULL DEFAULT (datetime('now')),
      annulee_le     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ventes_date   ON ventes(cree_le);
    CREATE INDEX IF NOT EXISTS idx_ventes_pv     ON ventes(point_vente_id);
    CREATE INDEX IF NOT EXISTS idx_ventes_periode ON ventes(periode_id);

    CREATE TABLE IF NOT EXISTS lignes_vente (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      vente_id      INTEGER NOT NULL REFERENCES ventes(id) ON DELETE CASCADE,
      article_id    INTEGER REFERENCES articles(id) ON DELETE SET NULL,
      libelle       TEXT    NOT NULL,
      prix_unitaire INTEGER NOT NULL,
      cout_unitaire INTEGER NOT NULL DEFAULT 0,
      quantite      REAL    NOT NULL,
      total         INTEGER NOT NULL,
      note          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lignes_vente ON lignes_vente(vente_id);

    CREATE TABLE IF NOT EXISTS clients (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nom        TEXT    NOT NULL,
      telephone  TEXT,
      email      TEXT,
      adresse    TEXT,
      note       TEXT,
      solde      INTEGER NOT NULL DEFAULT 0,
      cree_le    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS factures (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      reference      TEXT    NOT NULL UNIQUE,
      client_id      INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      vente_id       INTEGER REFERENCES ventes(id) ON DELETE SET NULL,
      point_vente_id INTEGER REFERENCES points_vente(id) ON DELETE SET NULL,
      statut         TEXT    NOT NULL DEFAULT 'emise'
                     CHECK (statut IN ('brouillon','emise','payee','annulee')),
      total          INTEGER NOT NULL DEFAULT 0,
      montant_paye   INTEGER NOT NULL DEFAULT 0,
      date_emission  TEXT    NOT NULL DEFAULT (date('now')),
      date_echeance  TEXT,
      note           TEXT,
      cree_le        TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lignes_facture (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      facture_id    INTEGER NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
      libelle       TEXT    NOT NULL,
      prix_unitaire INTEGER NOT NULL,
      quantite      REAL    NOT NULL,
      total         INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS depenses (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      libelle        TEXT    NOT NULL,
      categorie      TEXT    NOT NULL DEFAULT 'Divers',
      montant        INTEGER NOT NULL,
      beneficiaire   TEXT,
      point_vente_id INTEGER REFERENCES points_vente(id) ON DELETE SET NULL,
      employe_id     INTEGER REFERENCES employes(id),
      date_depense   TEXT    NOT NULL DEFAULT (date('now')),
      note           TEXT,
      cree_le        TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_depenses_date ON depenses(date_depense);

    CREATE TABLE IF NOT EXISTS tables_service (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      nom            TEXT    NOT NULL,
      zone           TEXT    NOT NULL DEFAULT 'Salle',
      places         INTEGER NOT NULL DEFAULT 4,
      point_vente_id INTEGER REFERENCES points_vente(id) ON DELETE CASCADE,
      UNIQUE (nom, point_vente_id)
    );

    CREATE TABLE IF NOT EXISTS parametres (
      cle    TEXT PRIMARY KEY,
      valeur TEXT NOT NULL
    );
  `);
}

export const PARAMETRES_DEFAUT = {
  nom_entreprise: 'Gesta+ Démo',
  adresse: 'Abidjan, Côte d’Ivoire',
  telephone: '+225 07 00 00 00 00',
  devise: 'Fcfa',
  taux_taxe: '0',
  pied_recu: 'Merci de votre confiance — à bientôt !',
};

export function lireParametres() {
  const rows = db.prepare('SELECT cle, valeur FROM parametres').all();
  const out = { ...PARAMETRES_DEFAUT };
  for (const r of rows) out[r.cle] = r.valeur;
  return out;
}

export function ecrireParametres(patch) {
  const stmt = db.prepare(
    'INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur',
  );
  db.transaction((entries) => {
    for (const [k, v] of entries) stmt.run(k, String(v));
  })(Object.entries(patch));
  return lireParametres();
}
