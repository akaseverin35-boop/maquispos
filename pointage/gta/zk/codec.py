"""Encodage/décodage des trames ZKTeco, partagé par le client et le simulateur."""

from __future__ import annotations

import struct
from datetime import datetime

from gta.zk.const import TCP_MAGIC_1, TCP_MAGIC_2, USHRT_MAX


def checksum(payload: bytes) -> int:
    """Somme de contrôle 16 bits du protocole (complément à un)."""
    total = 0
    data = payload
    if len(data) % 2:
        data = data + b"\x00"
    for (word,) in struct.iter_unpack("<H", data):
        total += word
        if total > USHRT_MAX:
            total -= USHRT_MAX
    total = ~total
    while total < 0:
        total += USHRT_MAX
    return total & 0xFFFF


def build_packet(command: int, session_id: int, reply_id: int, data: bytes = b"",
                 checksum_reply_id: int | None = None) -> bytes:
    """Construit un paquet : en-tête 8 octets (commande, checksum, session, n°) + données.

    Les terminaux ZKTeco et le SDK officiel calculent la somme de contrôle avec le n° de
    paquet *précédent* (`checksum_reply_id`) : on reproduit ce comportement à l'identique
    côté client, c'est lui qui est éprouvé sur le matériel réel.
    """
    chk_id = reply_id if checksum_reply_id is None else checksum_reply_id
    raw = struct.pack("<4H", command, 0, session_id, chk_id) + data
    chk = checksum(raw)
    return struct.pack("<4H", command, chk, session_id, reply_id) + data


def parse_packet(packet: bytes) -> tuple[int, int, int, int, bytes]:
    """Retourne (commande, checksum, session, n° de réponse, données)."""
    if len(packet) < 8:
        raise ValueError("paquet trop court")
    command, chk, session_id, reply_id = struct.unpack("<4H", packet[:8])
    return command, chk, session_id, reply_id, packet[8:]


def tcp_wrap(packet: bytes) -> bytes:
    return struct.pack("<HHI", TCP_MAGIC_1, TCP_MAGIC_2, len(packet)) + packet


def tcp_header(header: bytes) -> int:
    """Valide l'en-tête TCP de 8 octets et retourne la longueur du paquet qui suit."""
    magic1, magic2, length = struct.unpack("<HHI", header)
    if magic1 != TCP_MAGIC_1 or magic2 != TCP_MAGIC_2:
        raise ValueError("en-tête TCP ZK invalide")
    return length


def make_commkey(key: int, session_id: int, ticks: int = 50) -> bytes:
    """Clé de communication (mot de passe « Comm Key » de la pointeuse)."""
    key = int(key)
    k = 0
    for i in range(32):
        k = (k << 1 | 1) if key & (1 << i) else (k << 1)
    k = (k + int(session_id)) & 0xFFFFFFFF
    b = struct.pack("<I", k)
    b = bytes((b[0] ^ ord("Z"), b[1] ^ ord("K"), b[2] ^ ord("S"), b[3] ^ ord("O")))
    h0, h1 = struct.unpack("<HH", b)
    b = struct.pack("<HH", h1, h0)
    t = 0xFF & ticks
    return bytes((b[0] ^ t, b[1] ^ t, t, b[3] ^ t))


def decode_time(value: int) -> datetime:
    """Horodatage compressé sur 32 bits utilisé dans les journaux de pointage."""
    second = value % 60
    value //= 60
    minute = value % 60
    value //= 60
    hour = value % 24
    value //= 24
    day = value % 31 + 1
    value //= 31
    month = value % 12 + 1
    value //= 12
    year = value + 2000
    return datetime(year, month, day, hour, minute, second)


def encode_time(t: datetime) -> int:
    return (
        ((t.year % 100) * 12 * 31 + (t.month - 1) * 31 + t.day - 1) * 86400
        + (t.hour * 60 + t.minute) * 60
        + t.second
    )


def decode_time_hex(b: bytes) -> datetime:
    """Horodatage sur 6 octets (année-2000, mois, jour, h, min, s) des événements temps réel."""
    return datetime(b[0] + 2000, b[1], b[2], b[3], b[4], b[5])


def encode_time_hex(t: datetime) -> bytes:
    return bytes((t.year - 2000, t.month, t.day, t.hour, t.minute, t.second))


def cstr(raw: bytes) -> str:
    """Chaîne C terminée par un zéro, encodage variable selon les firmwares."""
    raw = raw.split(b"\x00", 1)[0]
    for enc in ("utf-8", "latin-1"):
        try:
            return raw.decode(enc).strip()
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", "replace").strip()
