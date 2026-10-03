const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const inspector = fs.readFileSync(path.join(__dirname, '../public/inspector.js'), 'utf8');
function fn(source, name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name); const rest = source.slice(start), next = rest.search(/\n(?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next);
}
function context() {
  const c = { state: { domain: { id: 'actors' }, file: { name: 'actors.json' }, selectedKey: 'actors[0]', workbench: { collectionId: 'actors', page: 0, search: 'old' }, history: { undo: [1], redo: [2] } },
    inspectorFormDisposables: new Map(), inspectorFormDisposalObserver: true, console: { error() {} },
    effects: { renders: 0, resets: 0 }, render() { c.effects.renders++; }, resetJsonDraftState() { c.effects.resets++; } };
  vm.createContext(c);
  vm.runInContext(['trackInspectorFormDisposal', 'disposeInspectorForm', 'canLeaveInspectorForms'].map(name => fn(inspector, name)).join('\n') + '\n' + fn(app, 'canLeaveEditor'), c);
  return c;
}
test('connected form leave guards track synchronous busy state and release with disposal', () => {
  const c = context(), host = { isConnected: true }; let busy = true, disposed = 0;
  c.trackInspectorFormDisposal(host, () => disposed++, () => !busy);
  assert.equal(c.canLeaveEditor(), false); busy = false; assert.equal(c.canLeaveEditor(), true);
  busy = true; c.disposeInspectorForm(host); assert.equal(c.canLeaveEditor(), true); assert.equal(disposed, 1); assert.equal(c.inspectorFormDisposables.size, 0);
  c.trackInspectorFormDisposal(host, undefined, () => false); assert.equal(c.canLeaveEditor(), false);
  c.disposeInspectorForm(host); assert.equal(c.canLeaveEditor(), true, 'a guard does not require a disposer');
});
test('stale or detached forms cannot block new resources, and nonboolean guards fail closed', () => {
  const c = context(), host = { isConnected: true };
  for (const guard of [() => false, () => undefined, () => Promise.resolve(true), () => { throw new Error('guard failed'); }]) {
    c.trackInspectorFormDisposal(host, undefined, guard); assert.equal(c.canLeaveEditor(), false);
  }
  host.isConnected = false; assert.equal(c.canLeaveEditor(), true);
  host.isConnected = true; c.state.file.name = 'another.json'; assert.equal(c.canLeaveEditor(), true);
});
test('busy form blocks native selection, navigation, history and reload before any effects', async () => {
  const c = context(), host = { isConnected: true }; c.trackInspectorFormDisposal(host, undefined, () => false);
  const names = ['selectCollectionItem', 'activateWorkbenchCollection', 'changeCollectionPage', 'undoAction', 'redoAction', 'openSelectedFile', 'selectDomain', 'refreshCurrentResource', 'navigateToResource', 'createFile', 'duplicateSelection', 'deleteSelection', 'addSelectionItem', 'switchSidepanelMode', 'selectJsonPath', 'confirmDiscardChanges'];
  vm.runInContext(names.map(name => fn(app, name)).join('\n') + '\n' + fn(inspector, 'switchInspectorMode'), c);
  const before = JSON.stringify(c.state);
  for (const name of [...names, 'switchInspectorMode']) assert.equal(await c[name]({ id: 'other' }, 1), false, name);
  assert.equal(JSON.stringify(c.state), before); assert.deepEqual(c.effects, { renders: 0, resets: 0 });
  c.disposeInspectorForm(host);
  c.getCollectionItemPath = (_collection, index) => `actors[${index}]`; c.getCollectionDefaultMode = () => 'edit';
  c.selectCollectionItem({}, 1); assert.equal(c.state.selectedKey, 'actors[1]'); assert.equal(c.effects.renders, 1);
});
test('busy form restores native search input and blocks detail/grid changes', () => {
  const c = context(), host = { isConnected: true }; c.trackInspectorFormDisposal(host, undefined, () => false);
  const listeners = {};
  for (const [element, event] of [['collectionSearch', 'input'], ['collectionDetailButton', 'click'], ['collectionGridButton', 'click']]) {
    c[element] = { value: 'new', addEventListener(_event, callback) { listeners[element] = callback; } };
    const start = app.indexOf(`${element}.addEventListener('${event}',`), end = app.indexOf('\n});', start);
    assert.ok(start >= 0 && end > start); vm.runInContext(app.slice(start, end + 4), c);
  }
  for (const listener of Object.values(listeners)) listener();
  assert.equal(c.state.workbench.search, 'old'); assert.equal(c.collectionSearch.value, 'old'); assert.equal(c.state.workbench.listLayout, undefined);
});
