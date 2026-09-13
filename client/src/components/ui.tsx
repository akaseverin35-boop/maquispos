import { useEffect, type ReactNode } from 'react';

/* --------------------------------- Icônes -------------------------------- */
/* Jeu d'icônes en trait, dessinées à la main pour éviter une dépendance. */

const trait = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function Icone({ nom, className = 'h-5 w-5' }: { nom: string; className?: string }) {
  const chemins: Record<string, ReactNode> = {
    caisse: (
      <>
        <path d="M3 9h18l-1.5 11H4.5L3 9Z" {...trait} />
        <path d="M8 9V6a4 4 0 0 1 8 0v3" {...trait} />
      </>
    ),
    tableau: (
      <>
        <rect x="3" y="3" width="7" height="9" rx="1.5" {...trait} />
        <rect x="14" y="3" width="7" height="5" rx="1.5" {...trait} />
        <rect x="14" y="12" width="7" height="9" rx="1.5" {...trait} />
        <rect x="3" y="16" width="7" height="5" rx="1.5" {...trait} />
      </>
    ),
    articles: (
      <>
        <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" {...trait} />
        <path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9" {...trait} />
      </>
    ),
    stock: (
      <>
        <path d="M4 7h16v13H4z" {...trait} />
        <path d="M4 7 6 3h12l2 4M9 12h6" {...trait} />
      </>
    ),
    depense: (
      <>
        <circle cx="12" cy="12" r="9" {...trait} />
        <path d="M8 12h8M12 8v8" {...trait} transform="rotate(45 12 12)" />
      </>
    ),
    client: (
      <>
        <circle cx="12" cy="8" r="3.5" {...trait} />
        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" {...trait} />
      </>
    ),
    recu: (
      <>
        <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" {...trait} />
        <path d="M9 8h6M9 12h6" {...trait} />
      </>
    ),
    employe: (
      <>
        <circle cx="9" cy="8" r="3" {...trait} />
        <path d="M2.5 19a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6M18 19a6.5 6.5 0 0 0-2-4.7" {...trait} />
      </>
    ),
    reglage: (
      <>
        <circle cx="12" cy="12" r="3" {...trait} />
        <path
          d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
          {...trait}
        />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" {...trait} />,
    moins: <path d="M5 12h14" {...trait} />,
    croix: <path d="M6 6l12 12M18 6 6 18" {...trait} />,
    recherche: (
      <>
        <circle cx="11" cy="11" r="6.5" {...trait} />
        <path d="m16 16 4.5 4.5" {...trait} />
      </>
    ),
    corbeille: (
      <>
        <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" {...trait} />
      </>
    ),
    crayon: <path d="M4 20h4L20 8l-4-4L4 16v4Z" {...trait} />,
    imprimer: (
      <>
        <path d="M7 9V3h10v6M7 19H4v-8h16v8h-3" {...trait} />
        <path d="M7 15h10v6H7z" {...trait} />
      </>
    ),
    alerte: (
      <>
        <path d="M12 3 2 20h20L12 3Z" {...trait} />
        <path d="M12 9v5M12 17.5v.5" {...trait} />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" {...trait} />,
    sortie: <path d="M15 4h4v16h-4M11 8l-4 4 4 4M7 12h10" {...trait} />,
    fleche: <path d="m9 6 6 6-6 6" {...trait} />,
  };

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {chemins[nom] ?? chemins.tableau}
    </svg>
  );
}

/* -------------------------------- Fenêtre -------------------------------- */

export function Fenetre({
  ouverte,
  titre,
  onFermer,
  children,
  large,
}: {
  ouverte: boolean;
  titre: string;
  onFermer: () => void;
  children: ReactNode;
  large?: boolean;
}) {
  useEffect(() => {
    if (!ouverte) return;
    const echap = (e: KeyboardEvent) => e.key === 'Escape' && onFermer();
    window.addEventListener('keydown', echap);
    return () => window.removeEventListener('keydown', echap);
  }, [ouverte, onFermer]);

  if (!ouverte) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div
        className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${
          large ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        }`}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-bold text-slate-800">{titre}</h2>
          <button onClick={onFermer} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Fermer">
            <Icone nom="croix" />
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* --------------------------- États et messages ---------------------------- */

export function Alerte({ message, type = 'erreur' }: { message: string; type?: 'erreur' | 'succes' | 'info' }) {
  const styles = {
    erreur: 'border-red-200 bg-red-50 text-red-700',
    succes: 'border-gesta-200 bg-gesta-50 text-gesta-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
  };
  return <div className={`rounded-lg border px-3 py-2 text-sm ${styles[type]}`}>{message}</div>;
}

export function Vide({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <p className="text-sm text-slate-500">{message}</p>
      {children}
    </div>
  );
}

export function Chargement({ message = 'Chargement…' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-12 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-gesta-600" />
      {message}
    </div>
  );
}

export function Etiquette({ enfant, couleur }: { enfant: string; couleur: string }) {
  return <span className={`puce ${couleur}`}>{enfant}</span>;
}
