"""Moteur de calcul des temps : des pointages bruts aux heures payables.

Étapes pour chaque employé :
  1. rattachement de chaque pointage à sa journée de travail (gère les postes de nuit
     qui finissent le lendemain) ;
  2. suppression des doublons (employé qui repasse son doigt deux fois) ;
  3. appariement entrée/sortie ;
  4. retards, départs anticipés, absences, anomalies ;
  5. ventilation hebdomadaire : heures normales, heures sup. par tranche, heures de nuit,
     heures de dimanche / jour férié.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from gta.config import Config

ABSENCE_LABELS = {"injustifiee": "Absent (injustifié)", "conge": "Congé", "maladie": "Maladie",
                  "permission": "Permission", "mission": "Mission"}
IN_STATES = {0, 3, 4}
OUT_STATES = {1, 2, 5}


@dataclass
class Schedule:
    debut: time
    fin: time
    pause_min: int = 60
    jours: frozenset[int] = frozenset({1, 2, 3, 4, 5})
    tolerance_min: int = 10
    debut_samedi: time | None = None
    fin_samedi: time | None = None

    @classmethod
    def from_row(cls, row) -> "Schedule":
        def t(v):
            return time.fromisoformat(v) if v else None
        return cls(
            debut=t(row["debut"]), fin=t(row["fin"]), pause_min=int(row["pause_min"]),
            jours=frozenset(int(x) for x in str(row["jours"]).split(",") if x.strip()),
            tolerance_min=int(row["tolerance_min"]),
            debut_samedi=t(row["debut_samedi"]), fin_samedi=t(row["fin_samedi"]),
        )

    def window(self, d: date) -> tuple[datetime, datetime]:
        """Heures prévues d'embauche et de débauche pour une date donnée."""
        start, end = self.debut, self.fin
        if d.isoweekday() == 6 and self.debut_samedi and self.fin_samedi:
            start, end = self.debut_samedi, self.fin_samedi
        s = datetime.combine(d, start)
        e = datetime.combine(d, end)
        if e <= s:
            e += timedelta(days=1)  # poste de nuit
        return s, e

    def break_window(self, d: date) -> tuple[datetime, datetime] | None:
        """Pause non pointée, placée au milieu du poste (12h-13h pour un 8h-17h)."""
        s, e = self.window(d)
        if self.pause_min <= 0 or (e - s) <= timedelta(hours=6):
            return None
        mid = s + (e - s) / 2
        half = timedelta(minutes=self.pause_min) / 2
        return mid - half, mid + half

    def planned_minutes(self, d: date) -> int:
        s, e = self.window(d)
        total = (e - s).total_seconds() / 60
        bw = self.break_window(d)
        if bw:
            total -= self.pause_min
        return int(total)


@dataclass
class Day:
    matricule: str
    date: date
    type_jour: str                    # travail | repos | ferie | hors_contrat
    prevu_min: int = 0
    pointages: list[datetime] = field(default_factory=list)
    intervalles: list[tuple[datetime, datetime]] = field(default_factory=list)
    travaille_min: int = 0
    retard_min: int = 0
    depart_anticipe_min: int = 0
    absence: str | None = None        # conge, maladie, … ou injustifiee
    anomalies: list[str] = field(default_factory=list)
    ferie: str | None = None
    # ventilation
    normal_min: int = 0
    nuit_normal_min: int = 0
    hs_min: dict[float, int] = field(default_factory=dict)  # taux → minutes
    hs_nuit_min: int = 0
    dim_ferie_min: int = 0
    dim_ferie_nuit_min: int = 0

    @property
    def present(self) -> bool:
        return bool(self.intervalles)

    @property
    def hs_total_min(self) -> int:
        return sum(self.hs_min.values()) + self.hs_nuit_min

    @property
    def statut(self) -> str:
        if self.absence:
            return ABSENCE_LABELS.get(self.absence, self.absence)
        if self.present:
            return "Présent" + (" — anomalie" if self.anomalies else "")
        if self.anomalies:
            return "Anomalie"
        return {"repos": "Repos", "ferie": "Férié", "hors_contrat": "Hors contrat"}.get(self.type_jour, "")


def _parse_hhmm(v: str) -> time:
    return time.fromisoformat(v)


