# GTA — pointeuses biométriques, temps de travail et paie

Logiciel en **Python** (aucune dépendance obligatoire) qui **lit directement les
pointeuses biométriques** (empreinte, visage, badge, paume), calcule les temps de
travail et prépare la paie.

```
 Pointeuse ──(réseau, port 4370)──▶ ┌──────────────┐    ┌───────────────┐    ┌────────────────┐
 Pointeuse ──(ADMS / Cloud, HTTP)─▶ │  Pointages   │──▶ │ Calcul temps  │──▶ │ Paie + export  │
 Clé USB ────(attlog.dat / CSV)───▶ │  (SQLite)    │    │ retards, H.S. │    │ Excel/bulletins│
                                    └──────────────┘    └───────────────┘    └────────────────┘
```

## Pointeuses compatibles

Le protocole ZKTeco est implémenté de bout en bout (pas de DLL ni de SDK Windows) :
la grande majorité des terminaux **ZKTeco** et des marques qui embarquent leur
firmware (K40, K50, MB20, MB160, MB360, iFace, UFace, SpeedFace, ProFace X, F18, F22,
X628, SilkBio, U160…).

Trois façons de récupérer les pointages :

| Mode | Quand l'utiliser | Commande |
|---|---|---|
| **Lecture directe** (TCP ou UDP, port 4370) | pointeuse sur le même réseau que le PC | `synchro`, `direct` |
| **ADMS / Serveur Cloud** (la pointeuse pousse en HTTP) | modèles récents, sites distants, 4G | `adms` |
| **Fichier** (clé USB `attlog.dat`, CSV) | pointeuse hors réseau | `importer` |

Fonctions lues sur la pointeuse : journal de pointage complet, liste des employés
inscrits, capacité, modèle, n° de série, firmware, heure (lecture et réglage),
écoute en temps réel, vidage du journal (uniquement après sauvegarde vérifiée).

## Installation

