import { Router } from 'express';
import { db } from '../lib/db.js';

export const router = Router();

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Filtre commun : période et point de vente. */
function bornes(req) {
  return {
    du: req.query.du || aujourdhui(),
    au: req.query.au || aujourdhui(),
    pv: Number(req.query.point_vente_id) || null,
  };
}

const FILTRE_VENTES = `v.statut = 'payee'
  AND date(v.cree_le) BETWEEN date(@du) AND date(@au)
  AND (@pv IS NULL OR v.point_vente_id = @pv)`;

router.get('/resume', (req, res) => {
  const p = bornes(req);

  const ventes = db
    .prepare(
      `SELECT COUNT(*) AS nb, IFNULL(SUM(v.total), 0) AS chiffre_affaires,
              IFNULL(SUM(v.remise_montant), 0) AS remises,
              IFNULL(AVG(v.total), 0) AS panier_moyen
         FROM ventes v WHERE ${FILTRE_VENTES}`,
    )
    .get(p);

  // La marge se calcule sur le coût figé dans la ligne au moment de la vente.
  const marge = db
    .prepare(
      `SELECT IFNULL(SUM((l.prix_unitaire - l.cout_unitaire) * l.quantite), 0) AS marge_brute
         FROM lignes_vente l JOIN ventes v ON v.id = l.vente_id
        WHERE ${FILTRE_VENTES}`,
    )
    .get(p).marge_brute;

  const depenses = db
    .prepare(
      `SELECT IFNULL(SUM(d.montant), 0) AS total FROM depenses d
        WHERE date(d.date_depense) BETWEEN date(@du) AND date(@au)
          AND (@pv IS NULL OR d.point_vente_id = @pv)`,
    )
    .get(p).total;

  const annulees = db
    .prepare(
      `SELECT COUNT(*) AS nb FROM ventes v
        WHERE v.statut = 'annulee' AND date(v.cree_le) BETWEEN date(@du) AND date(@au)
          AND (@pv IS NULL OR v.point_vente_id = @pv)`,
    )
    .get(p).nb;

  const alertes = db
    .prepare(
      `SELECT COUNT(*) AS nb FROM articles a
        WHERE a.actif = 1 AND a.suivi_stock = 1 AND a.stock <= a.alerte_stock
          AND (@pv IS NULL OR a.point_vente_id = @pv)`,
    )
    .get({ pv: p.pv }).nb;

  const creances = db.prepare('SELECT IFNULL(SUM(solde), 0) AS t FROM clients').get().t;

  res.json({
    periode: { du: p.du, au: p.au },
    nb_ventes: ventes.nb,
    chiffre_affaires: ventes.chiffre_affaires,
    remises: ventes.remises,
    panier_moyen: Math.round(ventes.panier_moyen),
    marge_brute: marge,
    depenses,
    resultat: ventes.chiffre_affaires - depenses,
    ventes_annulees: annulees,
    articles_en_alerte: alertes,
    creances_clients: creances,
  });
});

/** Chiffre d'affaires jour par jour, pour la courbe. */
router.get('/evolution', (req, res) => {
  const p = bornes(req);
  res.json(
    db
      .prepare(
        `SELECT date(v.cree_le) AS jour, COUNT(*) AS nb, IFNULL(SUM(v.total), 0) AS total
           FROM ventes v WHERE ${FILTRE_VENTES}
          GROUP BY jour ORDER BY jour`,
      )
      .all(p),
  );
});

router.get('/meilleurs-articles', (req, res) => {
  const p = bornes(req);
  res.json(
    db
      .prepare(
        `SELECT l.libelle, SUM(l.quantite) AS quantite, SUM(l.total) AS total
           FROM lignes_vente l JOIN ventes v ON v.id = l.vente_id
          WHERE ${FILTRE_VENTES}
          GROUP BY l.libelle ORDER BY total DESC LIMIT 10`,
      )
      .all(p),
  );
});

router.get('/par-categorie', (req, res) => {
  const p = bornes(req);
  res.json(
    db
      .prepare(
        `SELECT IFNULL(c.libelle, 'Aucune Catégorie') AS categorie,
                SUM(l.total) AS total, SUM(l.quantite) AS quantite
           FROM lignes_vente l
           JOIN ventes v ON v.id = l.vente_id
           LEFT JOIN articles a ON a.id = l.article_id
           LEFT JOIN categories c ON c.id = a.categorie_id
          WHERE ${FILTRE_VENTES}
          GROUP BY categorie ORDER BY total DESC`,
      )
      .all(p),
  );
});

router.get('/par-employe', (req, res) => {
  const p = bornes(req);
  res.json(
    db
      .prepare(
        `SELECT e.nom_complet AS employe, COUNT(*) AS nb_ventes, IFNULL(SUM(v.total), 0) AS total
           FROM ventes v JOIN employes e ON e.id = v.employe_id
          WHERE ${FILTRE_VENTES}
          GROUP BY e.id ORDER BY total DESC`,
      )
      .all(p),
  );
});

router.get('/par-paiement', (req, res) => {
  const p = bornes(req);
  res.json(
    db
      .prepare(
        `SELECT v.mode_paiement, COUNT(*) AS nb, IFNULL(SUM(v.total), 0) AS total
           FROM ventes v WHERE ${FILTRE_VENTES}
          GROUP BY v.mode_paiement ORDER BY total DESC`,
      )
      .all(p),
  );
});

/** Ventes par heure : sert à repérer les coups de feu du service. */
router.get('/par-heure', (req, res) => {
  const p = bornes(req);
  res.json(
    db
      .prepare(
        `SELECT strftime('%H', v.cree_le) AS heure, COUNT(*) AS nb, IFNULL(SUM(v.total), 0) AS total
           FROM ventes v WHERE ${FILTRE_VENTES}
          GROUP BY heure ORDER BY heure`,
      )
      .all(p),
  );
});
