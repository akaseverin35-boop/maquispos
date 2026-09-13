/** Enveloppe un handler async pour router les rejets vers le middleware d'erreur. */
export const asyncRoute = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Valide `body` avec un schéma zod et renvoie une 400 lisible en cas d'échec. */
export function parse(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || 'champ'} : ${i.message}`)
      .join(' ; ');
    throw new HttpError(400, detail);
  }
  return result.data;
}
