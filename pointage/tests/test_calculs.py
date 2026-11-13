import tempfile
import unittest
import urllib.request
from datetime import date, datetime, time
from pathlib import Path

from gta.adms import ADMSServer
from gta.attendance import Schedule, compute_days
from gta.config import Bareme, Config, Retenue
from gta.db import Database
from gta.importers import read_file
from gta.payroll import compute_payslip, progressive_tax

DAY_SCHED = Schedule(debut=time(8), fin=time(17), pause_min=60, jours=frozenset({1, 2, 3, 4, 5}), tolerance_min=10)
NIGHT_SCHED = Schedule(debut=time(22), fin=time(6), pause_min=0, jours=frozenset({1, 2, 3, 4, 5}), tolerance_min=10)
MON = date(2026, 11, 2)  # lundi


def dt(d: int, hh: int, mm: int = 0) -> tuple[datetime, int]:
    return (datetime(2026, 11, d, hh, mm), 0)


def run(punches, sched=DAY_SCHED, start=MON, end=date(2026, 11, 8), holidays=None, absences=None, cfg=None,
        embauche=None):
    return {d.date: d for d in compute_days("1", punches, sched, start, end, holidays or {}, absences or {},
                                            cfg or Config(), embauche)}


class AttendanceTest(unittest.TestCase):
    def test_normal_day_with_unpunched_lunch(self):
        days = run([dt(2, 7, 55), dt(2, 17, 5)])
        d = days[MON]
        self.assertEqual(d.travaille_min, 9 * 60 + 10 - 60)  # pause 12h-13h déduite
        self.assertEqual((d.retard_min, d.depart_anticipe_min, d.anomalies), (0, 0, []))

    def test_punched_lunch_not_deducted_twice(self):
        d = run([dt(2, 8), dt(2, 12), dt(2, 13), dt(2, 17)])[MON]
        self.assertEqual(d.travaille_min, 8 * 60)

    def test_late_and_tolerance(self):
        self.assertEqual(run([dt(2, 8, 9), dt(2, 17)])[MON].retard_min, 0)
        self.assertEqual(run([dt(2, 8, 25), dt(2, 17)])[MON].retard_min, 25)
        self.assertEqual(run([dt(2, 8), dt(2, 16, 30)])[MON].depart_anticipe_min, 30)

    def test_duplicates_and_missing_out(self):
        d = run([dt(2, 8), dt(2, 8, 1)])[MON]
        self.assertEqual(len(d.pointages), 1)
        self.assertEqual(d.travaille_min, 0)
        self.assertTrue(d.anomalies)

    def test_absences(self):
        days = run([], absences={date(2026, 11, 3): "conge"})
        self.assertEqual(days[MON].absence, "injustifiee")
        self.assertEqual(days[date(2026, 11, 3)].absence, "conge")
        self.assertIsNone(days[date(2026, 11, 7)].absence)  # samedi non travaillé

    def test_night_shift_crosses_midnight(self):
        days = run([dt(2, 21, 58), dt(3, 6, 2)], sched=NIGHT_SCHED)
        d = days[MON]
        self.assertEqual(d.travaille_min, 8 * 60 + 4)
        self.assertEqual(d.anomalies, [])
        self.assertFalse(days[date(2026, 11, 3)].pointages)

    def test_weekly_overtime_tiers(self):
        # 5 × 11 h (7h-19h, 1 h de pause) = 55 h : 40 normales, 6 h à +15 %, 9 h à +50 %
        punches = [p for d in range(2, 7) for p in (dt(d, 7), dt(d, 19))]
        days = run(punches)
        total_normal = sum(d.normal_min for d in days.values())
        hs = {}
        for d in days.values():
            for r, m in d.hs_min.items():
                hs[r] = hs.get(r, 0) + m
        self.assertEqual(total_normal, 40 * 60)
        self.assertEqual(hs, {0.15: 6 * 60, 0.50: 9 * 60})
        self.assertEqual(sum(days[date(2026, 11, d)].hs_total_min for d in (2, 3, 4)), 0)  # sup. en fin de semaine

    def test_sunday_and_holiday_and_night(self):
        days = run([dt(8, 8), dt(8, 12)])  # dimanche
        self.assertEqual(days[date(2026, 11, 8)].dim_ferie_min, 4 * 60)
        days = run([dt(2, 8), dt(2, 12)], holidays={MON: "Test"})
        self.assertEqual(days[MON].dim_ferie_min, 4 * 60)
        self.assertEqual(days[MON].type_jour, "ferie")
        # 45 h de jour puis 2 h après 21 h : sup. de nuit
        punches = [p for d in range(2, 7) for p in (dt(d, 8), dt(d, 18))] + [dt(6, 19), dt(6, 23)]
        days = run(punches)
        self.assertEqual(days[date(2026, 11, 6)].hs_nuit_min, 2 * 60)

    def test_hire_date(self):
        days = run([], embauche=date(2026, 11, 4))
        self.assertEqual(days[MON].type_jour, "hors_contrat")
        self.assertIsNone(days[MON].absence)
        self.assertEqual(days[date(2026, 11, 4)].absence, "injustifiee")


