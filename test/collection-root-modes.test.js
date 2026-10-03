'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`); assert.ok(start >= 0);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}
function fixture() {
  const effects = { tabs: [], bodies: [], json: [] };
  const c = { state: { data: { title: 'Root', steps: [] }, domain: {}, workbench: { mode: 'edit' } }, effects,
    collectionTitle: {}, collectionSubtitle: {}, collectionModeTabs: {}, collectionVariantTabs: {}, collectionEditorBody: {},
    findSelectedCollectionItem: () => null, escapeHtml: value => value, getAppLabel: () => 'No item',
    renderCollectionModeTabs: (...args) => effects.tabs.push(args), renderCollectionModeBody: (...args) => effects.bodies.push(args),
    renderEmbeddedJsonEditor: (_element, context, options) => effects.json.push({ context, options }),
    render: () => {}, getByPath: (object, key) => key.split('.').reduce((value, part) => value?.[part], object) };
  vm.createContext(c);
  vm.runInContext(['getCollectionModes', 'renderCollectionEditor', 'resolveCollectionModeTarget', 'renderCollectionJsonEditor'].map(fn).join('\n'), c);
  return c;
}
const collection = { id: 'steps', path: 'steps', modes: [{ id: 'edit' }, { id: 'meta', target: 'root' }, { id: 'json', view: 'json', target: 'root' }] };

test('root form and JSON targets are the actual document, independently of the selected step', () => {
  const c = fixture(), item = { id: 'a' };
  const root = c.resolveCollectionModeTarget(collection, item, 'steps[0]', collection.modes[1]);
  assert.equal(root.target, c.state.data); assert.equal(root.path, '');
  root.target.title = 'Edited'; assert.equal(c.state.data.title, 'Edited'); assert.equal(item.title, undefined);
  c.renderCollectionJsonEditor(collection, item, 'steps[0]', collection.modes[2]);
  assert.equal(c.effects.json[0].context.target, c.state.data); assert.equal(c.effects.json[0].context.targetPath, '');
  assert.equal(c.resolveCollectionModeTarget(collection, item, 'steps[0]', {}).target, item);
});

test('empty or fully filtered collections retain root modes without inventing a selected item', () => {
  const c = fixture(); c.renderCollectionEditor(collection);
  assert.equal(c.state.workbench.mode, 'meta');
  assert.equal(c.state.selectedKey, undefined);
  assert.equal(c.effects.tabs.length, 1); assert.equal(c.effects.tabs[0][1], null);
  assert.equal(c.effects.bodies[0][1], null); assert.equal(c.effects.bodies[0][2], '');
  c.state.workbench.mode = 'json'; c.renderCollectionEditor(collection);
  assert.equal(c.state.workbench.mode, 'json');
  c.renderCollectionJsonEditor(collection, null, '', collection.modes[2]);
  assert.equal(c.effects.json[0].context.target, c.state.data);
});

test('collections without root modes keep their existing empty presentation', () => {
  const c = fixture(); c.renderCollectionEditor({ id: 'steps', modes: [{ id: 'edit' }] });
  assert.equal(c.effects.tabs.length, 0); assert.equal(c.effects.bodies.length, 0);
  assert.match(c.collectionEditorBody.innerHTML, /No item/);
});

test('item modes stay disabled until an item exists while root modes remain navigable', () => {
  const c = fixture(), buttons = [];
  c.document = { createElement: () => ({ setAttribute() {}, addEventListener(_event, callback) { this.click = callback; } }) };
  c.collectionModeTabs = { append(button) { buttons.push(button); } };
  c.canLeaveEditor = () => true; c.resetJsonDraftState = () => {};
  vm.runInContext(fn('renderCollectionModeTabs'), c);
  c.renderCollectionModeTabs(collection, null);
  assert.deepEqual(buttons.map(button => button.disabled), [true, false, false]);
  buttons[2].click(); assert.equal(c.state.workbench.mode, 'json');
  buttons.length = 0; c.renderCollectionModeTabs(collection, { id: 'a' });
  assert.ok(buttons.every(button => button.disabled === false));
});
