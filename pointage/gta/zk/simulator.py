"""Pointeuse ZKTeco simulée, qui parle le même protocole qu'un vrai terminal.

Sert aux tests automatiques et aux démonstrations sans matériel :
    python -m gta simulateur --port 4370
"""

from __future__ import annotations

import random
import socket
import socketserver
import struct
import threading
from datetime import datetime

from gta.zk import codec
from gta.zk.client import DeviceUser, Punch
from gta.zk.const import (
    CMD_ACK_ERROR,
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
)

DIRECT_LIMIT = 512   # en dessous, les données partent directement dans la réponse
PIECE = 1024         # taille des paquets CMD_DATA envoyés pendant un transfert


class DeviceState:
    def __init__(self, users, punches, password: int, serial: str, record_size: int) -> None:
        self.users: list[DeviceUser] = list(users)
        self.punches: list[Punch] = list(punches)
        self.password = password
        self.serial = serial
        self.record_size = record_size
        self.clock_offset = datetime.now() - datetime.now()
        self.lock = threading.Lock()
        self.subscribers: list = []  # fonctions d'envoi des sessions abonnées au temps réel

    def now(self) -> datetime:
        return (datetime.now() + self.clock_offset).replace(microsecond=0)

    def users_blob(self) -> bytes:
        body = b"".join(
            struct.pack(
                "<HB8s24sIx7sx24s", u.uid, u.privilege, u.password.encode()[:8],
                u.name.encode()[:24], u.card, u.group_id.encode()[:7], u.user_id.encode()[:24],
            )
            for u in self.users
        )
        return struct.pack("<I", len(body)) + body

    def attlog_blob(self) -> bytes:
        uid_of = {u.user_id: u.uid for u in self.users}
        recs = []
        for p in self.punches:
            ts = codec.encode_time(p.timestamp)
            uid = uid_of.get(p.user_id, p.uid)
            if self.record_size == 16:
                recs.append(struct.pack("<IIBB2sI", int(p.user_id), ts, p.status, p.punch, b"", 0))
            elif self.record_size == 8:
                recs.append(struct.pack("<HBIB", uid, p.status, ts, p.punch))
            else:
                recs.append(struct.pack("<H24sBIB8s", uid, p.user_id.encode(), p.status, ts, p.punch, b""))
        body = b"".join(recs)
        return struct.pack("<I", len(body)) + body

    def sizes_blob(self) -> bytes:
        f = [0] * 20
        f[4], f[6], f[8] = len(self.users), 0, len(self.punches)
        f[14], f[15], f[16] = 3000, 3000, 100000
        return struct.pack("<20i", *f) + struct.pack("<i", 0)


