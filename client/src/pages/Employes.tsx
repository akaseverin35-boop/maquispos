import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { montant, LIBELLES_ROLE } from '../lib/format';
import { Alerte, Chargement, Fenetre, Icone, Vide } from '../components/ui';
import type { Employe, Role } from '../lib/types';

const ROLES: { cle: Role; aide: string }[] = [
  { cle: 'admin', aide: 'Accès complet, y compris les employés et le paramétrage' },
  { cle: 'gerant', aide: 'Gestion, rapports, stocks, annulation des ventes' },
  { cle: 'caissier', aide: 'Caisse, reçus, dépenses, clients' },
  { cle: 'serveur', aide: 'Prise de commande en caisse uniquement' },
];

export default function Employes() {
  const { peut, employe: moi } = useSession();
  const [employes, setEmployes] = useState<Employe[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [edition, setEdition] = useState<Partial<Employe> & { mot_de_passe?: string } | null>(null);
  const [motDePasse, setMotDePasse] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      setEmployes(await api.get<Employe[]>('/employes'));
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    if (peut('gerant')) void charger();
    else setChargement(false);
  }, [charger, peut]);

  async function supprimer(e: Employe) {
    if (!confirm(`Supprimer le compte de ${e.nom_complet} ?`)) return;
    try {
      const r = await api.delete<{ desactive: boolean }>(`/employes/${e.id}`);
      if (r.desactive) alert("Cet employé a des ventes à son nom : son compte a été désactivé.");
      void charger();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Suppression impossible');
    }
  }

  if (!peut('gerant')) {
    return (
      <div className="p-3 lg:p-5">
        <h1 className="mb-4 text-xl font-black text-slate-800">Mon compte</h1>
        <div className="carte max-w-md p-5">
          <div className="text-lg font-bold text-slate-800">{moi?.nom_complet}</div>
          <div className="text-sm text-slate-500">
            {LIBELLES_ROLE[moi?.role ?? '']} · {moi?.point_vente_nom ?? 'Sans point de vente'}
          </div>
          <button onClick={() => setMotDePasse(true)} className="bouton-secondaire mt-4 w-full">
            Changer mon mot de passe
          </button>
        </div>
        <ChangerMotDePasse ouverte={motDePasse} onFermer={() => setMotDePasse(false)} />
      </div>
    );
  }

  return (
    <div className="p-3 lg:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black text-slate-800">Gestion des employés</h1>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setMotDePasse(true)} className="bouton-secondaire">
            Mon mot de passe
          </button>
          <button onClick={() => setEdition({ role: 'caissier', actif: 1 })} className="bouton-principal">
            <Icone nom="plus" className="h-4 w-4" /> Nouvel employé
          </button>
        </div>
      </div>

      {erreur && (
        <div className="mb-3">
          <Alerte message={erreur} />
        </div>
      )}

      {chargement ? (
        <Chargement />
      ) : employes.length === 0 ? (
        <Vide message="Aucun employé." />
      ) : (
        <div className="carte divide-y divide-slate-100 overflow-hidden">
          {employes.map((e) => (
            <div key={e.id} className="flex items-center gap-3 p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                {e.nom_complet.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-slate-800">{e.nom_complet}</span>
                  <span className="puce bg-gesta-100 text-gesta-800">{LIBELLES_ROLE[e.role]}</span>
                  {!e.actif && <span className="puce bg-slate-200 text-slate-600">Désactivé</span>}
                </div>
                <div className="text-xs text-slate-500">
                  {e.identifiant} · {e.point_vente_nom ?? 'Sans point de vente'}
                  {(e.nb_ventes ?? 0) > 0 && ` · ${e.nb_ventes} vente(s) · ${montant(e.total_ventes ?? 0)}`}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setEdition(e)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Modifier"
                >
                  <Icone nom="crayon" className="h-4 w-4" />
                </button>
                {e.id !== moi?.id && (
                  <button
                    onClick={() => supprimer(e)}
                    className="rounded-lg p-2 text-red-500 hover:bg-red-50"
                    aria-label="Supprimer"
                  >
                    <Icone nom="corbeille" className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Formulaire
        valeur={edition}
        onFermer={() => setEdition(null)}
        onEnregistre={() => {
          setEdition(null);
          void charger();
        }}
      />
      <ChangerMotDePasse ouverte={motDePasse} onFermer={() => setMotDePasse(false)} />
    </div>
  );
}

function Formulaire({
  valeur,
  onFermer,
  onEnregistre,
}: {
  valeur: (Partial<Employe> & { mot_de_passe?: string }) | null;
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const { pointsVente } = useSession();
  const [f, setF] = useState<Partial<Employe> & { mot_de_passe?: string }>({});
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (valeur) setF({ ...valeur, mot_de_passe: '' });
    setErreur('');
  }, [valeur]);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    const corps: Record<string, unknown> = {
      nom_complet: f.nom_complet,
      identifiant: f.identifiant,
      role: f.role,
      telephone: f.telephone || null,
      point_vente_id: f.point_vente_id || null,
      actif: !!f.actif,
    };
    if (f.mot_de_passe) corps.mot_de_passe = f.mot_de_passe;
    try {
      if (f.id) await api.put(`/employes/${f.id}`, corps);
      else await api.post('/employes', corps);
      onEnregistre();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Fenetre ouverte={!!valeur} titre={f.id ? "Modifier l'employé" : 'Créer un employé'} onFermer={onFermer}>
      <form onSubmit={soumettre} className="space-y-4">
        {erreur && <Alerte message={erreur} />}

        <div>
          <label className="etiquette" htmlFor="nom">
            Nom complet <span className="text-red-500">*</span>
          </label>
          <input
            id="nom"
            className="champ"
            value={f.nom_complet ?? ''}
            onChange={(e) => setF({ ...f, nom_complet: e.target.value })}
            required
            autoFocus
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiquette" htmlFor="ident">
              Identifiant <span className="text-red-500">*</span>
            </label>
            <input
              id="ident"
              className="champ"
              value={f.identifiant ?? ''}
              onChange={(e) => setF({ ...f, identifiant: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="etiquette" htmlFor="mdp">
              Mot de passe {!f.id && <span className="text-red-500">*</span>}
            </label>
            <input
              id="mdp"
              type="password"
              className="champ"
              value={f.mot_de_passe ?? ''}
              onChange={(e) => setF({ ...f, mot_de_passe: e.target.value })}
              placeholder={f.id ? 'Laisser vide pour ne pas changer' : ''}
              required={!f.id}
            />
          </div>
        </div>

        <div>
          <span className="etiquette">Rôle</span>
          <div className="space-y-2">
            {ROLES.map((r) => (
              <button
                key={r.cle}
                type="button"
                onClick={() => setF({ ...f, role: r.cle })}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  f.role === r.cle ? 'border-gesta-600 bg-gesta-50' : 'border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="text-sm font-semibold text-slate-800">{LIBELLES_ROLE[r.cle]}</div>
                <div className="text-xs text-slate-500">{r.aide}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiquette" htmlFor="tel">
              Téléphone
            </label>
            <input
              id="tel"
              className="champ"
              value={f.telephone ?? ''}
              onChange={(e) => setF({ ...f, telephone: e.target.value })}
            />
          </div>
          <div>
            <label className="etiquette" htmlFor="pv">
              Point de ventes
            </label>
            <select
              id="pv"
              className="champ"
              value={f.point_vente_id ?? ''}
              onChange={(e) => setF({ ...f, point_vente_id: Number(e.target.value) || null })}
            >
              <option value="">Aucun</option>
              {pointsVente.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-gesta-600"
            checked={!!f.actif}
            onChange={(e) => setF({ ...f, actif: e.target.checked ? 1 : 0 })}
          />
          Compte actif (peut se connecter)
        </label>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onFermer} className="bouton-secondaire flex-1">
            Annuler
          </button>
          <button type="submit" className="bouton-principal flex-1" disabled={enCours}>
            {enCours ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Fenetre>
  );
}

function ChangerMotDePasse({ ouverte, onFermer }: { ouverte: boolean; onFermer: () => void }) {
  const [actuel, setActuel] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    setActuel('');
    setNouveau('');
    setMessage('');
    setErreur('');
  }, [ouverte]);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    try {
      await api.post('/auth/mot-de-passe', { actuel, nouveau });
      setMessage('Mot de passe modifié.');
      setActuel('');
      setNouveau('');
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Modification impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Fenetre ouverte={ouverte} titre="Changer mon mot de passe" onFermer={onFermer}>
      <form onSubmit={soumettre} className="space-y-4">
        {erreur && <Alerte message={erreur} />}
        {message && <Alerte type="succes" message={message} />}
        <div>
          <label className="etiquette" htmlFor="act">
            Mot de passe actuel
          </label>
          <input
            id="act"
            type="password"
            className="champ"
            value={actuel}
            onChange={(e) => setActuel(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="etiquette" htmlFor="nouv">
            Nouveau mot de passe
          </label>
          <input
            id="nouv"
            type="password"
            className="champ"
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
            required
            minLength={4}
          />
        </div>
        <button type="submit" className="bouton-principal w-full" disabled={enCours}>
          {enCours ? 'Modification…' : 'Modifier'}
        </button>
      </form>
    </Fenetre>
  );
}
