import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, lireParametres, ecrireParametres } from '../lib/db.js';
import { routeAsync, valider, ErreurHttp, bit } from '../lib/http.js';
import { exigerRole } from '../middleware/auth.js';
import { chargerEmploye } from '../middleware/auth.js';

export const router = Router();
const gerer = exigerRole('gerant');

/* --------------------- 11.3 Points de vente (dépôts) ---------------------- */

const schemaPointVente = z.object({
  nom: z.string().trim().min(1, 'le nom est obligatoire'),
  adresse: z.string().trim().nullish(),
  telephone: z.string().trim().nullish(),
  actif: z.coerce.boolean().default(true),
});

router.get('/points-vente', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT pv.*,
                (SELECT COUNT(*) FROM articles a WHERE a.point_vente_id = pv.id AND a.actif = 1)
                  AS nb_articles,
                (SELECT COUNT(*) FROM employes e WHERE e.point_vente_id = pv.id AND e.actif = 1)
                  AS nb_employes
           FROM points_vente pv ORDER BY pv.nom`,
      )
      .all(),
  );
});

router.post(
  '/points-vente',
  gerer,
  routeAsync((req, res) => {
    const d = valider(schemaPointVente, req.body);
    const info = db
      .prepare('INSERT INTO points_vente (nom, adresse, telephone, actif) VALUES (?, ?, ?, ?)')
      .run(d.nom, d.adresse || null, d.telephone || null, bit(d.actif));
    res.status(201).json(db.prepare('SELECT * FROM points_vente WHERE id = ?').get(info.lastInsertRowid));
  }),
);

router.put(
  '/points-vente/:id',
  gerer,
  routeAsync((req, res) => {
    const d = valider(schemaPointVente, req.body);
    const info = db
      .prepare('UPDATE points_vente SET nom = ?, adresse = ?, telephone = ?, actif = ? WHERE id = ?')
      .run(d.nom, d.adresse || null, d.telephone || null, bit(d.actif), req.params.id);
    if (!info.changes) throw new ErreurHttp(404, 'Point de vente introuvable');
    res.json(db.prepare('SELECT * FROM points_vente WHERE id = ?').get(req.params.id));
  }),
);

/* --------------------------- 11.1 Création tables ------------------------- */

const schemaTable = z.object({
  nom: z.string().trim().min(1, 'le nom est obligatoire'),
  zone: z.string().trim().default('Salle'),
  places: z.coerce.number().int().positive().default(4),
  point_vente_id: z.coerce.number().int().nullish(),
});

router.get('/tables', (req, res) => {
  const pv = Number(req.query.point_vente_id) || null;
  res.json(
    db
      .prepare(
        `SELECT t.*, pv.nom AS point_vente_nom
           FROM tables_service t
           LEFT JOIN points_vente pv ON pv.id = t.point_vente_id
          WHERE (@pv IS NULL OR t.point_vente_id = @pv)
          ORDER BY t.zone, t.nom`,
      )
      .all({ pv }),
  );
});

router.post(
  '/tables',
  gerer,
  routeAsync((req, res) => {
    const d = valider(schemaTable, req.body);
    const info = db
      .prepare('INSERT INTO tables_service (nom, zone, places, point_vente_id) VALUES (?, ?, ?, ?)')
      .run(d.nom, d.zone, d.places, d.point_vente_id || null);
    res.status(201).json(db.prepare('SELECT * FROM tables_service WHERE id = ?').get(info.lastInsertRowid));
  }),
);

router.put(
  '/tables/:id',
  gerer,
  routeAsync((req, res) => {
    const d = valider(schemaTable, req.body);
    const info = db
      .prepare('UPDATE tables_service SET nom = ?, zone = ?, places = ?, point_vente_id = ? WHERE id = ?')
      .run(d.nom, d.zone, d.places, d.point_vente_id || null, req.params.id);
    if (!info.changes) throw new ErreurHttp(404, 'Table introuvable');
    res.json(db.prepare('SELECT * FROM tables_service WHERE id = ?').get(req.params.id));
  }),
);

router.delete(
  '/tables/:id',
  gerer,
  routeAsync((req, res) => {
    const info = db.prepare('DELETE FROM tables_service WHERE id = ?').run(req.params.id);
    if (!info.changes) throw new ErreurHttp(404, 'Table introuvable');
    res.json({ ok: true });
  }),
);

/* ----------------------- 10. Gestion des employés ------------------------- */

const schemaEmploye = z.object({
  nom_complet: z.string().trim().min(1, 'le nom est obligatoire'),
  identifiant: z.string().trim().min(3, "l'identifiant doit faire au moins 3 caractères"),
  mot_de_passe: z.string().min(4, 'le mot de passe doit faire au moins 4 caractères').optional(),
  role: z.enum(['admin', 'gerant', 'caissier', 'serveur']),
  telephone: z.string().trim().nullish(),
  point_vente_id: z.coerce.number().int().nullish(),
  actif: z.coerce.boolean().default(true),
});

router.get('/employes', gerer, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT e.id, e.nom_complet, e.identifiant, e.role, e.telephone, e.point_vente_id,
                e.actif, e.cree_le, pv.nom AS point_vente_nom,
                (SELECT COUNT(*) FROM ventes v WHERE v.employe_id = e.id AND v.statut = 'payee')
                  AS nb_ventes,
                (SELECT IFNULL(SUM(v.total), 0) FROM ventes v
                  WHERE v.employe_id = e.id AND v.statut = 'payee') AS total_ventes
           FROM employes e
           LEFT JOIN points_vente pv ON pv.id = e.point_vente_id
          ORDER BY e.nom_complet`,
      )
      .all(),
  );
});

