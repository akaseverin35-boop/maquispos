import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { montant, quantite, LIBELLES_PAIEMENT } from '../lib/format';
import { Alerte, Chargement, Fenetre, Icone, Vide } from '../components/ui';
import Recu from '../components/Recu';
import type {
  Article,
  Categorie,
  Client,
  LignePanier,
  ModePaiement,
  Periode,
  TableService,
  Vente,
} from '../lib/types';

const MODES: ModePaiement[] = ['especes', 'mobile_money', 'carte', 'credit'];

export default function Caisse() {
  const { pointVenteActif, parametres, employe } = useSession();

  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [tables, setTables] = useState<TableService[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [periode, setPeriode] = useState<Periode | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const [categorieActive, setCategorieActive] = useState<number | 'toutes' | 'aucune'>('toutes');
  const [recherche, setRecherche] = useState('');

  const [panier, setPanier] = useState<LignePanier[]>([]);
  const [remiseType, setRemiseType] = useState<'montant' | 'pourcentage'>('montant');
  const [remiseValeur, setRemiseValeur] = useState(0);
  const [clientId, setClientId] = useState<number | ''>('');
  const [tableId, setTableId] = useState<number | ''>('');

  const [saisie, setSaisie] = useState<{ article: Article; quantite: string; prix: string } | null>(null);
  const [ouvrirCaisse, setOuvrirCaisse] = useState(false);
  const [fondCaisse, setFondCaisse] = useState('');
  const [paiementOuvert, setPaiementOuvert] = useState(false);
  const [modePaiement, setModePaiement] = useState<ModePaiement>('especes');
  const [montantRecu, setMontantRecu] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [venteFinalisee, setVenteFinalisee] = useState<Vente | null>(null);

  const charger = useCallback(async () => {
    if (!pointVenteActif) return;
    setChargement(true);
    setErreur('');
    try {
      const [a, c, t, cl, p] = await Promise.all([
        api.get<Article[]>(`/articles${qs({ point_vente_id: pointVenteActif, actifs_seulement: 'true' })}`),
        api.get<Categorie[]>(`/categories${qs({ point_vente_id: pointVenteActif })}`),
        api.get<TableService[]>(`/tables${qs({ point_vente_id: pointVenteActif })}`),
        api.get<Client[]>('/clients'),
        api.get<Periode | null>(`/periodes/courante${qs({ point_vente_id: pointVenteActif })}`),
      ]);
      setArticles(a);
      setCategories(c);
      setTables(t);
      setClients(cl);
      setPeriode(p);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, [pointVenteActif]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const articlesAffiches = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return articles.filter((a) => {
      if (categorieActive === 'aucune' && a.categorie_id !== null) return false;
      if (typeof categorieActive === 'number' && a.categorie_id !== categorieActive) return false;
      if (q && !a.libelle.toLowerCase().includes(q) && !(a.code ?? '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [articles, categorieActive, recherche]);

  const sousTotal = panier.reduce((s, l) => s + Math.round(l.prix_unitaire * l.quantite), 0);
  const remiseMontant = Math.min(
    remiseType === 'pourcentage' ? Math.round((sousTotal * remiseValeur) / 100) : Math.round(remiseValeur),
    sousTotal,
  );
  const taux = Number(parametres?.taux_taxe ?? 0);
  const taxe = Math.round(((sousTotal - remiseMontant) * taux) / 100);
  const total = sousTotal - remiseMontant + taxe;
  const rendu = Math.max(0, (Number(montantRecu) || 0) - total);

  /* --------------------------- Gestion du panier -------------------------- */

  function ajouter(article: Article) {
    // Prix libre ou vente au poids : on demande la valeur avant d'ajouter la ligne.
    if (article.prix_vente === 0 || article.vendu_par === 'poids_volume') {
      setSaisie({
        article,
        quantite: article.vendu_par === 'poids_volume' ? '' : '1',
        prix: article.prix_vente ? String(article.prix_vente) : '',
      });
      return;
    }
    setPanier((p) => {
      const existante = p.find((l) => l.article?.id === article.id && l.prix_unitaire === article.prix_vente);
      if (existante) {
        return p.map((l) => (l === existante ? { ...l, quantite: l.quantite + 1 } : l));
      }
      return [
        ...p,
        {
          cle: `${article.id}-${Date.now()}`,
          article,
          libelle: article.libelle,
          prix_unitaire: article.prix_vente,
          quantite: 1,
        },
      ];
    });
  }

  function validerSaisie() {
    if (!saisie) return;
    const q = Number(saisie.quantite.replace(',', '.'));
    const prix = Number(saisie.prix);
    if (!Number.isFinite(q) || q <= 0) return setErreur('Quantité invalide');
    if (!Number.isFinite(prix) || prix < 0) return setErreur('Prix invalide');
    if (saisie.article.vendu_par === 'chaque' && !Number.isInteger(q)) {
      return setErreur(`« ${saisie.article.libelle} » se vend à l'unité : quantité entière attendue`);
    }
    setErreur('');
    setPanier((p) => [
      ...p,
      {
        cle: `${saisie.article.id}-${Date.now()}`,
        article: saisie.article,
        libelle: saisie.article.libelle,
        prix_unitaire: Math.round(prix),
        quantite: q,
      },
    ]);
    setSaisie(null);
  }

  function modifierQuantite(cle: string, delta: number) {
    setPanier((p) =>
      p.flatMap((l) => {
        if (l.cle !== cle) return [l];
        const pas = l.article?.vendu_par === 'poids_volume' ? 0.5 : 1;
        const q = Number((l.quantite + delta * pas).toFixed(3));
        return q > 0 ? [{ ...l, quantite: q }] : [];
      }),
    );
  }

  function viderPanier() {
    setPanier([]);
    setRemiseValeur(0);
    setClientId('');
    setTableId('');
    setMontantRecu('');
  }

  /* ------------------------ Période de travail (6.1) ---------------------- */

  async function ouvrirPeriode() {
    if (!pointVenteActif) return;
    setEnCours(true);
    try {
      const p = await api.post<Periode>('/periodes/ouvrir', {
        point_vente_id: pointVenteActif,
        fond_caisse: Number(fondCaisse) || 0,
      });
      setPeriode(p);
      setOuvrirCaisse(false);
      setFondCaisse('');
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Ouverture impossible');
    } finally {
      setEnCours(false);
    }
  }

  /* ----------------------------- Encaissement ----------------------------- */

  async function encaisser() {
    if (!pointVenteActif) return;
    setEnCours(true);
    setErreur('');
    try {
      const vente = await api.post<Vente>('/ventes', {
        point_vente_id: pointVenteActif,
        client_id: clientId || null,
        table_id: tableId || null,
        remise_type: remiseType,
        remise_valeur: remiseValeur,
        mode_paiement: modePaiement,
        montant_recu: modePaiement === 'credit' ? 0 : Number(montantRecu) || 0,
        lignes: panier.map((l) => ({
          article_id: l.article?.id ?? null,
          libelle: l.libelle,
          prix_unitaire: l.prix_unitaire,
          quantite: l.quantite,
        })),
      });
      setVenteFinalisee(vente);
      setPaiementOuvert(false);
      viderPanier();
      void charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Encaissement impossible');
    } finally {
      setEnCours(false);
    }
  }

  if (chargement) return <Chargement message="Chargement de la caisse…" />;

  /* ------------------------------- Rendu ---------------------------------- */

  if (!periode) {
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <div className="carte p-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gesta-50 text-gesta-600">
            <Icone nom="caisse" className="h-7 w-7" />
          </div>
          <h1 className="text-lg font-bold text-slate-800">La caisse est fermée</h1>
          <p className="mt-2 text-sm text-slate-500">
            Ouvrez une période de travail pour commencer à enregistrer des ventes. Le fond de caisse
            servira au contrôle des espèces à la fermeture.
          </p>
          {erreur && (
            <div className="mt-4">
              <Alerte message={erreur} />
            </div>
          )}
          <button onClick={() => setOuvrirCaisse(true)} className="bouton-principal mt-5 w-full">
            Ouvrir la caisse
          </button>
        </div>

        <Fenetre ouverte={ouvrirCaisse} titre="Ouvrir la période de travail" onFermer={() => setOuvrirCaisse(false)}>
          <div className="space-y-4">
            <div>
              <label className="etiquette" htmlFor="fond">
                Fond de caisse
              </label>
              <input
                id="fond"
                type="number"
                min={0}
                className="champ"
                value={fondCaisse}
                onChange={(e) => setFondCaisse(e.target.value)}
                placeholder="0"
                autoFocus
              />
              <p className="mt-1 text-xs text-slate-500">
                Montant en espèces présent dans le tiroir avant la première vente.
              </p>
            </div>
            <button onClick={ouvrirPeriode} className="bouton-principal w-full" disabled={enCours}>
              {enCours ? 'Ouverture…' : 'Ouvrir la caisse'}
            </button>
          </div>
        </Fenetre>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.25rem)] flex-col lg:flex-row">
      {/* Catalogue */}
      <section className="flex min-h-0 flex-1 flex-col border-b border-slate-200 lg:border-b-0 lg:border-r">
        <div className="space-y-2 border-b border-slate-200 bg-white p-3">
          <div className="relative">
            <Icone nom="recherche" className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
            <input
              className="champ pl-10"
              placeholder="Rechercher un article…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
            />
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {[
              { cle: 'toutes' as const, libelle: 'Tous', couleur: '#64748b' },
              ...categories.map((c) => ({ cle: c.id, libelle: c.libelle, couleur: c.couleur })),
              { cle: 'aucune' as const, libelle: 'Aucune Catégorie', couleur: '#94a3b8' },
            ].map((c) => (
              <button
                key={String(c.cle)}
                onClick={() => setCategorieActive(c.cle)}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                  categorieActive === c.cle
                    ? 'text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                style={categorieActive === c.cle ? { backgroundColor: c.couleur } : undefined}
              >
                {c.libelle}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {articlesAffiches.length === 0 ? (
            <Vide message="Aucun article ne correspond." />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {articlesAffiches.map((a) => {
                const rupture = a.suivi_stock === 1 && a.stock <= 0;
                return (
                  <button
                    key={a.id}
                    onClick={() => !rupture && ajouter(a)}
                    disabled={rupture}
                    className={`carte flex flex-col gap-1 p-3 text-left transition ${
                      rupture ? 'cursor-not-allowed opacity-50' : 'hover:border-gesta-400 hover:shadow'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-2xl leading-none">{a.image || '🍽️'}</span>
                      {a.suivi_stock === 1 && (
                        <span
                          className={`puce ${
                            rupture
                              ? 'bg-red-100 text-red-700'
                              : a.stock <= a.alerte_stock
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {quantite(a.stock)} {a.unite}
                        </span>
                      )}
                    </div>
                    <span className="line-clamp-2 text-sm font-semibold text-slate-800">{a.libelle}</span>
                    <span className="text-sm font-bold text-gesta-700">
                      {a.prix_vente === 0 ? 'Prix libre' : montant(a.prix_vente)}
                    </span>
                    {a.vendu_par === 'poids_volume' && (
                      <span className="text-[11px] text-slate-500">au {a.unite}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Panier */}
      <aside className="flex min-h-0 w-full flex-col bg-white lg:w-96">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-slate-800">Panier</h2>
            <p className="truncate text-xs text-slate-500">
              Ouverte par {periode.employe_nom} · {periode.nb_ventes} vente(s)
            </p>
          </div>
          {panier.length > 0 && (
            <button onClick={viderPanier} className="text-xs font-semibold text-red-600 hover:underline">
              Vider
            </button>
          )}
          {employe && employe.role !== 'serveur' && (
            <FermetureCaisse periode={periode} onFerme={charger} />
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {erreur && (
            <div className="p-3">
              <Alerte message={erreur} />
            </div>
          )}
          {panier.length === 0 ? (
            <Vide message="Touchez un article pour le mettre au panier." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {panier.map((l) => (
                <li key={l.cle} className="flex items-center gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-800">{l.libelle}</div>
                    <div className="text-xs text-slate-500">
                      {quantite(l.quantite)} × {montant(l.prix_unitaire)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => modifierQuantite(l.cle, -1)}
                      className="rounded-md border border-slate-300 p-1 text-slate-600 hover:bg-slate-100"
                      aria-label="Diminuer"
                    >
                      <Icone nom="moins" className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => modifierQuantite(l.cle, 1)}
                      className="rounded-md border border-slate-300 p-1 text-slate-600 hover:bg-slate-100"
                      aria-label="Augmenter"
                    >
                      <Icone nom="plus" className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="w-20 text-right text-sm font-bold text-slate-800">
                    {montant(Math.round(l.prix_unitaire * l.quantite), false)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {panier.length > 0 && (
          <div className="space-y-2 border-t border-slate-200 p-3">
            <div className="grid grid-cols-2 gap-2">
              <select className="champ" value={tableId} onChange={(e) => setTableId(Number(e.target.value) || '')}>
                <option value="">Sans table</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nom}
                  </option>
                ))}
              </select>
              <select className="champ" value={clientId} onChange={(e) => setClientId(Number(e.target.value) || '')}>
                <option value="">Sans client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom}
                  </option>
                ))}
              </select>
            </div>

            {/* 6.2 — la remise */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remise</span>
              <div className="flex overflow-hidden rounded-lg border border-slate-300">
                {(['montant', 'pourcentage'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setRemiseType(t)}
                    className={`px-2.5 py-1 text-xs font-semibold ${
                      remiseType === t ? 'bg-gesta-600 text-white' : 'bg-white text-slate-600'
                    }`}
                  >
                    {t === 'montant' ? parametres?.devise : '%'}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={0}
                className="champ flex-1 py-1"
                value={remiseValeur || ''}
                onChange={(e) => setRemiseValeur(Number(e.target.value) || 0)}
                placeholder="0"
              />
            </div>

            <div className="space-y-0.5 border-t border-slate-200 pt-2 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Sous-total</span>
                <span>{montant(sousTotal)}</span>
              </div>
              {remiseMontant > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Remise</span>
                  <span>− {montant(remiseMontant)}</span>
                </div>
              )}
              {taxe > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>TVA ({taux}%)</span>
                  <span>{montant(taxe)}</span>
                </div>
              )}
              <div className="flex justify-between pt-1 text-lg font-black text-slate-900">
                <span>Total</span>
                <span>{montant(total)}</span>
              </div>
            </div>

            <button
              onClick={() => {
                setMontantRecu(String(total));
                setPaiementOuvert(true);
              }}
              className="bouton-principal w-full py-3 text-base"
            >
              Encaisser {montant(total)}
            </button>
          </div>
        )}
      </aside>

      {/* Saisie prix libre / quantité au poids */}
      <Fenetre ouverte={!!saisie} titre={saisie?.article.libelle ?? ''} onFermer={() => setSaisie(null)}>
        {saisie && (
          <div className="space-y-4">
            <div>
              <label className="etiquette" htmlFor="q">
                Quantité {saisie.article.vendu_par === 'poids_volume' && `(en ${saisie.article.unite})`}
              </label>
              <input
                id="q"
                type="text"
                inputMode="decimal"
                className="champ text-lg"
                value={saisie.quantite}
                onChange={(e) => setSaisie({ ...saisie, quantite: e.target.value })}
                placeholder={saisie.article.vendu_par === 'poids_volume' ? 'ex. 1,5' : '1'}
                autoFocus
              />
            </div>
            <div>
              <label className="etiquette" htmlFor="p">
                Prix unitaire
              </label>
              <input
                id="p"
                type="number"
                min={0}
                className="champ text-lg"
                value={saisie.prix}
                onChange={(e) => setSaisie({ ...saisie, prix: e.target.value })}
                placeholder="0"
              />
              {saisie.article.prix_vente === 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  Cet article n'a pas de prix fixe : indiquez le prix convenu.
                </p>
              )}
            </div>
            <button onClick={validerSaisie} className="bouton-principal w-full">
              Ajouter au panier
            </button>
          </div>
        )}
      </Fenetre>

      {/* Paiement */}
      <Fenetre ouverte={paiementOuvert} titre="Encaissement" onFermer={() => setPaiementOuvert(false)}>
        <div className="space-y-4">
          {erreur && <Alerte message={erreur} />}

          <div className="rounded-xl bg-gesta-50 p-4 text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-gesta-700">Total à payer</div>
            <div className="text-3xl font-black text-gesta-800">{montant(total)}</div>
          </div>

          <div>
            <span className="etiquette">Mode de paiement</span>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((m) => (
                <button
                  key={m}
                  onClick={() => setModePaiement(m)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${
                    modePaiement === m
                      ? 'border-gesta-600 bg-gesta-50 text-gesta-700'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {LIBELLES_PAIEMENT[m]}
                </button>
              ))}
            </div>
          </div>

          {modePaiement === 'credit' ? (
            <Alerte
              type="info"
              message={
                clientId
                  ? "Le montant sera porté au compte du client, à régler plus tard."
                  : 'Choisissez un client dans le panier avant de vendre à crédit.'
              }
            />
          ) : (
            <>
              <div>
                <label className="etiquette" htmlFor="recu">
                  Montant reçu
                </label>
                <input
                  id="recu"
                  type="number"
                  min={0}
                  className="champ text-lg"
                  value={montantRecu}
                  onChange={(e) => setMontantRecu(e.target.value)}
                  autoFocus
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[total, 1000, 2000, 5000, 10000].map((v, i) => (
                    <button
                      key={`${v}-${i}`}
                      onClick={() => setMontantRecu(String(i === 0 ? v : (Number(montantRecu) || 0) + v))}
                      className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                    >
                      {i === 0 ? 'Appoint' : `+ ${montant(v, false)}`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="font-semibold text-slate-600">Monnaie à rendre</span>
                <span className="text-lg font-black text-slate-900">{montant(rendu)}</span>
              </div>
            </>
          )}

          <button
            onClick={encaisser}
            className="bouton-principal w-full py-3 text-base"
            disabled={enCours || (modePaiement === 'credit' && !clientId)}
          >
            {enCours ? 'Enregistrement…' : 'Valider la vente'}
          </button>
        </div>
      </Fenetre>

      {/* Reçu après vente */}
      <Fenetre
        ouverte={!!venteFinalisee}
        titre="Vente enregistrée"
        onFermer={() => setVenteFinalisee(null)}
      >
        {venteFinalisee && parametres && (
          <div className="space-y-4">
            {venteFinalisee.monnaie > 0 && (
              <div className="rounded-xl bg-amber-50 p-4 text-center">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Monnaie à rendre
                </div>
                <div className="text-3xl font-black text-amber-800">{montant(venteFinalisee.monnaie)}</div>
              </div>
            )}
            <div className="rounded-lg border border-slate-200">
              <Recu vente={venteFinalisee} parametres={parametres} />
            </div>
            <div className="sans-impression grid grid-cols-2 gap-2">
              <button onClick={() => window.print()} className="bouton-secondaire">
                <Icone nom="imprimer" className="h-4 w-4" /> Imprimer
              </button>
              <button onClick={() => setVenteFinalisee(null)} className="bouton-principal">
                Nouvelle vente
              </button>
            </div>
          </div>
        )}
      </Fenetre>
    </div>
  );
}

/** Fermeture de caisse avec contrôle des espèces. Le rôle serveur n'y a pas accès. */
function FermetureCaisse({ periode, onFerme }: { periode: Periode; onFerme: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [compte, setCompte] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');

  const attendu = periode.especes_attendues ?? 0;
  const ecart = (Number(compte) || 0) - attendu;

  async function fermer() {
    setEnCours(true);
    try {
      await api.post(`/periodes/${periode.id}/fermer`, { montant_compte: Number(compte) || 0 });
      setOuvert(false);
      setCompte('');
      onFerme();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Fermeture impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOuvert(true)}
        className="sans-impression whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
      >
        Fermer la caisse
      </button>

      <Fenetre ouverte={ouvert} titre="Fermeture de la caisse" onFermer={() => setOuvert(false)}>
        <div className="space-y-4">
          {erreur && <Alerte message={erreur} />}

          <dl className="space-y-1.5 rounded-lg bg-slate-50 p-3 text-sm">
            {[
              ['Fond de caisse', periode.fond_caisse],
              ['Ventes encaissées', periode.total_ventes],
              ['Dépenses sorties', -(periode.total_depenses ?? 0)],
            ].map(([libelle, valeur]) => (
              <div key={String(libelle)} className="flex justify-between text-slate-600">
                <dt>{libelle}</dt>
                <dd>{montant(Number(valeur))}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-900">
              <dt>Espèces attendues</dt>
              <dd>{montant(attendu)}</dd>
            </div>
          </dl>

          <div>
            <label className="etiquette" htmlFor="compte">
              Espèces comptées dans le tiroir
            </label>
            <input
              id="compte"
              type="number"
              min={0}
              className="champ text-lg"
              value={compte}
              onChange={(e) => setCompte(e.target.value)}
              autoFocus
            />
          </div>

          {compte !== '' && (
            <div
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                ecart === 0
                  ? 'bg-gesta-50 text-gesta-800'
                  : ecart > 0
                    ? 'bg-sky-50 text-sky-800'
                    : 'bg-red-50 text-red-700'
              }`}
            >
              {ecart === 0
                ? 'La caisse est juste.'
                : ecart > 0
                  ? `Excédent de ${montant(ecart)}`
                  : `Manquant de ${montant(-ecart)}`}
            </div>
          )}

          <button onClick={fermer} className="bouton-principal w-full" disabled={enCours || compte === ''}>
            {enCours ? 'Fermeture…' : 'Confirmer la fermeture'}
          </button>
        </div>
      </Fenetre>
    </>
  );
}
