"""Préparation de la paie à partir des temps calculés.

Les taux par défaut suivent le Code du travail ivoirien (40 h/semaine, heures sup. à
+15 % puis +50 %, nuit +75 %, dimanche/férié +75 % et +100 % la nuit). Les cotisations
sociales et l'impôt sur salaire sont entièrement paramétrables dans gta.toml : faites
valider vos taux par votre comptable ou la CNPS avant la première paie réelle.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from gta.attendance import Day
from gta.config import Config


@dataclass
class Ligne:
    libelle: str
    base: float | None = None   # heures, jours ou montant de base
    taux: float | None = None
    montant: float = 0.0


@dataclass
class Bulletin:
    matricule: str
    nom: str
    periode_du: date
    periode_au: date
    type_salaire: str
    taux_horaire: float
    jours_presents: int = 0
    jours_absence_injustifiee: int = 0
    jours_absence_payee: int = 0
    heures_travaillees: float = 0.0
    heures_normales: float = 0.0
    heures_sup: float = 0.0
    retard_min: int = 0
    anomalies: int = 0
    gains: list[Ligne] = field(default_factory=list)
    retenues: list[Ligne] = field(default_factory=list)
    brut: float = 0.0
    imposable: float = 0.0
    total_retenues: float = 0.0
    net: float = 0.0


def _r(x: float, nd: int) -> float:
    return round(x + 0.0, nd)


def progressive_tax(amount: float, tranches: list[tuple[float, float]]) -> float:
    """Impôt par tranches : [(0, 0), (75000, 0.16), …] = 0 % jusqu'à 75 000, 16 % au-delà…"""
    tax = 0.0
    ordered = sorted(tranches)
    for i, (low, rate) in enumerate(ordered):
        high = ordered[i + 1][0] if i + 1 < len(ordered) else float("inf")
        if amount > low:
            tax += (min(amount, high) - low) * rate
    return tax


