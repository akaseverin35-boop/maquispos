import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from gta.db import Database
from gta.sync import sync_device
from gta.zk import ZKClient, ZKError
from gta.zk import codec
from gta.zk.client import DeviceUser, Punch
from gta.zk.simulator import ZKSimulator


def make_punches(n: int, users=("1", "2", "3")) -> list[Punch]:
    t0 = datetime(2026, 1, 5, 7, 0, 0)
    return [Punch(users[i % len(users)], t0 + timedelta(minutes=7 * i), status=1, punch=i % 2) for i in range(n)]


USERS = [DeviceUser(uid=i, user_id=str(i), name=f"Employé {i}") for i in (1, 2, 3)]


class CodecTest(unittest.TestCase):
    def test_time_roundtrip(self):
        for t in (datetime(2000, 1, 1), datetime(2026, 11, 13, 23, 59, 59), datetime(2031, 2, 28, 8, 1, 2)):
            self.assertEqual(codec.decode_time(codec.encode_time(t)), t)
            self.assertEqual(codec.decode_time_hex(codec.encode_time_hex(t)), t)

    def test_checksum_matches_reference(self):
        # trame CMD_CONNECT d'une session neuve, octet pour octet celle du SDK ZKTeco :
        # 50 50 82 7d 08 00 00 00 e8 03 17 fc 00 00 00 00
        packet, reply_id = ZKClient._packet(1000, 0, 65534)
        self.assertEqual(codec.tcp_wrap(packet).hex(), "5050827d08000000e80317fc00000000")
        self.assertEqual(reply_id, 0)

    def test_commkey(self):
        k = codec.make_commkey(123456, 4242)
        self.assertEqual(len(k), 4)
        self.assertEqual(k, codec.make_commkey(123456, 4242))
        self.assertNotEqual(k, codec.make_commkey(123457, 4242))


class ClientSimulatorTest(unittest.TestCase):
    def check_read(self, record_size: int, udp: bool, n: int = 50, password: int = 0):
        punches = make_punches(n)
        with ZKSimulator(USERS, punches, password=password, record_size=record_size) as sim:
            with ZKClient("127.0.0.1", sim.port, password=password, force_udp=udp, timeout=5) as zk:
                got = zk.get_attendance()
                users = zk.get_users()
        self.assertEqual([(p.user_id, p.timestamp, p.punch) for p in got],
                         [(p.user_id, p.timestamp, p.punch) for p in punches])
        self.assertEqual([(u.user_id, u.name) for u in users], [(u.user_id, u.name) for u in USERS])

    def test_formats_and_transports(self):
        for size in (40, 16, 8):
            for udp in (False, True):
                with self.subTest(record_size=size, udp=udp):
                    self.check_read(size, udp)

    def test_large_transfer_several_chunks(self):
        # 3 000 × 40 octets > 64 Ko : plusieurs lectures de tampon
        self.check_read(40, False, n=3000)
        self.check_read(40, True, n=3000)

    def test_small_direct_transfer(self):
        self.check_read(40, False, n=3)

    def test_password(self):
        self.check_read(40, False, password=654321)
        with ZKSimulator(USERS, [], password=654321) as sim:
            with self.assertRaises(ZKError):
                ZKClient("127.0.0.1", sim.port, password=1).connect()

    def test_unreachable(self):
        with self.assertRaises(ZKError):
            ZKClient("127.0.0.1", 1, timeout=1).connect()

    def test_time_and_clear(self):
        with ZKSimulator(USERS, make_punches(5)) as sim:
            with ZKClient("127.0.0.1", sim.port) as zk:
                target = datetime(2026, 3, 1, 10, 0, 0)
                zk.set_time(target)
                self.assertLess(abs((zk.get_time() - target).total_seconds()), 3)
                zk.clear_attendance()
                self.assertEqual(zk.get_attendance(), [])

    def test_live_capture(self):
        for udp in (False, True):
            with self.subTest(udp=udp), ZKSimulator(USERS, []) as sim:
                got: list[Punch] = []
                ready = threading.Event()

                def listen():
                    with ZKClient("127.0.0.1", sim.port, force_udp=udp) as zk:
                        for p in zk.live_capture(stop=lambda: len(got) >= 2, poll=0.1):
                            ready.set()
                            if p:
                                got.append(p)

                t = threading.Thread(target=listen)
                t.start()
                ready.wait(3)
                time.sleep(0.1)
                sim.punch("2", datetime(2026, 1, 5, 8, 0, 0), punch=0)
                sim.punch("3", datetime(2026, 1, 5, 8, 1, 0), punch=1)
                t.join(5)
                self.assertEqual([(p.user_id, p.timestamp.minute, p.punch) for p in got],
                                 [("2", 0, 0), ("3", 1, 1)])


class SyncTest(unittest.TestCase):
    def test_sync_is_idempotent_and_clear_is_safe(self):
        with tempfile.TemporaryDirectory() as tmp, ZKSimulator(USERS, make_punches(120)) as sim:
            db = Database(Path(tmp) / "t.db")
            dev = db.device(db.add_device("Test", "127.0.0.1", sim.port))
            r1 = sync_device(db, dev)
            self.assertIsNone(r1.erreur)
            self.assertEqual((r1.lus, r1.nouveaux, r1.nouveaux_employes), (120, 120, 3))
            r2 = sync_device(db, dev, clear_after=True)
            self.assertEqual((r2.lus, r2.nouveaux), (120, 0))
            self.assertEqual(len(sim.state.punches), 0)  # vidé après vérification
            self.assertEqual(db.one("SELECT COUNT(*) n FROM pointages")["n"], 120)
            db.close()


if __name__ == "__main__":
    unittest.main()
