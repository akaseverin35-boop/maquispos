"""Jours fériés à date fixe ou calculable (Côte d'Ivoire par défaut).

Les fêtes musulmanes (Korité, Tabaski, Maouloud, lendemain de la Nuit du Destin)
dépendent de l'observation lunaire et sont fixées chaque année par décret :
ajoutez-les avec `python -m gta ferie ajouter AAAA-MM-JJ "Tabaski"`.
"""

from __future__ import annotations

from datetime import date, timedelta


def easter(year: int) -> date:
    """Dimanche de Pâques (algorithme grégorien anonyme)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def ivory_coast(year: int) -> dict[date, str]:
    p = easter(year)
    return {
        date(year, 1, 1): "Jour de l'An",
        p + timedelta(days=1): "Lundi de Pâques",
        date(year, 5, 1): "Fête du Travail",
        p + timedelta(days=39): "Ascension",
        p + timedelta(days=50): "Lundi de Pentecôte",
        date(year, 8, 7): "Fête de l'Indépendance",
        date(year, 8, 15): "Assomption",
        date(year, 11, 1): "Toussaint",
        date(year, 11, 15): "Journée nationale de la Paix",
        date(year, 12, 25): "Noël",
    }
