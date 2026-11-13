"""Interface en ligne de commande : python -m gta <commande> …  (python -m gta --help)."""

from __future__ import annotations

import argparse
import calendar
import logging
import os
import shutil
import sys
import threading
import time as _time
from datetime import date, datetime, time
from pathlib import Path

from gta import __version__
from gta.attendance import compute_period
from gta.config import Config, load_config
from gta.db import Database
from gta.export import JOURS, export, fmt_h
from gta.payroll import compute_payslip
from gta.zk import ZKError
from gta.zk.const import PUNCH_STATES, VERIFY_MODES

ABSENCE_TYPES = ("conge", "maladie", "permission", "mission", "injustifiee")


# ------------------------------------------------------------------ utilitaires
def money(x: float, cfg: Config) -> str:
    s = f"{x:,.{cfg.arrondi}f}".replace(",", " ")
    return f"{s} {cfg.devise}"


def table(headers: list[str], rows: list[list]) -> str:
    rows = [[("" if v is None else str(v)) for v in r] for r in rows]
    widths = [max([len(h)] + [len(r[i]) for r in rows]) for i, h in enumerate(headers)]
    line = "  ".join(h.ljust(w) for h, w in zip(headers, widths))
    sep = "  ".join("─" * w for w in widths)
    body = ["  ".join(v.ljust(w) for v, w in zip(r, widths)) for r in rows]
    return "\n".join([line, sep, *body])


def period(args) -> tuple[date, date]:
    if getattr(args, "mois", None):
        y, m = (int(x) for x in args.mois.split("-"))
        return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])
    if args.du:
        start = date.fromisoformat(args.du)
        end = date.fromisoformat(args.au) if args.au else date.today()
        return start, end
    today = date.today()
    return today.replace(day=1), today


def add_period_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--mois", help="mois de paie AAAA-MM (par défaut : mois en cours)")
    p.add_argument("--du", help="début AAAA-MM-JJ")
    p.add_argument("--au", help="fin AAAA-MM-JJ (incluse)")


def open_db(cfg: Config) -> Database:
    return Database(cfg.base_de_donnees)


def direct_devices(db: Database, ref: str | None):
    if ref:
        dev = db.device(ref)
        if dev is None:
            raise SystemExit(f"Pointeuse « {ref} » introuvable (voir : python -m gta pointeuse liste)")
        return [dev]
    return [d for d in db.devices() if int(d["port"]) > 0]


def print_punch(dev_name: str, user_id: str, when: datetime, state: int, verify: int, db: Database) -> None:
    emp = db.employee(user_id)
    name = emp["nom"] if emp else "inconnu"
    print(f"{when:%d/%m/%Y %H:%M:%S}  {dev_name:<18} {user_id:>6}  {name:<25} "
          f"{PUNCH_STATES.get(state, state)} ({VERIFY_MODES.get(verify, verify)})", flush=True)


# --------------------------------------------------------------------- commandes
def cmd_init(args, cfg: Config) -> int:
    target = Path(args.config)
    if not target.exists():
        shutil.copy(Path(__file__).resolve().parent.parent / "gta.example.toml", target)
        print(f"Configuration créée : {target} (à adapter : entreprise, taux, cotisations)")
        cfg = load_config(target)
    db = open_db(cfg)
    print(f"Base de données prête : {db.path}")
    return 0


