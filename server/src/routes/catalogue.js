import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { routeAsync, valider, ErreurHttp, bit } from '../lib/http.js';
import { exigerRole } from '../middleware/auth.js';

export const router = Router();
const gerer = exigerRole('gerant');

/* ------------------------------- Catégories ------------------------------ */

const schemaCategorie = z.object({
  libelle: z.string().trim().min(1, 'le libellé est obligatoire'),
  couleur: z.string().trim().default('#16a34a'),
  position: z.coerce.number().int().default(0),
  point_vente_id: z.coerce.number().int({ message: 'le point de vente est obligatoire' }),
});

router.get('/categories', (req, res) => {
  const pv = Number(req.query.point_vente_id) || null;
  res.json(
    db
      .prepare(
        `SELECT c.*, pv.nom AS point_vente_nom,
                (SELECT COUNT(*) FROM articles a WHERE a.categorie_id = c.id AND a.actif = 1)
                  AS nb_articles
           FROM categories c
           LEFT JOIN points_vente pv ON pv.id = c.point_vente_id
          WHERE (@pv IS NULL OR c.point_vente_id = @pv)
          ORDER BY c.position, c.libelle`,
      )
      .all({ pv }),
  );
});

router.post(
  '/categories',
  gerer,
  routeAsync((req, res) => {
    const d = valider(schemaCategorie, req.body);
    const doublon = db
      .prepare('SELECT id FROM categories WHERE lower(libelle) = lower(?) AND point_vente_id = ?')
      .get(d.libelle, d.point_vente_id);
    if (doublon) throw new ErreurHttp(400, 'Cette catégorie existe déjà sur ce point de vente');

    const info = db
      .prepare(
        'INSERT INTO categories (libelle, couleur, position, point_vente_id) VALUES (?, ?, ?, ?)',
      )
      .run(d.libelle, d.couleur, d.position, d.point_vente_id);
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
  }),
);

router.put(
  '/categories/:id',
  gerer,
  routeAsync((req, res) => {
    const d = valider(schemaCategorie, req.body);
    const info = db
      .prepare(
        `UPDATE categories SET libelle = ?, couleur = ?, position = ?, point_vente_id = ?
          WHERE id = ?`,
      )
      .run(d.libelle, d.couleur, d.position, d.point_vente_id, req.params.id);
    if (!info.changes) throw new ErreurHttp(404, 'Catégorie introuvable');
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
  }),
);

router.delete(
  '/categories/:id',
  gerer,
  routeAsync((req, res) => {
    // Les articles de la catégorie basculent en « Aucune Catégorie » (categorie_id = NULL).
    const info = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    if (!info.changes) throw new ErreurHttp(404, 'Catégorie introuvable');
    res.json({ ok: true });
  }),
);

/* -------------------------------- Articles ------------------------------- */

const schemaArticle = z.object({
  libelle: z.string().trim().min(1, 'le libellé est obligatoire'),
  code: z.string().trim().nullish(),
  categorie_id: z.coerce.number().int().nullish(),
  point_vente_id: z.coerce.number().int({ message: 'le point de vente est obligatoire' }),
  vendu_par: z.enum(['chaque', 'poids_volume']).default('chaque'),
  unite: z.string().trim().default('pièce'),
  // 0 est autorisé : l'article est alors à prix libre, saisi pendant la vente.
  prix_vente: z.coerce.number().int().min(0, 'le prix de vente ne peut pas être négatif').default(0),
  cout: z.coerce.number().int().min(0).default(0),
  suivi_stock: z.coerce.boolean().default(false),
  stock: z.coerce.number().default(0),
  alerte_stock: z.coerce.number().min(0).default(0),
  image: z.string().trim().nullish(),
  actif: z.coerce.boolean().default(true),
});

const SELECT_ARTICLE = `
  SELECT a.*, c.libelle AS categorie_libelle, c.couleur AS categorie_couleur,
         pv.nom AS point_vente_nom,
         (a.suivi_stock = 1 AND a.stock <= a.alerte_stock) AS en_alerte
    FROM articles a
    LEFT JOIN categories c ON c.id = a.categorie_id
    LEFT JOIN points_vente pv ON pv.id = a.point_vente_id`;

