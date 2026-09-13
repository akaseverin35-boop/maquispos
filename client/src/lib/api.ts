const CLE_JETON = 'gestaplus.jeton';

export const lireJeton = () => localStorage.getItem(CLE_JETON);
export const ecrireJeton = (j: string) => localStorage.setItem(CLE_JETON, j);
export const effacerJeton = () => localStorage.removeItem(CLE_JETON);

export class ErreurApi extends Error {
  constructor(
    public statut: number,
    message: string,
  ) {
    super(message);
  }
}

async function requete<T>(chemin: string, options: RequestInit = {}): Promise<T> {
  const jeton = lireJeton();
  const reponse = await fetch(`/api${chemin}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
      ...options.headers,
    },
  });

  if (reponse.status === 401) {
    effacerJeton();
    // Le rechargement ramène l'utilisateur sur l'écran de connexion.
    if (!location.pathname.startsWith('/connexion')) location.href = '/connexion';
    throw new ErreurApi(401, 'Session expirée');
  }

  const texte = await reponse.text();
  const donnees = texte ? JSON.parse(texte) : null;
  if (!reponse.ok) {
    throw new ErreurApi(reponse.status, donnees?.error || 'Une erreur est survenue');
  }
  return donnees as T;
}

/** Sérialise les paramètres d'URL en ignorant les valeurs vides. */
export function qs(params: Record<string, string | number | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: <T,>(chemin: string) => requete<T>(chemin),
  post: <T,>(chemin: string, corps?: unknown) =>
    requete<T>(chemin, { method: 'POST', body: JSON.stringify(corps ?? {}) }),
  put: <T,>(chemin: string, corps?: unknown) =>
    requete<T>(chemin, { method: 'PUT', body: JSON.stringify(corps ?? {}) }),
  delete: <T,>(chemin: string) => requete<T>(chemin, { method: 'DELETE' }),
};
