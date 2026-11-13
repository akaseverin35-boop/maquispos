"""Constantes du protocole ZKTeco « standalone » (SDK ZKEM, port 4370)."""

USHRT_MAX = 65535

# Commandes
CMD_CONNECT = 1000
CMD_EXIT = 1001
CMD_ENABLEDEVICE = 1002
CMD_DISABLEDEVICE = 1003
CMD_RESTART = 1004
CMD_REFRESHDATA = 1013
CMD_TESTVOICE = 1017
CMD_GET_VERSION = 1100
CMD_AUTH = 1102

CMD_USERTEMP_RRQ = 9
CMD_OPTIONS_RRQ = 11
CMD_ATTLOG_RRQ = 13
CMD_CLEAR_ATTLOG = 15
CMD_GET_FREE_SIZES = 50
CMD_GET_TIME = 201
CMD_SET_TIME = 202
CMD_REG_EVENT = 500

# Transfert de gros volumes (lecture « bufferisée »)
CMD_PREPARE_DATA = 1500
CMD_DATA = 1501
CMD_FREE_DATA = 1502
CMD_DATA_WRRQ = 1503  # demande de préparation du tampon
CMD_DATA_RDY = 1504   # lecture d'un morceau du tampon

# Réponses
CMD_ACK_OK = 2000
CMD_ACK_ERROR = 2001
CMD_ACK_DATA = 2002
CMD_ACK_RETRY = 2003
CMD_ACK_REPEAT = 2004
CMD_ACK_UNAUTH = 2005

# Tables pour CMD_DATA_WRRQ
FCT_ATTLOG = 1
FCT_USER = 5

# Événements temps réel
EF_ATTLOG = 1

# En-tête TCP
TCP_MAGIC_1 = 0x5050
TCP_MAGIC_2 = 0x7D82

MAX_CHUNK_TCP = 0xFFC0
MAX_CHUNK_UDP = 16 * 1024

# Etat de pointage (touche pressée sur la pointeuse)
PUNCH_STATES = {
    0: "Entrée",
    1: "Sortie",
    2: "Sortie pause",
    3: "Retour pause",
    4: "Entrée heures sup.",
    5: "Sortie heures sup.",
    255: "Non défini",
}

# Mode de vérification
VERIFY_MODES = {
    0: "Mot de passe",
    1: "Empreinte",
    2: "Badge",
    3: "Mot de passe",
    4: "Badge",
    15: "Visage",
    25: "Paume",
}

PRIVILEGES = {0: "Utilisateur", 2: "Enregistreur", 6: "Administrateur", 14: "Super admin"}