router.get('/articles', (req, res) => {
  const { recherche, categorie_id, point_vente_id, actifs_seulement } = req.query;
  const conditions = [];
  const p = {};

  if (recherche) {
    conditions.push('(a.libelle LIKE @q OR IFNULL(a.code, "") LIKE @q)');
    p.q = `%${recherche}%`;
  }
  if (categorie_id === 'aucune') {
    conditions.push('a.categorie_id IS NULL');
  } else if (categorie_id) {
    conditions.push('a.categorie_id = @cat');
    p.cat = Number(categorie_id);
  }
  if (point_vente_id) {
    conditions.push('a.point_vente_id = @pv');
    p.pv = Number(point_vente_id);
  }
  if (actifs_seulement === 'true') conditions.push('a.actif = 1');

  res.json(
    db
      .prepare(
        `${SELECT_ARTICLE} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
         ORDER BY a.libelle`,
      )
      .all(p),
  );
});

router.get(
  '/articles/:id',
  routeAsync((req, res) => {
    const a = db.prepare(`${SELECT_ARTICLE} WHERE a.id = ?`).get(req.params.id);
    if (!a) throw new ErreurHttp(404, 'Article introuvable');
    res.json(a);
  }),
);

const champsArticle = (d) => ({
  ...d,
  code: d.code || null,
  categorie_id: d.categorie_id || null,
  image: d.image || null,
  suivi_stock: bit(d.suivi_stock),
  actif: bit(d.actif),
});

router.post(
  '/articles',
  gerer,
  routeAsync((req, res) => {
    const d = valider(schemaArticle, req.body);
    const info = db
      .prepare(
        `INSERT INTO articles
           (libelle, code, categorie_id, point_vente_id, vendu_par, unite, prix_vente, cout,
            suivi_stock, stock, alerte_stock, image, actif)
         VALUES (@libelle, @code, @categorie_id, @point_vente_id, @vendu_par, @unite, @prix_vente,
                 @cout, @suivi_stock, @stock, @alerte_stock, @image, @actif)`,
      )
      .run(champsArticle(d));

    // Le stock initial est tracé comme une entrée, pour que l'historique soit complet.
    if (d.suivi_stock && d.stock > 0) {
      db.prepare(
        `INSERT INTO mouvements_stock
           (article_id, type, quantite, stock_avant, stock_apres, cout_unitaire, motif, employe_id)
         VALUES (?, 'entree', ?, 0, ?, ?, 'Stock initial', ?)`,
      ).run(info.lastInsertRowid, d.stock, d.stock, d.cout, req.employe.id);
    }

    res.status(201).json(db.prepare(`${SELECT_ARTICLE} WHERE a.id = ?`).get(info.lastInsertRowid));
  }),
);

router.put(
  '/articles/:id',
  gerer,
  routeAsync((req, res) => {
    const d = valider(schemaArticle, req.body);
    const actuel = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
    if (!actuel) throw new ErreurHttp(404, 'Article introuvable');

    db.prepare(
      `UPDATE articles SET libelle = @libelle, code = @code, categorie_id = @categorie_id,
              point_vente_id = @point_vente_id, vendu_par = @vendu_par, unite = @unite,
              prix_vente = @prix_vente, cout = @cout, suivi_stock = @suivi_stock,
              alerte_stock = @alerte_stock, image = @image, actif = @actif
        WHERE id = @id`,
    ).run({ ...champsArticle(d), id: Number(req.params.id) });

    res.json(db.prepare(`${SELECT_ARTICLE} WHERE a.id = ?`).get(req.params.id));
  }),
);

router.delete(
  '/articles/:id',
  gerer,
  routeAsync((req, res) => {
    // Un article déjà vendu est désactivé, jamais supprimé : l'historique doit rester lisible.
    const vendu = db
      .prepare('SELECT COUNT(*) AS n FROM lignes_vente WHERE article_id = ?')
      .get(req.params.id).n;
    if (vendu) {
      const info = db.prepare('UPDATE articles SET actif = 0 WHERE id = ?').run(req.params.id);
      if (!info.changes) throw new ErreurHttp(404, 'Article introuvable');
      return res.json({ ok: true, desactive: true });
    }
    const info = db.prepare('DELETE FROM articles WHERE id = ?').run(req.params.id);
    if (!info.changes) throw new ErreurHttp(404, 'Article introuvable');
    res.json({ ok: true, desactive: false });
  }),
);
