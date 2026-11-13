"""Client du protocole ZKTeco : lecture directe d'une pointeuse sur le réseau.

Compatible avec la grande majorité des terminaux ZKTeco (empreinte, visage, badge,
paume) et des marques qui embarquent leur firmware : K40, K50, MB20, MB360, iFace,
SpeedFace, UFace, ProFace, F18, F22, X628, SilkBio, etc.

Exemple :
    with ZKClient("192.168.1.201") as zk:
        for p in zk.get_attendance():
            print(p.user_id, p.timestamp)
"""

from __future__ import annotations

import socket
import struct
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Iterator

from gta.zk import codec
from gta.zk.const import (
    CMD_ACK_DATA,
    CMD_ACK_OK,
    CMD_ACK_UNAUTH,
    CMD_ATTLOG_RRQ,
    CMD_AUTH,
    CMD_CLEAR_ATTLOG,
    CMD_CONNECT,
    CMD_DATA,
    CMD_DATA_RDY,
    CMD_DATA_WRRQ,
    CMD_DISABLEDEVICE,
    CMD_ENABLEDEVICE,
    CMD_EXIT,
    CMD_FREE_DATA,
    CMD_GET_FREE_SIZES,
    CMD_GET_TIME,
    CMD_GET_VERSION,
    CMD_OPTIONS_RRQ,
    CMD_PREPARE_DATA,
    CMD_REFRESHDATA,
    CMD_REG_EVENT,
    CMD_SET_TIME,
    CMD_TESTVOICE,
    CMD_USERTEMP_RRQ,
    EF_ATTLOG,
    FCT_ATTLOG,
    FCT_USER,
    MAX_CHUNK_TCP,
    MAX_CHUNK_UDP,
    USHRT_MAX,
)


class ZKError(Exception):
    """Erreur de communication avec la pointeuse."""


@dataclass(frozen=True)
class Punch:
    """Un pointage brut lu sur la pointeuse."""

    user_id: str        # matricule saisi dans la pointeuse (PIN)
    timestamp: datetime
    status: int = 0     # mode de vérification (empreinte, visage, badge…)
    punch: int = 0      # état : 0 entrée, 1 sortie, 4/5 heures sup.…
    uid: int = 0        # index interne de l'utilisateur dans la pointeuse


@dataclass(frozen=True)
class DeviceUser:
    uid: int
    user_id: str
    name: str
    privilege: int = 0
    password: str = ""
    card: int = 0
    group_id: str = ""


@dataclass(frozen=True)
class DeviceSizes:
    users: int = 0
    fingers: int = 0
    records: int = 0
    faces: int = 0
    users_cap: int = 0
    fingers_cap: int = 0
    records_cap: int = 0


