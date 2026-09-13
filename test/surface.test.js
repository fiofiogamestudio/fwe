'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.value = '';
    this.className = ''; this.attributes = {}; this.listeners = new Map(); this.hidden = false;
    this.classList = { add: (...names) => { this.className += ` ${names.join(' ')}`; } };
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  addEventListener(type, handler) { this.listeners.set(type, [...(this.listeners.get(type) || []), handler]); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== handler)); }
  dispatch(type) { for (const handler of this.listeners.get(type) || []) handler({ type, target: this, preventDefault() {} }); }
  querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(node => node.tagName === 'INPUT' && ['password', 'file'].includes(node.type)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
}

function runtime() {
  const context = vm.createContext({ window: {}, document: { createElement: tag => new Element(tag) }, formatValue: value => String(value) });
  for (const file of ['runtime.js', 'inspector.js', 'surface.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), context);
  return context.window.createFweRuntime();
}

test('surface configuration controls labels, layout, conditions, attributes, repeated templates and actions', () => {
  const ui = runtime().ui;
  const calls = [];
  const config = { root: 'main', texts: { count: '{name}: {total}' }, templates: {
    main: { type: 'columns', columns: 3, children: [
      { type: 'heading', ref: 'heading', text: { $text: 'count' } },
      { type: 'button', ref: 'run', text: 'Build', attrs: { disabled: { $path: 'busy' } }, on: { click: 'build' } },
      { type: 'text', ref: 'hint', text: '<img src=x>', visible: { $not: { $path: 'busy' } } },
      { type: 'list', ref: 'items', items: { $path: 'items' }, template: 'item' }
    ] }, item: { type: 'text', ref: 'name', text: { $path: 'name' } }
  } };
  const surface = ui.createSurface(config, { data: { name: 'Assets', total: 2, busy: false, items: [{ name: 'A' }, { name: 'B' }] }, actions: { build: payload => calls.push(payload.data.name) } });
  assert.equal(surface.root.dataset.columns, '3');
  assert.equal(surface.refs.heading.textContent, 'Assets: 2');
  assert.equal(surface.refs.hint.textContent, '<img src=x>');
  assert.equal(surface.refs.hint.hidden, false);
  assert.equal(surface.refs.items.children[0].refs.name.textContent, 'A');
  surface.refs.run.dispatch('click'); assert.deepEqual(calls, ['Assets']);
  config.templates.main.type = 'stack'; config.templates.main.children[1].text = 'Generate';
  const changed = ui.createSurface(config, { data: { name: 'Changed', busy: true, items: [] }, actions: { build() {} } });
  assert.match(changed.root.className, /fwe-surface-stack/); assert.equal(changed.refs.run.textContent, 'Generate'); assert.equal(changed.refs.hint.hidden, true);
});

test('surface fields share native control semantics and inherited constraints cannot drift', () => {
  const ui = runtime().ui;
  const changes = [];
  const surface = ui.createSurface({ root: 'main', templates: { main: { type: 'stack', children: [
    { type: 'field', ref: 'name', field: { schemaPath: 'name', label: 'Name', maxLength: 999 }, attrs: { maxLength: 999 }, value: { $path: 'name' } },
    { type: 'field', ref: 'quality', field: { schemaPath: 'quality', options: ['auto'] }, value: 'hd' },
    { type: 'field', ref: 'scale', field: { type: 'range', min: 0, max: 5 }, value: 2 },
    { type: 'field', ref: 'enabled', field: { type: 'checkbox' }, value: true }
  ] } } }, { data: { name: 'Bird' }, resolveField: key => key === 'name' ? { type: 'text', maxLength: 20, required: true } : { type: 'select', options: [{ value: 'hd', label: 'HD' }, { value: 'auto', label: 'Auto' }] }, onChange: change => changes.push(change) });
  assert.equal(surface.refs.name.maxLength, '20'); assert.equal(surface.refs.name.required, true);
  assert.equal(surface.refs.quality.value, 'hd'); assert.equal(surface.refs.quality.children.length, 2);
  surface.setOptions('quality', [{ value: 'fake', label: 'Bad' }, { value: 'hd', label: 'High' }]);
  assert.equal(surface.refs.quality.children.length, 2); assert.equal(surface.refs.quality.children[0].textContent, 'High');
  surface.refs.scale.value = '3'; surface.refs.scale.dispatch('change'); assert.equal(changes.at(-1).value, 3);
  surface.refs.enabled.checked = false; surface.refs.enabled.dispatch('change'); assert.equal(changes.at(-1).value, false);
});

test('password and file values never initialize from data or automatically flow into change bindings', () => {
  const changes = []; const calls = [];
  const data = { apiKey: 'must-not-render' };
  const surface = runtime().ui.createSurface({ root: 'main', templates: { main: { type: 'stack', children: [
    { type: 'field', ref: 'key', field: { type: 'password', path: 'apiKey' }, attrs: { value: 'must-not-render' }, on: { change: 'explicit' } },
    { type: 'field', ref: 'file', field: { type: 'file', accept: 'image/png' } }
  ] } } }, { data, onChange: payload => changes.push(payload), actions: { explicit: payload => calls.push(payload.value) } });
  assert.equal(surface.refs.key.value, ''); assert.equal(surface.refs.file.value, '');
  const key = surface.refs.key;
  key.value = 'temporary-secret'; key.dispatch('change'); surface.refs.file.dispatch('change');
  assert.equal(changes.length, 0); assert.deepEqual(calls, ['temporary-secret']); assert.equal(data.apiKey, 'must-not-render');
  surface.dispose(); assert.equal(key.value, ''); key.dispatch('change'); assert.equal(calls.length, 1);
});

test('rendered instances have independent references and dispose releases only their own controls', () => {
  const config = { templates: { row: { type: 'field', ref: 'name', field: { type: 'text' }, value: { $path: 'name' } } } };
  const ui = runtime().ui;
  const first = ui.createSurface(config); const second = ui.createSurface(config);
  const rowA = first.render('row', { name: 'A' }); const rowB = first.render('row', { name: 'B' });
  const rowC = second.render('row', { name: 'C' });
  assert.notEqual(rowA.refs.name, rowB.refs.name); assert.equal(rowA.refs.name.value, 'A'); assert.equal(rowB.refs.name.value, 'B');
  first.dispose(); assert.equal(rowC.refs.name.value, 'C'); assert.throws(() => first.render('row'), /disposed/);
});

test('surface rejects executable configuration, unsafe paths, arbitrary styles and action names', () => {
  const ui = runtime().ui;
  assert.throws(() => ui.createSurface({ templates: { main: { type: 'text', text: () => 'code' } } }), /JSON/);
  assert.throws(() => ui.createSurface({ root: 'main', templates: { main: { type: 'text', text: { $path: '__proto__.x' } } } }), /Unsafe/);
  assert.throws(() => ui.createSurface({ root: 'main', templates: { main: { type: 'text', attrs: { style: 'color:red' } } } }), /Unsupported/);
  assert.throws(() => ui.createSurface({ root: 'main', templates: { main: { type: 'button', on: { click: 'unknown' } } } }), /Unknown surface action/);
  assert.throws(() => ui.createSurface({ root: 'main', templates: { main: { type: 'link', attrs: { href: 'javascript:alert(1)' } } } }), /Unsafe surface URL/);
  assert.throws(() => ui.createSurface({ root: 'main', templates: { main: { type: 'link', attrs: { href: 'java\nscript:alert(1)' } } } }), /Unsafe surface URL/);
  assert.throws(() => ui.createSurface({ root: 'main', templates: { main: { type: 'link', attrs: { href: 'data:text/html,<script>alert(1)</script>' } } } }), /Unsafe surface URL/);
  assert.throws(() => ui.createSurface({ root: 'main', templates: { main: { type: 'field', field: { schemaPath: 'missing' } } } }), /Unknown surface model field/);
});

test('dynamic options preserve a selected unavailable value instead of silently overwriting it', () => {
  const surface = runtime().ui.createSurface({ root: 'main', templates: { main: { type: 'field', ref: 'asset', field: { type: 'select', options: [{ value: 'old', label: 'Old' }] }, value: 'old' } } });
  surface.setOptions('asset', [{ value: 'new', label: 'New' }]);
  assert.equal(surface.refs.asset.value, 'old'); assert.equal(surface.refs.asset.children[1].dataset.unavailable, 'true');
});

test('model paths fall back to configured defaults only for missing values', () => {
  const config = { root: 'main', templates: { main: { type: 'field', ref: 'size', field: { schemaPath: 'size', default: '1024x1024' } } } };
  const ui = runtime().ui;
  const resolveField = () => ({ type: 'select', path: 'size', options: [{ value: '1024x1024', label: 'Square' }, { value: '1536x1024', label: 'Wide' }] });
  assert.equal(ui.createSurface(config, { data: {}, resolveField }).refs.size.value, '1024x1024');
  assert.equal(ui.createSurface(config, { data: { size: '1536x1024' }, resolveField }).refs.size.value, '1536x1024');
  assert.equal(ui.createSurface(config, { data: { size: null }, resolveField }).refs.size.value, '');
});

test('in-place updates apply configured state, remove attributes and leave unrelated input values intact', () => {
  const seen = [];
  const ui = runtime().ui;
  const config = { templates: { main: { type: 'stack', children: [
    { type: 'field', ref: 'name', field: { type: 'text' }, value: { $path: 'name' } },
    { type: 'button', ref: 'run', text: { $if: [{ $path: 'busy' }, 'Working', 'Run'] }, attrs: { disabled: { $path: 'busy' }, title: { $path: 'hint' }, 'aria-busy': { $path: 'busy' } }, on: { click: 'run' } },
    { type: 'text', ref: 'status', text: { $path: 'notice' }, tone: { $path: 'tone' }, visible: { $path: 'notice' } }
  ] } } };
  const surface = ui.createSurface(config, { actions: { run: ({ data }) => seen.push(data.notice) } });
  const first = surface.render('main', { name: 'First', hint: 'Initial' });
  const second = surface.render('main', { name: 'Second', hint: 'Other' });
  first.refs.name.value = 'Typing';
  surface.update({ busy: true, notice: 'Loading', tone: 'warning', hint: null }, first);
  assert.equal(first.refs.name.value, 'Typing'); assert.equal(second.refs.name.value, 'Second');
  assert.equal(first.refs.run.textContent, 'Working'); assert.equal(first.refs.run.attributes['aria-busy'], 'true');
  assert.equal(first.refs.run.attributes.title, undefined); assert.equal(first.refs.status.dataset.tone, 'warning');
  assert.equal(second.refs.run.textContent, 'Run');
  surface.update({ busy: false, notice: '', tone: null }, first);
  assert.equal(first.refs.run.attributes.disabled, undefined); assert.equal(first.refs.run.attributes['aria-busy'], 'false');
  assert.equal(first.refs.status.hidden, true); assert.equal(first.refs.status.dataset.tone, undefined);
  surface.update({ notice: 'Latest', name: 'Explicit hydration' }, first);
  assert.equal(first.refs.name.value, 'Explicit hydration'); first.refs.run.dispatch('click'); assert.deepEqual(seen, ['Latest']);
  surface.update({ busy: true });
  const third = surface.render('main', { name: 'Third' }); assert.equal(third.refs.run.textContent, 'Working');
});

test('disclosure updates preserve user choice until a bound default condition changes', () => {
  const surface = runtime().ui.createSurface({ root: 'main', templates: { main: { type: 'details', ref: 'advanced', attrs: { open: { $path: 'needsSetup' } }, children: [{ type: 'summary', text: 'Advanced' }] } } }, { data: { needsSetup: true } });
  surface.refs.advanced.open = false;
  surface.update({ notice: 'Polling' }); assert.equal(surface.refs.advanced.open, false);
  surface.update({ needsSetup: true }); assert.equal(surface.refs.advanced.open, false);
  surface.update({ needsSetup: false }); assert.equal(surface.refs.advanced.open, false);
  surface.update({ needsSetup: true }); assert.equal(surface.refs.advanced.open, true);
});
