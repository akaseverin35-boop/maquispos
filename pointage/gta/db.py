"""Base de données SQLite : pointeuses, employés, horaires, pointages, absences, jours fériés."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Iterable, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS pointeuses (
    id          INTEGER PRIMARY KEY,
    nom         TEXT NOT NULL,
    ip          TEXT NOT NULL,
    port        INTEGER NOT NULL DEFAULT 4370,
    mot_de_passe INTEGER NOT NULL DEFAULT 0,
    udp         INTEGER NOT NULL DEFAULT 0,
    numero_serie TEXT,
    emplacement TEXT,
    derniere_synchro TEXT,
    actif       INTEGER NOT NULL DEFAULT 1,
    UNIQUE(ip, port)
);

CREATE TABLE IF NOT EXISTS horaires (
    id          INTEGER PRIMARY KEY,
    nom         TEXT NOT NULL UNIQUE,
    debut       TEXT NOT NULL,             -- HH:MM
    fin         TEXT NOT NULL,             -- HH:MM (peut être le lendemain : 22:00 → 06:00)
    pause_min   INTEGER NOT NULL DEFAULT 60,
    jours       TEXT NOT NULL DEFAULT '1,2,3,4,5',  -- jours ISO travaillés (1 = lundi)
    tolerance_min INTEGER NOT NULL DEFAULT 10,
    debut_samedi TEXT,                     -- horaire réduit facultatif pour le samedi
    fin_samedi  TEXT
);

CREATE TABLE IF NOT EXISTS employes (
    id          INTEGER PRIMARY KEY,
    matricule   TEXT NOT NULL UNIQUE,      -- identique au n° saisi dans la pointeuse
    nom         TEXT NOT NULL,
    departement TEXT DEFAULT '',
    poste       TEXT DEFAULT '',
    type_salaire TEXT NOT NULL DEFAULT 'mensuel' CHECK (type_salaire IN ('mensuel','horaire','journalier')),
    salaire_base REAL NOT NULL DEFAULT 0,  -- mensuel, ou taux horaire / journalier
    prime_transport REAL NOT NULL DEFAULT 0,
    autres_primes REAL NOT NULL DEFAULT 0,
    horaire_id  INTEGER REFERENCES horaires(id),
    date_embauche TEXT,
    actif       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pointages (
    id          INTEGER PRIMARY KEY,
    matricule   TEXT NOT NULL,
    horodatage  TEXT NOT NULL,             -- AAAA-MM-JJTHH:MM:SS (heure locale de la pointeuse)
    etat        INTEGER NOT NULL DEFAULT 0,
    verification INTEGER NOT NULL DEFAULT 0,
    pointeuse_id INTEGER REFERENCES pointeuses(id),
    source      TEXT NOT NULL DEFAULT 'zk',  -- zk | adms | fichier | manuel
    commentaire TEXT DEFAULT '',
    UNIQUE(matricule, horodatage)
);
CREATE INDEX IF NOT EXISTS idx_pointages_date ON pointages(horodatage);

CREATE TABLE IF NOT EXISTS absences (
    id          INTEGER PRIMARY KEY,
    matricule   TEXT NOT NULL,
    du          TEXT NOT NULL,
    au          TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('conge','maladie','permission','mission','injustifiee')),
    commentaire TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS feries (
    date        TEXT PRIMARY KEY,
    libelle     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_synchro (
    id          INTEGER PRIMARY KEY,
    pointeuse_id INTEGER,
    moment      TEXT NOT NULL,
    lus         INTEGER NOT NULL DEFAULT 0,
    nouveaux    INTEGER NOT NULL DEFAULT 0,
    message     TEXT DEFAULT ''
);
"""

DEFAULT_SCHEDULE = ("Journée 8h-17h", "08:00", "17:00", 60, "1,2,3,4,5,6", 10, "08:00", "12:00")


