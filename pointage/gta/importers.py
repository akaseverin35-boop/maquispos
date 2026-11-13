"""Import de pointages depuis un fichier : clé USB de la pointeuse (attlog.dat) ou CSV.

Utile quand la pointeuse n'est pas en réseau : Menu → Gestion clé USB → Télécharger
les pointages, puis `python -m gta importer /media/usb/1_attlog.dat`.
"""

from __future__ import annotations

import csv
import re
from datetime import datetime
from pathlib import Path

_DT_FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M",
               "%Y/%m/%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S")


def parse_datetime(text: str) -> datetime:
    text = text.strip()
    for fmt in _DT_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    raise ValueError(f"date illisible : {text!r}")


def read_attlog_dat(path: Path) -> list[tuple[str, datetime, int, int]]:
    """Format USB ZKTeco : matricule <tab> AAAA-MM-JJ HH:MM:SS <tab> n° terminal <tab> état <tab> vérification…"""
    rows = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = [p.strip() for p in line.split("\t")]
        if len(parts) < 2 or not parts[0]:
            continue
        try:
            when = parse_datetime(parts[1])
        except ValueError:
            continue
        state = int(parts[3]) if len(parts) > 3 and parts[3].isdigit() else 0
        verify = int(parts[4]) if len(parts) > 4 and parts[4].isdigit() else 0
        rows.append((parts[0], when, state, verify))
    return rows


def read_csv(path: Path) -> list[tuple[str, datetime, int, int]]:
    """CSV avec en-têtes : matricule ; date_heure (ou date + heure) ; etat facultatif."""
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    dialect = csv.Sniffer().sniff(text.splitlines()[0], delimiters=",;\t")
    rows = []
    for rec in csv.DictReader(text.splitlines(), dialect=dialect):
        rec = {re.sub(r"[^a-z_]", "", (k or "").lower().replace(" ", "_").replace("-", "_")): (v or "")
               for k, v in rec.items()}
        mat = rec.get("matricule") or rec.get("id") or rec.get("pin") or rec.get("user_id") or ""
        stamp = rec.get("date_heure") or rec.get("horodatage") or rec.get("datetime") or \
            f"{rec.get('date', '')} {rec.get('heure', '')}"
        if not mat.strip():
            continue
        etat = rec.get("etat", "")
        rows.append((mat.strip(), parse_datetime(stamp), int(etat) if etat.strip().isdigit() else 0, 0))
    return rows


def read_file(path: str | Path) -> list[tuple[str, datetime, int, int]]:
    path = Path(path)
    if path.suffix.lower() in (".csv", ".txt") and "\t" not in path.read_text(errors="replace")[:500]:
        return read_csv(path)
    return read_attlog_dat(path)