class Session:
    """Logique d'une connexion client, indépendante du transport."""

    def __init__(self, state: DeviceState, send) -> None:
        self.state = state
        self.send = send  # send(paquet sans en-tête TCP)
        self.session_id = random.randint(1, 60000)
        self.authenticated = state.password == 0
        self.buffer = b""

    def reply(self, command: int, reply_id: int, data: bytes = b"") -> None:
        self.send(codec.build_packet(command, self.session_id, reply_id, data))

    def push_event(self, punch: Punch) -> None:
        data = struct.pack("<24sBB6s20s", punch.user_id.encode(), punch.status, punch.punch,
                           codec.encode_time_hex(punch.timestamp), b"")
        self.send(codec.build_packet(CMD_REG_EVENT, self.session_id, 0, data))

    def handle(self, packet: bytes) -> bool:
        """Traite un paquet. Retourne False quand la session est terminée."""
        cmd, _chk, _session, rid, data = codec.parse_packet(packet)
        st = self.state
        if cmd == CMD_ACK_OK:  # accusé de réception d'un événement temps réel
            return True
        if cmd == CMD_CONNECT:
            self.reply(CMD_ACK_OK if self.authenticated else CMD_ACK_UNAUTH, rid)
            return True
        if cmd == CMD_AUTH:
            ok = data == codec.make_commkey(st.password, self.session_id)
            self.authenticated = ok
            self.reply(CMD_ACK_OK if ok else CMD_ACK_UNAUTH, rid)
            return True
        if not self.authenticated:
            self.reply(CMD_ACK_UNAUTH, rid)
            return True
        if cmd == CMD_EXIT:
            self.reply(CMD_ACK_OK, rid)
            with st.lock:
                if self.push_event in st.subscribers:
                    st.subscribers.remove(self.push_event)
            return False
        if cmd in (CMD_ENABLEDEVICE, CMD_DISABLEDEVICE, CMD_REFRESHDATA, CMD_TESTVOICE, CMD_FREE_DATA):
            if cmd == CMD_FREE_DATA:
                self.buffer = b""
            self.reply(CMD_ACK_OK, rid)
        elif cmd == CMD_GET_VERSION:
            self.reply(CMD_ACK_OK, rid, b"Ver 6.60 Simulateur GTA\x00")
        elif cmd == CMD_OPTIONS_RRQ:
            key = codec.cstr(data)
            values = {"~SerialNumber": st.serial, "~DeviceName": "Pointeuse simulée"}
            self.reply(CMD_ACK_OK, rid, f"{key}={values.get(key, '')}\x00".encode())
        elif cmd == CMD_GET_FREE_SIZES:
            with st.lock:
                self.reply(CMD_ACK_OK, rid, st.sizes_blob())
        elif cmd == CMD_GET_TIME:
            self.reply(CMD_ACK_OK, rid, struct.pack("<I", codec.encode_time(st.now())))
        elif cmd == CMD_SET_TIME:
            target = codec.decode_time(struct.unpack("<I", data[:4])[0])
            st.clock_offset = target - datetime.now()
            self.reply(CMD_ACK_OK, rid)
        elif cmd == CMD_CLEAR_ATTLOG:
            with st.lock:
                st.punches.clear()
            self.reply(CMD_ACK_OK, rid)
        elif cmd == CMD_DATA_WRRQ:
            _one, table, _fct, _ext = struct.unpack("<bhii", data[:11])
            with st.lock:
                if table == CMD_ATTLOG_RRQ:
                    self.buffer = st.attlog_blob()
                elif table == CMD_USERTEMP_RRQ:
                    self.buffer = st.users_blob()
                else:
                    self.reply(CMD_ACK_ERROR, rid)
                    return True
            if len(self.buffer) <= DIRECT_LIMIT:
                self.reply(CMD_DATA, rid, self.buffer)
            else:
                self.reply(CMD_ACK_OK, rid, b"\x00" + struct.pack("<I", len(self.buffer)) + b"\x00" * 4)
        elif cmd == CMD_DATA_RDY:
            start, size = struct.unpack("<ii", data[:8])
            chunk = self.buffer[start : start + size]
            self.reply(CMD_PREPARE_DATA, rid, struct.pack("<I", len(chunk)) + b"\x00" * 4)
            for off in range(0, len(chunk), PIECE):
                self.reply(CMD_DATA, rid, chunk[off : off + PIECE])
            self.reply(CMD_ACK_OK, rid)
        elif cmd == CMD_REG_EVENT:
            flags = struct.unpack("<I", data[:4])[0] if len(data) >= 4 else 0
            with st.lock:
                if flags and self.push_event not in st.subscribers:
                    st.subscribers.append(self.push_event)
                elif not flags and self.push_event in st.subscribers:
                    st.subscribers.remove(self.push_event)
            self.reply(CMD_ACK_OK, rid)
        else:
            self.reply(CMD_ACK_ERROR, rid)
        return True


