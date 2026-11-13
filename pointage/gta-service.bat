@echo off
REM Service Windows simple : écoute permanente des pointeuses + serveur ADMS.
REM Placez un raccourci de ce fichier dans shell:startup pour un démarrage automatique.
cd /d "%~dp0"
:boucle
python -m gta direct --adms 8081
timeout /t 10 /nobreak >nul
goto boucle
