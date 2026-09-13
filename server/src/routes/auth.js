import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { asyncRoute, parse, HttpError } from '../lib/http.js';
import { signToken, authenticate } from '../middleware/auth.js';

export const router = Router();

const credentials = z.object({
  username: z.string().trim().min(1, 'identifiant obligatoire'),
  password: z.string().min(1, 'mot de passe obligatoire'),
});

router.post(
  '/login',
  asyncRoute((req, res) => {
    const { username, password } = parse(credentials, req.body);
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new HttpError(401, 'Identifiant ou mot de passe incorrect');
    }
    if (!user.active) throw new HttpError(403, 'Ce compte est désactivé');

    const { password_hash: _, ...safe } = user;
    res.json({ token: signToken(user), user: safe });
  }),
);

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

router.post(
  '/password',
  authenticate,
  asyncRoute((req, res) => {
    const schema = z.object({
      current: z.string().min(1),
      next: z.string().min(4, 'le nouveau mot de passe doit faire au moins 4 caractères'),
    });
    const { current, next } = parse(schema, req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(current, row.password_hash)) {
      throw new HttpError(400, 'Mot de passe actuel incorrect');
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      bcrypt.hashSync(next, 10),
      req.user.id,
    );
    res.json({ ok: true });
  }),
);
