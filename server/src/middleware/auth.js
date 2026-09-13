import jwt from 'jsonwebtoken';
import { db } from '../lib/db.js';

const SECRET = process.env.JWT_SECRET || 'change-moi-en-production';
export const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, SECRET, { expiresIn: EXPIRES_IN });
}

export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentification requise' });

  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expirée, reconnectez-vous' });
  }

  const user = db
    .prepare('SELECT id, full_name, username, role, phone, active FROM users WHERE id = ?')
    .get(payload.sub);
  if (!user || !user.active) return res.status(401).json({ error: 'Compte introuvable ou désactivé' });

  req.user = user;
  next();
}

/** Restreint une route à une liste de rôles. `admin` passe partout. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    res.status(403).json({ error: "Vous n'avez pas les droits pour cette action" });
  };
}
