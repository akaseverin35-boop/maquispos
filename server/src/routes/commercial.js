import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { routeAsync, valider, ErreurHttp } from '../lib/http.js';
import { exigerRole } from '../middleware/auth.js';

export const router = Router();

/* ----------------------------- 8.1 Les clients ---------------------------- */

const schemaClient = z.object({
  nom: z.string().trim().min(1, 'le nom est obligatoire'),
  telephone: z.string().trim().nullish(),
  email: z.string().trim().nullish(),
  adresse: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
});

router.get('/clients', (req, res) => {
  const q = req.query.recherche ? `%${req.query.recherche}%` : '%';
  res.json(
    db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM ventes v WHERE v.client_id = c.id AND v.statut = 'payee')
                  AS nb_achats,
                (SELECT IFNULL(SUM(v.total), 0) FROM ventes v
                  WHERE v.client_id = c.id AND v.statut = 'payee') AS total_achats
           FROM clients c
          WHERE c.nom LIKE @q OR IFNULL(c.telephone, '') LIKE @q
          ORDER BY c.nom`,
      )
      .all({ q }),
  );
});

router.get(
  '/clients/:id',
  routeAsync((req, res) => {
    const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!c) throw new ErreurHttp(404, 'Client introuvable');
    c.ventes = db
      .prepare('SELECT * FROM ventes WHERE client_id = ? ORDER BY cree_le DESC LIMIT 50')
      .all(c.id);
    c.factures = db
      .prepare('SELECT * FROM factures WHERE client_id = ? ORDER BY date_emission DESC')
      .all(c.id);
    res.json(c);
  }),
);

router.post(
  '/clients',
  routeAsync((req, res) => {
    const d = valider(schemaClient, req.body);
    const info = db
      .prepare('INSERT INTO clients (nom, telephone, email, adresse, note) VALUES (?, ?, ?, ?, ?)')
      .run(d.nom, d.telephone || null, d.email || null, d.adresse || null, d.note || null);
    res.status(201).json(db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid));
  }),
);

router.put(
  '/clients/:id',
  routeAsync((req, res) => {
    const d = valider(schemaClient, req.body);
    const info = db
      .prepare(
        'UPDATE clients SET nom = ?, telephone = ?, email = ?, adresse = ?, note = ? WHERE id = ?',
      )
      .run(d.nom, d.telephone || null, d.email || null, d.adresse || null, d.note || null, req.params.id);
    if (!info.changes) throw new ErreurHttp(404, 'Client introuvable');
    res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id));
  }),
);

/** Encaissement d'une dette client (ventes à crédit). */
router.post(
  '/clients/:id/reglement',
  routeAsync((req, res) => {
    const { montant } = valider(
      z.object({ montant: z.coerce.number().int().positive('le montant doit être positif') }),
      req.body,
    );
    const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!c) throw new ErreurHttp(404, 'Client introuvable');
    if (montant > c.solde) {
      throw new ErreurHttp(400, `Le montant dépasse la dette du client (${c.solde})`);
    }
    db.prepare('UPDATE clients SET solde = solde - ? WHERE id = ?').run(montant, c.id);
    res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(c.id));
  }),
);

router.delete(
  '/clients/:id',
  exigerRole('gerant'),
  routeAsync((req, res) => {
    const c = db.prepare('SELECT solde FROM clients WHERE id = ?').get(req.params.id);
    if (!c) throw new ErreurHttp(404, 'Client introuvable');
    if (c.solde > 0) throw new ErreurHttp(400, 'Ce client a une dette en cours, il ne peut pas être supprimé');
    db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  }),
);

/* ---------------------------- 8.2 Les factures ---------------------------- */

const schemaFacture = z.object({
  client_id: z.coerce.number().int().nullish(),
  vente_id: z.coerce.number().int().nullish(),
  point_vente_id: z.coerce.number().int().nullish(),
  statut: z.enum(['brouillon', 'emise', 'payee', 'annulee']).default('emise'),
  date_emission: z.string().trim().default(() => new Date().toISOString().slice(0, 10)),
  date_echeance: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
  lignes: z
    .array(
      z.object({
        libelle: z.string().trim().min(1),
        prix_unitaire: z.coerce.number().int().min(0),
        quantite: z.coerce.number().positive(),
      }),
    )
    .min(1, 'la facture doit contenir au moins une ligne'),
});

function chargerFacture(id) {
  const f = db
    .prepare(
      `SELECT f.*, c.nom AS client_nom, c.telephone AS client_telephone, c.adresse AS client_adresse,
              pv.nom AS point_vente_nom, v.reference AS vente_reference
         FROM factures f
         LEFT JOIN clients c ON c.id = f.client_id
         LEFT JOIN points_vente pv ON pv.id = f.point_vente_id
         LEFT JOIN ventes v ON v.id = f.vente_id
        WHERE f.id = ?`,
    )
    .get(id);
  if (!f) throw new ErreurHttp(404, 'Facture introuvable');
  f.lignes = db.prepare('SELECT * FROM lignes_facture WHERE facture_id = ? ORDER BY id').all(id);
  return f;
}

function nouvelleReferenceFacture() {
  const annee = new Date().getFullYear();
  const n = db
    .prepare("SELECT COUNT(*) AS n FROM factures WHERE strftime('%Y', date_emission) = ?")
    .get(String(annee)).n;
  return `FA-${annee}-${String(n + 1).padStart(4, '0')}`;
}

router.get('/factures', (req, res) => {
  const { statut, client_id } = req.query;
  const conditions = [];
  const p = {};
  if (statut) {
    conditions.push('f.statut = @statut');
    p.statut = statut;
  }
  if (client_id) {
    conditions.push('f.client_id = @client_id');
    p.client_id = Number(client_id);
  }
  res.json(
    db
      .prepare(
        `SELECT f.*, c.nom AS client_nom FROM factures f
           LEFT JOIN clients c ON c.id = f.client_id
          ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
          ORDER BY f.date_emission DESC, f.id DESC LIMIT 200`,
      )
      .all(p),
  );
});

router.get(
  '/factures/:id',
  routeAsync((req, res) => res.json(chargerFacture(Number(req.params.id)))),
);

router.post(
  '/factures',
  routeAsync((req, res) => {
    const d = valider(schemaFacture, req.body);
    const total = d.lignes.reduce((s, l) => s + Math.round(l.prix_unitaire * l.quantite), 0);

    const id = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO factures
             (reference, client_id, vente_id, point_vente_id, statut, total, date_emission,
              date_echeance, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          nouvelleReferenceFacture(),
          d.client_id || null,
          d.vente_id || null,
          d.point_vente_id || req.employe.point_vente_id || null,
          d.statut,
          total,
          d.date_emission,
          d.date_echeance || null,
          d.note || null,
        );
      const factureId = Number(info.lastInsertRowid);
      const ajouter = db.prepare(
        'INSERT INTO lignes_facture (facture_id, libelle, prix_unitaire, quantite, total) VALUES (?, ?, ?, ?, ?)',
      );
      for (const l of d.lignes) {
        ajouter.run(factureId, l.libelle, l.prix_unitaire, l.quantite, Math.round(l.prix_unitaire * l.quantite));
      }
      return factureId;
    })();

    res.status(201).json(chargerFacture(id));
  }),
);

router.post(
  '/factures/:id/paiement',
  routeAsync((req, res) => {
    const { montant } = valider(
      z.object({ montant: z.coerce.number().int().positive() }),
      req.body,
    );
    const f = db.prepare('SELECT * FROM factures WHERE id = ?').get(req.params.id);
    if (!f) throw new ErreurHttp(404, 'Facture introuvable');
    if (f.statut === 'annulee') throw new ErreurHttp(400, 'Cette facture est annulée');

    const paye = Math.min(f.montant_paye + montant, f.total);
    db.prepare('UPDATE factures SET montant_paye = ?, statut = ? WHERE id = ?').run(
      paye,
      paye >= f.total ? 'payee' : f.statut === 'brouillon' ? 'emise' : f.statut,
      f.id,
    );
    res.json(chargerFacture(f.id));
  }),
);

router.post(
  '/factures/:id/annuler',
  exigerRole('gerant'),
  routeAsync((req, res) => {
    const info = db.prepare("UPDATE factures SET statut = 'annulee' WHERE id = ?").run(req.params.id);
    if (!info.changes) throw new ErreurHttp(404, 'Facture introuvable');
    res.json(chargerFacture(Number(req.params.id)));
  }),
);
