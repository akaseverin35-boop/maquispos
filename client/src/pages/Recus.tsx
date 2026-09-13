import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { montant, dateHeure, aujourdhui, ilYAJours, LIBELLES_PAIEMENT } from '../lib/format';
import { Alerte, Chargement, Fenetre, Icone, Vide } from '../components/ui';
import Recu from '../components/Recu';
import type { Vente } from '../lib/types';

export default function Recus() {
  const { pointVenteActif, parametres, peut } = useSession();
  const [ventes, setVentes] = useState<Vente[]>([]);
  const [du, setDu] = useState(ilYAJours(6));
  const [au, setAu] = useState(aujourdhui());
  const [statut, setStatut] = useState('');
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [detail, setDetail] = useState<Vente | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const v = await api.get<Vente[]>(`/ventes${qs({ du, au, statut, point_vente_id: pointVenteActif })}`);
      setVentes(v);
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, [du, au, statut, pointVenteActif]);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function ouvrir(id: number) {
    try {
      setDetail(await api.get<Vente>(`/ventes/${id}`));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Ouverture impossible');
    }
  }

  async function annuler(v: Vente) {
    if (!confirm(`Annuler la vente ${v.reference} ? Le stock sera restitué.`)) return;
    try {
      const maj = await api.post<Vente>(`/ventes/${v.id}/annuler`);
      setDetail(maj);
      void charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Annulation impossible');
    }
  }

  const totalPeriode = ventes.filter((v) => v.statut === 'payee').reduce((s, v) => s + v.total, 0);

  return (
    <div className="p-3 lg:p-5">
      <h1 className="mb-4 text-xl font-black text-slate-800">Reçus de vente</h1>

      <div className="carte mb-4 grid gap-3 p-3 sm:grid-cols-4">
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
        <div>
          <label className="etiquette" htmlFor="st">
            Statut
          </label>
          <select id="st" className="champ" value={statut} onChange={(e) => setStatut(e.target.value)}>
            <option value="">Tous</option>
            <option value="payee">Payées</option>
            <option value="annulee">Annulées</option>
          </select>
        </div>
        <div className="flex flex-col justify-end">
          <div className="rounded-lg bg-gesta-50 px-3 py-2 text-center">
            <div className="text-[11px] font-semibold uppercase text-gesta-700">Total encaissé</div>
            <div className="text-lg font-black text-gesta-800">{montant(totalPeriode)}</div>
          </div>
        </div>
      </div>

      {erreur && (
        <div className="mb-3">
          <Alerte message={erreur} />
        </div>
      )}

      {chargement ? (
        <Chargement />
      ) : ventes.length === 0 ? (
        <Vide message="Aucune vente sur cette période." />
      ) : (
        <div className="carte divide-y divide-slate-100 overflow-hidden">
          {ventes.map((v) => (
            <button
              key={v.id}
              onClick={() => ouvrir(v.id)}
              className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-bold text-slate-800">{v.reference}</span>
                  {v.statut === 'annulee' && <span className="puce bg-red-100 text-red-700">Annulée</span>}
                  <span className="puce bg-slate-100 text-slate-600">{LIBELLES_PAIEMENT[v.mode_paiement]}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {dateHeure(v.cree_le)} · {v.employe_nom}
                  {v.client_nom && ` · ${v.client_nom}`} · {v.nb_lignes} article(s)
                </div>
              </div>
              <div className="text-right">
                <div className={`font-black ${v.statut === 'annulee' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                  {montant(v.total)}
                </div>
                {v.remise_montant > 0 && (
                  <div className="text-xs text-red-500">− {montant(v.remise_montant)}</div>
                )}
              </div>
              <Icone nom="fleche" className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          ))}
        </div>
      )}

      <Fenetre ouverte={!!detail} titre={detail?.reference ?? ''} onFermer={() => setDetail(null)}>
        {detail && parametres && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200">
              <Recu vente={detail} parametres={parametres} />
            </div>
            <div className="sans-impression flex gap-2">
              <button onClick={() => window.print()} className="bouton-secondaire flex-1">
                <Icone nom="imprimer" className="h-4 w-4" /> Imprimer
              </button>
              {detail.statut === 'payee' && peut('gerant') && (
                <button onClick={() => annuler(detail)} className="bouton-danger flex-1">
                  Annuler la vente
                </button>
              )}
            </div>
          </div>
        )}
      </Fenetre>
    </div>
  );
}
