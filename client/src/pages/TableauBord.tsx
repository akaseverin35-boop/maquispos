import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { montant, quantite, aujourdhui, ilYAJours, dateCourte, LIBELLES_PAIEMENT } from '../lib/format';
import { Chargement, Icone, Vide, Alerte } from '../components/ui';
import type { ResumeTableauBord } from '../lib/types';

interface Point { jour: string; nb: number; total: number }
interface Ligne { libelle: string; quantite: number; total: number }

const PLAGES = [
  { cle: 'jour', libelle: "Aujourd'hui", du: () => aujourdhui() },
  { cle: 'semaine', libelle: '7 jours', du: () => ilYAJours(6) },
  { cle: 'mois', libelle: '30 jours', du: () => ilYAJours(29) },
] as const;

export default function TableauBord() {
  const { pointVenteActif } = useSession();
  const [plage, setPlage] = useState<(typeof PLAGES)[number]['cle']>('jour');
  const [resume, setResume] = useState<ResumeTableauBord | null>(null);
  const [evolution, setEvolution] = useState<Point[]>([]);
  const [meilleurs, setMeilleurs] = useState<Ligne[]>([]);
  const [categories, setCategories] = useState<{ categorie: string; total: number }[]>([]);
  const [paiements, setPaiements] = useState<{ mode_paiement: string; total: number; nb: number }[]>([]);
  const [employes, setEmployes] = useState<{ employe: string; nb_ventes: number; total: number }[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');

  const charger = useCallback(async () => {
    setChargement(true);
    const p = qs({
      du: PLAGES.find((x) => x.cle === plage)!.du(),
      au: aujourdhui(),
      point_vente_id: pointVenteActif,
    });
    try {
      const [r, e, m, c, pa, em] = await Promise.all([
        api.get<ResumeTableauBord>(`/tableau-bord/resume${p}`),
        api.get<Point[]>(`/tableau-bord/evolution${p}`),
        api.get<Ligne[]>(`/tableau-bord/meilleurs-articles${p}`),
        api.get<{ categorie: string; total: number }[]>(`/tableau-bord/par-categorie${p}`),
        api.get<{ mode_paiement: string; total: number; nb: number }[]>(`/tableau-bord/par-paiement${p}`),
        api.get<{ employe: string; nb_ventes: number; total: number }[]>(`/tableau-bord/par-employe${p}`),
      ]);
      setResume(r);
      setEvolution(e);
      setMeilleurs(m);
      setCategories(c);
      setPaiements(pa);
      setEmployes(em);
      setErreur('');
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, [plage, pointVenteActif]);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (chargement && !resume) return <Chargement />;

  return (
    <div className="p-3 lg:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black text-slate-800">Tableau de bord</h1>
        <div className="ml-auto flex gap-1 rounded-lg bg-slate-200 p-1">
          {PLAGES.map((p) => (
            <button
              key={p.cle}
              onClick={() => setPlage(p.cle)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                plage === p.cle ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600'
              }`}
            >
              {p.libelle}
            </button>
          ))}
        </div>
      </div>

      {erreur && (
        <div className="mb-3">
          <Alerte message={erreur} />
        </div>
      )}

      {resume && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tuile titre="Chiffre d'affaires" valeur={montant(resume.chiffre_affaires)} accent />
            <Tuile titre="Ventes" valeur={String(resume.nb_ventes)} detail={`panier moyen ${montant(resume.panier_moyen)}`} />
            <Tuile titre="Marge brute" valeur={montant(resume.marge_brute)} />
            <Tuile
              titre="Résultat"
              valeur={montant(resume.resultat)}
              detail={`dépenses ${montant(resume.depenses)}`}
              negatif={resume.resultat < 0}
            />
          </div>

          {(resume.articles_en_alerte > 0 || resume.creances_clients > 0 || resume.ventes_annulees > 0) && (
            <div className="mb-4 flex flex-wrap gap-2">
              {resume.articles_en_alerte > 0 && (
                <Signal
                  icone="alerte"
                  couleur="bg-amber-50 text-amber-800 border-amber-200"
                  texte={`${resume.articles_en_alerte} article(s) sous le seuil d'alerte`}
                />
              )}
              {resume.creances_clients > 0 && (
                <Signal
                  icone="client"
                  couleur="bg-sky-50 text-sky-800 border-sky-200"
                  texte={`${montant(resume.creances_clients)} de créances clients`}
                />
              )}
              {resume.ventes_annulees > 0 && (
                <Signal
                  icone="croix"
                  couleur="bg-red-50 text-red-700 border-red-200"
                  texte={`${resume.ventes_annulees} vente(s) annulée(s)`}
                />
              )}
            </div>
          )}
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Bloc titre="Évolution des ventes">
          {evolution.length === 0 ? <Vide message="Aucune vente sur la période." /> : <Courbe points={evolution} />}
        </Bloc>

        <Bloc titre="Meilleurs articles">
          {meilleurs.length === 0 ? (
            <Vide message="Aucune vente sur la période." />
          ) : (
            <Barres
              lignes={meilleurs.map((m) => ({
                libelle: m.libelle,
                valeur: m.total,
                detail: `${quantite(m.quantite)} vendus`,
              }))}
            />
          )}
        </Bloc>

        <Bloc titre="Ventes par catégorie">
          {categories.length === 0 ? (
            <Vide message="Aucune donnée." />
          ) : (
            <Barres lignes={categories.map((c) => ({ libelle: c.categorie, valeur: c.total }))} />
          )}
        </Bloc>

        <Bloc titre="Modes de paiement">
          {paiements.length === 0 ? (
            <Vide message="Aucune donnée." />
          ) : (
            <Barres
              lignes={paiements.map((p) => ({
                libelle: LIBELLES_PAIEMENT[p.mode_paiement] ?? p.mode_paiement,
                valeur: p.total,
                detail: `${p.nb} vente(s)`,
              }))}
            />
          )}
        </Bloc>

        <Bloc titre="Performance des employés" pleineLargeur>
          {employes.length === 0 ? (
            <Vide message="Aucune vente sur la période." />
          ) : (
            <Barres
              lignes={employes.map((e) => ({
                libelle: e.employe,
                valeur: e.total,
                detail: `${e.nb_ventes} vente(s)`,
              }))}
            />
          )}
        </Bloc>
      </div>
    </div>
  );
}

function Tuile({
  titre,
  valeur,
  detail,
  accent,
  negatif,
}: {
  titre: string;
  valeur: string;
  detail?: string;
  accent?: boolean;
  negatif?: boolean;
}) {
  return (
    <div className={`carte p-4 ${accent ? 'bg-gesta-600 text-white' : ''}`}>
      <div className={`text-xs font-semibold uppercase tracking-wide ${accent ? 'text-gesta-100' : 'text-slate-500'}`}>
        {titre}
      </div>
      <div className={`mt-1 text-xl font-black lg:text-2xl ${negatif ? 'text-red-600' : ''}`}>{valeur}</div>
      {detail && <div className={`text-xs ${accent ? 'text-gesta-100' : 'text-slate-500'}`}>{detail}</div>}
    </div>
  );
}

function Signal({ icone, couleur, texte }: { icone: string; couleur: string; texte: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${couleur}`}>
      <Icone nom={icone} className="h-4 w-4" />
      {texte}
    </div>
  );
}

function Bloc({ titre, children, pleineLargeur }: { titre: string; children: React.ReactNode; pleineLargeur?: boolean }) {
  return (
    <section className={`carte p-4 ${pleineLargeur ? 'lg:col-span-2' : ''}`}>
      <h2 className="mb-3 text-sm font-bold text-slate-800">{titre}</h2>
      {children}
    </section>
  );
}

/** Courbe en SVG : pas de librairie de graphiques à embarquer. */
function Courbe({ points }: { points: Point[] }) {
  const max = Math.max(...points.map((p) => p.total), 1);
  const l = 100;
  const h = 40;
  const pas = points.length > 1 ? l / (points.length - 1) : 0;
  const coords = points.map((p, i) => [i * pas, h - (p.total / max) * h] as const);
  const ligne = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const aire = `0,${h} ${ligne} ${(coords.at(-1)?.[0] ?? 0).toFixed(2)},${h}`;

  return (
    <div>
      <svg viewBox={`0 0 ${l} ${h}`} preserveAspectRatio="none" className="h-32 w-full">
        <polygon points={aire} fill="#16a34a" opacity="0.12" />
        <polyline points={ligne} fill="none" stroke="#16a34a" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
        {coords.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="0.9" fill="#16a34a" />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-slate-500">
        <span>{dateCourte(points[0].jour)}</span>
        <span className="font-semibold text-slate-700">Maximum : {montant(max)}</span>
        <span>{dateCourte(points.at(-1)!.jour)}</span>
      </div>
    </div>
  );
}

function Barres({ lignes }: { lignes: { libelle: string; valeur: number; detail?: string }[] }) {
  const max = Math.max(...lignes.map((l) => l.valeur), 1);
  return (
    <ul className="space-y-2.5">
      {lignes.map((l) => (
        <li key={l.libelle}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium text-slate-700">{l.libelle}</span>
            <span className="whitespace-nowrap font-bold text-slate-900">{montant(l.valeur)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gesta-500" style={{ width: `${(l.valeur / max) * 100}%` }} />
          </div>
          {l.detail && <div className="mt-0.5 text-[11px] text-slate-500">{l.detail}</div>}
        </li>
      ))}
    </ul>
  );
}
