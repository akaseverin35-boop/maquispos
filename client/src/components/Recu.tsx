import { montant, quantite, dateHeure, LIBELLES_PAIEMENT } from '../lib/format';
import type { Parametres, Vente } from '../lib/types';

/** Reçu au format ticket, imprimable tel quel sur une imprimante 80 mm. */
export default function Recu({ vente, parametres }: { vente: Vente; parametres: Parametres }) {
  return (
    <div className="zone-impression mx-auto max-w-sm bg-white p-4 font-mono text-[13px] leading-snug text-slate-900">
      <div className="text-center">
        <div className="text-base font-bold uppercase">{parametres.nom_entreprise}</div>
        {parametres.adresse && <div>{parametres.adresse}</div>}
        {parametres.telephone && <div>{parametres.telephone}</div>}
      </div>

      <div className="my-2 border-t border-dashed border-slate-400" />

      <div className="flex justify-between">
        <span>Reçu</span>
        <span className="font-bold">{vente.reference}</span>
      </div>
      <div className="flex justify-between">
        <span>Date</span>
        <span>{dateHeure(vente.cree_le)}</span>
      </div>
      <div className="flex justify-between">
        <span>Vendeur</span>
        <span>{vente.employe_nom}</span>
      </div>
      {vente.client_nom && (
        <div className="flex justify-between">
          <span>Client</span>
          <span>{vente.client_nom}</span>
        </div>
      )}
      {vente.table_nom && (
        <div className="flex justify-between">
          <span>Table</span>
          <span>{vente.table_nom}</span>
        </div>
      )}

      <div className="my-2 border-t border-dashed border-slate-400" />

      <table className="w-full">
        <tbody>
          {vente.lignes.map((l) => (
            <tr key={l.id} className="align-top">
              <td className="pb-1">
                {l.libelle}
                <div className="text-[11px] text-slate-500">
                  {quantite(l.quantite)} × {montant(l.prix_unitaire, false)}
                </div>
              </td>
              <td className="pb-1 text-right whitespace-nowrap">{montant(l.total, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="my-2 border-t border-dashed border-slate-400" />

      <div className="flex justify-between">
        <span>Sous-total</span>
        <span>{montant(vente.sous_total)}</span>
      </div>
      {vente.remise_montant > 0 && (
        <div className="flex justify-between">
          <span>
            Remise
            {vente.remise_type === 'pourcentage' && ` (${vente.remise_valeur}%)`}
          </span>
          <span>− {montant(vente.remise_montant)}</span>
        </div>
      )}
      {vente.taxe > 0 && (
        <div className="flex justify-between">
          <span>TVA</span>
          <span>{montant(vente.taxe)}</span>
        </div>
      )}

      <div className="mt-1 flex justify-between border-t border-slate-400 pt-1 text-base font-bold">
        <span>TOTAL</span>
        <span>{montant(vente.total)}</span>
      </div>

      <div className="mt-2 flex justify-between">
        <span>{LIBELLES_PAIEMENT[vente.mode_paiement]}</span>
        <span>{montant(vente.montant_recu)}</span>
      </div>
      {vente.monnaie > 0 && (
        <div className="flex justify-between font-bold">
          <span>Monnaie</span>
          <span>{montant(vente.monnaie)}</span>
        </div>
      )}

      {vente.statut === 'annulee' && (
        <div className="mt-3 border-2 border-red-600 py-1 text-center font-bold text-red-600">
          VENTE ANNULÉE
        </div>
      )}

      <div className="my-2 border-t border-dashed border-slate-400" />
      <div className="text-center text-[12px]">{parametres.pied_recu}</div>
    </div>
  );
}