class ZKClient:
    def __init__(
        self,
        ip: str,
        port: int = 4370,
        password: int = 0,
        timeout: float = 10.0,
        force_udp: bool = False,
    ) -> None:
        self.ip = ip
        self.port = port
        self.password = int(password or 0)
        self.timeout = timeout
        self.tcp = not force_udp
        self.sock: socket.socket | None = None
        self.session_id = 0
        self.reply_id = USHRT_MAX - 1
        self.connected = False
        self._sizes: DeviceSizes | None = None

    # ------------------------------------------------------------------ transport
    def __enter__(self) -> "ZKClient":
        self.connect()
        return self

    def __exit__(self, *exc) -> None:
        self.disconnect()

    def _open_socket(self) -> None:
        if self.tcp:
            self.sock = socket.create_connection((self.ip, self.port), timeout=self.timeout)
        else:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.sock.settimeout(self.timeout)

    def _recv_exact(self, n: int) -> bytes:
        assert self.sock is not None
        buf = bytearray()
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ZKError("connexion fermée par la pointeuse")
            buf.extend(chunk)
        return bytes(buf)

    def _send_raw(self, packet: bytes) -> None:
        assert self.sock is not None
        if self.tcp:
            self.sock.sendall(codec.tcp_wrap(packet))
        else:
            self.sock.sendto(packet, (self.ip, self.port))

    def _recv_packet(self) -> tuple[int, int, int, bytes]:
        """Reçoit un paquet complet → (commande, session, n° réponse, données)."""
        assert self.sock is not None
        try:
            if self.tcp:
                length = codec.tcp_header(self._recv_exact(8))
                packet = self._recv_exact(length)
            else:
                packet, _ = self.sock.recvfrom(65535)
        except socket.timeout as exc:
            raise ZKError("délai dépassé : la pointeuse ne répond pas") from exc
        except ValueError as exc:
            raise ZKError(str(exc)) from exc
        command, _chk, session, reply, data = codec.parse_packet(packet)
        return command, session, reply, data

    @staticmethod
    def _packet(command: int, session_id: int, previous_id: int, data: bytes = b"") -> tuple[bytes, int]:
        reply_id = previous_id + 1
        if reply_id >= USHRT_MAX:
            reply_id -= USHRT_MAX
        return codec.build_packet(command, session_id, reply_id, data, checksum_reply_id=previous_id), reply_id

    def _command(self, command: int, data: bytes = b"") -> tuple[int, bytes]:
        if self.sock is None:
            raise ZKError("non connecté")
        packet, self.reply_id = self._packet(command, self.session_id, self.reply_id, data)
        try:
            self._send_raw(packet)
        except OSError as exc:
            raise ZKError(f"envoi impossible : {exc}") from exc
        cmd, session, _reply, payload = self._recv_packet()
        if command == CMD_CONNECT:
            self.session_id = session
        return cmd, payload

    def _expect_ok(self, command: int, data: bytes = b"", what: str = "") -> bytes:
        cmd, payload = self._command(command, data)
        if cmd not in (CMD_ACK_OK, CMD_ACK_DATA, CMD_PREPARE_DATA, CMD_DATA):
            raise ZKError(f"{what or command} refusé par la pointeuse (code {cmd})")
        return payload

    # -------------------------------------------------------------- connexion
    def connect(self) -> None:
        try:
            self._open_socket()
        except OSError as exc:
            raise ZKError(f"impossible de joindre {self.ip}:{self.port} ({exc})") from exc
        self.session_id = 0
        self.reply_id = USHRT_MAX - 1
        cmd, _ = self._command(CMD_CONNECT)
        if cmd == CMD_ACK_UNAUTH:
            key = codec.make_commkey(self.password, self.session_id)
            cmd, _ = self._command(CMD_AUTH, key)
            if cmd != CMD_ACK_OK:
                self._close()
                raise ZKError("mot de passe de communication (Comm Key) refusé")
        elif cmd != CMD_ACK_OK:
            self._close()
            raise ZKError(f"connexion refusée (code {cmd})")
        self.connected = True

    def _close(self) -> None:
        if self.sock is not None:
            try:
                self.sock.close()
            finally:
                self.sock = None
        self.connected = False

    def disconnect(self) -> None:
        if self.sock is not None and self.connected:
            try:
                self._command(CMD_EXIT)
            except (ZKError, OSError):
                pass
        self._close()

    # ------------------------------------------------------------ commandes
    def enable_device(self) -> None:
        self._expect_ok(CMD_ENABLEDEVICE, what="activation")

    def disable_device(self) -> None:
        """Verrouille le clavier pendant une lecture (évite les pointages pendant le transfert)."""
        self._expect_ok(CMD_DISABLEDEVICE, what="désactivation")

    def refresh_data(self) -> None:
        self._expect_ok(CMD_REFRESHDATA, what="rafraîchissement")

    def test_voice(self, index: int = 0) -> None:
        self._expect_ok(CMD_TESTVOICE, struct.pack("<I", index), what="test sonore")

    def get_firmware_version(self) -> str:
        return codec.cstr(self._expect_ok(CMD_GET_VERSION, what="version"))

    def get_option(self, name: str) -> str:
        payload = self._expect_ok(CMD_OPTIONS_RRQ, name.encode() + b"\x00", what=name)
        text = codec.cstr(payload)
        return text.split("=", 1)[1] if "=" in text else text

    def get_serial_number(self) -> str:
        return self.get_option("~SerialNumber")

    def get_device_name(self) -> str:
        return self.get_option("~DeviceName")

    def get_time(self) -> datetime:
        payload = self._expect_ok(CMD_GET_TIME, what="lecture de l'heure")
        return codec.decode_time(struct.unpack("<I", payload[:4])[0])

    def set_time(self, t: datetime | None = None) -> None:
        t = t or datetime.now()
        self._expect_ok(CMD_SET_TIME, struct.pack("<I", codec.encode_time(t)), what="mise à l'heure")

    def get_sizes(self) -> DeviceSizes:
        payload = self._expect_ok(CMD_GET_FREE_SIZES, what="capacités")
        if len(payload) < 80:
            return DeviceSizes()
        f = struct.unpack("<20i", payload[:80])
        faces = struct.unpack("<i", payload[80:84])[0] if len(payload) >= 84 else 0
        self._sizes = DeviceSizes(
            users=f[4], fingers=f[6], records=f[8],
            fingers_cap=f[14], users_cap=f[15], records_cap=f[16], faces=faces,
        )
        return self._sizes

    def clear_attendance(self) -> None:
        """Vide le journal de la pointeuse. À n'utiliser qu'après une sauvegarde réussie."""
        self._expect_ok(CMD_CLEAR_ATTLOG, what="effacement du journal")

    # ------------------------------------------------------- lecture tamponnée
    def _read_chunk(self, start: int, size: int) -> bytes:
        cmd, payload = self._command(CMD_DATA_RDY, struct.pack("<ii", start, size))
        if cmd == CMD_DATA:
            return payload
        if cmd == CMD_PREPARE_DATA:
            expected = struct.unpack("<I", payload[:4])[0]
            buf = bytearray()
            while len(buf) < expected:
                c, _s, _r, data = self._recv_packet()
                if c == CMD_DATA:
                    buf.extend(data)
                elif c == CMD_ACK_OK:
                    break
                else:
                    raise ZKError(f"réponse inattendue pendant le transfert (code {c})")
            else:
                # La pointeuse termine par un ACK_OK après les paquets de données.
                c, _s, _r, _d = self._recv_packet()
                if c != CMD_ACK_OK:
                    raise ZKError(f"fin de transfert inattendue (code {c})")
            return bytes(buf)
        raise ZKError(f"lecture du tampon refusée (code {cmd})")

    def read_with_buffer(self, command: int, fct: int = 0, ext: int = 0) -> bytes:
        request = struct.pack("<bhii", 1, command, fct, ext)
        cmd, payload = self._command(CMD_DATA_WRRQ, request)
        if cmd == CMD_DATA:
            return payload
        if cmd != CMD_ACK_OK:
            raise ZKError(f"préparation des données refusée (code {cmd})")
        total = struct.unpack("<I", payload[1:5])[0]
        chunk_max = MAX_CHUNK_TCP if self.tcp else MAX_CHUNK_UDP
        data = bytearray()
        start = 0
        while start < total:
            size = min(chunk_max, total - start)
            data.extend(self._read_chunk(start, size))
            start += size
        try:
            self._command(CMD_FREE_DATA)
        except ZKError:
            pass
        return bytes(data)

    # ------------------------------------------------------------ utilisateurs
    def get_users(self) -> list[DeviceUser]:
        sizes = self._sizes or self.get_sizes()
        raw = self.read_with_buffer(CMD_USERTEMP_RRQ, FCT_USER)
        if len(raw) <= 4:
            return []
        total = struct.unpack("<I", raw[:4])[0]
        body = raw[4 : 4 + total]
        rec = _guess_record_size(total, sizes.users, (72, 28))
        users: list[DeviceUser] = []
        for off in range(0, len(body) - rec + 1, rec):
            chunk = body[off : off + rec]
            if rec == 28:
                uid, priv, pwd, name, card, group, _tz, uidnum = struct.unpack("<HB5s8sIxBhI", chunk)
                user_id, group_id = str(uidnum), str(group)
            else:
                uid, priv, pwd, name, card, group, user_id_b = struct.unpack("<HB8s24sIx7sx24s", chunk)
                user_id, group_id = codec.cstr(user_id_b), codec.cstr(group)
            users.append(DeviceUser(
                uid=uid, user_id=user_id or str(uid), name=codec.cstr(name) or f"NN-{user_id}",
                privilege=priv, password=codec.cstr(pwd), card=card, group_id=group_id,
            ))
        return users

    # --------------------------------------------------------------- pointages
    def get_attendance(self) -> list[Punch]:
        """Lit tout le journal de pointage stocké dans la pointeuse."""
        sizes = self._sizes or self.get_sizes()
        users: dict[int, str] = {}
        raw = self.read_with_buffer(CMD_ATTLOG_RRQ, FCT_ATTLOG)
        if len(raw) <= 4:
            return []
        total = struct.unpack("<I", raw[:4])[0]
        body = raw[4 : 4 + total]
        rec = _guess_record_size(total, sizes.records, (40, 16, 8))
        if rec == 8:
            users = {u.uid: u.user_id for u in self.get_users()}
        punches: list[Punch] = []
        for off in range(0, len(body) - rec + 1, rec):
            chunk = body[off : off + rec]
            if rec == 8:
                uid, status, ts, punch = struct.unpack("<HBIB", chunk)
                user_id = users.get(uid, str(uid))
            elif rec == 16:
                uidnum, ts, status, punch, _res, _wc = struct.unpack("<IIBB2sI", chunk)
                uid, user_id = uidnum, str(uidnum)
            else:
                uid, user_id_b, status, ts, punch, _sp = struct.unpack("<H24sBIB8s", chunk)
                user_id = codec.cstr(user_id_b) or str(uid)
            try:
                when = codec.decode_time(ts)
            except ValueError:
                continue  # enregistrement corrompu : on l'ignore plutôt que tout bloquer
            punches.append(Punch(user_id=user_id, timestamp=when, status=status, punch=punch, uid=uid))
        return punches

    # ------------------------------------------------------------ temps réel
    def live_capture(
        self, stop: Callable[[], bool] | None = None, poll: float = 1.0
    ) -> Iterator[Punch | None]:
        """Génère chaque pointage au moment où il est fait sur la pointeuse.

        Produit `None` à chaque délai d'attente, pour laisser l'appelant vérifier
        s'il doit s'arrêter (Ctrl+C, arrêt du service…).
        """
        assert self.sock is not None
        self._expect_ok(CMD_REG_EVENT, struct.pack("<I", EF_ATTLOG), what="abonnement")
        self.enable_device()
        old_timeout = self.sock.gettimeout()
        self.sock.settimeout(poll)
        try:
            while not (stop and stop()):
                try:
                    if self.tcp:
                        length = codec.tcp_header(self._recv_exact(8))
                        packet = self._recv_exact(length)
                    else:
                        packet, _ = self.sock.recvfrom(65535)
                except socket.timeout:
                    yield None
                    continue
                cmd, _chk, _session, _reply, data = codec.parse_packet(packet)
                if cmd != CMD_REG_EVENT:
                    continue
                self._ack_event()
                for punch in _parse_events(data):
                    yield punch
        finally:
            self.sock.settimeout(old_timeout)
            try:
                self._command(CMD_REG_EVENT, struct.pack("<I", 0))
            except ZKError:
                pass

    def _ack_event(self) -> None:
        self._send_raw(self._packet(CMD_ACK_OK, self.session_id, USHRT_MAX - 1)[0])


