import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { routeAsync, valider, ErreurHttp } from '../lib/http.js';
import { exigerRole } from '../middleware/auth.js';

export const router = Router();

export const CATEGORIES_DEPENSE = [
  'Achat marchandise',
  'Salaire',
  'Loyer',
  'Électricité / Eau',
  'Transport',
  'Entretien',
  'Taxes',
  'Divers',
];

const schema = z.object({
  libelle: z.string().trim().min(1, 'le libellé est obligatoire'),
  categorie: z.string().trim().default('Divers'),
  montant: z.coerce.number().int().positive('le montant doit être supérieur à zéro'),
  beneficiaire: z.string().trim().nullish(),
  point_vente_id: z.coerce.number().int().nullish(),
  date_depense: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date attendue au format AAAA-MM-JJ')
    .default(() => new Date().toISOString().slice(0, 10)),
  note: z.string().trim().nullish(),
});

router.get('/categories', (req, res) => res.json(CATEGORIES_DEPENSE));

router.get('/', (req, res) => {
  const { du, au, categorie, point_vente_id } = req.query;
  const conditions = [];
  const p = {};
  if (du) {
    conditions.push('date(d.date_depense) >= date(@du)');
    p.du = du;
  }
  if (au) {
    conditions.push('date(d.date_depense) <= date(@au)');
    p.au = au;
  }
  if (categorie) {
    conditions.push('d.categorie = @categorie');
    p.categorie = categorie;
  }
  if (point_vente_id) {
    conditions.push('d.point_vente_id = @pv');
    p.pv = Number(point_vente_id);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const lignes = db
    .prepare(
      `SELECT d.*, e.nom_complet AS employe_nom, pv.nom AS point_vente_nom
         FROM depenses d
         LEFT JOIN employes e ON e.id = d.employe_id
         LEFT JOIN points_vente pv ON pv.id = d.point_vente_id
        ${where} ORDER BY d.date_depense DESC, d.id DESC LIMIT 300`,
    )
    .all(p);

  const total = db.prepare(`SELECT IFNULL(SUM(d.montant), 0) AS t FROM depenses d ${where}`).get(p).t;
  const parCategorie = db
    .prepare(
      `SELECT d.categorie, IFNULL(SUM(d.montant), 0) AS total FROM depenses d ${where}
        GROUP BY d.categorie ORDER BY total DESC`,
    )
    .all(p);

  res.json({ lignes, total, par_categorie: parCategorie });
});

router.post(
  '/',
  routeAsync((req, res) => {
    const d = valider(schema, req.body);
    const info = db
      .prepare(
        `INSERT INTO depenses
           (libelle, categorie, montant, beneficiaire, point_vente_id, employe_id, date_depense, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        d.libelle,
        d.categorie,
        d.montant,
        d.beneficiaire || null,
        d.point_vente_id || req.employe.point_vente_id || null,
        req.employe.id,
        d.date_depense,
        d.note || null,
      );
    res.status(201).json(db.prepare('SELECT * FROM depenses WHERE id = ?').get(info.lastInsertRowid));
  }),
);

router.put(
  '/:id',
  exigerRole('gerant'),
  routeAsync((req, res) => {
    const d = valider(schema, req.body);
    const info = db
      .prepare(
        `UPDATE depenses SET libelle = ?, categorie = ?, montant = ?, beneficiaire = ?,
                point_vente_id = ?, date_depense = ?, note = ? WHERE id = ?`,
      )
      .run(
        d.libelle,
        d.categorie,
        d.montant,
        d.beneficiaire || null,
        d.point_vente_id || null,
        d.date_depense,
        d.note || null,
        req.params.id,
      );
    if (!info.changes) throw new ErreurHttp(404, 'Dépense introuvable');
    res.json(db.prepare('SELECT * FROM depenses WHERE id = ?').get(req.params.id));
  }),
);

router.delete(
  '/:id',
  exigerRole('gerant'),
  routeAsync((req, res) => {
    const info = db.prepare('DELETE FROM depenses WHERE id = ?').run(req.params.id);
    if (!info.changes) throw new ErreurHttp(404, 'Dépense introuvable');
    res.json({ ok: true });
  }),
);
