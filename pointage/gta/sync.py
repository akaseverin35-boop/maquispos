"""Synchronisation des pointeuses vers la base : relevé complet ou écoute en temps réel."""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime

from gta.db import Database
from gta.zk import ZKClient, ZKError

log = logging.getLogger("gta.sync")


@dataclass
class SyncResult:
    device: str
    lus: int = 0
    nouveaux: int = 0
    nouveaux_employes: int = 0
    ecart_horloge_s: float | None = None
    erreur: str | None = None


def client_for(dev) -> ZKClient:
    return ZKClient(dev["ip"], int(dev["port"]), password=int(dev["mot_de_passe"] or 0),
                    force_udp=bool(dev["udp"]))


def sync_device(db: Database, dev, *, import_users: bool = True, clear_after: bool = False,
                set_clock: bool = False) -> SyncResult:
    """Relève tout le journal de la pointeuse et enregistre les nouveaux pointages.

    Avec `clear_after`, le journal de la pointeuse n'est vidé que si chaque pointage lu
    est bien présent en base (aucune perte possible en cas de coupure).
    """
    res = SyncResult(device=dev["nom"])
    zk = client_for(dev)
    try:
        zk.connect()
        try:
            zk.disable_device()
            try:
                serial = zk.get_serial_number()
                if serial and serial != dev["numero_serie"]:
                    with db.tx() as c:
                        c.execute("UPDATE pointeuses SET numero_serie = ? WHERE id = ?", (serial, dev["id"]))
            except ZKError:
                pass
            dev_time = zk.get_time()
            res.ecart_horloge_s = (dev_time - datetime.now()).total_seconds()
            if import_users:
                known = {e["matricule"] for e in db.employees(active_only=False)}
                for u in zk.get_users():
                    if u.user_id not in known:
                        db.upsert_employee(u.user_id, u.name)
                        res.nouveaux_employes += 1
            punches = zk.get_attendance()
            res.lus = len(punches)
            res.nouveaux = db.add_punches(
                ((p.user_id, p.timestamp, p.punch, p.status) for p in punches), dev["id"], "zk")
            if clear_after and punches:
                stored = {(r["matricule"], r["horodatage"]) for r in db.q(
                    "SELECT matricule, horodatage FROM pointages WHERE pointeuse_id = ?", (dev["id"],))}
                missing = [p for p in punches
                           if (p.user_id, p.timestamp.replace(microsecond=0).isoformat()) not in stored]
                if missing:
                    raise ZKError(f"{len(missing)} pointages non enregistrés : journal conservé sur la pointeuse")
                zk.clear_attendance()
            if set_clock:
                zk.set_time(datetime.now())
        finally:
            try:
                zk.enable_device()
            except ZKError:
                pass
            zk.disconnect()
    except (ZKError, OSError) as exc:
        res.erreur = str(exc)
        log.error("%s : %s", dev["nom"], exc)
    db.log_sync(dev["id"], res.lus, res.nouveaux, res.erreur or "OK")
    return res


class LiveService:
    """Écoute les pointeuses en temps réel, avec reconnexion automatique et relevé
    complet à chaque (re)connexion pour rattraper ce qui a été pointé pendant une coupure."""

    def __init__(self, db: Database, devices, on_punch=None, resync_minutes: int = 60) -> None:
        self.db = db
        self.devices = list(devices)
        self.on_punch = on_punch
        self.resync = resync_minutes * 60
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self._db_lock = threading.Lock()

    def start(self) -> None:
        for dev in self.devices:
            t = threading.Thread(target=self._run, args=(dev,), name=f"pointeuse-{dev['id']}", daemon=True)
            t.start()
            self._threads.append(t)

    def stop(self) -> None:
        self._stop.set()
        for t in self._threads:
            t.join(timeout=5)

    def wait(self) -> None:
        while not self._stop.is_set():
            self._stop.wait(1)

    def _run(self, dev) -> None:
        backoff = 5
        while not self._stop.is_set():
            with self._db_lock:
                res = sync_device(self.db, dev)
            if res.erreur:
                log.warning("%s injoignable, nouvel essai dans %ss", dev["nom"], backoff)
                self._stop.wait(backoff)
                backoff = min(backoff * 2, 300)
                continue
            backoff = 5
            log.info("%s : %s pointages relevés (%s nouveaux)", dev["nom"], res.lus, res.nouveaux)
            started = time.monotonic()
            zk = client_for(dev)
            try:
                zk.connect()
                stop = lambda: self._stop.is_set() or time.monotonic() - started > self.resync  # noqa: E731
                for p in zk.live_capture(stop=stop):
                    if p is None:
                        continue
                    with self._db_lock:
                        n = self.db.add_punches([(p.user_id, p.timestamp, p.punch, p.status)], dev["id"], "zk")
                    if n and self.on_punch:
                        self.on_punch(dev, p)
            except (ZKError, OSError) as exc:
                log.warning("%s : connexion perdue (%s)", dev["nom"], exc)
            finally:
                zk.disconnect()