class ZKSimulator:
    def __init__(
        self,
        users: list[DeviceUser] | None = None,
        punches: list[Punch] | None = None,
        password: int = 0,
        host: str = "127.0.0.1",
        port: int = 0,
        serial: str = "SIM0000001",
        record_size: int = 40,
    ) -> None:
        self.state = DeviceState(users or [], punches or [], password, serial, record_size)
        self.host = host
        self.port = port
        self._tcp: socketserver.ThreadingTCPServer | None = None
        self._udp: socket.socket | None = None
        self._threads: list[threading.Thread] = []
        self._running = False

    # ----------------------------------------------------------- démarrage
    def start(self) -> "ZKSimulator":
        state = self.state

        class Handler(socketserver.BaseRequestHandler):
            def handle(self) -> None:
                sock: socket.socket = self.request
                send_lock = threading.Lock()

                def send(packet: bytes) -> None:
                    with send_lock:
                        sock.sendall(codec.tcp_wrap(packet))

                session = Session(state, send)
                try:
                    while True:
                        header = _recv_exact(sock, 8)
                        if not header:
                            break
                        packet = _recv_exact(sock, codec.tcp_header(header))
                        if not packet or not session.handle(packet):
                            break
                except (OSError, ValueError):
                    pass
                finally:
                    with state.lock:
                        if session.push_event in state.subscribers:
                            state.subscribers.remove(session.push_event)

        socketserver.ThreadingTCPServer.allow_reuse_address = True
        self._tcp = socketserver.ThreadingTCPServer((self.host, self.port), Handler)
        self._tcp.daemon_threads = True
        self.port = self._tcp.server_address[1]
        self._udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._udp.bind((self.host, self.port))
        self._udp.settimeout(0.2)
        self._running = True
        self._threads = [
            threading.Thread(target=self._tcp.serve_forever, daemon=True),
            threading.Thread(target=self._serve_udp, daemon=True),
        ]
        for t in self._threads:
            t.start()
        return self

    def _serve_udp(self) -> None:
        sessions: dict[tuple, Session] = {}
        assert self._udp is not None
        udp = self._udp
        while self._running:
            try:
                packet, addr = udp.recvfrom(65535)
            except socket.timeout:
                continue
            except OSError:
                break
            session = sessions.get(addr)
            if session is None:
                session = Session(self.state, lambda p, a=addr: udp.sendto(p, a))
                sessions[addr] = session
            try:
                if not session.handle(packet):
                    sessions.pop(addr, None)
            except (ValueError, struct.error):
                continue

    def stop(self) -> None:
        self._running = False
        if self._tcp:
            self._tcp.shutdown()
            self._tcp.server_close()
        if self._udp:
            self._udp.close()

    def __enter__(self) -> "ZKSimulator":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()

    # ------------------------------------------------------------ actions
    def punch(self, user_id: str, when: datetime | None = None, punch: int = 0, status: int = 1) -> Punch:
        """Simule un employé qui pointe : enregistre et diffuse en temps réel."""
        p = Punch(user_id=user_id, timestamp=(when or self.state.now()).replace(microsecond=0),
                  status=status, punch=punch)
        with self.state.lock:
            self.state.punches.append(p)
            subscribers = list(self.state.subscribers)
        for push in subscribers:
            try:
                push(p)
            except OSError:
                pass
        return p


def _recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return b""
        buf.extend(chunk)
    return bytes(buf)


def demo_device(port: int = 4370, host: str = "0.0.0.0", days: int = 30) -> ZKSimulator:
    """Pointeuse de démonstration pré-remplie avec un mois de pointages réalistes."""
    from datetime import date, timedelta

    names = ["KOUASSI Aya", "KONE Ibrahim", "YAO Koffi", "TRAORE Mariam", "BAMBA Seydou"]
    users = [DeviceUser(uid=i + 1, user_id=str(100 + i + 1), name=n) for i, n in enumerate(names)]
    rnd = random.Random(42)
    punches: list[Punch] = []
    today = date.today()
    for d in range(days, 0, -1):
        day = today - timedelta(days=d)
        if day.weekday() == 6:
            continue
        for u in users:
            if rnd.random() < 0.05:
                continue  # absence
            arrive = datetime.combine(day, datetime.min.time()).replace(hour=7, minute=45)
            arrive += timedelta(minutes=rnd.randint(0, 35))
            leave = datetime.combine(day, datetime.min.time()).replace(hour=17)
            leave += timedelta(minutes=rnd.randint(-10, 120))
            if day.weekday() == 5:
                leave = leave.replace(hour=12, minute=rnd.randint(0, 30))
            punches.append(Punch(u.user_id, arrive, status=1, punch=0, uid=u.uid))
            if rnd.random() > 0.02:  # parfois l'employé oublie de pointer en sortant
                punches.append(Punch(u.user_id, leave, status=15, punch=1, uid=u.uid))
    punches.sort(key=lambda p: p.timestamp)
    return ZKSimulator(users=users, punches=punches, host=host, port=port, serial="DEMO4370")
