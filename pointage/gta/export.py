"""Exports : classeur Excel (paie, journées, bulletins) ou CSV si openpyxl est absent."""

from __future__ import annotations

import csv
from pathlib import Path

from gta.attendance import Day
from gta.config import Config
from gta.payroll import Bulletin


def fmt_h(minutes: int) -> str:
    sign = "-" if minutes < 0 else ""
    minutes = abs(int(minutes))
    return f"{sign}{minutes // 60}h{minutes % 60:02d}"


DAY_HEADERS = ["Matricule", "Nom", "Date", "Jour", "Statut", "Pointages", "Prévu", "Travaillé",
               "Retard (min)", "Départ anticipé (min)", "Heures sup.", "Dim./férié", "Anomalies"]
JOURS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."]


def day_row(day: Day, nom: str) -> list:
    return [
        day.matricule, nom, day.date.isoformat(), JOURS[day.date.weekday()],
        day.statut + (f" ({day.ferie})" if day.ferie else ""),
        " ".join(t.strftime("%H:%M") for t in day.pointages),
        fmt_h(day.prevu_min) if day.type_jour == "travail" else "",
        fmt_h(day.travaille_min) if day.travaille_min else "",
        day.retard_min or "", day.depart_anticipe_min or "",
        fmt_h(day.hs_total_min) if day.hs_total_min else "",
        fmt_h(day.dim_ferie_min + day.dim_ferie_nuit_min) if day.dim_ferie_min + day.dim_ferie_nuit_min else "",
        " ; ".join(day.anomalies),
    ]


PAY_HEADERS = ["Matricule", "Nom", "Type", "Taux horaire", "Jours présents", "Absences injustifiées",
               "Absences payées", "Heures travaillées", "Heures sup.", "Retards (min)", "Anomalies",
               "Brut", "Imposable", "Retenues", "Net à payer"]


def pay_row(b: Bulletin) -> list:
    return [b.matricule, b.nom, b.type_salaire, b.taux_horaire, b.jours_presents,
            b.jours_absence_injustifiee, b.jours_absence_payee, b.heures_travaillees, b.heures_sup,
            b.retard_min, b.anomalies, b.brut, b.imposable, b.total_retenues, b.net]


def export(path: str | Path, cfg: Config, bulletins: list[Bulletin], days: dict[str, list[Day]],
           names: dict[str, str]) -> Path:
    path = Path(path)
    try:
        import openpyxl  # noqa: F401
    except ImportError:
        return _export_csv(path, bulletins, days, names)
    return _export_xlsx(path, cfg, bulletins, days, names)


def _export_csv(path: Path, bulletins, days, names) -> Path:
    base = path.with_suffix("")
    with open(f"{base}_paie.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(PAY_HEADERS)
        w.writerows(pay_row(b) for b in bulletins)
    with open(f"{base}_journees.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(DAY_HEADERS)
        for m, ds in days.items():
            w.writerows(day_row(d, names.get(m, "")) for d in ds)
    return Path(f"{base}_paie.csv")


def _export_xlsx(path: Path, cfg: Config, bulletins, days, names) -> Path:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    head_font = Font(bold=True, color="FFFFFF")
    head_fill = PatternFill("solid", fgColor="1F4E78")
    warn_fill = PatternFill("solid", fgColor="FCE4D6")
    thin = Side(style="thin", color="BFBFBF")
    money = f'#,##0{"." + "0" * cfg.arrondi if cfg.arrondi else ""} "{cfg.devise}"'

    def table(ws, headers, rows, money_cols=()):
        ws.append(headers)
        for c in ws[ws.max_row]:
            c.font, c.fill = head_font, head_fill
            c.alignment = Alignment(wrap_text=True, vertical="center")
        for r in rows:
            ws.append(r)
            for col in money_cols:
                ws.cell(ws.max_row, col).number_format = money
        for i, h in enumerate(headers, 1):
            width = max([len(str(h))] + [len(str(ws.cell(r, i).value or "")) for r in range(2, ws.max_row + 1)])
            ws.column_dimensions[get_column_letter(i)].width = min(max(width + 2, 8), 60)
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions

    wb = Workbook()
    ws = wb.active
    ws.title = "Paie"
    table(ws, PAY_HEADERS, [pay_row(b) for b in bulletins], money_cols=(12, 13, 14, 15))
    ws.append([])
    ws.append(["", "TOTAL"] + [""] * 9 + [sum(b.brut for b in bulletins), sum(b.imposable for b in bulletins),
                                          sum(b.total_retenues for b in bulletins), sum(b.net for b in bulletins)])
    for col in (12, 13, 14, 15):
        ws.cell(ws.max_row, col).number_format = money
        ws.cell(ws.max_row, col).font = Font(bold=True)

    ws = wb.create_sheet("Journées")
    rows = [day_row(d, names.get(m, "")) for m, ds in days.items() for d in ds]
    table(ws, DAY_HEADERS, rows)
    for r in range(2, ws.max_row + 1):
        if ws.cell(r, 13).value or str(ws.cell(r, 5).value or "").startswith("Absent"):
            for c in ws[r]:
                c.fill = warn_fill

    for b in bulletins:
        ws = wb.create_sheet(f"{b.matricule} {b.nom}"[:31].replace("/", "-"))
        ws.column_dimensions["A"].width = 42
        for col in "BCD":
            ws.column_dimensions[col].width = 16
        ws.append([cfg.entreprise])
        ws["A1"].font = Font(bold=True, size=14)
        ws.append([f"BULLETIN DE PAIE — du {b.periode_du:%d/%m/%Y} au {b.periode_au:%d/%m/%Y}"])
        ws["A2"].font = Font(bold=True)
        ws.append([])
        ws.append(["Matricule", b.matricule])
        ws.append(["Nom", b.nom])
        ws.append(["Jours de présence", b.jours_presents])
        ws.append(["Heures travaillées", b.heures_travaillees])
        ws.append(["Absences injustifiées (jours)", b.jours_absence_injustifiee])
        ws.append([])
        ws.append(["Rubrique", "Base", "Taux", "Montant"])
        for c in ws[ws.max_row]:
            c.font, c.fill = head_font, head_fill
        for g in b.gains:
            ws.append([g.libelle, g.base, g.taux, g.montant])
            ws.cell(ws.max_row, 4).number_format = money
        ws.append(["SALAIRE BRUT", None, None, b.brut])
        ws.cell(ws.max_row, 1).font = ws.cell(ws.max_row, 4).font = Font(bold=True)
        ws.cell(ws.max_row, 4).number_format = money
        for r in b.retenues:
            ws.append([r.libelle, r.base, r.taux, -r.montant])
            ws.cell(ws.max_row, 2).number_format = money
            ws.cell(ws.max_row, 3).number_format = "0.00%"
            ws.cell(ws.max_row, 4).number_format = money
        ws.append(["NET À PAYER", None, None, b.net])
        last = ws.max_row
        for c in ws[last]:
            c.font = Font(bold=True, size=12)
            c.border = Border(top=thin, bottom=thin)
        ws.cell(last, 4).number_format = money

    wb.save(path)
    return path
