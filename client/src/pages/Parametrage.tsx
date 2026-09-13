import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { dateHeure, montant } from '../lib/format';
import { Alerte, Chargement, Fenetre, Icone, Vide } from '../components/ui';
import type { Parametres, PointVente, Periode, TableService } from '../lib/types';

type Onglet = 'entreprise' | 'points_vente' | 'tables' | 'periodes';

const ONGLETS: { cle: Onglet; libelle: string }[] = [
  { cle: 'entreprise', libelle: 'Entreprise' },
  { cle: 'points_vente', libelle: 'Points de vente' },
  { cle: 'tables', libelle: 'Tables' },
  { cle: 'periodes', libelle: 'Historique de caisse' },
];

export default function Parametrage() {
  const [onglet, setOnglet] = useState<Onglet>('entreprise');

  return (
    <div className="p-3 lg:p-5">
      <h1 className="mb-4 text-xl font-black text-slate-800">Paramétrage</h1>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-200 p-1">
        {ONGLETS.map((o) => (
          <button
            key={o.cle}
            onClick={() => setOnglet(o.cle)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              onglet === o.cle ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600'
            }`}
          >
            {o.libelle}
          </button>
        ))}
      </div>

      {onglet === 'entreprise' && <OngletEntreprise />}
      {onglet === 'points_vente' && <OngletPointsVente />}
      {onglet === 'tables' && <OngletTables />}
      {onglet === 'periodes' && <OngletPeriodes />}
    </div>
  );
}

function OngletEntreprise() {
  const { parametres, rafraichir, peut } = useSession();
  const [f, setF] = useState<Partial<Parametres>>({});
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (parametres) setF(parametres);
  }, [parametres]);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    setMessage('');
    try {
      await api.put('/parametres', {
        nom_entreprise: f.nom_entreprise,
        adresse: f.adresse,
        telephone: f.telephone,
        devise: f.devise,
        taux_taxe: Number(f.taux_taxe) || 0,
        pied_recu: f.pied_recu,
      });
      await rafraichir();
      setMessage('Paramètres enregistrés.');
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="carte max-w-2xl space-y-4 p-4">
      {erreur && <Alerte message={erreur} />}
      {message && <Alerte type="succes" message={message} />}

      <div>
        <label className="etiquette" htmlFor="ent">
          Nom de l'entreprise
        </label>
        <input
          id="ent"
          className="champ"
          value={f.nom_entreprise ?? ''}
          onChange={(e) => setF({ ...f, nom_entreprise: e.target.value })}
          disabled={!peut('gerant')}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="etiquette" htmlFor="adr">
            Adresse
          </label>
          <input
            id="adr"
            className="champ"
            value={f.adresse ?? ''}
            onChange={(e) => setF({ ...f, adresse: e.target.value })}
            disabled={!peut('gerant')}
          />
        </div>
        <div>
          <label className="etiquette" htmlFor="tel">
            Téléphone
          </label>
          <input
            id="tel"
            className="champ"
            value={f.telephone ?? ''}
            onChange={(e) => setF({ ...f, telephone: e.target.value })}
            disabled={!peut('gerant')}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="etiquette" htmlFor="dev">
            Devise
          </label>
          <input
            id="dev"
            className="champ"
            value={f.devise ?? ''}
            onChange={(e) => setF({ ...f, devise: e.target.value })}
            disabled={!peut('gerant')}
          />
        </div>
        <div>
          <label className="etiquette" htmlFor="taxe">
            Taux de TVA (%)
          </label>
          <input
            id="taxe"
            type="number"
            min={0}
            max={100}
            step="0.01"
            className="champ"
            value={f.taux_taxe ?? '0'}
            onChange={(e) => setF({ ...f, taux_taxe: e.target.value })}
            disabled={!peut('gerant')}
          />
          <p className="mt-1 text-xs text-slate-500">Laissez 0 si vous ne facturez pas de TVA.</p>
        </div>
      </div>

      <div>
        <label className="etiquette" htmlFor="pied">
          Message en bas du reçu
        </label>
        <textarea
          id="pied"
          rows={2}
          className="champ"
          value={f.pied_recu ?? ''}
          onChange={(e) => setF({ ...f, pied_recu: e.target.value })}
          disabled={!peut('gerant')}
        />
      </div>

      {peut('gerant') && (
        <button type="submit" className="bouton-principal" disabled={enCours}>
          {enCours ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      )}
    </form>
  );
}

function OngletPointsVente() {
  const { rafraichir, peut } = useSession();
  const [liste, setListe] = useState<PointVente[]>([]);
  const [chargement, setChargement] = useState(true);
  const [edition, setEdition] = useState<Partial<PointVente> | null>(null);
  const [erreur, setErreur] = useState('');

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      setListe(await api.get<PointVente[]>('/points-vente'));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  return (
    <div className="max-w-2xl">
      {peut('gerant') && (
        <button onClick={() => setEdition({ actif: 1 })} className="bouton-principal mb-3">
          <Icone nom="plus" className="h-4 w-4" /> Nouveau point de vente
        </button>
      )}
      {erreur && (
        <div className="mb-3">
          <Alerte message={erreur} />
        </div>
      )}
      {chargement ? (
        <Chargement />
      ) : (
        <div className="carte divide-y divide-slate-100 overflow-hidden">
          {liste.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-800">{p.nom}</span>
                  {!p.actif && <span className="puce bg-slate-200 text-slate-600">Inactif</span>}
                </div>
                <div className="text-xs text-slate-500">
                  {p.adresse ?? 'Sans adresse'} · {p.nb_articles} article(s) · {p.nb_employes} employé(s)
                </div>
              </div>
              {peut('gerant') && (
                <button
                  onClick={() => setEdition(p)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Modifier"
                >
                  <Icone nom="crayon" className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <FormulairePointVente
        valeur={edition}
        onFermer={() => setEdition(null)}
        onEnregistre={async () => {
          setEdition(null);
          await charger();
          await rafraichir();
        }}
      />
    </div>
  );
}

function FormulairePointVente({
  valeur,
  onFermer,
  onEnregistre,
}: {
  valeur: Partial<PointVente> | null;
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const [f, setF] = useState<Partial<PointVente>>({});
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
      nom: f.nom,
      adresse: f.adresse || null,
      telephone: f.telephone || null,
      actif: !!f.actif,
    };
    try {
      if (f.id) await api.put(`/points-vente/${f.id}`, corps);
      else await api.post('/points-vente', corps);
      onEnregistre();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Fenetre
      ouverte={!!valeur}
      titre={f.id ? 'Modifier le point de vente' : 'Créer un point de vente'}
      onFermer={onFermer}
    >
      <form onSubmit={soumettre} className="space-y-4">
        {erreur && <Alerte message={erreur} />}
        <div>
          <label className="etiquette" htmlFor="nompv">
            Nom <span className="text-red-500">*</span>
          </label>
          <input
            id="nompv"
            className="champ"
            value={f.nom ?? ''}
            onChange={(e) => setF({ ...f, nom: e.target.value })}
            required
            autoFocus
          />
        </div>
        <div>
          <label className="etiquette" htmlFor="adrpv">
            Adresse
          </label>
          <input
            id="adrpv"
            className="champ"
            value={f.adresse ?? ''}
            onChange={(e) => setF({ ...f, adresse: e.target.value })}
          />
        </div>
        <div>
          <label className="etiquette" htmlFor="telpv">
            Téléphone
          </label>
          <input
            id="telpv"
            className="champ"
            value={f.telephone ?? ''}
            onChange={(e) => setF({ ...f, telephone: e.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-gesta-600"
            checked={!!f.actif}
            onChange={(e) => setF({ ...f, actif: e.target.checked ? 1 : 0 })}
          />
          Point de vente actif
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

/* --------------------------- 11.1 Création tables ------------------------- */

function OngletTables() {
  const { pointVenteActif, pointsVente, peut } = useSession();
  const [liste, setListe] = useState<TableService[]>([]);
  const [chargement, setChargement] = useState(true);
  const [edition, setEdition] = useState<Partial<TableService> | null>(null);
  const [erreur, setErreur] = useState('');

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      setListe(await api.get<TableService[]>(`/tables${qs({ point_vente_id: pointVenteActif })}`));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, [pointVenteActif]);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function supprimer(t: TableService) {
    if (!confirm(`Supprimer « ${t.nom} » ?`)) return;
    try {
      await api.delete(`/tables/${t.id}`);
      void charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Suppression impossible');
    }
  }

  const zones = [...new Set(liste.map((t) => t.zone))];

  return (
    <div className="max-w-2xl">
      {peut('gerant') && (
        <button
          onClick={() => setEdition({ zone: 'Salle', places: 4, point_vente_id: pointVenteActif })}
          className="bouton-principal mb-3"
        >
          <Icone nom="plus" className="h-4 w-4" /> Nouvelle table
        </button>
      )}
      {erreur && (
        <div className="mb-3">
          <Alerte message={erreur} />
        </div>
      )}
      {chargement ? (
        <Chargement />
      ) : liste.length === 0 ? (
        <Vide message="Aucune table pour ce point de vente." />
      ) : (
        <div className="space-y-4">
          {zones.map((zone) => (
            <div key={zone}>
              <h3 className="mb-2 text-sm font-bold text-slate-600">{zone}</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {liste
                  .filter((t) => t.zone === zone)
                  .map((t) => (
                    <div key={t.id} className="carte flex items-center gap-2 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-800">{t.nom}</div>
                        <div className="text-xs text-slate-500">{t.places} places</div>
                      </div>
                      {peut('gerant') && (
                        <>
                          <button
                            onClick={() => setEdition(t)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                            aria-label="Modifier"
                          >
                            <Icone nom="crayon" className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => supprimer(t)}
                            className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                            aria-label="Supprimer"
                          >
                            <Icone nom="corbeille" className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Fenetre
        ouverte={!!edition}
        titre={edition?.id ? 'Modifier la table' : 'Créer une table'}
        onFermer={() => setEdition(null)}
      >
        {edition && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const corps = {
                  nom: edition.nom,
                  zone: edition.zone,
                  places: Number(edition.places) || 4,
                  point_vente_id: edition.point_vente_id || null,
                };
                if (edition.id) await api.put(`/tables/${edition.id}`, corps);
                else await api.post('/tables', corps);
                setEdition(null);
                void charger();
              } catch (err) {
                setErreur(err instanceof Error ? err.message : 'Enregistrement impossible');
              }
            }}
            className="space-y-4"
          >
            <div>
              <label className="etiquette" htmlFor="nomt">
                Nom <span className="text-red-500">*</span>
              </label>
              <input
                id="nomt"
                className="champ"
                value={edition.nom ?? ''}
                onChange={(e) => setEdition({ ...edition, nom: e.target.value })}
                required
                autoFocus
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="etiquette" htmlFor="zone">
                  Zone
                </label>
                <input
                  id="zone"
                  className="champ"
                  value={edition.zone ?? ''}
                  onChange={(e) => setEdition({ ...edition, zone: e.target.value })}
                  placeholder="Salle, Terrasse…"
                />
              </div>
              <div>
                <label className="etiquette" htmlFor="places">
                  Places
                </label>
                <input
                  id="places"
                  type="number"
                  min={1}
                  className="champ"
                  value={edition.places ?? 4}
                  onChange={(e) => setEdition({ ...edition, places: Number(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <label className="etiquette" htmlFor="pvt">
                Point de ventes
              </label>
              <select
                id="pvt"
                className="champ"
                value={edition.point_vente_id ?? ''}
                onChange={(e) => setEdition({ ...edition, point_vente_id: Number(e.target.value) || null })}
              >
                <option value="">Aucun</option>
                {pointsVente.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nom}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setEdition(null)} className="bouton-secondaire flex-1">
                Annuler
              </button>
              <button type="submit" className="bouton-principal flex-1">
                Enregistrer
              </button>
            </div>
          </form>
        )}
      </Fenetre>
    </div>
  );
}

function OngletPeriodes() {
  const { pointVenteActif } = useSession();
  const [liste, setListe] = useState<Periode[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    (async () => {
      setChargement(true);
      try {
        setListe(await api.get<Periode[]>(`/periodes${qs({ point_vente_id: pointVenteActif })}`));
      } finally {
        setChargement(false);
      }
    })();
  }, [pointVenteActif]);

  if (chargement) return <Chargement />;
  if (liste.length === 0) return <Vide message="Aucune période de travail enregistrée." />;

  return (
    <div className="carte max-w-3xl divide-y divide-slate-100 overflow-hidden">
      {liste.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
          <span
            className={`puce ${p.statut === 'ouverte' ? 'bg-gesta-100 text-gesta-800' : 'bg-slate-100 text-slate-600'}`}
          >
            {p.statut}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-800">{p.employe_nom}</div>
            <div className="text-xs text-slate-500">
              Ouverte {dateHeure(p.ouverte_le)}
              {p.fermee_le && ` · fermée ${dateHeure(p.fermee_le)}`}
            </div>
          </div>
          <div className="text-right">
            <div className="font-bold text-slate-800">{montant(p.total_ventes)}</div>
            <div className="text-xs text-slate-500">{p.nb_ventes} vente(s)</div>
          </div>
        </div>
      ))}
    </div>
  );
}