router.post(
  '/employes',
  gerer,
  routeAsync((req, res) => {
    const d = valider(schemaEmploye, req.body);
    if (!d.mot_de_passe) throw new ErreurHttp(400, 'Le mot de passe est obligatoire à la création');
    const pris = db
      .prepare('SELECT id FROM employes WHERE lower(identifiant) = lower(?)')
      .get(d.identifiant);
    if (pris) throw new ErreurHttp(400, 'Cet identifiant est déjà utilisé');

    const info = db
      .prepare(
        `INSERT INTO employes (nom_complet, identifiant, mot_de_passe, role, telephone,
                               point_vente_id, actif)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        d.nom_complet,
        d.identifiant.toLowerCase(),
        bcrypt.hashSync(d.mot_de_passe, 10),
        d.role,
        d.telephone || null,
        d.point_vente_id || null,
        bit(d.actif),
      );
    res.status(201).json(chargerEmploye(Number(info.lastInsertRowid)));
  }),
);

router.put(
  '/employes/:id',
  gerer,
  routeAsync((req, res) => {
    const d = valider(schemaEmploye, req.body);
    const id = Number(req.params.id);
    const actuel = db.prepare('SELECT * FROM employes WHERE id = ?').get(id);
    if (!actuel) throw new ErreurHttp(404, 'Employé introuvable');

    const pris = db
      .prepare('SELECT id FROM employes WHERE lower(identifiant) = lower(?) AND id <> ?')
      .get(d.identifiant, id);
    if (pris) throw new ErreurHttp(400, 'Cet identifiant est déjà utilisé');

    // Se retirer à soi-même ses droits ou son accès rendrait le logiciel inadministrable.
    if (id === req.employe.id && (!d.actif || d.role !== actuel.role)) {
      throw new ErreurHttp(400, 'Vous ne pouvez pas modifier votre propre rôle ni vous désactiver');
    }

    db.prepare(
      `UPDATE employes SET nom_complet = ?, identifiant = ?, role = ?, telephone = ?,
              point_vente_id = ?, actif = ? WHERE id = ?`,
    ).run(
      d.nom_complet,
      d.identifiant.toLowerCase(),
      d.role,
      d.telephone || null,
      d.point_vente_id || null,
      bit(d.actif),
      id,
    );
    if (d.mot_de_passe) {
      db.prepare('UPDATE employes SET mot_de_passe = ? WHERE id = ?').run(
        bcrypt.hashSync(d.mot_de_passe, 10),
        id,
      );
    }
    res.json(chargerEmploye(id));
  }),
);

router.delete(
  '/employes/:id',
  gerer,
  routeAsync((req, res) => {
    const id = Number(req.params.id);
    if (id === req.employe.id) throw new ErreurHttp(400, 'Vous ne pouvez pas supprimer votre propre compte');
    const aVendu = db.prepare('SELECT COUNT(*) AS n FROM ventes WHERE employe_id = ?').get(id).n;
    if (aVendu) {
      db.prepare('UPDATE employes SET actif = 0 WHERE id = ?').run(id);
      return res.json({ ok: true, desactive: true });
    }
    const info = db.prepare('DELETE FROM employes WHERE id = ?').run(id);
    if (!info.changes) throw new ErreurHttp(404, 'Employé introuvable');
    res.json({ ok: true, desactive: false });
  }),
);

/* --------------------------- 11. Paramétrage ------------------------------ */

router.get('/parametres', (req, res) => res.json(lireParametres()));

router.put(
  '/parametres',
  gerer,
  routeAsync((req, res) => {
    const d = valider(
      z.object({
        nom_entreprise: z.string().trim().min(1).optional(),
        adresse: z.string().trim().optional(),
        telephone: z.string().trim().optional(),
        devise: z.string().trim().min(1).optional(),
        taux_taxe: z.coerce.number().min(0).max(100).optional(),
        pied_recu: z.string().trim().optional(),
      }),
      req.body,
    );
    res.json(ecrireParametres(d));
  }),
);
