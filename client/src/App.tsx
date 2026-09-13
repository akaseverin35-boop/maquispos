import { lazy, Suspense, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './lib/session';
import { Chargement, Icone } from './components/ui';
import { LIBELLES_ROLE } from './lib/format';
import Connexion from './pages/Connexion';

const TableauBord = lazy(() => import('./pages/TableauBord'));
const Caisse = lazy(() => import('./pages/Caisse'));
const Articles = lazy(() => import('./pages/Articles'));
const Stocks = lazy(() => import('./pages/Stocks'));
const Depenses = lazy(() => import('./pages/Depenses'));
const Commercial = lazy(() => import('./pages/Commercial'));
const Recus = lazy(() => import('./pages/Recus'));
const Employes = lazy(() => import('./pages/Employes'));
const Parametrage = lazy(() => import('./pages/Parametrage'));

interface Entree {
  chemin: string;
  libelle: string;
  icone: string;
  roles?: ('gerant' | 'caissier' | 'serveur')[];
}

const MENU: Entree[] = [
  { chemin: '/', libelle: 'Tableau de bord', icone: 'tableau', roles: ['gerant'] },
  { chemin: '/caisse', libelle: 'Faire la vente', icone: 'caisse', roles: ['gerant', 'caissier', 'serveur'] },
  { chemin: '/recus', libelle: 'Reçus de vente', icone: 'recu', roles: ['gerant', 'caissier'] },
  { chemin: '/articles', libelle: 'Articles', icone: 'articles', roles: ['gerant'] },
  { chemin: '/stocks', libelle: 'Stocks', icone: 'stock', roles: ['gerant'] },
  { chemin: '/depenses', libelle: 'Dépenses', icone: 'depense', roles: ['gerant', 'caissier'] },
  { chemin: '/commercial', libelle: 'Gestion commerciale', icone: 'client', roles: ['gerant', 'caissier'] },
  { chemin: '/employes', libelle: 'Employés', icone: 'employe' },
  { chemin: '/parametrage', libelle: 'Paramétrage', icone: 'reglage' },
];

function Barre({ onBasculer }: { onBasculer: () => void }) {
  const { employe, pointsVente, pointVenteActif, choisirPointVente, deconnecter } = useSession();

  return (
    <header className="sans-impression sticky top-0 z-30 flex items-center gap-3 bg-gesta-600 px-3 py-2.5 text-white shadow-md lg:px-5">
      <button onClick={onBasculer} className="rounded-lg p-1.5 hover:bg-white/15 lg:hidden" aria-label="Menu">
        <Icone nom="menu" />
      </button>

      <span className="text-lg font-black tracking-tight">Gesta+</span>

      <div className="ml-auto flex items-center gap-2">
        {pointsVente.length > 1 && (
          <select
            value={pointVenteActif ?? ''}
            onChange={(e) => choisirPointVente(Number(e.target.value))}
            className="max-w-[9rem] rounded-lg border-0 bg-white/15 px-2 py-1.5 text-sm font-medium text-white outline-none"
            aria-label="Point de vente"
          >
            {pointsVente.map((p) => (
              <option key={p.id} value={p.id} className="text-slate-800">
                {p.nom}
              </option>
            ))}
          </select>
        )}

        <div className="hidden text-right leading-tight sm:block">
          <div className="text-sm font-semibold">{employe?.nom_complet}</div>
          <div className="text-xs text-gesta-100">{LIBELLES_ROLE[employe?.role ?? '']}</div>
        </div>

        <button onClick={deconnecter} className="rounded-lg p-1.5 hover:bg-white/15" aria-label="Se déconnecter">
          <Icone nom="sortie" />
        </button>
      </div>
    </header>
  );
}

function Navigation({ ouvert, onFermer }: { ouvert: boolean; onFermer: () => void }) {
  const { peut } = useSession();
  const entrees = MENU.filter((e) => !e.roles || peut(...e.roles));

  return (
    <>
      {ouvert && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onFermer} />}
      <nav
        className={`sans-impression fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-slate-200 bg-white pt-3 transition-transform lg:static lg:z-0 lg:translate-x-0 ${
          ouvert ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 pb-2 lg:hidden">
          <span className="text-lg font-black text-gesta-700">Gesta+</span>
          <button onClick={onFermer} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Fermer">
            <Icone nom="croix" />
          </button>
        </div>

        <ul className="space-y-0.5 px-2 pb-6">
          {entrees.map((e) => (
            <li key={e.chemin}>
              <NavLink
                to={e.chemin}
                end={e.chemin === '/'}
                onClick={onFermer}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-gesta-50 text-gesta-700 ring-1 ring-gesta-200'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                <Icone nom={e.icone} className="h-5 w-5 shrink-0" />
                {e.libelle}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

export default function App() {
  const { employe, chargement, peut } = useSession();
  const [menuOuvert, setMenuOuvert] = useState(false);
  const location = useLocation();

  if (chargement) return <Chargement message="Ouverture de Gesta+…" />;
  if (!employe) return <Connexion />;

  // Un serveur n'a pas accès au tableau de bord : sa page d'accueil est la caisse.
  const accueil = peut('gerant') ? <TableauBord /> : <Navigate to="/caisse" replace />;

  return (
    <div className="flex min-h-screen flex-col">
      <Barre onBasculer={() => setMenuOuvert((v) => !v)} />
      <div className="flex flex-1">
        <Navigation ouvert={menuOuvert} onFermer={() => setMenuOuvert(false)} />
        <main className="min-w-0 flex-1">
          <Suspense fallback={<Chargement />}>
            <Routes key={location.pathname}>
              <Route path="/" element={accueil} />
              <Route path="/caisse" element={<Caisse />} />
              <Route path="/recus" element={<Recus />} />
              <Route path="/articles" element={<Articles />} />
              <Route path="/stocks" element={<Stocks />} />
              <Route path="/depenses" element={<Depenses />} />
              <Route path="/commercial" element={<Commercial />} />
              <Route path="/employes" element={<Employes />} />
              <Route path="/parametrage" element={<Parametrage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
