import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultFile = path.join(here, '..', '..', 'data', 'maquispos.db');
const file = process.env.DATABASE_FILE
  ? path.resolve(process.cwd(), process.env.DATABASE_FILE)
  : defaultFile;

fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const DB_FILE = file;

/**
 * Toutes les valeurs monétaires sont stockées en entiers (unité de base de la
 * devise, ex. le franc CFA) pour éviter les erreurs d'arrondi des flottants.
 */
export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name     TEXT    NOT NULL,
      username      TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL CHECK (role IN ('admin','gerant','caissier','serveur')),
      phone         TEXT,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE,
      color      TEXT    NOT NULL DEFAULT '#f59e0b',
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      sku           TEXT    UNIQUE,
      category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      unit          TEXT    NOT NULL DEFAULT 'pièce',
      cost_price    INTEGER NOT NULL DEFAULT 0,
      sale_price    INTEGER NOT NULL DEFAULT 0,
      stock         REAL    NOT NULL DEFAULT 0,
      stock_alert   REAL    NOT NULL DEFAULT 0,
      track_stock   INTEGER NOT NULL DEFAULT 1,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

    CREATE TABLE IF NOT EXISTS tables_map (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT    NOT NULL UNIQUE,
      zone     TEXT    NOT NULL DEFAULT 'Salle',
      seats    INTEGER NOT NULL DEFAULT 4,
      status   TEXT    NOT NULL DEFAULT 'libre' CHECK (status IN ('libre','occupee','reservee'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      phone      TEXT,
      email      TEXT,
      note       TEXT,
      balance    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      phone      TEXT,
      email      TEXT,
      address    TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      reference     TEXT    NOT NULL UNIQUE,
      table_id      INTEGER REFERENCES tables_map(id) ON DELETE SET NULL,
      customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      user_id       INTEGER NOT NULL REFERENCES users(id),
      status        TEXT    NOT NULL DEFAULT 'ouverte'
                    CHECK (status IN ('ouverte','payee','annulee')),
      subtotal      INTEGER NOT NULL DEFAULT 0,
      discount      INTEGER NOT NULL DEFAULT 0,
      tax           INTEGER NOT NULL DEFAULT 0,
      total         INTEGER NOT NULL DEFAULT 0,
      paid          INTEGER NOT NULL DEFAULT 0,
      payment_method TEXT   CHECK (payment_method IN ('especes','mobile_money','carte','credit')),
      note          TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      closed_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

    CREATE TABLE IF NOT EXISTS order_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
      name        TEXT    NOT NULL,
      unit_price  INTEGER NOT NULL,
      quantity    REAL    NOT NULL,
      total       INTEGER NOT NULL,
      note        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

    CREATE TABLE IF NOT EXISTS stock_moves (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      type        TEXT    NOT NULL CHECK (type IN ('entree','sortie','ajustement','vente')),
      quantity    REAL    NOT NULL,
      unit_cost   INTEGER NOT NULL DEFAULT 0,
      reason      TEXT,
      user_id     INTEGER REFERENCES users(id),
      order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_moves(product_id);

    CREATE TABLE IF NOT EXISTS expenses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      label       TEXT    NOT NULL,
      category    TEXT    NOT NULL DEFAULT 'Divers',
      amount      INTEGER NOT NULL,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      user_id     INTEGER REFERENCES users(id),
      spent_at    TEXT    NOT NULL DEFAULT (date('now')),
      note        TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(spent_at);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export const DEFAULT_SETTINGS = {
  business_name: 'Maquis Le Baobab',
  address: 'Cocody, Abidjan',
  phone: '+225 07 00 00 00 00',
  currency: 'FCFA',
  tax_rate: '0',
  footer_ticket: 'Merci de votre visite — à bientôt !',
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSettings(patch) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) stmt.run(k, String(v));
  });
  tx(Object.entries(patch));
  return getSettings();
}