def compute_payslip(emp, days: list[Day], cfg: Config, start: date, end: date) -> Bulletin:
    nd = cfg.arrondi
    kind = emp["type_salaire"]
    base = float(emp["salaire_base"] or 0)
    if kind == "mensuel":
        rate = base / cfg.heures_mois if cfg.heures_mois else 0.0
    elif kind == "journalier":
        rate = base / (cfg.heures_semaine / 5 if cfg.heures_semaine else 8)
    else:
        rate = base

    b = Bulletin(matricule=emp["matricule"], nom=emp["nom"], periode_du=start, periode_au=end,
                 type_salaire=kind, taux_horaire=_r(rate, 2))

    normal = sum(d.normal_min for d in days)
    night_normal = sum(d.nuit_normal_min for d in days)
    hs_by_rate: dict[float, int] = {}
    for d in days:
        for r, m in d.hs_min.items():
            hs_by_rate[r] = hs_by_rate.get(r, 0) + m
    hs_night = sum(d.hs_nuit_min for d in days)
    df_day = sum(d.dim_ferie_min for d in days)
    df_night = sum(d.dim_ferie_nuit_min for d in days)

    b.jours_presents = sum(1 for d in days if d.present)
    unjust = [d for d in days if d.absence == "injustifiee"]
    paid_abs = [d for d in days if d.absence and d.absence != "injustifiee"]
    b.jours_absence_injustifiee = len(unjust)
    b.jours_absence_payee = len(paid_abs)
    b.heures_travaillees = _r(sum(d.travaille_min for d in days) / 60, 2)
    b.heures_normales = _r(normal / 60, 2)
    b.heures_sup = _r((sum(hs_by_rate.values()) + hs_night) / 60, 2)
    b.retard_min = sum(d.retard_min for d in days)
    b.anomalies = sum(1 for d in days if d.anomalies)

    gains = b.gains
    # --- salaire de base
    if kind == "mensuel":
        planned_all = sum(d.prevu_min for d in days)
        outside = sum(d.prevu_min for d in days if d.type_jour == "hors_contrat")
        prorata = (planned_all - outside) / planned_all if planned_all and outside else 1.0
        gains.append(Ligne("Salaire de base", base=round(prorata * 100, 2) if prorata < 1 else None,
                           montant=_r(base * prorata, nd)))
        if cfg.deduire_absences and unjust:
            h = sum(d.prevu_min for d in unjust) / 60
            gains.append(Ligne("Retenue absences injustifiées", base=_r(h, 2), taux=_r(rate, 2),
                               montant=-_r(h * rate, nd)))
    elif kind == "journalier":
        daily = base
        worked_days = b.jours_presents + b.jours_absence_payee
        gains.append(Ligne("Salaire journalier", base=worked_days, taux=daily, montant=_r(worked_days * daily, nd)))
    else:
        paid_h = normal / 60 + sum(d.prevu_min for d in paid_abs) / 60
        gains.append(Ligne("Heures normales", base=_r(paid_h, 2), taux=_r(rate, 2), montant=_r(paid_h * rate, nd)))

    if cfg.deduire_retards and b.retard_min:
        h = b.retard_min / 60
        gains.append(Ligne("Retenue retards", base=_r(h, 2), taux=_r(rate, 2), montant=-_r(h * rate, nd)))

    # --- majorations
    for r in sorted(hs_by_rate):
        h = hs_by_rate[r] / 60
        gains.append(Ligne(f"Heures sup. +{r * 100:g} %", base=_r(h, 2), taux=_r(rate * (1 + r), 2),
                           montant=_r(h * rate * (1 + r), nd)))
    if hs_night:
        h = hs_night / 60
        gains.append(Ligne(f"Heures sup. de nuit +{cfg.taux_hs_nuit * 100:g} %", base=_r(h, 2),
                           taux=_r(rate * (1 + cfg.taux_hs_nuit), 2),
                           montant=_r(h * rate * (1 + cfg.taux_hs_nuit), nd)))
    if df_day:
        h = df_day / 60
        gains.append(Ligne(f"Heures dimanche/férié +{cfg.taux_dimanche_ferie * 100:g} %", base=_r(h, 2),
                           taux=_r(rate * (1 + cfg.taux_dimanche_ferie), 2),
                           montant=_r(h * rate * (1 + cfg.taux_dimanche_ferie), nd)))
    if df_night:
        h = df_night / 60
        gains.append(Ligne(f"Heures dimanche/férié nuit +{cfg.taux_dimanche_ferie_nuit * 100:g} %", base=_r(h, 2),
                           taux=_r(rate * (1 + cfg.taux_dimanche_ferie_nuit), 2),
                           montant=_r(h * rate * (1 + cfg.taux_dimanche_ferie_nuit), nd)))
    if night_normal and cfg.prime_nuit_heures_normales:
        h = night_normal / 60
        gains.append(Ligne(f"Prime de nuit +{cfg.prime_nuit_heures_normales * 100:g} %", base=_r(h, 2),
                           taux=_r(rate * cfg.prime_nuit_heures_normales, 2),
                           montant=_r(h * rate * cfg.prime_nuit_heures_normales, nd)))
    primes = float(emp["autres_primes"] or 0)
    if primes:
        gains.append(Ligne("Primes et indemnités", montant=_r(primes, nd)))

    imposable = sum(g.montant for g in gains)
    transport = float(emp["prime_transport"] or 0)
    if transport:
        gains.append(Ligne("Indemnité de transport", montant=_r(transport, nd)))
    if not cfg.transport_non_imposable:
        imposable += transport
    b.brut = _r(sum(g.montant for g in gains), nd)
    b.imposable = _r(max(imposable, 0), nd)

    # --- retenues
    for ret in cfg.retenues:
        assiette = b.brut if ret.base == "brut" else b.imposable
        if ret.plafond:
            assiette = min(assiette, ret.plafond)
        b.retenues.append(Ligne(ret.nom, base=_r(assiette, nd), taux=ret.taux, montant=_r(assiette * ret.taux, nd)))
    if cfg.bareme and cfg.bareme.tranches:
        b.retenues.append(Ligne(cfg.bareme.nom, base=b.imposable,
                                montant=_r(progressive_tax(b.imposable, cfg.bareme.tranches), nd)))
    b.total_retenues = _r(sum(r.montant for r in b.retenues), nd)
    b.net = _r(b.brut - b.total_retenues, nd)
    return b


def compute_payroll(db, cfg: Config, start: date, end: date) -> list[Bulletin]:
    from gta.attendance import compute_period

    period = compute_period(db, cfg, start, end)
    return [compute_payslip(db.employee(m), days, cfg, start, end) for m, days in period.items()]
