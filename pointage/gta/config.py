"""Paramètres de l'entreprise et règles de calcul (fichier gta.toml)."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Tranche:
    """Tranche d'heures supplémentaires : `heures` premières heures sup. de la semaine au `taux`."""
    taux: float
    heures: float | None = None  # None = toutes les heures restantes


@dataclass
class Retenue:
    nom: str
    taux: float
    base: str = "imposable"   # imposable | brut
    plafond: float | None = None


@dataclass
class Bareme:
    """Barème progressif mensuel (impôt sur salaire) : liste de (seuil bas, taux)."""
    nom: str = "Impôt sur salaire"
    tranches: list[tuple[float, float]] = field(default_factory=list)


@dataclass
class Config:
    entreprise: str = "Mon entreprise"
    devise: str = "FCFA"
    base_de_donnees: str = "gta.db"
    arrondi: int = 0

    # Temps de travail
    heures_semaine: float = 40.0
    heures_mois: float = 173.33
    jours_mois: float = 26.0
    doublon_minutes: int = 2          # deux pointages à moins de N min = un seul
    decalage_journee_h: float = 4.0   # une journée commence N h avant l'heure d'embauche
    utiliser_etat_pointeuse: bool = False  # se fier à la touche Entrée/Sortie pressée

    # Majorations (part ajoutée au taux horaire : 0.15 = +15 %)
    tranches_hs: list[Tranche] = field(default_factory=lambda: [Tranche(0.15, 6), Tranche(0.50, None)])
    nuit_debut: str = "21:00"
    nuit_fin: str = "05:00"
    taux_hs_nuit: float = 0.75
    taux_dimanche_ferie: float = 0.75
    taux_dimanche_ferie_nuit: float = 1.00
    jour_repos: int = 7               # jour ISO du repos hebdomadaire (7 = dimanche)
    prime_nuit_heures_normales: float = 0.0

    deduire_retards: bool = False
    deduire_absences: bool = True
    transport_non_imposable: bool = True

    retenues: list[Retenue] = field(default_factory=list)
    bareme: Bareme | None = None


def load_config(path: str | Path | None) -> Config:
    cfg = Config()
    if not path or not Path(path).exists():
        return cfg
    data = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    simple = {k: v for k, v in data.items() if not isinstance(v, (dict, list))}
    for k, v in simple.items():
        if hasattr(cfg, k):
            setattr(cfg, k, v)
    for section in ("temps", "majorations", "paie"):
        for k, v in data.get(section, {}).items():
            if hasattr(cfg, k) and not isinstance(v, (dict, list)):
                setattr(cfg, k, v)
    if "tranches_hs" in data.get("majorations", {}):
        cfg.tranches_hs = [Tranche(t["taux"], t.get("heures")) for t in data["majorations"]["tranches_hs"]]
    if "retenues" in data:
        cfg.retenues = [Retenue(r["nom"], r["taux"], r.get("base", "imposable"), r.get("plafond"))
                        for r in data["retenues"]]
    if "bareme" in data and data["bareme"].get("actif", True):
        b = data["bareme"]
        cfg.bareme = Bareme(b.get("nom", "Impôt sur salaire"), [tuple(t) for t in b.get("tranches", [])])
    base = Path(path).parent
    if not Path(cfg.base_de_donnees).is_absolute():
        cfg.base_de_donnees = str(base / cfg.base_de_donnees)
    return cfg