class Database:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.executescript(SCHEMA)
        if not self.conn.execute("SELECT 1 FROM horaires LIMIT 1").fetchone():
            self.conn.execute(
                "INSERT INTO horaires (nom, debut, fin, pause_min, jours, tolerance_min, debut_samedi, fin_samedi)"
                " VALUES (?,?,?,?,?,?,?,?)", DEFAULT_SCHEDULE)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        try:
            yield self.conn
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def q(self, sql: str, params: Iterable = ()) -> list[sqlite3.Row]:
        return self.conn.execute(sql, tuple(params)).fetchall()

    def one(self, sql: str, params: Iterable = ()) -> sqlite3.Row | None:
        return self.conn.execute(sql, tuple(params)).fetchone()

    # -------------------------------------------------------------- pointeuses
    def add_device(self, nom: str, ip: str, port: int = 4370, mot_de_passe: int = 0,
                   udp: bool = False, emplacement: str = "") -> int:
        with self.tx() as c:
            cur = c.execute(
                "INSERT INTO pointeuses (nom, ip, port, mot_de_passe, udp, emplacement) VALUES (?,?,?,?,?,?)",
                (nom, ip, port, mot_de_passe, int(udp), emplacement))
            return int(cur.lastrowid)

    def devices(self, active_only: bool = True) -> list[sqlite3.Row]:
        sql = "SELECT * FROM pointeuses" + (" WHERE actif = 1" if active_only else "") + " ORDER BY id"
        return self.q(sql)

    def device(self, ref: str | int) -> sqlite3.Row | None:
        return self.one("SELECT * FROM pointeuses WHERE id = ? OR nom = ? OR numero_serie = ?",
                        (ref, str(ref), str(ref)))

    # -------------------------------------------------------------- employés
    def upsert_employee(self, matricule: str, nom: str, **fields) -> None:
        allowed = {"departement", "poste", "type_salaire", "salaire_base", "prime_transport",
                   "autres_primes", "horaire_id", "date_embauche", "actif"}
        extra = {k: v for k, v in fields.items() if k in allowed and v is not None}
        with self.tx() as c:
            c.execute("INSERT INTO employes (matricule, nom) VALUES (?, ?) "
                      "ON CONFLICT(matricule) DO UPDATE SET nom = excluded.nom", (matricule, nom))
            if extra:
                sets = ", ".join(f"{k} = ?" for k in extra)
                c.execute(f"UPDATE employes SET {sets} WHERE matricule = ?", (*extra.values(), matricule))

    def employees(self, active_only: bool = True) -> list[sqlite3.Row]:
        sql = "SELECT * FROM employes" + (" WHERE actif = 1" if active_only else "") + " ORDER BY matricule"
        return self.q(sql)

    def employee(self, matricule: str) -> sqlite3.Row | None:
        return self.one("SELECT * FROM employes WHERE matricule = ?", (matricule,))

    def schedule(self, horaire_id: int | None) -> sqlite3.Row:
        row = None
        if horaire_id:
            row = self.one("SELECT * FROM horaires WHERE id = ?", (horaire_id,))
        return row or self.one("SELECT * FROM horaires ORDER BY id LIMIT 1")

    # -------------------------------------------------------------- pointages
    def add_punches(self, rows: Iterable[tuple], device_id: int | None, source: str) -> int:
        """rows : (matricule, datetime, etat, verification). Retourne le nombre de nouveaux pointages."""
        with self.tx() as c:
            before = c.total_changes
            c.executemany(
                "INSERT OR IGNORE INTO pointages (matricule, horodatage, etat, verification, pointeuse_id, source)"
                " VALUES (?,?,?,?,?,?)",
                ((str(m), t.replace(microsecond=0).isoformat(), int(e), int(v), device_id, source)
                 for m, t, e, v in rows))
            return c.total_changes - before

    def punches(self, start: datetime, end: datetime, matricule: str | None = None) -> list[sqlite3.Row]:
        sql = "SELECT * FROM pointages WHERE horodatage >= ? AND horodatage < ?"
        params: list = [start.isoformat(), end.isoformat()]
        if matricule:
            sql += " AND matricule = ?"
            params.append(matricule)
        return self.q(sql + " ORDER BY matricule, horodatage", params)

    def log_sync(self, device_id: int | None, lus: int, nouveaux: int, message: str = "") -> None:
        with self.tx() as c:
            c.execute("INSERT INTO journal_synchro (pointeuse_id, moment, lus, nouveaux, message) VALUES (?,?,?,?,?)",
                      (device_id, datetime.now().replace(microsecond=0).isoformat(), lus, nouveaux, message))
            if device_id:
                c.execute("UPDATE pointeuses SET derniere_synchro = ? WHERE id = ?",
                          (datetime.now().replace(microsecond=0).isoformat(), device_id))

    # -------------------------------------------------------- absences / fériés
    def holidays(self, start: date, end: date) -> dict[date, str]:
        rows = self.q("SELECT * FROM feries WHERE date >= ? AND date <= ?", (start.isoformat(), end.isoformat()))
        return {date.fromisoformat(r["date"]): r["libelle"] for r in rows}

    def absences(self, start: date, end: date) -> list[sqlite3.Row]:
        return self.q("SELECT * FROM absences WHERE au >= ? AND du <= ?", (start.isoformat(), end.isoformat()))
