import { useState, type FormEvent } from 'react';
import { useSession } from '../lib/session';
import { Alerte } from '../components/ui';

const COMPTES_DEMO = [
  { identifiant: 'admin', mot_de_passe: 'admin', role: 'Administrateur' },
  { identifiant: 'gerant', mot_de_passe: 'gerant', role: 'Gérant' },
  { identifiant: 'caissier', mot_de_passe: 'caissier', role: 'Caissier' },
  { identifiant: 'serveur', mot_de_passe: 'serveur', role: 'Serveur' },
];

export default function Connexion() {
  const { connecter } = useSession();
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur('');
    setOccupe(true);
    try {
      await connecter(identifiant, motDePasse);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Connexion impossible');
    } finally {
      setOccupe(false);
    }
  }

  async function connexionRapide(c: (typeof COMPTES_DEMO)[number]) {
    setIdentifiant(c.identifiant);
    setMotDePasse(c.mot_de_passe);
    setErreur('');
    setOccupe(true);
    try {
      await connecter(c.identifiant, c.mot_de_passe);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Connexion impossible');
    } finally {
      setOccupe(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gesta-600 to-gesta-800 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-3xl font-black backdrop-blur">
            G+
          </div>
          <h1 className="text-2xl font-black tracking-tight">Gesta+</h1>
          <p className="mt-1 text-sm text-gesta-100">Logiciel de caisse et de gestion</p>
        </div>

        <form onSubmit={soumettre} className="carte space-y-4 p-5">
          {erreur && <Alerte message={erreur} />}

          <div>
            <label className="etiquette" htmlFor="identifiant">
              Identifiant
            </label>
            <input
              id="identifiant"
              className="champ"
              value={identifiant}
              onChange={(e) => setIdentifiant(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="etiquette" htmlFor="motdepasse">
              Mot de passe
            </label>
            <input
              id="motdepasse"
              type="password"
              className="champ"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button type="submit" className="bouton-principal w-full" disabled={occupe}>
            {occupe ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <div className="mt-5 rounded-xl bg-white/10 p-4 backdrop-blur">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gesta-100">
            Comptes de démonstration
          </p>
          <div className="grid grid-cols-2 gap-2">
            {COMPTES_DEMO.map((c) => (
              <button
                key={c.identifiant}
                type="button"
                onClick={() => connexionRapide(c)}
                disabled={occupe}
                className="rounded-lg bg-white/90 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-white disabled:opacity-50"
              >
                {c.role}
                <span className="block font-normal text-slate-500">{c.identifiant}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