Python 3.11 ou plus récent ([python.org](https://www.python.org/downloads/), cochez
« Add to PATH » sous Windows).

```bash
cd pointage
pip install openpyxl     # facultatif : export Excel (sinon export CSV)
python -m gta init       # crée gta.toml et la base gta.db
```

## Essayer sans pointeuse

Une pointeuse simulée parle exactement le même protocole qu'un vrai terminal et
contient un mois de pointages :

```bash
python -m gta simulateur --port 4370           # dans un premier terminal
python -m gta pointeuse ajouter Démo 127.0.0.1 # dans un second
python -m gta synchro
python -m gta paie --export paie.xlsx
```

## Brancher une vraie pointeuse

1. Sur la pointeuse : **Menu → Communication → Ethernet** : notez l'adresse IP
   (ex. `192.168.1.201`), donnez-lui une IP fixe du réseau du PC.
2. **Menu → Communication → Connexion PC** : notez la **Comm Key** (0 par défaut).
3. Sur le PC :

```bash
python -m gta pointeuse ajouter Accueil 192.168.1.201 --mdp 0
python -m gta pointeuse tester 1        # modèle, n° de série, nb d'employés, heure
python -m gta pointeuse heure 1 --regler
python -m gta synchro                   # relève les pointages et importe les employés
```

Le **matricule** de chaque employé dans le logiciel est le **n° d'utilisateur saisi
dans la pointeuse** (PIN). Les employés inscrits sur la pointeuse sont importés
automatiquement à la première synchro ; complétez ensuite leurs salaires.

Anciens modèles qui ne répondent pas en TCP : ajoutez `--udp`.

### Mode ADMS (la pointeuse envoie elle-même ses pointages)

Sur la pointeuse : **Menu → Communication → Serveur Cloud (ADMS)** : adresse = IP du PC,
port = 8081, HTTPS désactivé. Puis sur le PC :

```bash
python -m gta adms --port 8081
```

La pointeuse est enregistrée automatiquement par son n° de série dès son premier envoi.
Ouvrez le port 8081 dans le pare-feu du PC.

### Service permanent

```bash
python -m gta direct --adms 8081
```

écoute toutes les pointeuses en temps réel, relance la connexion en cas de coupure et
refait un relevé complet à chaque reconnexion (rien n'est perdu pendant une coupure
de courant ou de réseau : la pointeuse garde ses pointages en mémoire).
Démarrage automatique : `gta-service.bat` (Windows) ou `gta.service` (Linux/systemd).

## Paramétrage

```bash
# Employés : salaire mensuel, horaire (taux/heure) ou journalier (taux/jour)
python -m gta employe modifier 101 --salaire 250000 --transport 30000 --embauche 2026-01-15
python -m gta employe modifier 102 --type horaire --salaire 1500
python -m gta employe liste

# Horaires (le n°1 « 8h-17h, samedi 8h-12h » existe par défaut)
python -m gta horaire ajouter "Équipe de nuit" 22:00 06:00 --pause 0 --jours 1,2,3,4,5,6
python -m gta employe modifier 105 --horaire 2

# Jours fériés, congés, corrections
python -m gta ferie charger 2026
python -m gta ferie ajouter 2026-05-27 "Tabaski"
python -m gta absence ajouter 104 2026-11-10 2026-11-21 conge
python -m gta pointage ajouter 103 "2026-11-05 17:00" --commentaire "oubli de pointage"
```

Les règles de calcul (durée légale, tranches d'heures supplémentaires, nuit,
dimanche/férié, cotisations, barème d'impôt) sont dans **`gta.toml`**.

## Utilisation mensuelle

```bash
python -m gta synchro
python -m gta rapport --mois 2026-11                 # feuille de présence jour par jour
python -m gta paie --mois 2026-11 --export paie-2026-11.xlsx
python -m gta bulletin 101 --mois 2026-11
```

Le classeur Excel contient la synthèse de la paie, le détail de chaque journée (les
absences et anomalies surlignées) et un bulletin par employé.

## Règles de calcul

- **Journée de travail** : un pointage est rattaché à la journée qui commence 4 h avant
  l'heure d'embauche ; un poste 22h-6h reste donc sur une seule journée.
- **Doublons** : deux passages à moins de 2 min comptent pour un.
- **Entrées/sorties** : appariées dans l'ordre (1er = entrée, 2e = sortie…). Si vos
  employés appuient sur les touches Entrée/Sortie, mettez `utiliser_etat_pointeuse = true`.
  Un nombre impair de pointages est signalé comme **anomalie**, sans heures inventées.
- **Pause** : si l'employé ne pointe qu'en arrivant et en partant, la pause de
  l'horaire est retirée au milieu du poste (12h-13h pour un 8h-17h).
- **Retard / départ anticipé** : au-delà de la tolérance de l'horaire, compté en entier.
- **Heures supplémentaires** : par semaine (lundi-dimanche) au-delà de 40 h,
  +15 % de la 41e à la 46e heure, +50 % au-delà, +75 % la nuit (21h-5h).
- **Dimanche et jours fériés** : +75 %, +100 % la nuit.
- **Absence** : jour prévu sans pointage ni congé saisi = absence injustifiée,
  retenue sur le salaire mensuel au taux horaire (salaire / 173,33 h).
- **Embauche en cours de mois** : salaire de base proratisé.

Ces valeurs par défaut suivent le Code du travail ivoirien et se modifient dans
`gta.toml`.

## À savoir

- **Cotisations et impôt** : la CNPS (6,3 % part salariale) est préremplie ; le barème
  ITS est fourni mais **désactivé**. Faites valider ces taux par votre comptable avant la
  première paie réelle : ils changent avec les lois de finances.
- Les fêtes musulmanes sont fixées chaque année par décret : ajoutez-les à la main.
- Les gabarits biométriques (empreintes, visages) ne sont pas copiés : ils restent dans
  la pointeuse, seul le résultat du pointage est utilisé.
- Les terminaux d'autres familles (Suprema, Hikvision ISAPI, Anviz natif) utilisent
  d'autres protocoles : passez par leur export CSV en attendant un connecteur dédié.
- Le protocole a été validé contre la pointeuse simulée et la trame de référence du SDK
  ZKTeco ; faites un premier `pointeuse tester` sur votre modèle avant de vous y fier.

## Tests

```bash
python -m unittest discover -s tests -t .
```

## Organisation du code

| Fichier | Rôle |
|---|---|
| `gta/zk/client.py` | protocole ZKTeco : connexion, Comm Key, lecture, temps réel |
| `gta/zk/simulator.py` | pointeuse simulée (tests, démonstration) |
| `gta/adms.py` | serveur ADMS/iClock (pointeuses en mode Cloud) |
| `gta/importers.py` | import `attlog.dat` (clé USB) et CSV |
| `gta/sync.py` | relevé des pointeuses, service temps réel avec reconnexion |
| `gta/db.py` | base SQLite |
| `gta/attendance.py` | calcul des journées et ventilation des heures |
| `gta/payroll.py` | calcul de la paie |
| `gta/export.py` | export Excel / CSV |
| `gta/cli.py` | commandes `python -m gta …` |
