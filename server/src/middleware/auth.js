import jwt from 'jsonwebtoken';
import { db } from '../lib/db.js';

const SECRET = process.env.JWT_SECRET || 'change-moi-en-production';
export const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

const CHAMPS_PUBLICS = `e.id, e.nom_complet, e.identifiant, e.role, e.telephone,
                        e.point_vente_id, e.actif, pv.nom AS point_vente_nom`;

export function signerJeton(employe) {
  return jwt.sign({ sub: employe.id, role: employe.role }, SECRET, { expiresIn: EXPIRES_IN });
}

export function chargerEmploye(id) {
  return db
    .prepare(
      `SELECT ${CHAMPS_PUBLICS} FROM employes e
         LEFT JOIN points_vente pv ON pv.id = e.point_vente_id
        WHERE e.id = ?`,
    )
    .get(id);
}

export function authentifier(req, res, next) {
  const header = req.headers.authorization || '';
  const jeton = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!jeton) return res.status(401).json({ error: 'Connexion requise' });

  let payload;
  try {
    payload = jwt.verify(jeton, SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expirée, reconnectez-vous' });
  }

  const employe = chargerEmploye(payload.sub);
  if (!employe || !employe.actif) {
    return res.status(401).json({ error: 'Compte introuvable ou désactivé' });
  }

  req.employe = employe;
  next();
}

/** Restreint une route à certains rôles. Le rôle « admin » passe partout. */
export function exigerRole(...roles) {
  return (req, res, next) => {
    if (req.employe.role === 'admin' || roles.includes(req.employe.role)) return next();
    res.status(403).json({ error: "Vous n'avez pas les droits pour cette action" });
  };
}
