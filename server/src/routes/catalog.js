import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { asyncRoute, parse, HttpError } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';

export const router = Router();
const manage = requireRole('gerant');

/* ------------------------------- Catégories ------------------------------ */

const categorySchema = z.object({
  name: z.string().trim().min(1, 'nom obligatoire'),
  color: z.string().trim().default('#f59e0b'),
  position: z.coerce.number().int().default(0),
});

router.get('/categories', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1)
                AS product_count
           FROM categories c ORDER BY c.position, c.name`,
      )
      .all(),
  );
});

router.post(
  '/categories',
  manage,
  asyncRoute((req, res) => {
    const data = parse(categorySchema, req.body);
    const info = db
      .prepare('INSERT INTO categories (name, color, position) VALUES (?, ?, ?)')
      .run(data.name, data.color, data.position);
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
  }),
);

router.put(
  '/categories/:id',
  manage,
  asyncRoute((req, res) => {
    const data = parse(categorySchema, req.body);
    const info = db
      .prepare('UPDATE categories SET name = ?, color = ?, position = ? WHERE id = ?')
      .run(data.name, data.color, data.position, req.params.id);
    if (!info.changes) throw new HttpError(404, 'Catégorie introuvable');
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
  }),
);

router.delete(
  '/categories/:id',
  manage,
  asyncRoute((req, res) => {
    const info = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    if (!info.changes) throw new HttpError(404, 'Catégorie introuvable');
    res.json({ ok: true });
  }),
);

/* -------------------------------- Produits ------------------------------- */

const productSchema = z.object({
  name: z.string().trim().min(1, 'nom obligatoire'),
  sku: z.string().trim().nullish(),
  category_id: z.coerce.number().int().nullish(),
  unit: z.string().trim().default('pièce'),
  cost_price: z.coerce.number().int().min(0).default(0),
  sale_price: z.coerce.number().int().min(0, 'le prix de vente doit être positif'),
  stock: z.coerce.number().default(0),
  stock_alert: z.coerce.number().min(0).default(0),
  track_stock: z.coerce.boolean().default(true),
  active: z.coerce.boolean().default(true),
});

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, c.color AS category_color
    FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

router.get('/products', (req, res) => {
  const { search = '', category, only_active } = req.query;
  const where = [];
  const params = {};

  if (search) {
    where.push('(p.name LIKE @q OR IFNULL(p.sku, "") LIKE @q)');
    params.q = `%${search}%`;
  }
  if (category) {
    where.push('p.category_id = @category');
    params.category = Number(category);
  }
  if (only_active === 'true') where.push('p.active = 1');

  const sql = `${PRODUCT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.name`;
  res.json(db.prepare(sql).all(params));
});

router.post(
  '/products',
  manage,
  asyncRoute((req, res) => {
    const d = parse(productSchema, req.body);
    const info = db
      .prepare(
        `INSERT INTO products
           (name, sku, category_id, unit, cost_price, sale_price, stock, stock_alert, track_stock, active)
         VALUES (@name, @sku, @category_id, @unit, @cost_price, @sale_price, @stock, @stock_alert,
                 @track_stock, @active)`,
      )
      .run({
        ...d,
        sku: d.sku || null,
        category_id: d.category_id || null,
        track_stock: d.track_stock ? 1 : 0,
        active: d.active ? 1 : 0,
      });
    res.status(201).json(db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(info.lastInsertRowid));
  }),
);

router.put(
  '/products/:id',
  manage,
  asyncRoute((req, res) => {
    const d = parse(productSchema, req.body);
    const info = db
      .prepare(
        `UPDATE products SET name = @name, sku = @sku, category_id = @category_id, unit = @unit,
                cost_price = @cost_price, sale_price = @sale_price, stock = @stock,
                stock_alert = @stock_alert, track_stock = @track_stock, active = @active
          WHERE id = @id`,
      )
      .run({
        ...d,
        id: Number(req.params.id),
        sku: d.sku || null,
        category_id: d.category_id || null,
        track_stock: d.track_stock ? 1 : 0,
        active: d.active ? 1 : 0,
      });
    if (!info.changes) throw new HttpError(404, 'Produit introuvable');
    res.json(db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(req.params.id));
  }),
);

router.delete(
  '/products/:id',
  manage,
  asyncRoute((req, res) => {
    // Un produit déjà vendu est archivé plutôt que supprimé, pour préserver l'historique.
    const sold = db
      .prepare('SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?')
      .get(req.params.id).n;
    if (sold) {
      db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
      return res.json({ ok: true, archived: true });
    }
    const info = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    if (!info.changes) throw new HttpError(404, 'Produit introuvable');
    res.json({ ok: true, archived: false });
  }),
);