def cmd_device(args, cfg: Config) -> int:
    db = open_db(cfg)
    if args.action == "ajouter":
        dev_id = db.add_device(args.nom, args.ip, args.port, args.mdp, args.udp, args.lieu or "")
        print(f"Pointeuse n°{dev_id} « {args.nom} » ajoutée ({args.ip}:{args.port}).")
        print("Testez-la avec : python -m gta pointeuse tester", dev_id)
    elif args.action == "liste":
        rows = [[d["id"], d["nom"], f"{d['ip']}:{d['port']}" if d["port"] else d["ip"],
                 "UDP" if d["udp"] else ("ADMS" if not d["port"] else "TCP"), d["numero_serie"] or "",
                 d["emplacement"] or "", d["derniere_synchro"] or "jamais"] for d in db.devices(False)]
        print(table(["N°", "Nom", "Adresse", "Mode", "N° série", "Emplacement", "Dernière synchro"], rows)
              if rows else "Aucune pointeuse. Ajoutez-en une : python -m gta pointeuse ajouter Accueil 192.168.1.201")
    elif args.action == "supprimer":
        dev = direct_devices(db, args.ref)[0]
        with db.tx() as c:
            c.execute("UPDATE pointeuses SET actif = 0 WHERE id = ?", (dev["id"],))
        print(f"Pointeuse « {dev['nom']} » désactivée (ses pointages sont conservés).")
    elif args.action in ("tester", "heure"):
        from gta.sync import client_for

        dev = direct_devices(db, args.ref)[0]
        try:
            with client_for(dev) as zk:
                now = zk.get_time()
                if args.action == "tester":
                    sizes = zk.get_sizes()
                    print(f"Connexion OK à « {dev['nom']} » ({dev['ip']}:{dev['port']})")
                    for label, fn in (("Modèle", zk.get_device_name), ("N° de série", zk.get_serial_number),
                                      ("Firmware", zk.get_firmware_version)):
                        try:
                            print(f"  {label:<14}: {fn()}")
                        except ZKError:
                            pass
                    print(f"  {'Utilisateurs':<14}: {sizes.users} / {sizes.users_cap}")
                    print(f"  {'Empreintes':<14}: {sizes.fingers}   Visages : {sizes.faces}")
                    print(f"  {'Pointages':<14}: {sizes.records} / {sizes.records_cap}")
                    if args.bip:
                        zk.test_voice()
                drift = (now - datetime.now()).total_seconds()
                print(f"  {'Heure':<14}: {now:%d/%m/%Y %H:%M:%S} (écart avec ce PC : {drift:+.0f} s)")
                if args.action == "heure" and args.regler:
                    zk.set_time(datetime.now())
                    print("  Heure de la pointeuse réglée sur celle de ce PC.")
                elif abs(drift) > 120:
                    print("  ⚠ Écart > 2 min : réglez l'heure avec « pointeuse heure", dev["id"], "--regler »")
        except ZKError as exc:
            print(f"Échec : {exc}", file=sys.stderr)
            print("Vérifiez : câble/Wi-Fi, IP et port (Menu → Communication → Ethernet), "
                  "Comm Key (Menu → Communication → Connexion PC), pare-feu.", file=sys.stderr)
            return 1
    return 0


def cmd_sync(args, cfg: Config) -> int:
    from gta.sync import sync_device

    db = open_db(cfg)
    devices = direct_devices(db, args.ref)
    if not devices:
        print("Aucune pointeuse configurée.")
        return 1
    errors = 0
    for dev in devices:
        res = sync_device(db, dev, import_users=not args.sans_employes, clear_after=args.vider,
                          set_clock=args.regler_heure)
        if res.erreur:
            errors += 1
            print(f"✗ {dev['nom']} : {res.erreur}")
            continue
        print(f"✓ {dev['nom']} : {res.lus} pointages lus, {res.nouveaux} nouveaux, "
              f"{res.nouveaux_employes} nouveaux employés")
        if res.ecart_horloge_s is not None and abs(res.ecart_horloge_s) > 120:
            print(f"  ⚠ horloge décalée de {res.ecart_horloge_s:+.0f} s (option --regler-heure)")
    return 1 if errors else 0


