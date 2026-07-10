const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { listFiles, loadAppConfig, readDomainFile, writeDomainFile } = require('../src/server');

test('built-in folder-json source lists, reads, and writes inside its workspace', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-server-test-'));
  const workspace = path.join(root, 'workspace');
  const dataDir = path.join(workspace, 'items');
  fs.mkdirSync(dataDir, { recursive: true });
  writeJson(path.join(dataDir, 'items.json'), { items: [{ id: 1, name: 'One' }] });
  writeJson(path.join(root, 'domain.fwe.json'), {
    id: 'items',
    kind: 'table',
    title: 'Items',
    source: { type: 'folder-json', path: 'items' },
    model: { type: 'table', rows: 'items', rowId: 'id' },
    columns: ['id', 'name']
  });
  writeJson(path.join(root, 'app.fwe.json'), {
    id: 'test-app',
    title: 'Test',
    workspace: './workspace',
    domains: ['./domain.fwe.json']
  });
  const previous = process.cwd();
  process.chdir(root);
  t.after(() => {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const app = loadAppConfig('app.fwe.json');
  const domain = app.domains[0];
  assert.deepEqual(listFiles(app, domain).map((file) => file.name), ['items.json']);
  assert.equal(readDomainFile(app, domain, 'items.json').data.items[0].name, 'One');

  writeDomainFile(app, domain, 'items.json', { data: { items: [{ id: 1, name: 'Changed' }] } });
  assert.equal(readJson(path.join(dataDir, 'items.json')).items[0].name, 'Changed');
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
