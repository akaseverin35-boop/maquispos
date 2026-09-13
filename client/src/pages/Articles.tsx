import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { montant, quantite } from '../lib/format';
import { Alerte, Chargement, Fenetre, Icone, Vide } from '../components/ui';
import type { Article, Categorie, VenduPar } from '../lib/types';

const EMOJIS = ['🍽️', '🍲', '🍛', '🥘', '🍗', '🌮', '🥐', '🍍', '🥗', '🍺', '🥤', '💧', '☕', '🍰', '🐟', '🍚'];

type Onglet = 'articles' | 'categories';

export default function Articles() {
  const { pointVenteActif, pointsVente } = useSession();
  const [onglet, setOnglet] = useState<Onglet>('articles');
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [chargement, setChargement] = useState(true);
  const [recherche, setRecherche] = useState('');
  const [erreur, setErreur] = useState('');

  const [articleEdite, setArticleEdite] = useState<Partial<Article> | null>(null);
  const [categorieEditee, setCategorieEditee] = useState<Partial<Categorie> | null>(null);

  const charger = useCallback(async () => {
    if (!pointVenteActif) return;
    setChargement(true);
    try {
      const [a, c] = await Promise.all([
        api.get<Article[]>(`/articles${qs({ point_vente_id: pointVenteActif, recherche })}`),
        api.get<Categorie[]>(`/categories${qs({ point_vente_id: pointVenteActif })}`),
      ]);
      setArticles(a);
      setCategories(c);
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, [pointVenteActif, recherche]);

  useEffect(() => {
    const t = setTimeout(() => void charger(), recherche ? 250 : 0);
    return () => clearTimeout(t);
  }, [charger, recherche]);

  async function supprimerArticle(a: Article) {
    if (!confirm(`Supprimer « ${a.libelle} » ?`)) return;
    try {
      const r = await api.delete<{ desactive: boolean }>(`/articles/${a.id}`);
      if (r.desactive) alert("Cet article a déjà été vendu : il a été désactivé pour préserver l'historique.");
      void charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Suppression impossible');
    }
  }

  async function supprimerCategorie(c: Categorie) {
    if (!confirm(`Supprimer la catégorie « ${c.libelle} » ? Ses articles passeront en « Aucune Catégorie ».`)) return;
    try {
      await api.delete(`/categories/${c.id}`);
      void charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Suppression impossible');
    }
  }

  return (
    <div className="p-3 lg:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black text-slate-800">Gestion des articles</h1>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() =>
              onglet === 'articles'
                ? setArticleEdite({ point_vente_id: pointVenteActif, vendu_par: 'chaque', unite: 'pièce', actif: 1 })
                : setCategorieEditee({ point_vente_id: pointVenteActif, couleur: '#16a34a' })
            }
            className="bouton-principal"
          >
            <Icone nom="plus" className="h-4 w-4" />
            {onglet === 'articles' ? 'Nouvel article' : 'Nouvelle catégorie'}
          </button>
        </div>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-200 p-1">
        {(['articles', 'categories'] as const).map((o) => (
          <button
            key={o}
            onClick={() => setOnglet(o)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              onglet === o ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600'
            }`}
          >
            {o === 'articles' ? `Articles (${articles.length})` : `Catégories (${categories.length})`}
          </button>
        ))}
      </div>

      {erreur && (
        <div className="mb-3">
          <Alerte message={erreur} />
        </div>
      )}

      {onglet === 'articles' && (
        <div className="relative mb-3">
          <Icone nom="recherche" className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
          <input
            className="champ pl-10"
            placeholder="Rechercher un article…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
      )}

      {chargement ? (
        <Chargement />
      ) : onglet === 'articles' ? (
        articles.length === 0 ? (
          <Vide message="Aucun article pour ce point de vente." />
        ) : (
          <div className="carte divide-y divide-slate-100 overflow-hidden">
            {articles.map((a) => (
              <div key={a.id} className="flex items-center gap-3 p-3">
                <span className="text-2xl">{a.image || '🍽️'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-slate-800">{a.libelle}</span>
                    {!a.actif && <span className="puce bg-slate-200 text-slate-600">Inactif</span>}
                    {a.suivi_stock === 1 && a.stock <= a.alerte_stock && (
                      <span className="puce bg-amber-100 text-amber-700">Stock bas</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {a.categorie_libelle ?? 'Aucune Catégorie'}
                    {a.vendu_par === 'poids_volume' && ` · au ${a.unite}`}
                    {a.suivi_stock === 1 && ` · stock ${quantite(a.stock)} ${a.unite}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-gesta-700">
                    {a.prix_vente === 0 ? 'Prix libre' : montant(a.prix_vente)}
                  </div>
                  {a.cout > 0 && <div className="text-xs text-slate-400">coût {montant(a.cout)}</div>}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setArticleEdite(a)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                    aria-label="Modifier"
                  >
                    <Icone nom="crayon" className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => supprimerArticle(a)}
                    className="rounded-lg p-2 text-red-500 hover:bg-red-50"
                    aria-label="Supprimer"
                  >
                    <Icone nom="corbeille" className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : categories.length === 0 ? (
        <Vide message="Aucune catégorie pour ce point de vente." />
      ) : (
        <div className="carte divide-y divide-slate-100 overflow-hidden">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-3">
              <span className="h-8 w-8 shrink-0 rounded-lg" style={{ backgroundColor: c.couleur }} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-800">{c.libelle}</div>
                <div className="text-xs text-slate-500">{c.nb_articles} article(s)</div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setCategorieEditee(c)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Modifier"
                >
                  <Icone nom="crayon" className="h-4 w-4" />
                </button>
                <button
                  onClick={() => supprimerCategorie(c)}
                  className="rounded-lg p-2 text-red-500 hover:bg-red-50"
                  aria-label="Supprimer"
                >
                  <Icone nom="corbeille" className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <FormulaireArticle
        valeur={articleEdite}
        categories={categories}
        pointsVente={pointsVente}
        onFermer={() => setArticleEdite(null)}
        onEnregistre={() => {
          setArticleEdite(null);
          void charger();
        }}
      />
      <FormulaireCategorie
        valeur={categorieEditee}
        pointsVente={pointsVente}
        onFermer={() => setCategorieEditee(null)}
        onEnregistre={() => {
          setCategorieEditee(null);
          void charger();
        }}
      />
    </div>
  );
}

/* ------------------------- 4.1 / 4.2 — Formulaire ------------------------- */

function FormulaireArticle({
  valeur,
  categories,
  pointsVente,
  onFermer,
  onEnregistre,
}: {
  valeur: Partial<Article> | null;
  categories: Categorie[];
  pointsVente: { id: number; nom: string }[];
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const [f, setF] = useState<Partial<Article>>({});
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (valeur) setF({ vendu_par: 'chaque', unite: 'pièce', actif: 1, suivi_stock: 0, ...valeur });
    setErreur('');
  }, [valeur]);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    const corps = {
      libelle: f.libelle,
      code: f.code || null,
      categorie_id: f.categorie_id || null,
      point_vente_id: f.point_vente_id,
      vendu_par: f.vendu_par,
      unite: f.unite,
      prix_vente: Number(f.prix_vente) || 0,
      cout: Number(f.cout) || 0,
      suivi_stock: !!f.suivi_stock,
      stock: Number(f.stock) || 0,
      alerte_stock: Number(f.alerte_stock) || 0,
      image: f.image || null,
      actif: !!f.actif,
    };
    try {
      if (f.id) await api.put(`/articles/${f.id}`, corps);
      else await api.post('/articles', corps);
      onEnregistre();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Fenetre ouverte={!!valeur} titre={f.id ? 'Modifier un article' : 'Créer un article'} onFermer={onFermer} large>
      <form onSubmit={soumettre} className="space-y-4">
        {erreur && <Alerte message={erreur} />}

        <div>
          <label className="etiquette" htmlFor="libelle">
            Libellé <span className="text-red-500">*</span>
          </label>
          <input
            id="libelle"
            className="champ"
            value={f.libelle ?? ''}
            onChange={(e) => setF({ ...f, libelle: e.target.value })}
            required
            autoFocus
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiquette" htmlFor="cat">
              Catégorie
            </label>
            <select
              id="cat"
              className="champ"
              value={f.categorie_id ?? ''}
              onChange={(e) => setF({ ...f, categorie_id: Number(e.target.value) || null })}
            >
              <option value="">Aucune Catégorie</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.libelle}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiquette" htmlFor="pv">
              Point de ventes <span className="text-red-500">*</span>
            </label>
            <select
              id="pv"
              className="champ"
              value={f.point_vente_id ?? ''}
              onChange={(e) => setF({ ...f, point_vente_id: Number(e.target.value) })}
              required
            >
              <option value="">Choisir…</option>
              {pointsVente.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <span className="etiquette">Vendu par</span>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['chaque', 'Chaque', 'Quantité entière (1, 2, 3…)'],
                ['poids_volume', 'Poids / Volume', 'Quantité décimale (1,5 kg)'],
              ] as [VenduPar, string, string][]
            ).map(([v, titre, aide]) => (
              <button
                key={v}
                type="button"
                onClick={() => setF({ ...f, vendu_par: v, unite: v === 'chaque' ? 'pièce' : 'kg' })}
                className={`rounded-lg border p-3 text-left transition ${
                  f.vendu_par === v ? 'border-gesta-600 bg-gesta-50' : 'border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="text-sm font-semibold text-slate-800">{titre}</div>
                <div className="text-xs text-slate-500">{aide}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="etiquette" htmlFor="prix">
              Prix de vente
            </label>
            <input
              id="prix"
              type="number"
              min={0}
              className="champ"
              value={f.prix_vente ?? 0}
              onChange={(e) => setF({ ...f, prix_vente: Number(e.target.value) })}
            />
            <p className="mt-1 text-[11px] text-slate-500">0 = prix libre, saisi à la vente.</p>
          </div>
          <div>
            <label className="etiquette" htmlFor="cout">
              Coût
            </label>
            <input
              id="cout"
              type="number"
              min={0}
              className="champ"
              value={f.cout ?? 0}
              onChange={(e) => setF({ ...f, cout: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="etiquette" htmlFor="unite">
              Unité
            </label>
            <input
              id="unite"
              className="champ"
              value={f.unite ?? ''}
              onChange={(e) => setF({ ...f, unite: e.target.value })}
              placeholder="pièce, kg, L…"
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="text-sm font-semibold text-slate-800">Suivi de stock</span>
              <span className="block text-xs text-slate-500">
                La vente sera bloquée si le stock tombe à zéro.
              </span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-gesta-600"
              checked={!!f.suivi_stock}
              onChange={(e) => setF({ ...f, suivi_stock: e.target.checked ? 1 : 0 })}
            />
          </label>

          {!!f.suivi_stock && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="etiquette" htmlFor="stock">
                  Stock {f.id && '(modifiable via le module Stocks)'}
                </label>
                <input
                  id="stock"
                  type="number"
                  step="any"
                  min={0}
                  className="champ"
                  value={f.stock ?? 0}
                  onChange={(e) => setF({ ...f, stock: Number(e.target.value) })}
                  disabled={!!f.id}
                />
              </div>
              <div>
                <label className="etiquette" htmlFor="alerte">
                  Alerte stock
                </label>
                <input
                  id="alerte"
                  type="number"
                  step="any"
                  min={0}
                  className="champ"
                  value={f.alerte_stock ?? 0}
                  onChange={(e) => setF({ ...f, alerte_stock: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
        </div>

        <div>
          <span className="etiquette">Image</span>
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setF({ ...f, image: e })}
                className={`h-10 w-10 rounded-lg border text-xl transition ${
                  f.image === e ? 'border-gesta-600 bg-gesta-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-gesta-600"
            checked={!!f.actif}
            onChange={(e) => setF({ ...f, actif: e.target.checked ? 1 : 0 })}
          />
          Article actif (visible en caisse)
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

/* ------------------------- 3.1 / 3.2 — Catégories ------------------------- */

const COULEURS = ['#16a34a', '#f59e0b', '#0ea5e9', '#8b5cf6', '#ef4444', '#ec4899', '#64748b', '#14b8a6'];

function FormulaireCategorie({
  valeur,
  pointsVente,
  onFermer,
  onEnregistre,
}: {
  valeur: Partial<Categorie> | null;
  pointsVente: { id: number; nom: string }[];
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const [f, setF] = useState<Partial<Categorie>>({});
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (valeur) setF({ couleur: '#16a34a', position: 0, ...valeur });
    setErreur('');
  }, [valeur]);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    try {
      const corps = {
        libelle: f.libelle,
        couleur: f.couleur,
        position: Number(f.position) || 0,
        point_vente_id: f.point_vente_id,
      };
      if (f.id) await api.put(`/categories/${f.id}`, corps);
      else await api.post('/categories', corps);
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
      titre={f.id ? 'Modifier la catégorie' : 'Créer la catégorie'}
      onFermer={onFermer}
    >
      <form onSubmit={soumettre} className="space-y-4">
        {erreur && <Alerte message={erreur} />}

        <div>
          <label className="etiquette" htmlFor="libcat">
            Libellé <span className="text-red-500">*</span>
          </label>
          <input
            id="libcat"
            className="champ"
            value={f.libelle ?? ''}
            onChange={(e) => setF({ ...f, libelle: e.target.value })}
            required
            autoFocus
          />
        </div>

        <div>
          <label className="etiquette" htmlFor="pvcat">
            Point de ventes <span className="text-red-500">*</span>
          </label>
          <select
            id="pvcat"
            className="champ"
            value={f.point_vente_id ?? ''}
            onChange={(e) => setF({ ...f, point_vente_id: Number(e.target.value) })}
            required
          >
            <option value="">Choisir…</option>
            {pointsVente.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="etiquette">Couleur</span>
          <div className="flex flex-wrap gap-2">
            {COULEURS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setF({ ...f, couleur: c })}
                className={`h-9 w-9 rounded-lg ring-offset-2 transition ${
                  f.couleur === c ? 'ring-2 ring-slate-800' : ''
                }`}
                style={{ backgroundColor: c }}
                aria-label={`Couleur ${c}`}
              />
            ))}
          </div>
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