def cmd_live(args, cfg: Config) -> int:
    from gta.sync import LiveService

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    db = open_db(cfg)
    devices = direct_devices(db, args.ref)
    services = []
    if devices:
        live = LiveService(db, devices, on_punch=lambda d, p: print_punch(
            d["nom"], p.user_id, p.timestamp, p.punch, p.status, db), resync_minutes=args.resynchro)
        live.start()
        services.append(live)
        print(f"Écoute en temps réel de {len(devices)} pointeuse(s)… (Ctrl+C pour arrêter)")
    if args.adms is not None:
        from gta.adms import ADMSServer

        srv = ADMSServer(db, port=args.adms, on_punch=lambda sn, r: print_punch(f"ADMS {sn}", *r, db)).start()
        print(f"Serveur ADMS en écoute sur le port {srv.port} (pointeuses en mode « Serveur Cloud »)")
        services.append(srv)
    if not services:
        print("Aucune pointeuse à écouter.")
        return 1
    try:
        while True:
            _time.sleep(1)
    except KeyboardInterrupt:
        print("\nArrêt…")
    for s in services:
        s.stop()
    return 0


def cmd_adms(args, cfg: Config) -> int:
    from gta.adms import ADMSServer

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    db = open_db(cfg)
    srv = ADMSServer(db, host=args.hote, port=args.port,
                     on_punch=lambda sn, r: print_punch(f"ADMS {sn}", *r, db))
    print(f"Serveur ADMS/iClock sur http://{args.hote}:{srv.port}/iclock/cdata — Ctrl+C pour arrêter")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.stop()
    return 0


def cmd_simulator(args, cfg: Config) -> int:
    from gta.zk.simulator import demo_device

    sim = demo_device(port=args.port, host=args.hote, days=args.jours)
    sim.state.password = args.mdp
    sim.start()
    print(f"Pointeuse simulée sur {args.hote}:{sim.port} : {len(sim.state.users)} employés, "
          f"{len(sim.state.punches)} pointages. Ctrl+C pour arrêter.")
    print("Tapez un matricule puis Entrée pour simuler un pointage en direct.")
    try:
        for line in sys.stdin:
            mat = line.strip()
            if mat:
                p = sim.punch(mat)
                print(f"  pointage {p.user_id} à {p.timestamp:%H:%M:%S}")
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    sim.stop()
    return 0


def cmd_import(args, cfg: Config) -> int:
    from gta.importers import read_file

    db = open_db(cfg)
    rows = read_file(args.fichier)
    n = db.add_punches(rows, None, "fichier")
    for mat in sorted({r[0] for r in rows}):
        if db.employee(mat) is None:
            db.upsert_employee(mat, f"Employé {mat}")
    db.log_sync(None, len(rows), n, f"import {args.fichier}")
    print(f"{len(rows)} pointages lus dans {args.fichier}, {n} nouveaux enregistrés.")
    return 0


def cmd_employee(args, cfg: Config) -> int:
    db = open_db(cfg)
    if args.action == "liste":
        scheds = {r["id"]: r["nom"] for r in db.q("SELECT id, nom FROM horaires")}
        rows = [[e["matricule"], e["nom"], e["departement"], e["type_salaire"], money(e["salaire_base"], cfg),
                 money(e["prime_transport"], cfg), scheds.get(e["horaire_id"], "(défaut)"),
                 "" if e["actif"] else "inactif"] for e in db.employees(active_only=not args.tous)]
        print(table(["Matricule", "Nom", "Service", "Salaire", "Base", "Transport", "Horaire", ""], rows)
              if rows else "Aucun employé : lancez une synchro pour importer ceux de la pointeuse.")
        return 0
    fields = {"departement": args.departement, "poste": args.poste, "type_salaire": args.type,
              "salaire_base": args.salaire, "prime_transport": args.transport, "autres_primes": args.primes,
              "horaire_id": args.horaire, "date_embauche": args.embauche,
              "actif": None if args.actif is None else int(args.actif == "oui")}
    existing = db.employee(args.matricule)
    if existing is None and not args.nom:
        raise SystemExit("Nouvel employé : précisez --nom")
    db.upsert_employee(args.matricule, args.nom or existing["nom"], **fields)
    print(f"Employé {args.matricule} enregistré.")
    return 0