def _in_night(t: datetime, start: time, end: time) -> bool:
    cur = t.time()
    if start <= end:
        return start <= cur < end
    return cur >= start or cur < end


def assign_day(t: datetime, sched: Schedule, cfg: Config) -> date:
    offset = timedelta(hours=sched.debut.hour, minutes=sched.debut.minute) - timedelta(hours=cfg.decalage_journee_h)
    return (t - offset).date()


def dedupe(punches: list[tuple[datetime, int]], minutes: int) -> list[tuple[datetime, int]]:
    out: list[tuple[datetime, int]] = []
    for t, s in sorted(punches):
        if out and (t - out[-1][0]) < timedelta(minutes=minutes):
            continue
        out.append((t, s))
    return out


def pair(punches: list[tuple[datetime, int]], use_state: bool) -> tuple[list[tuple[datetime, datetime]], list[str]]:
    """Apparie entrées et sorties. Retourne (intervalles, anomalies)."""
    intervals: list[tuple[datetime, datetime]] = []
    anomalies: list[str] = []
    if not use_state:
        for i in range(0, len(punches) - 1, 2):
            intervals.append((punches[i][0], punches[i + 1][0]))
        if len(punches) % 2:
            label = "sortie" if len(punches) == 1 else "entrée ou sortie"
            anomalies.append(f"Pointage de {label} manquant ({punches[-1][0]:%H:%M} non apparié)")
        return intervals, anomalies
    current: datetime | None = None
    for t, s in punches:
        if s in OUT_STATES:
            if current is None:
                anomalies.append(f"Sortie sans entrée à {t:%H:%M}")
            else:
                intervals.append((current, t))
                current = None
        else:
            if current is not None:
                anomalies.append(f"Entrée sans sortie à {current:%H:%M}")
            current = t
    if current is not None:
        anomalies.append(f"Pointage de sortie manquant (entrée {current:%H:%M})")
    return intervals, anomalies


def _subtract(interval: tuple[datetime, datetime], hole: tuple[datetime, datetime]) -> list[tuple[datetime, datetime]]:
    s, e = interval
    hs, he = hole
    if he <= s or hs >= e:
        return [interval]
    parts = []
    if s < hs:
        parts.append((s, hs))
    if he < e:
        parts.append((he, e))
    return parts


