import { Router } from 'express';
import { z } from 'zod';
import { db, getSettings } from '../lib/db.js';
import { asyncRoute, parse, HttpError } from '../lib/http.js';

export const router = Router();

const itemSchema = z.object({
  product_id: z.coerce.number().int().nullish(),
  name: z.string().trim().min(1),
  unit_price: z.coerce.number().int().min(0),
  quantity: z.coerce.number().positive('la quantité doit être supérieure à zéro'),
  note: z.string().trim().nullish(),
});

const orderSchema = z.object({
  table_id: z.coerce.number().int().nullish(),
  customer_id: z.coerce.number().int().nullish(),
  discount: z.coerce.number().int().min(0).default(0),
  note: z.string().trim().nullish(),
  items: z.array(itemSchema).min(1, 'la commande doit contenir au moins une ligne'),
});

const paymentSchema = z.object({
  payment_method: z.enum(['especes', 'mobile_money', 'carte', 'credit']),
  paid: z.coerce.number().int().min(0),
});

function nextReference() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const n = db
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE date(created_at) = date('now')")
    .get().n;
  return `CMD-${today}-${String(n + 1).padStart(4, '0')}`;
}

/** Recalcule sous-total, TVA et total à partir des lignes enregistrées. */
function recomputeTotals(orderId, discount) {
  const subtotal = db
    .prepare('SELECT IFNULL(SUM(total), 0) AS s FROM order_items WHERE order_id = ?')
    .get(orderId).s;
  const rate = Number(getSettings().tax_rate) || 0;
  const base = Math.max(0, subtotal - discount);
  const tax = Math.round((base * rate) / 100);
  const total = base + tax;
  db.prepare('UPDATE orders SET subtotal = ?, discount = ?, tax = ?, total = ? WHERE id = ?').run(
    subtotal,
    discount,
    tax,
    total,
    orderId,
  );
  return { subtotal, discount, tax, total };
}

/**
 * Applique la variation de stock d'une commande.
 * `sign` vaut -1 quand on consomme du stock, +1 quand on le restitue.
 */
function applyStock(orderId, userId, sign) {
  const items = db
    .prepare(
      `SELECT oi.product_id, oi.quantity, p.track_stock
         FROM order_items oi JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ? AND p.track_stock = 1`,
    )
    .all(orderId);
  const updateStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
  const logMove = db.prepare(
    `INSERT INTO stock_moves (product_id, type, quantity, reason, user_id, order_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const it of items) {
    updateStock.run(sign * it.quantity, it.product_id);
    logMove.run(
      it.product_id,
      sign < 0 ? 'vente' : 'entree',
      it.quantity,
      sign < 0 ? 'Vente' : 'Annulation de vente',
      userId,
      orderId,
    );
  }
}

function loadOrder(id) {
  const order = db
    .prepare(
      `SELECT o.*, t.name AS table_name, c.name AS customer_name, u.full_name AS user_name
         FROM orders o
         LEFT JOIN tables_map t ON t.id = o.table_id
         LEFT JOIN customers  c ON c.id = o.customer_id
         LEFT JOIN users      u ON u.id = o.user_id
        WHERE o.id = ?`,
    )
    .get(id);
  if (!order) throw new HttpError(404, 'Commande introuvable');
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id);
  return order;
}

/** Libère la table si plus aucune commande ouverte ne l'occupe. */
function refreshTableStatus(tableId) {
  if (!tableId) return;
  const open = db
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE table_id = ? AND status = 'ouverte'")
    .get(tableId).n;
  db.prepare('UPDATE tables_map SET status = ? WHERE id = ?').run(open ? 'occupee' : 'libre', tableId);
}

/* --------------------------------- Routes -------------------------------- */

router.get('/', (req, res) => {
  const { status, from, to, limit = 100 } = req.query;
  const where = [];
  const params = {};
  if (status) {
    where.push('o.status = @status');
    params.status = status;
  }
  if (from) {
    where.push('date(o.created_at) >= date(@from)');
    params.from = from;
  }
  if (to) {
    where.push('date(o.created_at) <= date(@to)');
    params.to = to;
  }
  params.limit = Math.min(Number(limit) || 100, 500);

  res.json(
    db
      .prepare(
        `SELECT o.*, t.name AS table_name, c.name AS customer_name, u.full_name AS user_name,
                (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
           FROM orders o
           LEFT JOIN tables_map t ON t.id = o.table_id
           LEFT JOIN customers  c ON c.id = o.customer_id
           LEFT JOIN users      u ON u.id = o.user_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY o.created_at DESC LIMIT @limit`,
      )
      .all(params),
  );
});

router.get(
  '/:id',
  asyncRoute((req, res) => res.json(loadOrder(Number(req.params.id)))),
);

router.post(
  '/',
  asyncRoute((req, res) => {
    const d = parse(orderSchema, req.body);
    const userId = req.user.id;

    const create = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO orders (reference, table_id, customer_id, user_id, note)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(nextReference(), d.table_id || null, d.customer_id || null, userId, d.note || null);
      const orderId = Number(info.lastInsertRowid);

      const addItem = db.prepare(
        `INSERT INTO order_items (order_id, product_id, name, unit_price, quantity, total, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const it of d.items) {
        addItem.run(
          orderId,
          it.product_id || null,
          it.name,
          it.unit_price,
          it.quantity,
          Math.round(it.unit_price * it.quantity),
          it.note || null,
        );
      }

      recomputeTotals(orderId, d.discount);
      applyStock(orderId, userId, -1);
      if (d.table_id) {
        db.prepare("UPDATE tables_map SET status = 'occupee' WHERE id = ?").run(d.table_id);
      }
      return orderId;
    });

    res.status(201).json(loadOrder(create()));
  }),
);

