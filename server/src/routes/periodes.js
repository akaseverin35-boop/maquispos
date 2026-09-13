import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { routeAsync, valider, ErreurHttp } from '../lib/http.js';

export const router = Router();

/** Période de travail en cours sur un point de vente, ou null. */
export function periodeOuverte(pointVenteId) {
  return db
    .prepare(
      `SELECT p.*, e.nom_complet AS employe_nom
         FROM periodes_travail p JOIN employes e ON e.id = p.employe_id
        WHERE p.point_vente_id = ? AND p.statut = 'ouverte'
        ORDER BY p.id DESC LIMIT 1`,
    )
    .get(pointVenteId);
}

/** Récapitulatif de caisse d'une période : ventes, encaissements, dépenses. */
export function resumePeriode(periodeId) {
  const p = db
    .prepare(
      `SELECT p.*, e.nom_complet AS employe_nom, pv.nom AS point_vente_nom
         FROM periodes_travail p
         JOIN employes e ON e.id = p.employe_id
         JOIN points_vente pv ON pv.id = p.point_vente_id
        WHERE p.id = ?`,
    )
    .get(periodeId);
  if (!p) return null;

  const ventes = db
    .prepare(
      `SELECT COUNT(*) AS nb, IFNULL(SUM(total), 0) AS total,
              IFNULL(SUM(remise_montant), 0) AS remises
         FROM ventes WHERE periode_id = ? AND statut = 'payee'`,
    )
    .get(periodeId);

  const parMode = db
    .prepare(
      `SELECT mode_paiement, COUNT(*) AS nb, IFNULL(SUM(total), 0) AS total
         FROM ventes WHERE periode_id = ? AND statut = 'payee'
        GROUP BY mode_paiement`,
    )
    .all(periodeId);

  const annulees = db
    .prepare("SELECT COUNT(*) AS nb FROM ventes WHERE periode_id = ? AND statut = 'annulee'")
    .get(periodeId).nb;

  // Les dépenses sortent de la caisse pendant la période, elles amputent le fond attendu.
  const depenses = db
    .prepare(
      `SELECT IFNULL(SUM(montant), 0) AS total FROM depenses
        WHERE point_vente_id = ? AND cree_le >= ? AND (? IS NULL OR cree_le <= ?)`,
    )
    .get(p.point_vente_id, p.ouverte_le, p.fermee_le, p.fermee_le).total;

  const especes = parMode.find((m) => m.mode_paiement === 'especes')?.total || 0;
  const attendu = p.fond_caisse + especes - depenses;

  return {
    ...p,
    nb_ventes: ventes.nb,
    total_ventes: ventes.total,
    total_remises: ventes.remises,
    ventes_annulees: annulees,
    par_mode_paiement: parMode,
    total_depenses: depenses,
    especes_attendues: attendu,
    ecart: p.montant_compte === null ? null : p.montant_compte - attendu,
  };
}

router.get('/courante', (req, res) => {
  const pv = Number(req.query.point_vente_id) || req.employe.point_vente_id;
  if (!pv) return res.json(null);
  const p = periodeOuverte(pv);
  res.json(p ? resumePeriode(p.id) : null);
});

router.get('/', (req, res) => {
  const pv = Number(req.query.point_vente_id) || null;
  res.json(
    db
      .prepare(
        `SELECT p.*, e.nom_complet AS employe_nom, pv.nom AS point_vente_nom,
                (SELECT COUNT(*) FROM ventes v WHERE v.periode_id = p.id AND v.statut = 'payee')
                  AS nb_ventes,
                (SELECT IFNULL(SUM(v.total), 0) FROM ventes v
                  WHERE v.periode_id = p.id AND v.statut = 'payee') AS total_ventes
           FROM periodes_travail p
           JOIN employes e ON e.id = p.employe_id
           JOIN points_vente pv ON pv.id = p.point_vente_id
          WHERE (@pv IS NULL OR p.point_vente_id = @pv)
          ORDER BY p.ouverte_le DESC LIMIT 100`,
      )
      .all({ pv }),
  );
});

router.get(
  '/:id',
  routeAsync((req, res) => {
    const r = resumePeriode(Number(req.params.id));
    if (!r) throw new ErreurHttp(404, 'Période introuvable');
    res.json(r);
  }),
);

router.post(
  '/ouvrir',
  routeAsync((req, res) => {
    const d = valider(
      z.object({
        point_vente_id: z.coerce.number().int(),
        fond_caisse: z.coerce.number().int().min(0).default(0),
        note: z.string().trim().nullish(),
      }),
      req.body,
    );

    if (periodeOuverte(d.point_vente_id)) {
      throw new ErreurHttp(400, 'Une période de travail est déjà ouverte sur ce point de vente');
    }
    const info = db
      .prepare(
        `INSERT INTO periodes_travail (point_vente_id, employe_id, fond_caisse, note)
         VALUES (?, ?, ?, ?)`,
      )
      .run(d.point_vente_id, req.employe.id, d.fond_caisse, d.note || null);

    res.status(201).json(resumePeriode(Number(info.lastInsertRowid)));
  }),
);

router.post(
  '/:id/fermer',
  routeAsync((req, res) => {
    const d = valider(
      z.object({
        montant_compte: z.coerce.number().int().min(0),
        note: z.string().trim().nullish(),
      }),
      req.body,
    );
    const p = db.prepare('SELECT * FROM periodes_travail WHERE id = ?').get(req.params.id);
    if (!p) throw new ErreurHttp(404, 'Période introuvable');
    if (p.statut === 'fermee') throw new ErreurHttp(400, 'Cette période est déjà fermée');

    db.prepare(
      `UPDATE periodes_travail
          SET statut = 'fermee', montant_compte = ?, note = IFNULL(?, note),
              fermee_le = datetime('now')
        WHERE id = ?`,
    ).run(d.montant_compte, d.note || null, p.id);

    res.json(resumePeriode(p.id));
  }),
);
