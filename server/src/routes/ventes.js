import { Router } from 'express';
import { z } from 'zod';
import { db, lireParametres } from '../lib/db.js';
import { routeAsync, valider, ErreurHttp } from '../lib/http.js';
import { enregistrerMouvement } from './stocks.js';
import { periodeOuverte } from './periodes.js';

export const router = Router();

const schemaLigne = z.object({
  article_id: z.coerce.number().int().nullish(),
  libelle: z.string().trim().min(1),
  prix_unitaire: z.coerce.number().int().min(0),
  quantite: z.coerce.number().positive('la quantité doit être supérieure à zéro'),
  note: z.string().trim().nullish(),
});

const schemaVente = z.object({
  point_vente_id: z.coerce.number().int(),
  client_id: z.coerce.number().int().nullish(),
  table_id: z.coerce.number().int().nullish(),
  remise_type: z.enum(['montant', 'pourcentage']).default('montant'),
  remise_valeur: z.coerce.number().min(0).default(0),
  mode_paiement: z.enum(['especes', 'mobile_money', 'carte', 'credit']).default('especes'),
  montant_recu: z.coerce.number().int().min(0).default(0),
  note: z.string().trim().nullish(),
  lignes: z.array(schemaLigne).min(1, 'la vente doit contenir au moins un article'),
});

function nouvelleReference(pointVenteId) {
  const jour = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const n = db
    .prepare(
      "SELECT COUNT(*) AS n FROM ventes WHERE point_vente_id = ? AND date(cree_le) = date('now')",
    )
    .get(pointVenteId).n;
  return `V${jour}-${String(n + 1).padStart(4, '0')}`;
}

function chargerVente(id) {
  const v = db
    .prepare(
      `SELECT v.*, pv.nom AS point_vente_nom, e.nom_complet AS employe_nom,
              c.nom AS client_nom, c.telephone AS client_telephone, t.nom AS table_nom
         FROM ventes v
         JOIN points_vente pv ON pv.id = v.point_vente_id
         JOIN employes e ON e.id = v.employe_id
         LEFT JOIN clients c ON c.id = v.client_id
         LEFT JOIN tables_service t ON t.id = v.table_id
        WHERE v.id = ?`,
    )
    .get(id);
  if (!v) throw new ErreurHttp(404, 'Vente introuvable');
  v.lignes = db.prepare('SELECT * FROM lignes_vente WHERE vente_id = ? ORDER BY id').all(id);
  return v;
}

/** Applique la remise puis la taxe, et renvoie le détail chiffré de la vente. */
function calculerTotaux(sousTotal, remiseType, remiseValeur) {
  let remise =
    remiseType === 'pourcentage'
      ? Math.round((sousTotal * remiseValeur) / 100)
      : Math.round(remiseValeur);
  remise = Math.min(Math.max(remise, 0), sousTotal);

  const base = sousTotal - remise;
  const taux = Number(lireParametres().taux_taxe) || 0;
  const taxe = Math.round((base * taux) / 100);
  return { remise_montant: remise, taxe, total: base + taxe };
}

/* -------------------------- 9.1 Historique des reçus ---------------------- */

router.get('/', (req, res) => {
  const { du, au, statut, point_vente_id, employe_id, periode_id, limite = 100 } = req.query;
  const conditions = [];
  const p = { limite: Math.min(Number(limite) || 100, 500) };

  if (du) {
    conditions.push('date(v.cree_le) >= date(@du)');
    p.du = du;
  }
  if (au) {
    conditions.push('date(v.cree_le) <= date(@au)');
    p.au = au;
  }
  if (statut) {
    conditions.push('v.statut = @statut');
    p.statut = statut;
  }
  if (point_vente_id) {
    conditions.push('v.point_vente_id = @pv');
    p.pv = Number(point_vente_id);
  }
  if (employe_id) {
    conditions.push('v.employe_id = @emp');
    p.emp = Number(employe_id);
  }
  if (periode_id) {
    conditions.push('v.periode_id = @per');
    p.per = Number(periode_id);
  }

  res.json(
    db
      .prepare(
        `SELECT v.*, e.nom_complet AS employe_nom, c.nom AS client_nom, pv.nom AS point_vente_nom,
                (SELECT COUNT(*) FROM lignes_vente l WHERE l.vente_id = v.id) AS nb_lignes
           FROM ventes v
           JOIN employes e ON e.id = v.employe_id
           JOIN points_vente pv ON pv.id = v.point_vente_id
           LEFT JOIN clients c ON c.id = v.client_id
          ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
          ORDER BY v.cree_le DESC, v.id DESC LIMIT @limite`,
      )
      .all(p),
  );
});

router.get(
  '/:id',
  routeAsync((req, res) => res.json(chargerVente(Number(req.params.id)))),
);

/* ------------------------------ 6. Faire la vente ------------------------- */