class PayrollTest(unittest.TestCase):
    def emp(self, **kw):
        base = {"matricule": "1", "nom": "Test", "type_salaire": "mensuel", "salaire_base": 173330,
                "prime_transport": 30000, "autres_primes": 0}
        base.update(kw)
        return base

    def test_monthly_with_absence_overtime_and_deductions(self):
        punches = [p for d in range(2, 7) for p in (dt(d, 7), dt(d, 19))]  # 55 h, mardi… tout présent
        days = list(run(punches, end=date(2026, 11, 8)).values())
        cfg = Config(retenues=[Retenue("CNPS", 0.063, "imposable")])
        b = compute_payslip(self.emp(), days, cfg, MON, date(2026, 11, 8))
        gains = {g.libelle: g.montant for g in b.gains}
        self.assertEqual(b.taux_horaire, 1000.0)
        self.assertEqual(gains["Heures sup. +15 %"], 6 * 1150)
        self.assertEqual(gains["Heures sup. +50 %"], 9 * 1500)
        self.assertEqual(b.imposable, 173330 + 6900 + 13500)
        self.assertEqual(b.brut, b.imposable + 30000)
        self.assertEqual(b.retenues[0].montant, round(b.imposable * 0.063))
        self.assertEqual(b.net, b.brut - b.total_retenues)

        days = list(run([dt(d, 8) for d in ()]).values())  # aucune présence : 5 absences injustifiées
        b = compute_payslip(self.emp(), days, Config(), MON, date(2026, 11, 8))
        self.assertEqual(b.jours_absence_injustifiee, 5)
        self.assertEqual({g.libelle: g.montant for g in b.gains}["Retenue absences injustifiées"], -40000)

    def test_hourly(self):
        days = list(run([dt(2, 8), dt(2, 17)]).values())
        b = compute_payslip(self.emp(type_salaire="horaire", salaire_base=1500, prime_transport=0),
                            days, Config(), MON, date(2026, 11, 8))
        self.assertEqual(b.brut, 8 * 1500)

    def test_progressive_tax(self):
        tr = [(0, 0.0), (75000, 0.16), (240000, 0.21)]
        self.assertEqual(progressive_tax(50000, tr), 0)
        self.assertAlmostEqual(progressive_tax(300000, tr), 165000 * 0.16 + 60000 * 0.21)
        days = list(run([]).values())
        cfg = Config(bareme=Bareme("ITS", tr), deduire_absences=False)
        b = compute_payslip(self.emp(salaire_base=300000, prime_transport=0), days, cfg, MON, date(2026, 11, 8))
        self.assertEqual(b.net, 300000 - round(165000 * 0.16 + 60000 * 0.21))


class AdmsAndImportTest(unittest.TestCase):
    def test_adms_push(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Database(Path(tmp) / "t.db")
            srv = ADMSServer(db, host="127.0.0.1", port=0).start()
            base = f"http://127.0.0.1:{srv.port}/iclock/cdata?SN=ABC123"
            options = urllib.request.urlopen(base + "&options=all").read().decode()
            self.assertIn("GET OPTION FROM: ABC123", options)
            body = "101\t2026-11-02 07:58:12\t0\t1\t0\t0\n102\t2026-11-02 08:03:40\t0\t15\t0\t0\n"
            req = urllib.request.Request(base + "&table=ATTLOG&Stamp=1", data=body.encode(), method="POST")
            self.assertEqual(urllib.request.urlopen(req).read().decode(), "OK: 2")
            users = "USER PIN=101\tName=KOUASSI Aya\tPri=0\tPasswd=\tCard=\tGrp=1\n"
            req = urllib.request.Request(base + "&table=OPERLOG", data=users.encode(), method="POST")
            urllib.request.urlopen(req).read()
            srv.stop()
            self.assertEqual(db.one("SELECT COUNT(*) n FROM pointages WHERE source = 'adms'")["n"], 2)
            self.assertEqual(db.employee("101")["nom"], "KOUASSI Aya")
            self.assertEqual(db.device("ABC123")["numero_serie"], "ABC123")
            db.close()

    def test_import_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            dat = Path(tmp) / "1_attlog.dat"
            dat.write_text("     101\t2026-11-02 07:58:12\t1\t0\t1\t0\n     101\t2026-11-02 17:02:00\t1\t1\t1\t0\n")
            rows = read_file(dat)
            self.assertEqual([(r[0], r[1].hour, r[2]) for r in rows], [("101", 7, 0), ("101", 17, 1)])
            csv_file = Path(tmp) / "p.csv"
            csv_file.write_text("Matricule;Date;Heure\n101;02/11/2026;07:58\n102;02/11/2026;08:10\n")
            rows = read_file(csv_file)
            self.assertEqual([(r[0], r[1]) for r in rows],
                             [("101", datetime(2026, 11, 2, 7, 58)), ("102", datetime(2026, 11, 2, 8, 10))])


if __name__ == "__main__":
    unittest.main()