def cmd_schedule(args, cfg: Config) -> int:
    db = open_db(cfg)
    if args.action == "liste":
        rows = [[h["id"], h["nom"], f"{h['debut']}-{h['fin']}", h["pause_min"], h["jours"], h["tolerance_min"],
                 f"{h['debut_samedi']}-{h['fin_samedi']}" if h["debut_samedi"] else ""]
                for h in db.q("SELECT * FROM horaires ORDER BY id")]
        print(table(["N°", "Nom", "Horaire", "Pause (min)", "Jours (1=lun)", "Tolérance", "Samedi"], rows))
        return 0
    sat = args.samedi.split("-") if args.samedi else (None, None)
    with db.tx() as c:
        c.execute("INSERT INTO horaires (nom, debut, fin, pause_min, jours, tolerance_min, debut_samedi, fin_samedi)"
                  " VALUES (?,?,?,?,?,?,?,?)",
                  (args.nom, args.debut, args.fin, args.pause, args.jours, args.tolerance, sat[0], sat[1]))
    print(f"Horaire « {args.nom} » ajouté. Affectez-le : python -m gta employe modifier MATRICULE --horaire N°")
    return 0


def cmd_absence(args, cfg: Config) -> int:
    db = open_db(cfg)
    if args.action == "liste":
        rows = [[a["id"], a["matricule"], a["du"], a["au"], a["type"], a["commentaire"]]
                for a in db.q("SELECT * FROM absences ORDER BY du DESC LIMIT 200")]
        print(table(["N°", "Matricule", "Du", "Au", "Type", "Commentaire"], rows) if rows else "Aucune absence.")
        return 0
    with db.tx() as c:
        c.execute("INSERT INTO absences (matricule, du, au, type, commentaire) VALUES (?,?,?,?,?)",
                  (args.matricule, args.du, args.au, args.type, args.commentaire or ""))
    print("Absence enregistrée.")
    return 0


def cmd_holiday(args, cfg: Config) -> int:
    from gta.holidays import ivory_coast

    db = open_db(cfg)
    if args.action == "charger":
        days = ivory_coast(args.annee)
        with db.tx() as c:
            c.executemany("INSERT OR IGNORE INTO feries (date, libelle) VALUES (?, ?)",
                          ((d.isoformat(), lib) for d, lib in days.items()))
        print(f"{len(days)} jours fériés {args.annee} chargés. Ajoutez les fêtes musulmanes "
              "(Korité, Tabaski, Maouloud…) dès leur fixation : python -m gta ferie ajouter AAAA-MM-JJ Libellé")
    elif args.action == "ajouter":
        with db.tx() as c:
            c.execute("INSERT OR REPLACE INTO feries (date, libelle) VALUES (?, ?)", (args.date, args.libelle))
        print("Jour férié enregistré.")
    else:
        rows = [[r["date"], r["libelle"]] for r in db.q("SELECT * FROM feries ORDER BY date")]
        print(table(["Date", "Libellé"], rows) if rows else "Aucun jour férié (python -m gta ferie charger 2026).")
    return 0


def cmd_punch(args, cfg: Config) -> int:
    db = open_db(cfg)
    if args.action == "liste":
        start, end = period(args)
        rows = db.punches(datetime.combine(start, time()), datetime.combine(end, time.max), args.matricule)
        devs = {d["id"]: d["nom"] for d in db.devices(False)}
        print(table(["Matricule", "Horodatage", "État", "Vérification", "Source"],
                    [[r["matricule"], r["horodatage"].replace("T", " "), PUNCH_STATES.get(r["etat"], r["etat"]),
                      VERIFY_MODES.get(r["verification"], r["verification"]),
                      devs.get(r["pointeuse_id"], r["source"])] for r in rows]))
        return 0
    from gta.importers import parse_datetime

    when = parse_datetime(args.horodatage)
    n = db.add_punches([(args.matricule, when, args.etat, 0)], None, "manuel")
    if args.commentaire:
        with db.tx() as c:
            c.execute("UPDATE pointages SET commentaire = ? WHERE matricule = ? AND horodatage = ?",
                      (args.commentaire, args.matricule, when.isoformat()))
    print("Pointage manuel ajouté." if n else "Ce pointage existe déjà.")
    return 0


