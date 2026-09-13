import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { montant, dateCourte, aujourdhui, ilYAJours } from '../lib/format';
import { Alerte, Chargement, Fenetre, Icone, Vide } from '../components/ui';
import type { Depense } from '../lib/types';

interface Reponse {
  lignes: Depense[];
  total: number;
  par_categorie: { categorie: string; total: number }[];
}

export default function Depenses() {
  const { pointVenteActif, peut } = useSession();
  const [donnees, setDonnees] = useState<Reponse | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [du, setDu] = useState(ilYAJours(29));
  const [au, setAu] = useState(aujourdhui());
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [edition, setEdition] = useState<Partial<Depense> | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const [d, c] = await Promise.all([
        api.get<Reponse>(`/depenses${qs({ du, au, point_vente_id: pointVenteActif })}`),
        api.get<string[]>('/depenses/categories'),
      ]);
      setDonnees(d);
      setCategories(c);
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, [du, au, pointVenteActif]);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function supprimer(d: Depense) {
    if (!confirm(`Supprimer la dépense « ${d.libelle} » ?`)) return;
    try {
      await api.delete(`/depenses/${d.id}`);
      void charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Suppression impossible');
    }
  }

  return (
    <div className="p-3 lg:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black text-slate-800">Les dépenses</h1>
        <button
          onClick={() => setEdition({ categorie: 'Divers', date_depense: aujourdhui(), point_vente_id: pointVenteActif })}
          className="bouton-principal ml-auto"
        >
          <Icone nom="plus" className="h-4 w-4" /> Nouvelle dépense
        </button>
      </div>

      <div className="carte mb-4 grid gap-3 p-3 sm:grid-cols-3">
        <div>
          <label className="etiquette" htmlFor="du">
            Du
          </label>
          <input id="du" type="date" className="champ" value={du} onChange={(e) => setDu(e.target.value)} />
        </div>
        <div>
          <label className="etiquette" htmlFor="au">
            Au
          </label>
          <input id="au" type="date" className="champ" value={au} onChange={(e) => setAu(e.target.value)} />
        </div>
        <div className="flex flex-col justify-end">
          <div className="rounded-lg bg-red-50 px-3 py-2 text-center">
            <div className="text-[11px] font-semibold uppercase text-red-700">Total des dépenses</div>
            <div className="text-lg font-black text-red-800">{montant(donnees?.total ?? 0)}</div>
          </div>
        </div>
      </div>

      {erreur && (
        <div className="mb-3">
          <Alerte message={erreur} />
        </div>
      )}

      {donnees && donnees.par_categorie.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {donnees.par_categorie.map((c) => (
            <span key={c.categorie} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">
              <span className="text-slate-600">{c.categorie}</span>{' '}
              <span className="font-bold text-slate-900">{montant(c.total)}</span>
            </span>
          ))}
        </div>
      )}

      {chargement ? (
        <Chargement />
      ) : !donnees || donnees.lignes.length === 0 ? (
        <Vide message="Aucune dépense sur cette période." />
      ) : (
        <div className="carte divide-y divide-slate-100 overflow-hidden">
          {donnees.lignes.map((d) => (
            <div key={d.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-800">{d.libelle}</div>
                <div className="text-xs text-slate-500">
                  {dateCourte(d.date_depense)} · {d.categorie}
                  {d.beneficiaire && ` · ${d.beneficiaire}`}
                  {d.employe_nom && ` · saisie par ${d.employe_nom}`}
                </div>
              </div>
              <div className="font-black text-red-600">− {montant(d.montant)}</div>
              {peut('gerant') && (
                <div className="flex gap-1">
                  <button
                    onClick={() => setEdition(d)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                    aria-label="Modifier"
                  >
                    <Icone nom="crayon" className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => supprimer(d)}
                    className="rounded-lg p-2 text-red-500 hover:bg-red-50"
                    aria-label="Supprimer"
                  >
                    <Icone nom="corbeille" className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Formulaire
        valeur={edition}
        categories={categories}
        onFermer={() => setEdition(null)}
        onEnregistre={() => {
          setEdition(null);
          void charger();
        }}
      />
    </div>
  );
}

function Formulaire({
  valeur,
  categories,
  onFermer,
  onEnregistre,
}: {
  valeur: Partial<Depense> | null;
  categories: string[];
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const [f, setF] = useState<Partial<Depense>>({});
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (valeur) setF(valeur);
    setErreur('');
  }, [valeur]);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    const corps = {
      libelle: f.libelle,
      categorie: f.categorie || 'Divers',
      montant: Number(f.montant) || 0,
      beneficiaire: f.beneficiaire || null,
      point_vente_id: f.point_vente_id || null,
      date_depense: f.date_depense,
      note: f.note || null,
    };
    try {
      if (f.id) await api.put(`/depenses/${f.id}`, corps);
      else await api.post('/depenses', corps);
      onEnregistre();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Fenetre ouverte={!!valeur} titre={f.id ? 'Modifier la dépense' : 'Créer une dépense'} onFermer={onFermer}>
      <form onSubmit={soumettre} className="space-y-4">
        {erreur && <Alerte message={erreur} />}

        <div>
          <label className="etiquette" htmlFor="lib">
            Libellé <span className="text-red-500">*</span>
          </label>
          <input
            id="lib"
            className="champ"
            value={f.libelle ?? ''}
            onChange={(e) => setF({ ...f, libelle: e.target.value })}
            required
            autoFocus
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiquette" htmlFor="mont">
              Montant <span className="text-red-500">*</span>
            </label>
            <input
              id="mont"
              type="number"
              min={1}
              className="champ text-lg"
              value={f.montant ?? ''}
              onChange={(e) => setF({ ...f, montant: Number(e.target.value) })}
              required
            />
          </div>
          <div>
            <label className="etiquette" htmlFor="cat">
              Catégorie
            </label>
            <select
              id="cat"
              className="champ"
              value={f.categorie ?? 'Divers'}
              onChange={(e) => setF({ ...f, categorie: e.target.value })}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiquette" htmlFor="date">
              Date
            </label>
            <input
              id="date"
              type="date"
              className="champ"
              value={f.date_depense ?? ''}
              onChange={(e) => setF({ ...f, date_depense: e.target.value })}
            />
          </div>
          <div>
            <label className="etiquette" htmlFor="benef">
              Bénéficiaire
            </label>
            <input
              id="benef"
              className="champ"
              value={f.beneficiaire ?? ''}
              onChange={(e) => setF({ ...f, beneficiaire: e.target.value })}
              placeholder="Fournisseur, prestataire…"
            />
          </div>
        </div>

        <div>
          <label className="etiquette" htmlFor="note">
            Note
          </label>
          <textarea
            id="note"
            className="champ"
            rows={2}
            value={f.note ?? ''}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
        </div>

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
