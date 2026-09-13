import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { routeAsync, valider, ErreurHttp } from '../lib/http.js';

export const router = Router();

/** Écrit un mouvement et met le stock de l'article à jour, de façon atomique. */
export function enregistrerMouvement({ article, type, quantite, cout_unitaire = 0, motif, employe_id, vente_id = null }) {
  const avant = article.stock;
  const delta = type === 'entree' || type === 'annulation' ? quantite : -quantite;
  const apres = avant + delta;

  db.prepare('UPDATE articles SET stock = ? WHERE id = ?').run(apres, article.id);
  db.prepare(
    `INSERT INTO mouvements_stock
       (article_id, type, quantite, stock_avant, stock_apres, cout_unitaire, motif, employe_id, vente_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(article.id, type, Math.abs(quantite), avant, apres, cout_unitaire, motif || null, employe_id, vente_id);

  return apres;
}

/* 5.1 — Suivi des niveaux de stock */

router.get('/niveaux', (req, res) => {
  const pv = Number(req.query.point_vente_id) || null;
  res.json(
    db
      .prepare(
        `SELECT a.id, a.libelle, a.unite, a.stock, a.alerte_stock, a.cout, a.prix_vente,
                a.image, c.libelle AS categorie_libelle,
                (a.stock * a.cout) AS valeur_stock,
                CASE WHEN a.stock <= 0 THEN 'rupture'
                     WHEN a.stock <= a.alerte_stock THEN 'alerte'
                     ELSE 'ok' END AS niveau
           FROM articles a
           LEFT JOIN categories c ON c.id = a.categorie_id
          WHERE a.actif = 1 AND a.suivi_stock = 1
            AND (@pv IS NULL OR a.point_vente_id = @pv)
          ORDER BY (a.stock - a.alerte_stock), a.libelle`,
      )
      .all({ pv }),
  );
});

router.get('/mouvements', (req, res) => {
  const { article_id, type, limite = 200 } = req.query;
  const conditions = [];
  const p = { limite: Math.min(Number(limite) || 200, 500) };
  if (article_id) {
    conditions.push('m.article_id = @article_id');
    p.article_id = Number(article_id);
  }
  if (type) {
    conditions.push('m.type = @type');
    p.type = type;
  }
  res.json(
    db
      .prepare(
        `SELECT m.*, a.libelle AS article_libelle, a.unite, e.nom_complet AS employe_nom,
                v.reference AS vente_reference
           FROM mouvements_stock m
           JOIN articles a ON a.id = m.article_id
           LEFT JOIN employes e ON e.id = m.employe_id
           LEFT JOIN ventes v ON v.id = m.vente_id
          ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
          ORDER BY m.cree_le DESC, m.id DESC LIMIT @limite`,
      )
      .all(p),
  );
});

/* 5.2 Entrées — 5.3 Sorties et ajustements */

const schemaMouvement = z.object({
  article_id: z.coerce.number().int(),
  type: z.enum(['entree', 'sortie', 'ajustement']),
  quantite: z.coerce.number().min(0, 'la quantité ne peut pas être négative'),
  cout_unitaire: z.coerce.number().int().min(0).default(0),
  motif: z.string().trim().nullish(),
});

router.post(
  '/mouvements',
  routeAsync((req, res) => {
    const d = valider(schemaMouvement, req.body);
    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(d.article_id);
    if (!article) throw new ErreurHttp(404, 'Article introuvable');
    if (!article.suivi_stock) {
      throw new ErreurHttp(400, `Le suivi de stock n'est pas activé sur « ${article.libelle} »`);
    }
    if (d.type !== 'ajustement' && d.quantite <= 0) {
      throw new ErreurHttp(400, 'La quantité doit être supérieure à zéro');
    }
    if (d.type === 'sortie' && d.quantite > article.stock) {
      throw new ErreurHttp(
        400,
        `Stock insuffisant : il reste ${article.stock} ${article.unite} de « ${article.libelle} »`,
      );
    }

    db.transaction(() => {
      if (d.type === 'ajustement') {
        // Un ajustement fixe le stock à la valeur comptée sur le terrain.
        const ecart = d.quantite - article.stock;
        db.prepare('UPDATE articles SET stock = ? WHERE id = ?').run(d.quantite, article.id);
        db.prepare(
          `INSERT INTO mouvements_stock
             (article_id, type, quantite, stock_avant, stock_apres, motif, employe_id)
           VALUES (?, 'ajustement', ?, ?, ?, ?, ?)`,
        ).run(
          article.id,
          Math.abs(ecart),
          article.stock,
          d.quantite,
          d.motif || 'Inventaire',
          req.employe.id,
        );
      } else {
        enregistrerMouvement({
          article,
          type: d.type,
          quantite: d.quantite,
          cout_unitaire: d.cout_unitaire,
          motif: d.motif,
          employe_id: req.employe.id,
        });
        // Une entrée chiffrée met à jour le coût d'achat de référence de l'article.
        if (d.type === 'entree' && d.cout_unitaire > 0) {
          db.prepare('UPDATE articles SET cout = ? WHERE id = ?').run(d.cout_unitaire, article.id);
        }
      }
    })();

    res.status(201).json(db.prepare('SELECT * FROM articles WHERE id = ?').get(article.id));
  }),
);