def cmd_report(args, cfg: Config) -> int:
    db = open_db(cfg)
    start, end = period(args)
    result = compute_period(db, cfg, start, end, args.matricule)
    for mat, days in result.items():
        emp = db.employee(mat)
        print(f"\n■ {mat} — {emp['nom']}  ({start:%d/%m/%Y} → {end:%d/%m/%Y})")
        rows = []
        for d in days:
            if not args.complet and d.type_jour in ("repos", "hors_contrat") and not d.pointages:
                continue
            rows.append([f"{JOURS[d.date.weekday()]} {d.date:%d/%m}", d.statut,
                         " ".join(t.strftime("%H:%M") for t in d.pointages),
                         fmt_h(d.travaille_min) if d.travaille_min else "",
                         d.retard_min or "", fmt_h(d.hs_total_min) if d.hs_total_min else "",
                         " ; ".join(d.anomalies)])
        print(table(["Jour", "Statut", "Pointages", "Travaillé", "Retard", "H. sup.", "Anomalie"], rows))
        print(f"  Total : {fmt_h(sum(d.travaille_min for d in days))} travaillées, "
              f"{fmt_h(sum(d.hs_total_min for d in days))} sup., "
              f"{sum(d.retard_min for d in days)} min de retard, "
              f"{sum(1 for d in days if d.absence == 'injustifiee')} absence(s) injustifiée(s), "
              f"{sum(1 for d in days if d.anomalies)} anomalie(s)")
    return 0


def cmd_payroll(args, cfg: Config) -> int:
    db = open_db(cfg)
    start, end = period(args)
    days = compute_period(db, cfg, start, end, getattr(args, "matricule", None))
    bulletins = [compute_payslip(db.employee(m), ds, cfg, start, end) for m, ds in days.items()]
    if args.cmd == "bulletin":
        for b in bulletins:
            print(f"\n{cfg.entreprise}\nBULLETIN DE PAIE du {start:%d/%m/%Y} au {end:%d/%m/%Y}")
            print(f"{b.matricule} — {b.nom}   ({b.type_salaire}, taux horaire {money(b.taux_horaire, cfg)})")
            print(f"Présence : {b.jours_presents} j — {b.heures_travaillees} h travaillées — "
                  f"{b.jours_absence_injustifiee} absence(s) injustifiée(s)\n")
            rows = [[g.libelle, "" if g.base is None else g.base, "" if g.taux is None else g.taux,
                     money(g.montant, cfg)] for g in b.gains]
            rows.append(["SALAIRE BRUT", "", "", money(b.brut, cfg)])
            rows += [[r.libelle, "" if r.base is None else money(r.base, cfg),
                      "" if r.taux is None else f"{r.taux * 100:g} %", money(-r.montant, cfg)] for r in b.retenues]
            rows.append(["NET À PAYER", "", "", money(b.net, cfg)])
            print(table(["Rubrique", "Base", "Taux", "Montant"], rows))
        return 0
    rows = [[b.matricule, b.nom, b.jours_presents, b.jours_absence_injustifiee, b.heures_travaillees,
             b.heures_sup, b.retard_min, b.anomalies, money(b.brut, cfg), money(b.total_retenues, cfg),
             money(b.net, cfg)] for b in bulletins]
    print(f"Paie du {start:%d/%m/%Y} au {end:%d/%m/%Y}")
    print(table(["Matricule", "Nom", "Présent", "Abs.", "Heures", "H. sup.", "Retard", "Anom.", "Brut",
                 "Retenues", "Net"], rows))
    print(f"\nMasse salariale brute : {money(sum(b.brut for b in bulletins), cfg)} — "
          f"net à payer : {money(sum(b.net for b in bulletins), cfg)}")
    if any(b.anomalies for b in bulletins):
        print("⚠ Des journées comportent des anomalies (pointage manquant) : vérifiez le rapport "
              "et corrigez avec « pointage ajouter » avant de clôturer la paie.")
    if args.export:
        names = {e["matricule"]: e["nom"] for e in db.employees(active_only=False)}
        out = export(args.export, cfg, bulletins, days, names)
        print(f"Export enregistré : {out}")
    return 0


