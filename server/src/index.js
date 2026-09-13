import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import compression from 'compression';

import { migrate, DB_FILE } from './lib/db.js';
import { authentifier } from './middleware/auth.js';
import { router as auth } from './routes/auth.js';
import { router as catalogue } from './routes/catalogue.js';
import { router as stocks } from './routes/stocks.js';
import { router as periodes } from './routes/periodes.js';
import { router as ventes } from './routes/ventes.js';
import { router as depenses } from './routes/depenses.js';
import { router as commercial } from './routes/commercial.js';
import { router as administration } from './routes/administration.js';
import { router as tableauBord } from './routes/tableau-bord.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 4000;

migrate();

app.use(cors());
app.use(compression());
// Les images d'articles sont envoyées en data URL : la limite par défaut d'Express est trop basse.
app.use(express.json({ limit: '8mb' }));

app.get('/api/sante', (req, res) =>
  res.json({ ok: true, base: path.basename(DB_FILE), heure: new Date().toISOString() }),
);

app.use('/api/auth', auth);

// Tout le reste exige une session ouverte.
app.use('/api', authentifier);
app.use('/api', catalogue);
app.use('/api/stocks', stocks);
app.use('/api/periodes', periodes);
app.use('/api/ventes', ventes);
app.use('/api/depenses', depenses);
app.use('/api', commercial);
app.use('/api', administration);
app.use('/api/tableau-bord', tableauBord);

app.use('/api', (req, res) => res.status(404).json({ error: 'Ressource introuvable' }));

// En production, le serveur sert aussi l'interface compilée.
const dist = path.join(here, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars -- Express identifie le middleware d'erreur à ses 4 arguments.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Erreur interne du serveur' });
});

app.listen(PORT, () => {
  console.log(`Gesta+ — API démarrée sur http://localhost:${PORT}`);
  console.log(`Base de données : ${DB_FILE}`);
});
