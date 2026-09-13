import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { montant, quantite, dateHeure } from '../lib/format';
import { Alerte, Chargement, Fenetre, Icone, Vide } from '../components/ui';
import type { Article, MouvementStock, NiveauStock } from '../lib/types';

type Onglet = 'niveaux' | 'mouvements';
type TypeMouvement = 'entree' | 'sortie' | 'ajustement';

const TYPES: { cle: TypeMouvement; libelle: string; aide: string }[] = [
  { cle: 'entree', libelle: 'Entrée', aide: 'Réception d’une livraison' },
  { cle: 'sortie', libelle: 'Sortie', aide: 'Perte, casse, consommation' },
  { cle: 'ajustement', libelle: 'Ajustement', aide: 'Corriger après inventaire' },
];

const COULEURS_TYPE: Record<string, string> = {
  entree: 'bg-gesta-100 text-gesta-800',
  sortie: 'bg-red-100 text-red-700',
  ajustement: 'bg-sky-100 text-sky-800',
  vente: 'bg-slate-100 text-slate-600',
  annulation: 'bg-amber-100 text-amber-800',
};

export default function Stocks() {
  const { pointVenteActif } = useSession();
  const [onglet, setOnglet] = useState<Onglet>('niveaux');
  const [niveaux, setNiveaux] = useState<NiveauStock[]>([]);
  const [mouvements, setMouvements] = useState<MouvementStock[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [formulaire, setFormulaire] = useState<TypeMouvement | null>(null);

  const charger = useCallback(async () => {
    if (!pointVenteActif) return;
    setChargement(true);
    try {
      const [n, m, a] = await Promise.all([
        api.get<NiveauStock[]>(`/stocks/niveaux${qs({ point_vente_id: pointVenteActif })}`),
        api.get<MouvementStock[]>('/stocks/mouvements'),
        api.get<Article[]>(`/articles${qs({ point_vente_id: pointVenteActif, actifs_seulement: 'true' })}`),
      ]);
      setNiveaux(n);
      setMouvements(m);
      setArticles(a.filter((x) => x.suivi_stock === 1));
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, [pointVenteActif]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const valeurTotale = niveaux.reduce((s, n) => s + n.valeur_stock, 0);
  const enAlerte = niveaux.filter((n) => n.niveau !== 'ok');

  return (
    <div className="p-3 lg:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black text-slate-800">Gestion des stocks</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <button key={t.cle} onClick={() => setFormulaire(t.cle)} className="bouton-secondaire">
              <Icone nom={t.cle === 'entree' ? 'plus' : t.cle === 'sortie' ? 'moins' : 'crayon'} className="h-4 w-4" />
              {t.libelle}
            </button>
          ))}
        </div>
      </div>

      {erreur && (
        <div className="mb-3">
          <Alerte message={erreur} />
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="carte p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Articles suivis</div>
          <div className="mt-1 text-2xl font-black">{niveaux.length}</div>
        </div>
        <div className="carte p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Valeur du stock</div>
          <div className="mt-1 text-2xl font-black">{montant(valeurTotale)}</div>
        </div>
        <div className="carte p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sous le seuil</div>
          <div className="mt-1 text-2xl font-black text-amber-600">{enAlerte.length}</div>
        </div>
        <div className="carte p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">En rupture</div>
          <div className="mt-1 text-2xl font-black text-red-600">
            {niveaux.filter((n) => n.niveau === 'rupture').length}
          </div>
        </div>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-200 p-1">
        {(['niveaux', 'mouvements'] as const).map((o) => (
          <button
            key={o}
            onClick={() => setOnglet(o)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              onglet === o ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600'
            }`}
          >
            {o === 'niveaux' ? 'Niveaux de stock' : 'Historique des mouvements'}
          </button>
        ))}
      </div>

      {chargement ? (
        <Chargement />
      ) : onglet === 'niveaux' ? (
        niveaux.length === 0 ? (
          <Vide message="Aucun article avec suivi de stock. Activez « Suivi de stock » sur un article." />
        ) : (
          <div className="carte divide-y divide-slate-100 overflow-hidden">
            {niveaux.map((n) => (
              <div key={n.id} className="flex items-center gap-3 p-3">
                <span className="text-2xl">{n.image || '📦'}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-800">{n.libelle}</div>
                  <div className="text-xs text-slate-500">
                    {n.categorie_libelle ?? 'Aucune Catégorie'} · seuil {quantite(n.alerte_stock)} {n.unite}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-lg font-black ${
                      n.niveau === 'rupture'
                        ? 'text-red-600'
                        : n.niveau === 'alerte'
                          ? 'text-amber-600'
                          : 'text-slate-800'
                    }`}
                  >
                    {quantite(n.stock)} <span className="text-xs font-medium text-slate-500">{n.unite}</span>
                  </div>
                  <div className="text-xs text-slate-400">{montant(n.valeur_stock)}</div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : mouvements.length === 0 ? (
        <Vide message="Aucun mouvement enregistré." />
      ) : (
        <div className="carte divide-y divide-slate-100 overflow-hidden">
          {mouvements.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
              <span className={`puce ${COULEURS_TYPE[m.type]}`}>{m.type}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-800">{m.article_libelle}</div>
                <div className="text-xs text-slate-500">
                  {dateHeure(m.cree_le)}
                  {m.employe_nom && ` · ${m.employe_nom}`}
                  {m.motif && ` · ${m.motif}`}
                  {m.vente_reference && ` · ${m.vente_reference}`}
                </div>
              </div>
              <div className="text-right text-sm">
                <div className="font-bold text-slate-800">
                  {m.type === 'entree' || m.type === 'annulation' ? '+' : '−'}
                  {quantite(m.quantite)} {m.unite}
                </div>
                <div className="text-xs text-slate-400">
                  {quantite(m.stock_avant)} → {quantite(m.stock_apres)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <FormulaireMouvement
        type={formulaire}
        articles={articles}
        onFermer={() => setFormulaire(null)}
        onEnregistre={() => {
          setFormulaire(null);
          void charger();
        }}
      />
    </div>
  );
}

function FormulaireMouvement({
  type,
  articles,
  onFermer,
  onEnregistre,
}: {
  type: TypeMouvement | null;
  articles: Article[];
  onFermer: () => void;
  onEnregistre: () => void;
}) {
  const [articleId, setArticleId] = useState<number | ''>('');
  const [qte, setQte] = useState('');
  const [cout, setCout] = useState('');
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    setArticleId('');
    setQte('');
    setCout('');
    setMotif('');
    setErreur('');
  }, [type]);

  const article = articles.find((a) => a.id === articleId);
  const infos = TYPES.find((t) => t.cle === type);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    try {
      await api.post('/stocks/mouvements', {
        article_id: articleId,
        type,
        quantite: Number(qte.replace(',', '.')),
        cout_unitaire: Number(cout) || 0,
        motif: motif || null,
      });
      onEnregistre();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Fenetre ouverte={!!type} titre={infos ? `${infos.libelle} de stock` : ''} onFermer={onFermer}>
      <form onSubmit={soumettre} className="space-y-4">
        {erreur && <Alerte message={erreur} />}
        {infos && <Alerte type="info" message={infos.aide} />}

        <div>
          <label className="etiquette" htmlFor="art">
            Article <span className="text-red-500">*</span>
          </label>
          <select
            id="art"
            className="champ"
            value={articleId}
            onChange={(e) => setArticleId(Number(e.target.value) || '')}
            required
          >
            <option value="">Choisir un article…</option>
            {articles.map((a) => (
              <option key={a.id} value={a.id}>
                {a.libelle} — {quantite(a.stock)} {a.unite}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="etiquette" htmlFor="qte">
            {type === 'ajustement' ? 'Stock réel compté' : 'Quantité'} <span className="text-red-500">*</span>
            {article && <span className="ml-1 font-normal normal-case text-slate-400">en {article.unite}</span>}
          </label>
          <input
            id="qte"
            type="text"
            inputMode="decimal"
            className="champ text-lg"
            value={qte}
            onChange={(e) => setQte(e.target.value)}
            required
          />
          {article && type === 'ajustement' && (
            <p className="mt-1 text-xs text-slate-500">
              Stock actuel enregistré : {quantite(article.stock)} {article.unite}
            </p>
          )}
        </div>

        {type === 'entree' && (
          <div>
            <label className="etiquette" htmlFor="cout">
              Coût unitaire d'achat
            </label>
            <input
              id="cout"
              type="number"
              min={0}
              className="champ"
              value={cout}
              onChange={(e) => setCout(e.target.value)}
              placeholder={article ? String(article.cout) : '0'}
            />
            <p className="mt-1 text-xs text-slate-500">
              S'il est renseigné, il remplace le coût de référence de l'article.
            </p>
          </div>
        )}

        <div>
          <label className="etiquette" htmlFor="motif">
            Motif
          </label>
          <input
            id="motif"
            className="champ"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder={type === 'sortie' ? 'Casse, perte…' : type === 'entree' ? 'Livraison…' : 'Inventaire…'}
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onFermer} className="bouton-secondaire flex-1">
            Annuler
          </button>
          <button type="submit" className="bouton-principal flex-1" disabled={enCours}>
            {enCours ? 'Enregistrement…' : 'Valider'}
          </button>
        </div>
      </form>
    </Fenetre>
  );
}