# ---------------------------------------------------------------------- parseur
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="python -m gta",
                                 description="GTA — pointeuses biométriques, temps de travail et paie")
    ap.add_argument("--config", default=os.environ.get("GTA_CONFIG", "gta.toml"),
                    help="fichier de configuration (défaut : gta.toml)")
    ap.add_argument("--version", action="version", version=f"GTA {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="créer la configuration et la base")

    p = sub.add_parser("pointeuse", help="gérer les pointeuses")
    ps = p.add_subparsers(dest="action", required=True)
    a = ps.add_parser("ajouter", help="déclarer une pointeuse réseau")
    a.add_argument("nom")
    a.add_argument("ip")
    a.add_argument("--port", type=int, default=4370)
    a.add_argument("--mdp", type=int, default=0, help="Comm Key (mot de passe de communication)")
    a.add_argument("--udp", action="store_true", help="anciens modèles qui ne parlent qu'en UDP")
    a.add_argument("--lieu")
    ps.add_parser("liste")
    for name in ("tester", "heure", "supprimer"):
        x = ps.add_parser(name)
        x.add_argument("ref", help="n°, nom ou n° de série")
        if name == "heure":
            x.add_argument("--regler", action="store_true", help="mettre la pointeuse à l'heure du PC")
        if name == "tester":
            x.add_argument("--bip", action="store_true", help="faire parler la pointeuse")

    p = sub.add_parser("synchro", help="relever les pointages des pointeuses")
    p.add_argument("ref", nargs="?", help="une seule pointeuse (par défaut : toutes)")
    p.add_argument("--vider", action="store_true", help="vider le journal de la pointeuse après sauvegarde vérifiée")
    p.add_argument("--regler-heure", action="store_true")
    p.add_argument("--sans-employes", action="store_true", help="ne pas importer les nouveaux employés")

    p = sub.add_parser("direct", help="écouter les pointages en temps réel (service)")
    p.add_argument("ref", nargs="?")
    p.add_argument("--adms", type=int, nargs="?", const=8081, help="démarrer aussi le serveur ADMS (port 8081)")
    p.add_argument("--resynchro", type=int, default=60, help="relevé complet toutes les N minutes")

    p = sub.add_parser("adms", help="recevoir les pointages poussés par les pointeuses (mode Cloud/ADMS)")
    p.add_argument("--port", type=int, default=8081)
    p.add_argument("--hote", default="0.0.0.0")

    p = sub.add_parser("simulateur", help="lancer une pointeuse simulée pour essayer sans matériel")
    p.add_argument("--port", type=int, default=4370)
    p.add_argument("--hote", default="127.0.0.1")
    p.add_argument("--jours", type=int, default=30)
    p.add_argument("--mdp", type=int, default=0)

    p = sub.add_parser("importer", help="importer un fichier attlog.dat (clé USB) ou CSV")
    p.add_argument("fichier")

    p = sub.add_parser("employe", help="employés et salaires")
    ps = p.add_subparsers(dest="action", required=True)
    x = ps.add_parser("liste")
    x.add_argument("--tous", action="store_true")
    x = ps.add_parser("modifier", help="créer ou modifier un employé")
    x.add_argument("matricule")
    x.add_argument("--nom")
    x.add_argument("--departement")
    x.add_argument("--poste")
    x.add_argument("--type", choices=("mensuel", "horaire", "journalier"))
    x.add_argument("--salaire", type=float, help="salaire mensuel, ou taux horaire / journalier")
    x.add_argument("--transport", type=float)
    x.add_argument("--primes", type=float)
    x.add_argument("--horaire", type=int, help="n° d'horaire")
    x.add_argument("--embauche", help="date d'embauche AAAA-MM-JJ")
    x.add_argument("--actif", choices=("oui", "non"))

    p = sub.add_parser("horaire", help="horaires de travail")
    ps = p.add_subparsers(dest="action", required=True)
    ps.add_parser("liste")
    x = ps.add_parser("ajouter")
    x.add_argument("nom")
    x.add_argument("debut", help="HH:MM")
    x.add_argument("fin", help="HH:MM (ex. 22:00 06:00 pour un poste de nuit)")
    x.add_argument("--pause", type=int, default=60, help="pause non pointée en minutes")
    x.add_argument("--jours", default="1,2,3,4,5", help="jours travaillés, 1 = lundi")
    x.add_argument("--tolerance", type=int, default=10, help="minutes de retard tolérées")
    x.add_argument("--samedi", help="horaire du samedi, ex. 08:00-12:00")

    p = sub.add_parser("absence", help="congés, maladies, permissions")
    ps = p.add_subparsers(dest="action", required=True)
    ps.add_parser("liste")
    x = ps.add_parser("ajouter")
    x.add_argument("matricule")
    x.add_argument("du")
    x.add_argument("au")
    x.add_argument("type", choices=ABSENCE_TYPES)
    x.add_argument("--commentaire")

    p = sub.add_parser("ferie", help="jours fériés")
    ps = p.add_subparsers(dest="action", required=True)
    ps.add_parser("liste")
    x = ps.add_parser("charger", help="jours fériés fixes de Côte d'Ivoire pour une année")
    x.add_argument("annee", type=int)
    x = ps.add_parser("ajouter")
    x.add_argument("date")
    x.add_argument("libelle")

    p = sub.add_parser("pointage", help="consulter ou corriger les pointages")
    ps = p.add_subparsers(dest="action", required=True)
    x = ps.add_parser("liste")
    add_period_args(x)
    x.add_argument("--matricule")
    x = ps.add_parser("ajouter", help="pointage oublié (correction manuelle tracée)")
    x.add_argument("matricule")
    x.add_argument("horodatage", help='"AAAA-MM-JJ HH:MM"')
    x.add_argument("--etat", type=int, default=255)
    x.add_argument("--commentaire")

    p = sub.add_parser("rapport", help="feuille de présence jour par jour")
    add_period_args(p)
    p.add_argument("--matricule")
    p.add_argument("--complet", action="store_true", help="afficher aussi les jours de repos")

    p = sub.add_parser("paie", help="préparer la paie de la période")
    add_period_args(p)
    p.add_argument("--export", help="fichier Excel à produire, ex. paie-2026-11.xlsx")

    p = sub.add_parser("bulletin", help="afficher le bulletin d'un employé")
    p.add_argument("matricule")
    add_period_args(p)
    return ap


HANDLERS = {
    "init": cmd_init, "pointeuse": cmd_device, "synchro": cmd_sync, "direct": cmd_live, "adms": cmd_adms,
    "simulateur": cmd_simulator, "importer": cmd_import, "employe": cmd_employee, "horaire": cmd_schedule,
    "absence": cmd_absence, "ferie": cmd_holiday, "pointage": cmd_punch, "rapport": cmd_report,
    "paie": cmd_payroll, "bulletin": cmd_payroll,
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    try:
        return HANDLERS[args.cmd](args, cfg)
    except ZKError as exc:
        print(f"Erreur pointeuse : {exc}", file=sys.stderr)
        return 1
