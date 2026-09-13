const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadAppConfig, loadDomainConfig } = require('../src/server');

test('domain overlays retain compiled fields and validation and track inherited files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-overlay-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'config'));
  const schema = 'id overlay\nsource "single-json:items.json"\ndata Items {\n name?: string @length(min=2, max=30)\n}\n';
  fs.writeFileSync(path.join(root, 'config', 'model.fwe'), schema);
  fs.writeFileSync(path.join(root, 'config', 'domain.json'), JSON.stringify({ extends: './model.fwe', actions: { save: false }, workbench: { editor: { configs: { sample: './sample.ui.json' } } } }));
  const ref = { extends: './config/domain.json', title: 'Configured title' };
  const domain = loadDomainConfig(ref, root);
  assert.equal(domain.title, 'Configured title');
  assert.equal(domain.schema.language, 'fwe');
  assert.equal(domain.actions.save, false);
  const fields = Object.values(domain.inspector.forms).flatMap(form => form.groups.flatMap(group => group.fields));
  assert.ok(fields.some(field => field.path === 'name' && field.minLength === 2 && field.maxLength === 30));
  assert.ok(domain.validate.some(rule => rule.rule === 'length' && rule.max === 30));
  const appPath = path.join(root, 'fwe.app.json');
  fs.writeFileSync(appPath, JSON.stringify({ id: 'overlay', workspace: '.', domains: [ref] }));
  const before = loadAppConfig(appPath).launchRevision;
  fs.writeFileSync(path.join(root, 'config', 'model.fwe'), schema.replace('max=30', 'max=31'));
  const after = loadAppConfig(appPath).launchRevision;
  assert.notEqual(before, after);
  fs.writeFileSync(path.join(root, 'sample.ui.json'), '{}');
  assert.notEqual(loadAppConfig(appPath).launchRevision, after);
});

test('domain overlay cycles and malformed extends fail explicitly', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-overlay-cycle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'a.json'), JSON.stringify({ extends: './b.json' }));
  fs.writeFileSync(path.join(root, 'b.json'), JSON.stringify({ extends: './a.json' }));
  assert.throws(() => loadDomainConfig('./a.json', root), /Circular domain extends/);
  assert.throws(() => loadDomainConfig({ extends: [] }, root), /must be a config path/);
});