router.put(
  '/:id',
  asyncRoute((req, res) => {
    const id = Number(req.params.id);
    const d = parse(orderSchema, req.body);
    const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Commande introuvable');
    if (existing.status !== 'ouverte') {
      throw new HttpError(400, 'Seule une commande ouverte peut être modifiée');
    }

    const update = db.transaction(() => {
      // On restitue l'ancien stock avant de réécrire les lignes, puis on redéduit.
      applyStock(id, req.user.id, +1);
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);

      const addItem = db.prepare(
        `INSERT INTO order_items (order_id, product_id, name, unit_price, quantity, total, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const it of d.items) {
        addItem.run(
          id,
          it.product_id || null,
          it.name,
          it.unit_price,
          it.quantity,
          Math.round(it.unit_price * it.quantity),
          it.note || null,
        );
      }

      db.prepare('UPDATE orders SET table_id = ?, customer_id = ?, note = ? WHERE id = ?').run(
        d.table_id || null,
        d.customer_id || null,
        d.note || null,
        id,
      );
      recomputeTotals(id, d.discount);
      applyStock(id, req.user.id, -1);
      refreshTableStatus(existing.table_id);
      if (d.table_id) {
        db.prepare("UPDATE tables_map SET status = 'occupee' WHERE id = ?").run(d.table_id);
      }
    });

    update();
    res.json(loadOrder(id));
  }),
);

router.post(
  '/:id/pay',
  asyncRoute((req, res) => {
    const id = Number(req.params.id);
    const d = parse(paymentSchema, req.body);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw new HttpError(404, 'Commande introuvable');
    if (order.status !== 'ouverte') throw new HttpError(400, 'Cette commande est déjà clôturée');
    if (d.payment_method !== 'credit' && d.paid < order.total) {
      throw new HttpError(400, 'Le montant encaissé est inférieur au total à payer');
    }
    if (d.payment_method === 'credit' && !order.customer_id) {
      throw new HttpError(400, 'Une vente à crédit doit être rattachée à un client');
    }

    const pay = db.transaction(() => {
      db.prepare(
        `UPDATE orders SET status = 'payee', paid = ?, payment_method = ?,
                closed_at = datetime('now') WHERE id = ?`,
      ).run(d.paid, d.payment_method, id);

      if (d.payment_method === 'credit') {
        const due = order.total - d.paid;
        db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(
          due,
          order.customer_id,
        );
      }
      refreshTableStatus(order.table_id);
    });

    pay();
    res.json({ ...loadOrder(id), change: Math.max(0, d.paid - order.total) });
  }),
);

router.post(
  '/:id/cancel',
  asyncRoute((req, res) => {
    const id = Number(req.params.id);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw new HttpError(404, 'Commande introuvable');
    if (order.status === 'annulee') throw new HttpError(400, 'Commande déjà annulée');
    if (order.status === 'payee' && req.user.role !== 'admin' && req.user.role !== 'gerant') {
      throw new HttpError(403, 'Seul un gérant peut annuler une commande déjà payée');
    }

    const cancel = db.transaction(() => {
      applyStock(id, req.user.id, +1);
      if (order.status === 'payee' && order.payment_method === 'credit' && order.customer_id) {
        db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(
          order.total - order.paid,
          order.customer_id,
        );
      }
      db.prepare(
        "UPDATE orders SET status = 'annulee', closed_at = datetime('now') WHERE id = ?",
      ).run(id);
      refreshTableStatus(order.table_id);
    });

    cancel();
    res.json(loadOrder(id));
  }),
);
