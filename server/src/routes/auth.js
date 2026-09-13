import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { routeAsync, valider, ErreurHttp } from '../lib/http.js';
import { signerJeton, authentifier, chargerEmploye } from '../middleware/auth.js';

export const router = Router();

router.post(
  '/connexion',
  routeAsync((req, res) => {
    const { identifiant, mot_de_passe } = valider(
      z.object({
        identifiant: z.string().trim().min(1, 'identifiant obligatoire'),
        mot_de_passe: z.string().min(1, 'mot de passe obligatoire'),
      }),
      req.body,
    );

    const row = db
      .prepare('SELECT * FROM employes WHERE lower(identifiant) = lower(?)')
      .get(identifiant);
    if (!row || !bcrypt.compareSync(mot_de_passe, row.mot_de_passe)) {
      throw new ErreurHttp(401, 'Identifiant ou mot de passe incorrect');
    }
    if (!row.actif) throw new ErreurHttp(403, 'Ce compte est désactivé');

    res.json({ jeton: signerJeton(row), employe: chargerEmploye(row.id) });
  }),
);

router.get('/moi', authentifier, (req, res) => res.json({ employe: req.employe }));

router.post(
  '/mot-de-passe',
  authentifier,
  routeAsync((req, res) => {
    const { actuel, nouveau } = valider(
      z.object({
        actuel: z.string().min(1, 'mot de passe actuel obligatoire'),
        nouveau: z.string().min(4, 'le nouveau mot de passe doit faire au moins 4 caractères'),
      }),
      req.body,
    );
    const row = db.prepare('SELECT mot_de_passe FROM employes WHERE id = ?').get(req.employe.id);
    if (!bcrypt.compareSync(actuel, row.mot_de_passe)) {
      throw new ErreurHttp(400, 'Mot de passe actuel incorrect');
    }
    db.prepare('UPDATE employes SET mot_de_passe = ? WHERE id = ?').run(
      bcrypt.hashSync(nouveau, 10),
      req.employe.id,
    );
    res.json({ ok: true });
  }),
);