def _guess_record_size(total: int, count: int, candidates: tuple[int, ...]) -> int:
    if count > 0 and total % count == 0 and total // count in candidates:
        return total // count
    for size in candidates:
        if total % size == 0:
            return size
    return candidates[0]


_EVENT_FORMATS = {
    # taille exacte de la trame → format (firmwares anciens à récents)
    10: "<HBB6s",
    12: "<IBB6s",
    14: "<HBB6s4s",
    32: "<24sBB6s",
    36: "<24sBB6s4s",
    52: "<24sBB6s20s",
}


def _parse_events(data: bytes) -> list[Punch]:
    """Décode une trame d'événement : un pointage, ou plusieurs de 52 octets à la suite."""
    punches: list[Punch] = []
    while len(data) >= 10:
        size = len(data) if len(data) in _EVENT_FORMATS else 52
        if len(data) < size:
            break
        fmt = _EVENT_FORMATS[size]
        uid_raw, status, punch, timehex, *_ = struct.unpack(fmt, data[: struct.calcsize(fmt)])
        user_id = codec.cstr(uid_raw) if isinstance(uid_raw, bytes) else str(uid_raw)
        try:
            when = codec.decode_time_hex(timehex)
        except ValueError:
            break
        punches.append(Punch(user_id=user_id, timestamp=when, status=status, punch=punch))
        data = data[size:]
    return punches


def is_reachable(ip: str, port: int = 4370, timeout: float = 3.0) -> bool:
    """Teste rapidement si la pointeuse accepte une connexion TCP."""
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False
