import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, qs } from '../lib/api';
import { montant, dateCourte } from '../lib/format';
import { Alerte, Chargement, Fenetre, Icone, Vide } from '../components/ui';
import type { Client, Facture } from '../lib/types';

type Onglet = 'clients' | 'factures';

const STATUTS: Record<Facture['statut'], string> = {
  brouillon: 'bg-slate-100 text-slate-600',
  emise: 'bg-sky-100 text-sky-800',
  payee: 'bg-gesta-100 text-gesta-800',
  annulee: 'bg-red-100 text-red-700',
};

export default function Commercial() {
  const [onglet, setOnglet] = useState<Onglet>('clients');
  const [clients, setClients] = useState<Client[]>([]);
  const [factures, setFactures] = useState<Facture[]>([]);
  const [recherche, setRecherche] = useState('');
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [clientEdite, setClientEdite] = useState<Partial<Client> | null>(null);
  const [reglement, setReglement] = useState<Client | null>(null);
  const [factureEditee, setFactureEditee] = useState<boolean>(false);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const [c, f] = await Promise.all([
        api.get<Client[]>(`/clients${qs({ recherche })}`),
        api.get<Facture[]>('/factures'),
      ]);
      setClients(c);
      setFactures(f);
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, [recherche]);

  useEffect(() => {
    const t = setTimeout(() => void charger(), recherche ? 250 : 0);
    return () => clearTimeout(t);
  }, [charger, recherche]);

  const creances = clients.reduce((s, c) => s + c.solde, 0);

  return (
    <div className="p-3 lg:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black text-slate-800">Gestion commerciale</h1>
        <button
          onClick={() => (onglet === 'clients' ? setClientEdite({}) : setFactureEditee(true))}
          className="bouton-principal ml-auto"
        >
          <Icone nom="plus" className="h-4 w-4" />
          {onglet === 'clients' ? 'Nouveau client' : 'Nouvelle facture'}
        </button>
      </div>

      {creances > 0 && (
        <div className="mb-4">
          <Alerte type="info" message={`${montant(creances)} de créances clients en cours.`} />
        </div>
      )}

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-200 p-1">
        {(['clients', 'factures'] as const).map((o) => (
          <button
            key={o}
            onClick={() => setOnglet(o)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              onglet === o ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600'
            }`}
          >
            {o === 'clients' ? `Clients (${clients.length})` : `Factures (${factures.length})`}
          </button>
        ))}
      </div>

      {erreur && (
        <div className="mb-3">
          <Alerte message={erreur} />
        </div>
      )}

      {onglet === 'clients' && (
        <div className="relative mb-3">
          <Icone nom="recherche" className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
          <input
            className="champ pl-10"
            placeholder="Rechercher par nom ou téléphone…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
      )}

      {chargement ? (
        <Chargement />
      ) : onglet === 'clients' ? (
        clients.length === 0 ? (
          <Vide message="Aucun client enregistré." />
        ) : (
          <div className="carte divide-y divide-slate-100 overflow-hidden">
            {clients.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gesta-50 text-sm font-bold text-gesta-700">
                  {c.nom.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-800">{c.nom}</div>
                  <div className="text-xs text-slate-500">
                    {c.telephone ?? 'Sans téléphone'} · {c.nb_achats ?? 0} achat(s) ·{' '}
                    {montant(c.total_achats ?? 0)}
                  </div>
                </div>
                {c.solde > 0 && (
                  <button
                    onClick={() => setReglement(c)}
                    className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-800 hover:bg-amber-100"
                  >
                    Doit {montant(c.solde)}
                  </button>
                )}
                <button
                  onClick={() => setClientEdite(c)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Modifier"
                >
                  <Icone nom="crayon" className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )
      ) : factures.length === 0 ? (
        <Vide message="Aucune facture émise." />
      ) : (
        <div className="carte divide-y divide-slate-100 overflow-hidden">
          {factures.map((f) => (
            <div key={f.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-bold text-slate-800">{f.reference}</span>
                  <span className={`puce ${STATUTS[f.statut]}`}>{f.statut}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {dateCourte(f.date_emission)} · {f.client_nom ?? 'Sans client'}
                  {f.montant_paye > 0 && f.montant_paye < f.total && ` · payé ${montant(f.montant_paye)}`}
                </div>
              </div>
              <div className="font-black text-slate-800">{montant(f.total)}</div>
            </div>
          ))}
        </div>
      )}

      <FormulaireClient
        valeur={clientEdite}
        onFermer={() => setClientEdite(null)}
        onEnregistre={() => {
          setClientEdite(null);
          void charger();
        }}
      />
      <FenetreReglement
        client={reglement}
        onFermer={() => setReglement(null)}
        onRegle={() => {
          setReglement(null);
          void charger();
        }}
      />
      <FormulaireFacture
        ouverte={factureEditee}
        clients={clients}
        onFermer={() => setFactureEditee(false)}
        onEnregistre={() => {
          setFactureEditee(false);
          setOnglet('factures');
          void charger();
        }}
      />
    </div>
  );
}

function FormulaireClient({
  valeur,
  onFermer,
  onEnregistre,
}: {
  valeur: Partial<Client> | null;
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const [f, setF] = useState<Partial<Client>>({});
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
      telephone: f.telephone || null,
      email: f.email || null,
      adresse: f.adresse || null,
      note: f.note || null,
    };
    try {
      if (f.id) await api.put(`/clients/${f.id}`, corps);
      else await api.post('/clients', corps);
      onEnregistre();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Fenetre ouverte={!!valeur} titre={f.id ? 'Modifier le client' : 'Créer un client'} onFermer={onFermer}>
      <form onSubmit={soumettre} className="space-y-4">
        {erreur && <Alerte message={erreur} />}
        <div>
          <label className="etiquette" htmlFor="nom">
            Nom <span className="text-red-500">*</span>
          </label>
          <input
            id="nom"
            className="champ"
            value={f.nom ?? ''}
            onChange={(e) => setF({ ...f, nom: e.target.value })}
            required
            autoFocus
          />
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
            <label className="etiquette" htmlFor="mail">
              Email
            </label>
            <input
              id="mail"
              type="email"
              className="champ"
              value={f.email ?? ''}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="etiquette" htmlFor="adr">
            Adresse
          </label>
          <input
            id="adr"
            className="champ"
            value={f.adresse ?? ''}
            onChange={(e) => setF({ ...f, adresse: e.target.value })}
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

function FenetreReglement({
  client,
  onFermer,
  onRegle,
}: {
  client: Client | null;
  onFermer: () => void;
  onRegle: () => void;
}) {
  const [valeur, setValeur] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    setValeur(client ? String(client.solde) : '');
    setErreur('');
  }, [client]);

  async function regler() {
    if (!client) return;
    setEnCours(true);
    try {
      await api.post(`/clients/${client.id}/reglement`, { montant: Number(valeur) || 0 });
      onRegle();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Règlement impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Fenetre ouverte={!!client} titre="Règlement de dette" onFermer={onFermer}>
      {client && (
        <div className="space-y-4">
          {erreur && <Alerte message={erreur} />}
          <div className="rounded-xl bg-amber-50 p-4 text-center">
            <div className="text-xs font-semibold uppercase text-amber-700">Dette de {client.nom}</div>
            <div className="text-2xl font-black text-amber-800">{montant(client.solde)}</div>
          </div>
          <div>
            <label className="etiquette" htmlFor="reg">
              Montant encaissé
            </label>
            <input
              id="reg"
              type="number"
              min={1}
              max={client.solde}
              className="champ text-lg"
              value={valeur}
              onChange={(e) => setValeur(e.target.value)}
              autoFocus
            />
          </div>
          <button onClick={regler} className="bouton-principal w-full" disabled={enCours}>
            {enCours ? 'Enregistrement…' : 'Encaisser'}
          </button>
        </div>
      )}
    </Fenetre>
  );
}

function FormulaireFacture({
  ouverte,
  clients,
  onFermer,
  onEnregistre,
}: {
  ouverte: boolean;
  clients: Client[];
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const [clientId, setClientId] = useState<number | ''>('');
  const [echeance, setEcheance] = useState('');
  const [lignes, setLignes] = useState([{ libelle: '', prix_unitaire: 0, quantite: 1 }]);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (ouverte) {
      setClientId('');
      setEcheance('');
      setLignes([{ libelle: '', prix_unitaire: 0, quantite: 1 }]);
      setErreur('');
    }
  }, [ouverte]);

  const total = lignes.reduce((s, l) => s + Math.round(l.prix_unitaire * l.quantite), 0);

  function majLigne(i: number, patch: Partial<(typeof lignes)[number]>) {
    setLignes((ls) => ls.map((l, j) => (i === j ? { ...l, ...patch } : l)));
  }

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    const valides = lignes.filter((l) => l.libelle.trim() && l.quantite > 0);
    if (valides.length === 0) return setErreur('Ajoutez au moins une ligne avec un libellé.');
    setEnCours(true);
    setErreur('');
    try {
      await api.post('/factures', {
        client_id: clientId || null,
        date_echeance: echeance || null,
        lignes: valides,
      });
      onEnregistre();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Fenetre ouverte={ouverte} titre="Créer une facture" onFermer={onFermer} large>
      <form onSubmit={soumettre} className="space-y-4">
        {erreur && <Alerte message={erreur} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiquette" htmlFor="cl">
              Client
            </label>
            <select
              id="cl"
              className="champ"
              value={clientId}
              onChange={(e) => setClientId(Number(e.target.value) || '')}
            >
              <option value="">Sans client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiquette" htmlFor="ech">
              Échéance
            </label>
            <input id="ech" type="date" className="champ" value={echeance} onChange={(e) => setEcheance(e.target.value)} />
          </div>
        </div>

        <div>
          <span className="etiquette">Lignes</span>
          <div className="space-y-2">
            {lignes.map((l, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="champ flex-1"
                  placeholder="Désignation"
                  value={l.libelle}
                  onChange={(e) => majLigne(i, { libelle: e.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  className="champ w-24"
                  placeholder="P.U."
                  value={l.prix_unitaire || ''}
                  onChange={(e) => majLigne(i, { prix_unitaire: Number(e.target.value) || 0 })}
                />
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="champ w-20"
                  value={l.quantite}
                  onChange={(e) => majLigne(i, { quantite: Number(e.target.value) || 0 })}
                />
                <button
                  type="button"
                  onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))}
                  className="rounded-lg p-2 text-red-500 hover:bg-red-50"
                  aria-label="Retirer"
                >
                  <Icone nom="croix" className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLignes((ls) => [...ls, { libelle: '', prix_unitaire: 0, quantite: 1 }])}
            className="mt-2 text-sm font-semibold text-gesta-700 hover:underline"
          >
            + Ajouter une ligne
          </button>
        </div>

        <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
          <span className="font-semibold text-slate-600">Total</span>
          <span className="text-lg font-black text-slate-900">{montant(total)}</span>
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onFermer} className="bouton-secondaire flex-1">
            Annuler
          </button>
          <button type="submit" className="bouton-principal flex-1" disabled={enCours}>
            {enCours ? 'Enregistrement…' : 'Créer la facture'}
          </button>
        </div>
      </form>
    </Fenetre>
  );
}
