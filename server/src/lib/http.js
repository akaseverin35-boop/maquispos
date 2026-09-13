/** Enveloppe un handler pour router les rejets vers le middleware d'erreur. */
export const routeAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export class ErreurHttp extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Valide un corps de requête avec zod et renvoie une 400 lisible en français. */
export function valider(schema, body) {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new ErreurHttp(
      400,
      r.error.issues.map((i) => `${i.path.join('.') || 'champ'} : ${i.message}`).join(' ; '),
    );
  }
  return r.data;
}

/** Convertit les booléens JS en 0/1 pour SQLite. */
export const bit = (v) => (v ? 1 : 0);
