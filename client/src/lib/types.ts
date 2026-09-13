export type Role = 'admin' | 'gerant' | 'caissier' | 'serveur';
export type ModePaiement = 'especes' | 'mobile_money' | 'carte' | 'credit';
export type VenduPar = 'chaque' | 'poids_volume';

export interface Employe {
  id: number;
  nom_complet: string;
  identifiant: string;
  role: Role;
  telephone: string | null;
  point_vente_id: number | null;
  point_vente_nom: string | null;
  actif: number;
  nb_ventes?: number;
  total_ventes?: number;
}

export interface PointVente {
  id: number;
  nom: string;
  adresse: string | null;
  telephone: string | null;
  actif: number;
  nb_articles?: number;
  nb_employes?: number;
}

export interface Categorie {
  id: number;
  libelle: string;
  couleur: string;
  position: number;
  point_vente_id: number | null;
  point_vente_nom?: string | null;
  nb_articles?: number;
}

export interface Article {
  id: number;
  libelle: string;
  code: string | null;
  categorie_id: number | null;
  categorie_libelle: string | null;
  categorie_couleur: string | null;
  point_vente_id: number | null;
  point_vente_nom?: string | null;
  vendu_par: VenduPar;
  unite: string;
  prix_vente: number;
  cout: number;
  suivi_stock: number;
  stock: number;
  alerte_stock: number;
  image: string | null;
  actif: number;
  en_alerte?: number;
}

export interface NiveauStock {
  id: number;
  libelle: string;
  unite: string;
  stock: number;
  alerte_stock: number;
  cout: number;
  prix_vente: number;
  image: string | null;
  categorie_libelle: string | null;
  valeur_stock: number;
  niveau: 'ok' | 'alerte' | 'rupture';
}

export interface MouvementStock {
  id: number;
  article_id: number;
  article_libelle: string;
  unite: string;
  type: 'entree' | 'sortie' | 'ajustement' | 'vente' | 'annulation';
  quantite: number;
  stock_avant: number;
  stock_apres: number;
  cout_unitaire: number;
  motif: string | null;
  employe_nom: string | null;
  vente_reference: string | null;
  cree_le: string;
}

export interface Periode {
  id: number;
  point_vente_id: number;
  point_vente_nom?: string;
  employe_id: number;
  employe_nom: string;
  fond_caisse: number;
  montant_compte: number | null;
  statut: 'ouverte' | 'fermee';
  note: string | null;
  ouverte_le: string;
  fermee_le: string | null;
  nb_ventes: number;
  total_ventes: number;
  total_remises?: number;
  ventes_annulees?: number;
  par_mode_paiement?: { mode_paiement: ModePaiement; nb: number; total: number }[];
  total_depenses?: number;
  especes_attendues?: number;
  ecart?: number | null;
}

export interface LigneVente {
  id: number;
  article_id: number | null;
  libelle: string;
  prix_unitaire: number;
  quantite: number;
  total: number;
  note: string | null;
}

export interface Vente {
  id: number;
  reference: string;
  point_vente_id: number;
  point_vente_nom: string;
  employe_nom: string;
  client_id: number | null;
  client_nom: string | null;
  client_telephone?: string | null;
  table_nom: string | null;
  sous_total: number;
  remise_type: 'montant' | 'pourcentage';
  remise_valeur: number;
  remise_montant: number;
  taxe: number;
  total: number;
  montant_recu: number;
  monnaie: number;
  mode_paiement: ModePaiement;
  statut: 'payee' | 'annulee';
  note: string | null;
  cree_le: string;
  nb_lignes?: number;
  lignes: LigneVente[];
}

export interface Client {
  id: number;
  nom: string;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  note: string | null;
  solde: number;
  nb_achats?: number;
  total_achats?: number;
}

export interface Facture {
  id: number;
  reference: string;
  client_id: number | null;
  client_nom: string | null;
  statut: 'brouillon' | 'emise' | 'payee' | 'annulee';
  total: number;
  montant_paye: number;
  date_emission: string;
  date_echeance: string | null;
  note: string | null;
  lignes?: { id: number; libelle: string; prix_unitaire: number; quantite: number; total: number }[];
}

export interface Depense {
  id: number;
  libelle: string;
  categorie: string;
  montant: number;
  beneficiaire: string | null;
  point_vente_id: number | null;
  point_vente_nom: string | null;
  employe_nom: string | null;
  date_depense: string;
  note: string | null;
}

export interface TableService {
  id: number;
  nom: string;
  zone: string;
  places: number;
  point_vente_id: number | null;
  point_vente_nom?: string | null;
}

export interface Parametres {
  nom_entreprise: string;
  adresse: string;
  telephone: string;
  devise: string;
  taux_taxe: string;
  pied_recu: string;
}

export interface ResumeTableauBord {
  periode: { du: string; au: string };
  nb_ventes: number;
  chiffre_affaires: number;
  remises: number;
  panier_moyen: number;
  marge_brute: number;
  depenses: number;
  resultat: number;
  ventes_annulees: number;
  articles_en_alerte: number;
  creances_clients: number;
}

/** Ligne du panier en cours de saisie, avant envoi au serveur. */
export interface LignePanier {
  cle: string;
  article: Article | null;
  libelle: string;
  prix_unitaire: number;
  quantite: number;
  note?: string;
}