router.post(
  '/',
  routeAsync((req, res) => {
    const d = valider(schemaVente, req.body);

    const periode = periodeOuverte(d.point_vente_id);
    if (!periode) {
      throw new ErreurHttp(
        400,
        'Aucune période de travail ouverte : ouvrez la caisse avant de vendre',
      );
    }
    if (d.mode_paiement === 'credit' && !d.client_id) {
      throw new ErreurHttp(400, 'Une vente à crédit doit être rattachée à un client');
    }

    // On contrôle le stock avant d'écrire quoi que ce soit : une vente est tout ou rien.
    const articles = new Map();
    const cumul = new Map();
    for (const ligne of d.lignes) {
      if (!ligne.article_id) continue;
      let a = articles.get(ligne.article_id);
      if (!a) {
        a = db.prepare('SELECT * FROM articles WHERE id = ?').get(ligne.article_id);
        if (!a) throw new ErreurHttp(404, `Article introuvable (ligne « ${ligne.libelle} »)`);
        articles.set(a.id, a);
      }
      if (a.vendu_par === 'chaque' && !Number.isInteger(ligne.quantite)) {
        throw new ErreurHttp(
          400,
          `« ${a.libelle} » se vend à l'unité : la quantité doit être un nombre entier`,
        );
      }
      cumul.set(a.id, (cumul.get(a.id) || 0) + ligne.quantite);
    }
    for (const [id, quantite] of cumul) {
      const a = articles.get(id);
      if (!a.suivi_stock) continue;
      if (a.stock <= 0) throw new ErreurHttp(400, `« ${a.libelle} » est en rupture de stock`);
      if (quantite > a.stock) {
        throw new ErreurHttp(
          400,
          `Stock insuffisant pour « ${a.libelle} » : il reste ${a.stock} ${a.unite}`,
        );
      }
    }

    const sousTotal = d.lignes.reduce(
      (s, l) => s + Math.round(l.prix_unitaire * l.quantite),
      0,
    );
    const { remise_montant, taxe, total } = calculerTotaux(sousTotal, d.remise_type, d.remise_valeur);

    if (d.mode_paiement !== 'credit' && d.montant_recu < total) {
      throw new ErreurHttp(400, 'Le montant reçu est inférieur au total à payer');
    }
    const monnaie = d.mode_paiement === 'credit' ? 0 : d.montant_recu - total;

    const creer = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO ventes
             (reference, point_vente_id, periode_id, employe_id, client_id, table_id, sous_total,
              remise_type, remise_valeur, remise_montant, taxe, total, montant_recu, monnaie,
              mode_paiement, note)
           VALUES (@reference, @point_vente_id, @periode_id, @employe_id, @client_id, @table_id,
                   @sous_total, @remise_type, @remise_valeur, @remise_montant, @taxe, @total,
                   @montant_recu, @monnaie, @mode_paiement, @note)`,
        )
        .run({
          reference: nouvelleReference(d.point_vente_id),
          point_vente_id: d.point_vente_id,
          periode_id: periode.id,
          employe_id: req.employe.id,
          client_id: d.client_id || null,
          table_id: d.table_id || null,
          sous_total: sousTotal,
          remise_type: d.remise_type,
          remise_valeur: d.remise_valeur,
          remise_montant,
          taxe,
          total,
          montant_recu: d.mode_paiement === 'credit' ? 0 : d.montant_recu,
          monnaie,
          mode_paiement: d.mode_paiement,
          note: d.note || null,
        });
      const venteId = Number(info.lastInsertRowid);

      const ajouterLigne = db.prepare(
        `INSERT INTO lignes_vente
           (vente_id, article_id, libelle, prix_unitaire, cout_unitaire, quantite, total, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const l of d.lignes) {
        ajouterLigne.run(
          venteId,
          l.article_id || null,
          l.libelle,
          l.prix_unitaire,
          articles.get(l.article_id)?.cout || 0,
          l.quantite,
          Math.round(l.prix_unitaire * l.quantite),
          l.note || null,
        );
      }

      // Le stock est décrémenté une seule fois par article, sur la quantité cumulée.
      for (const [id, quantite] of cumul) {
        const a = articles.get(id);
        if (!a.suivi_stock) continue;
        enregistrerMouvement({
          article: a,
          type: 'vente',
          quantite,
          motif: 'Vente',
          employe_id: req.employe.id,
          vente_id: venteId,
        });
      }

      if (d.mode_paiement === 'credit') {
        db.prepare('UPDATE clients SET solde = solde + ? WHERE id = ?').run(total, d.client_id);
      }
      return venteId;
    });

    res.status(201).json(chargerVente(creer()));
  }),
);

router.post(
  '/:id/annuler',
  routeAsync((req, res) => {
    const v = db.prepare('SELECT * FROM ventes WHERE id = ?').get(req.params.id);
    if (!v) throw new ErreurHttp(404, 'Vente introuvable');
    if (v.statut === 'annulee') throw new ErreurHttp(400, 'Cette vente est déjà annulée');
    if (req.employe.role === 'serveur' || req.employe.role === 'caissier') {
      throw new ErreurHttp(403, 'Seul un gérant peut annuler une vente');
    }

    db.transaction(() => {
      // Le stock consommé est restitué article par article.
      const lignes = db
        .prepare(
          `SELECT l.article_id, SUM(l.quantite) AS quantite
             FROM lignes_vente l WHERE l.vente_id = ? AND l.article_id IS NOT NULL
            GROUP BY l.article_id`,
        )
        .all(v.id);
      for (const l of lignes) {
        const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(l.article_id);
        if (!a || !a.suivi_stock) continue;
        enregistrerMouvement({
          article: a,
          type: 'annulation',
          quantite: l.quantite,
          motif: `Annulation vente ${v.reference}`,
          employe_id: req.employe.id,
          vente_id: v.id,
        });
      }
      if (v.mode_paiement === 'credit' && v.client_id) {
        db.prepare('UPDATE clients SET solde = solde - ? WHERE id = ?').run(v.total, v.client_id);
      }
      db.prepare("UPDATE ventes SET statut = 'annulee', annulee_le = datetime('now') WHERE id = ?").run(
        v.id,
      );
    })();

    res.json(chargerVente(v.id));
  }),
);

/* --------------------- 9.2 Données d'impression du reçu ------------------- */

router.get(
  '/:id/recu',
  routeAsync((req, res) => {
    const vente = chargerVente(Number(req.params.id));
    res.json({ vente, parametres: lireParametres() });
  }),
);
