import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ecrireJeton, effacerJeton, lireJeton } from './api';
import { definirDevise } from './format';
import type { Employe, Parametres, PointVente } from './types';

interface Session {
  employe: Employe | null;
  parametres: Parametres | null;
  pointsVente: PointVente[];
  pointVenteActif: number | null;
  chargement: boolean;
  connecter: (identifiant: string, motDePasse: string) => Promise<void>;
  deconnecter: () => void;
  choisirPointVente: (id: number) => void;
  rafraichir: () => Promise<void>;
  peut: (...roles: Employe['role'][]) => boolean;
}

const Contexte = createContext<Session | null>(null);
const CLE_PV = 'gestaplus.point_vente';

export function FournisseurSession({ children }: { children: ReactNode }) {
  const [employe, setEmploye] = useState<Employe | null>(null);
  const [parametres, setParametres] = useState<Parametres | null>(null);
  const [pointsVente, setPointsVente] = useState<PointVente[]>([]);
  const [pointVenteActif, setPointVenteActif] = useState<number | null>(null);
  const [chargement, setChargement] = useState(true);

  async function chargerContexte(e: Employe) {
    const [params, pvs] = await Promise.all([
      api.get<Parametres>('/parametres'),
      api.get<PointVente[]>('/points-vente'),
    ]);
    setParametres(params);
    definirDevise(params.devise);
    setPointsVente(pvs);

    // On reprend le point de vente mémorisé, sinon celui de l'employé, sinon le premier.
    const memorise = Number(localStorage.getItem(CLE_PV)) || null;
    const valide = pvs.some((p) => p.id === memorise) ? memorise : null;
    setPointVenteActif(valide ?? e.point_vente_id ?? pvs[0]?.id ?? null);
  }

  async function rafraichir() {
    if (!lireJeton()) {
      setChargement(false);
      return;
    }
    try {
      const { employe: e } = await api.get<{ employe: Employe }>('/auth/moi');
      setEmploye(e);
      await chargerContexte(e);
    } catch {
      effacerJeton();
      setEmploye(null);
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    void rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valeur = useMemo<Session>(
    () => ({
      employe,
      parametres,
      pointsVente,
      pointVenteActif,
      chargement,
      async connecter(identifiant, mot_de_passe) {
        const r = await api.post<{ jeton: string; employe: Employe }>('/auth/connexion', {
          identifiant,
          mot_de_passe,
        });
        ecrireJeton(r.jeton);
        setEmploye(r.employe);
        await chargerContexte(r.employe);
      },
      deconnecter() {
        effacerJeton();
        setEmploye(null);
      },
      choisirPointVente(id) {
        localStorage.setItem(CLE_PV, String(id));
        setPointVenteActif(id);
      },
      rafraichir,
      peut: (...roles) => !!employe && (employe.role === 'admin' || roles.includes(employe.role)),
    }),
    [employe, parametres, pointsVente, pointVenteActif, chargement],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useSession() {
  const c = useContext(Contexte);
  if (!c) throw new Error('useSession doit être utilisé dans FournisseurSession');
  return c;
}
