"""Serveur « ADMS / iClock » : les pointeuses récentes envoient elles-mêmes leurs pointages.

Sur la pointeuse : Menu → Communication → Serveur Cloud (ou ADMS) :
    Adresse du serveur = IP de ce PC, Port = 8081 (option --port), HTTPS désactivé.
La pointeuse pousse alors chaque pointage en quelques secondes, même derrière un
routeur 4G ou depuis un autre site, sans que le logiciel ait besoin de la joindre.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from gta.db import Database

log = logging.getLogger("gta.adms")


def parse_attlog(body: str) -> list[tuple[str, datetime, int, int]]:
    rows = []
    for line in body.splitlines():
        parts = line.strip().split("\t")
        if len(parts) < 2:
            continue
        try:
            when = datetime.strptime(parts[1].strip(), "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        state = int(parts[2]) if len(parts) > 2 and parts[2].strip().isdigit() else 0
        verify = int(parts[3]) if len(parts) > 3 and parts[3].strip().isdigit() else 0
        rows.append((parts[0].strip(), when, state, verify))
    return rows


def parse_users(body: str) -> list[tuple[str, str]]:
    users = []
    for line in body.splitlines():
        line = line.strip()
        if not line.startswith("USER "):
            continue
        fields = dict(f.split("=", 1) for f in line[5:].split("\t") if "=" in f)
        if fields.get("PIN"):
            users.append((fields["PIN"].strip(), fields.get("Name", "").strip() or f"NN-{fields['PIN']}"))
    return users


class ADMSServer:
    def __init__(self, db: Database, host: str = "0.0.0.0", port: int = 8081, on_punch=None) -> None:
        self.db = db
        self.on_punch = on_punch
        self.lock = threading.Lock()
        server = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "GTA-ADMS/1.0"

            def log_message(self, fmt, *args):
                log.debug("%s - %s", self.address_string(), fmt % args)

            def _reply(self, text: str, code: int = 200) -> None:
                data = text.encode()
                self.send_response(code)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                url = urlparse(self.path)
                qs = {k: v[0] for k, v in parse_qs(url.query).items()}
                sn = qs.get("SN", "")
                if url.path.endswith("/cdata"):
                    server._device_id(sn, self.client_address[0])
                    self._reply(
                        f"GET OPTION FROM: {sn}\nATTLOGStamp=None\nOPERLOGStamp=9999\nATTPHOTOStamp=None\n"
                        "ErrorDelay=30\nDelay=10\nTransTimes=00:00;14:05\nTransInterval=1\n"
                        "TransFlag=TransData AttLog\tOpLog\tEnrollUser\nTimeZone=0\nRealtime=1\nEncrypt=None\n")
                elif url.path.endswith("/getrequest"):
                    self._reply("OK")
                else:
                    self._reply("OK")

            def do_POST(self):
                url = urlparse(self.path)
                qs = {k: v[0] for k, v in parse_qs(url.query).items()}
                length = int(self.headers.get("Content-Length", 0) or 0)
                body = self.rfile.read(length).decode("utf-8", "replace") if length else ""
                sn = qs.get("SN", "")
                if url.path.endswith("/cdata"):
                    table = qs.get("table", "").upper()
                    dev_id = server._device_id(sn, self.client_address[0])
                    if table == "ATTLOG":
                        rows = parse_attlog(body)
                        with server.lock:
                            n = server.db.add_punches(rows, dev_id, "adms")
                            server.db.log_sync(dev_id, len(rows), n, f"ADMS {sn}")
                        log.info("ADMS %s : %s pointages reçus (%s nouveaux)", sn, len(rows), n)
                        if server.on_punch:
                            for r in rows:
                                server.on_punch(sn, r)
                        self._reply(f"OK: {len(rows)}")
                        return
                    if table == "OPERLOG":
                        users = parse_users(body)
                        with server.lock:
                            for pin, name in users:
                                if server.db.employee(pin) is None:
                                    server.db.upsert_employee(pin, name)
                        self._reply(f"OK: {len(body.splitlines())}")
                        return
                    self._reply(f"OK: {len(body.splitlines())}")
                else:
                    self._reply("OK")

        self.httpd = ThreadingHTTPServer((host, port), Handler)
        self.port = self.httpd.server_address[1]

    def _device_id(self, sn: str, ip: str) -> int | None:
        if not sn:
            return None
        with self.lock:
            row = self.db.one("SELECT id FROM pointeuses WHERE numero_serie = ?", (sn,))
            if row:
                return int(row["id"])
            with self.db.tx() as c:
                cur = c.execute(
                    "INSERT INTO pointeuses (nom, ip, port, numero_serie, emplacement) VALUES (?,?,?,?,?)",
                    (f"ADMS {sn}", f"adms:{sn}", 0, sn, f"poussée depuis {ip}"))
                log.info("Nouvelle pointeuse ADMS enregistrée : %s (%s)", sn, ip)
                return int(cur.lastrowid)

    def serve_forever(self) -> None:
        self.httpd.serve_forever()

    def start(self) -> "ADMSServer":
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return self

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
