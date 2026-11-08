const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');

const port = Number(process.env.PORT || 4174);
const dataDirectory = process.env.DESIGN_STUDIO_DATA || path.resolve(process.cwd(), 'data');
const databaseFile = path.join(dataDirectory, 'studio.sqlite');
const app = express();
app.use(express.json({ limit: '80mb' }));

async function start() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  const db = fs.existsSync(databaseFile) ? new SQL.Database(fs.readFileSync(databaseFile)) : new SQL.Database();
  db.run('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const persist = () => fs.writeFileSync(databaseFile, Buffer.from(db.export()));
  const all = () => {
    const result = db.exec('SELECT content FROM projects ORDER BY updated_at DESC');
    return result[0] ? result[0].values.map(([content]) => JSON.parse(String(content))) : [];
  };
  app.get('/api/health', (_request, response) => response.json({ ok: true }));
  app.get('/api/projects', (_request, response) => response.json(all()));
  app.post('/api/projects', (request, response) => {
    const project = request.body;
    if (!project || typeof project.id !== 'string' || typeof project.name !== 'string' || !Array.isArray(project.nodes)) return response.status(400).json({ error: 'Invalid project data' });
    const updatedAt = new Date().toISOString();
    const saved = { ...project, updatedAt };
    const query = db.prepare('INSERT OR REPLACE INTO projects (id, name, content, updated_at) VALUES (?, ?, ?, ?)');
    query.run([saved.id, saved.name.slice(0, 180), JSON.stringify(saved), updatedAt]);
    query.free();
    persist();
    response.status(201).json(saved);
  });
  app.put('/api/projects/:id', (request, response) => {
    const project = request.body;
    if (!project || project.id !== request.params.id || typeof project.name !== 'string' || !Array.isArray(project.nodes)) return response.status(400).json({ error: 'Invalid project data' });
    const updatedAt = new Date().toISOString();
    const saved = { ...project, updatedAt };
    const query = db.prepare('INSERT OR REPLACE INTO projects (id, name, content, updated_at) VALUES (?, ?, ?, ?)');
    query.run([saved.id, saved.name.slice(0, 180), JSON.stringify(saved), updatedAt]);
    query.free();
    persist();
    response.json(saved);
  });
  app.use(express.static(path.resolve(__dirname, '../dist')));
  app.get('*path', (_request, response) => response.sendFile(path.resolve(__dirname, '../dist/index.html')));
  app.listen(port, '127.0.0.1', () => console.log(`AI Design Studio services listening on ${port}`));
}

start().catch((error) => {
  console.error('Unable to start local services', error);
  process.exit(1);
});
