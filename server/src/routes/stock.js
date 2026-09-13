import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { asyncRoute, parse, HttpError } from '../lib/http.js';

export const router = Router();

const moveSchema = z.object({
  product_id: z.coerce.number().int(),
  type: z.enum(['entree', 'sortie', 'ajustement']),
  quantity: z.coerce.number().positive('la quantité doit être supérieure à zéro'),
  unit_cost: z.coerce.number().int().min(0).default(0),
  reason: z.string().trim().nullish(),
});

router.get('/moves', (req, res) => {
  const { product_id, limit = 100 } = req.query;
  const where = product_id ? 'WHERE m.product_id = @product_id' : '';
  res.json(
    db
      .prepare(
        `SELECT m.*, p.name AS product_name, p.unit, u.full_name AS user_name
           FROM stock_moves m
           JOIN products p ON p.id = m.product_id
           LEFT JOIN users u ON u.id = m.user_id
          ${where}
          ORDER BY m.created_at DESC, m.id DESC LIMIT @limit`,
      )
      .all({ product_id: Number(product_id) || 0, limit: Math.min(Number(limit) || 100, 500) }),
  );
});

router.get('/alerts', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT p.*, c.name AS category_name
           FROM products p LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.active = 1 AND p.track_stock = 1 AND p.stock <= p.stock_alert
          ORDER BY (p.stock - p.stock_alert), p.name`,
      )
      .all(),
  );
});

router.post(
  '/moves',
  asyncRoute((req, res) => {
    const d = parse(moveSchema, req.body);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(d.product_id);
    if (!product) throw new HttpError(404, 'Produit introuvable');

    // Un ajustement fixe le stock à la valeur saisie ; entrée/sortie le font varier.
    const delta =
      d.type === 'ajustement'
        ? d.quantity - product.stock
        : d.type === 'entree'
          ? d.quantity
          : -d.quantity;

    if (product.stock + delta < 0) {
      throw new HttpError(400, `Stock insuffisant : il reste ${product.stock} ${product.unit}`);
    }

    const run = db.transaction(() => {
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(delta, product.id);
      if (d.type === 'entree' && d.unit_cost > 0) {
        db.prepare('UPDATE products SET cost_price = ? WHERE id = ?').run(d.unit_cost, product.id);
      }
      db.prepare(
        `INSERT INTO stock_moves (product_id, type, quantity, unit_cost, reason, user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(product.id, d.type, Math.abs(delta), d.unit_cost, d.reason || null, req.user.id);
    });

    run();
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(product.id));
  }),
);