def compute_days(
    matricule: str,
    punches: list[tuple[datetime, int]],
    sched: Schedule,
    start: date,
    end: date,
    holidays: dict[date, str],
    absences: dict[date, str],
    cfg: Config,
    embauche: date | None = None,
) -> list[Day]:
    """Calcule chaque journée du `start` au `end` inclus.

    Les pointages doivent couvrir les semaines entières (du lundi au dimanche) qui
    contiennent la période, pour que les heures supplémentaires hebdomadaires soient justes.
    """
    week_start = start - timedelta(days=start.isoweekday() - 1)
    week_end = end + timedelta(days=7 - end.isoweekday())

    by_day: dict[date, list[tuple[datetime, int]]] = defaultdict(list)
    for t, s in punches:
        by_day[assign_day(t, sched, cfg)].append((t, s))

    days: list[Day] = []
    d = week_start
    while d <= week_end:
        if embauche and d < embauche:
            kind = "hors_contrat"
        elif d in holidays:
            kind = "ferie"
        elif d.isoweekday() in sched.jours:
            kind = "travail"
        else:
            kind = "repos"
        day = Day(matricule=matricule, date=d, type_jour=kind, ferie=holidays.get(d))
        if kind == "travail" or (kind == "hors_contrat" and d.isoweekday() in sched.jours and d not in holidays):
            day.prevu_min = sched.planned_minutes(d)  # sert aussi au prorata d'une embauche en cours de mois
        clean = dedupe(by_day.get(d, []), cfg.doublon_minutes)
        day.pointages = [t for t, _ in clean]
        intervals, day.anomalies = pair(clean, cfg.utiliser_etat_pointeuse)

        bw = sched.break_window(d)
        if len(intervals) == 1 and bw:
            intervals = _subtract(intervals[0], bw)  # pause déjeuner non pointée
        day.intervalles = intervals
        day.travaille_min = int(sum((e - s).total_seconds() for s, e in intervals) // 60)

        if kind == "travail":
            s_prev, e_prev = sched.window(d)
            if day.pointages:
                first = day.pointages[0]
                late = int((first - s_prev).total_seconds() // 60)
                if late > sched.tolerance_min:
                    day.retard_min = late
                if len(day.pointages) >= 2:
                    early = int((e_prev - day.pointages[-1]).total_seconds() // 60)
                    if early > sched.tolerance_min:
                        day.depart_anticipe_min = early
            elif d in absences:
                day.absence = absences[d]
            else:
                day.absence = "injustifiee"
        elif d in absences and not day.pointages:
            pass  # congé posé un jour non travaillé : sans effet
        days.append(day)
        d += timedelta(days=1)

    _split_hours(days, cfg)
    return [x for x in days if start <= x.date <= end]


def _split_hours(days: list[Day], cfg: Config) -> None:
    """Ventile chaque minute travaillée, semaine par semaine, dans l'ordre chronologique."""
    night_s, night_e = _parse_hhmm(cfg.nuit_debut), _parse_hhmm(cfg.nuit_fin)
    legal = int(cfg.heures_semaine * 60)
    tiers: list[tuple[int | None, float]] = []
    for tr in cfg.tranches_hs:
        tiers.append((None if tr.heures is None else int(tr.heures * 60), tr.taux))

    weeks: dict[tuple[int, int], list[Day]] = defaultdict(list)
    for day in days:
        weeks[day.date.isocalendar()[:2]].append(day)

    for week_days in weeks.values():
        counted = 0
        for day in sorted(week_days, key=lambda x: x.date):
            special = day.type_jour == "ferie" or day.date.isoweekday() == cfg.jour_repos
            for s, e in sorted(day.intervalles):
                t = s.replace(second=0)
                stop = e.replace(second=0)
                while t < stop:
                    night = _in_night(t, night_s, night_e)
                    if special:
                        if night:
                            day.dim_ferie_nuit_min += 1
                        else:
                            day.dim_ferie_min += 1
                    else:
                        counted += 1
                        if counted <= legal:
                            day.normal_min += 1
                            if night:
                                day.nuit_normal_min += 1
                        elif night:
                            day.hs_nuit_min += 1
                        else:
                            rank = counted - legal
                            rate = tiers[-1][1] if tiers else 0.0
                            acc = 0
                            for limit, r in tiers:
                                if limit is None or rank <= acc + limit:
                                    rate = r
                                    break
                                acc += limit
                            day.hs_min[rate] = day.hs_min.get(rate, 0) + 1
                    t += timedelta(minutes=1)


def absences_by_day(rows, start: date, end: date) -> dict[str, dict[date, str]]:
    out: dict[str, dict[date, str]] = defaultdict(dict)
    for r in rows:
        d = max(date.fromisoformat(r["du"]), start)
        last = min(date.fromisoformat(r["au"]), end)
        while d <= last:
            out[r["matricule"]][d] = r["type"]
            d += timedelta(days=1)
    return out


def compute_period(db, cfg: Config, start: date, end: date, matricule: str | None = None) -> dict[str, list[Day]]:
    """Calcule les journées de tous les employés actifs (ou d'un seul) sur la période."""
    week_start = start - timedelta(days=start.isoweekday() - 1)
    week_end = end + timedelta(days=7 - end.isoweekday())
    # marge d'un jour de part et d'autre pour les postes de nuit
    rows = db.punches(datetime.combine(week_start - timedelta(days=1), time()),
                      datetime.combine(week_end + timedelta(days=2), time()), matricule)
    punches: dict[str, list[tuple[datetime, int]]] = defaultdict(list)
    for r in rows:
        punches[r["matricule"]].append((datetime.fromisoformat(r["horodatage"]), r["etat"]))
    holidays = db.holidays(week_start, week_end)
    absences = absences_by_day(db.absences(week_start, week_end), week_start, week_end)
    employees = [db.employee(matricule)] if matricule else db.employees()
    result: dict[str, list[Day]] = {}
    for emp in employees:
        if emp is None:
            continue
        sched = Schedule.from_row(db.schedule(emp["horaire_id"]))
        result[emp["matricule"]] = compute_days(
            emp["matricule"], punches.get(emp["matricule"], []), sched, start, end,
            holidays, absences.get(emp["matricule"], {}), cfg,
            date.fromisoformat(emp["date_embauche"]) if emp["date_embauche"] else None)
    return result
