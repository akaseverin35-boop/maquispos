let devise = 'Fcfa';

export function definirDevise(d: string) {
  devise = d;
}

/** 13000 → « 13 000 Fcfa ». L'espace insécable évite les coupures de ligne. */
export function montant(valeur: number, avecDevise = true) {
  const n = Math.round(valeur || 0);
  const texte = n.toLocaleString('fr-FR').replace(/ /g, ' ');
  return avecDevise ? `${texte} ${devise}` : texte;
}

/** Les quantités entières s'affichent sans décimale : 2 et non 2,00. */
export function quantite(valeur: number) {
  return Number.isInteger(valeur) ? String(valeur) : valeur.toFixed(3).replace(/0+$/, '').replace('.', ',');
}

export function dateHeure(iso: string) {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function dateCourte(iso: string) {
  const d = new Date(iso.includes('T') ? iso : `${iso}T00:00:00`);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export const aujourdhui = () => new Date().toISOString().slice(0, 10);

export function ilYAJours(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export const LIBELLES_PAIEMENT: Record<string, string> = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  carte: 'Carte',
  credit: 'Crédit',
};

export const LIBELLES_ROLE: Record<string, string> = {
  admin: 'Administrateur',
  gerant: 'Gérant',
  caissier: 'Caissier',
  serveur: 'Serveur',
};
