import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve('package.json'));
const initSqlJs = require('sql.js');
const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
const databasePath = process.argv[2] ?? 'C:/Users/BRAVOC~1/AppData/Local/Temp/iadesign-bg-workflow-8172/studio.sqlite';
const database = new SQL.Database(fs.readFileSync(databasePath));
const latest = database.exec('SELECT content FROM projects ORDER BY updated_at DESC LIMIT 1')[0]?.values[0]?.[0];
if (typeof latest === 'string') {
  const project = JSON.parse(latest);
  console.log(JSON.stringify({ latestProject: project.id, nodes: project.nodes.map((node) => ({ id: node.id, name: node.name, hasOriginal: Boolean(node.originalSrc), hasMask: Boolean(node.maskSrc), src: node.src })) }));
}
