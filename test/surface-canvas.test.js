'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback); }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name) { for (const callback of [...this.listeners.get(name) || []]) callback({ type: name }); }
  count(name) { return this.listeners.get(name)?.size || 0; }
}
class Element extends Events {
  constructor(tag) {
    super(); this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.dataset = {};
    this.rect = { width: 300, height: 150 }; this.hidden = false; this.isConnected = true;
    this._width = 300; this._height = 150; this.writes = { width: 0, height: 0 }; this.classList = { add() {} };
  }
  get width() { return this._width; }
  set width(value) { this._width = value; this.writes.width++; }
  get height() { return this._height; }
  set height(value) { this._height = value; this.writes.height++; }
  getBoundingClientRect() { return this.hidden ? { width: 0, height: 0 } : { ...this.rect, height: this.style.height?.endsWith('px') ? parseFloat(this.style.height) : this.rect.height }; }
  append(child) { this.children.push(child); }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  querySelectorAll() { return []; }
  remove() { this.isConnected = false; }
  setAttribute(name, value) { this[name] = value; }
}
function fixture({ pixelRatio = 1, observe = true, media = true } = {}) {
  const resizeObservers = [], mutations = [], queries = [], window = new Events(); window.devicePixelRatio = pixelRatio;
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; resizeObservers.push(this); }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
    trigger() { if (!this.disconnected) this.callback([]); }
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; mutations.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  if (observe) window.ResizeObserver = ResizeObserver;
  if (media) window.matchMedia = query => { const result = new Events(); result.media = query; queries.push(result); return result; };
  const context = vm.createContext({ window, document: { documentElement: {}, createElement: tag => new Element(tag) }, MutationObserver });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/surface.js'), 'utf8'), context);
  const surface = window.createFweSurface({ root: 'main', templates: { main: { type: 'stack', children: [{ type: 'canvas', ref: 'canvas', attrs: { width: 300, height: 150 } }] } } });
  return { surface, window, resizeObservers, mutations, queries };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('canvas binding advertises its contract and uses CSS pixels with exact rounded DPR scale', () => {
  assert.equal(require('../src/server').SERVER_INTEGRATION_CONTRACT.surfaceCanvas, 'device-resolution-v1');
  const { surface } = fixture({ pixelRatio: 2.5 }), canvas = surface.refs.canvas; canvas.rect.width = 301.2;
  const notifications = [];
  const binding = surface.bindCanvas('canvas', { height: 112, onResize: metrics => {
    assert.equal(canvas.width, metrics.pixelWidth); assert.equal(canvas.height, metrics.pixelHeight);
    notifications.push(metrics);
  } });
  assert.deepEqual(plain(binding.metrics), { width: 301.2, height: 112, pixelWidth: 753, pixelHeight: 280, scaleX: 753 / 301.2, scaleY: 2.5, pixelRatio: 2.5 });
  assert.equal(notifications.length, 1); assert.equal(Object.isFrozen(binding.metrics), true);
  assert.deepEqual(plain(canvas.style), { display: 'block', width: '100%', height: '112px', minWidth: '0' });
  surface.dispose();
});

test('unchanged resize and surface state patches never clear a bound bitmap', () => {
  const { surface, window, resizeObservers } = fixture({ pixelRatio: 2 }), canvas = surface.refs.canvas; canvas.rect.width = 220;
  let redraws = 0; const binding = surface.bindCanvas(canvas, { height: 112, onResize: () => redraws++ });
  canvas.writes = { width: 0, height: 0 };
  binding.resize(); resizeObservers[0].trigger(); window.emit('resize'); surface.update({ unrelated: 'patch' });
  assert.deepEqual(canvas.writes, { width: 0, height: 0 }); assert.equal(redraws, 1);
  canvas.rect.width = 240; resizeObservers[0].trigger();
  assert.deepEqual(canvas.writes, { width: 1, height: 0 }); assert.equal(redraws, 2); assert.equal(binding.metrics.width, 240);
  surface.dispose();
});

test('fractional CSS size changes notify without rewriting an unchanged integer bitmap', () => {
  const { surface } = fixture(), canvas = surface.refs.canvas; canvas.rect = { width: 100.1, height: 50 };
  let redraws = 0; const binding = surface.bindCanvas(canvas, { onResize: () => redraws++ }); canvas.writes = { width: 0, height: 0 };
  canvas.rect.width = 100.2; binding.resize();
  assert.equal(binding.metrics.pixelWidth, 100); assert.equal(binding.metrics.scaleX, 100 / 100.2);
  assert.equal(redraws, 2); assert.deepEqual(canvas.writes, { width: 0, height: 0 });
  surface.dispose();
});

test('DPR media changes rearm their listener and window resize also updates resolution', () => {
  const { surface, window, queries } = fixture({ pixelRatio: 2 }); let redraws = 0;
  const binding = surface.bindCanvas('canvas', { onResize: () => redraws++ });
  const old = queries[0]; assert.equal(old.media, '(resolution: 2dppx)');
  window.devicePixelRatio = 3; old.emit('change');
  assert.equal(old.count('change'), 0); assert.equal(queries.at(-1).count('change'), 1);
  assert.equal(queries.at(-1).media, '(resolution: 3dppx)'); assert.equal(binding.metrics.pixelWidth, 900); assert.equal(redraws, 2);
  window.devicePixelRatio = 1.5; window.emit('resize');
  assert.equal(binding.metrics.pixelWidth, 450); assert.equal(queries.at(-1).media, '(resolution: 1.5dppx)'); assert.equal(redraws, 3);
  surface.dispose(); assert.equal(window.count('resize'), 0); assert.ok(queries.every(query => query.count('change') === 0));
});

test('rebind, fragment release and surface disposal clean observers and listeners exactly once', () => {
  const { surface, window, resizeObservers, queries } = fixture();
  let calls = 0; const first = surface.bindCanvas('canvas', { onResize: () => calls++ });
  const replacement = surface.bindCanvas('canvas', {}); assert.equal(resizeObservers[0].disconnected, true); assert.equal(queries[0].count('change'), 0); assert.equal(window.count('resize'), 1);
  first.dispose(); first.resize(); assert.equal(calls, 1);
  const fragment = surface.render('main'); const second = surface.bindCanvas(fragment.refs.canvas, {});
  assert.equal(window.count('resize'), 2);
  surface.release(surface.root); assert.equal(resizeObservers[1].disconnected, true); assert.equal(window.count('resize'), 1);
  replacement.resize(); surface.dispose(); surface.dispose(); second.dispose();
  assert.ok(resizeObservers.every(observer => observer.disconnected)); assert.equal(window.count('resize'), 0); assert.ok(queries.every(query => !query.count('change')));
  assert.throws(() => surface.bindCanvas(fragment.refs.canvas), /disposed/);
});

test('detached canvases release automatically while DOM moves keep bindings live', () => {
  const { surface, mutations, resizeObservers, window } = fixture(), canvas = surface.refs.canvas;
  surface.bindCanvas(canvas);
  mutations[0].callback([{ removedNodes: [surface.root] }]);
  assert.equal(resizeObservers[0].disconnected, false, 'still-connected nodes were moved, not disposed');
  canvas.isConnected = false; mutations[0].callback([{ removedNodes: [canvas] }]);
  assert.equal(resizeObservers[0].disconnected, true); assert.equal(window.count('resize'), 0);
  surface.dispose();
});

test('window fallback, hidden geometry and invalid binding options remain bounded', () => {
  const { surface, window } = fixture({ observe: false, media: false, pixelRatio: NaN }), canvas = surface.refs.canvas;
  const binding = surface.bindCanvas(canvas); assert.equal(binding.metrics.pixelRatio, 1); assert.equal(canvas.style.height, '100%');
  canvas.hidden = true; window.emit('resize');
  assert.deepEqual(plain(binding.metrics), { width: 0, height: 0, pixelWidth: 0, pixelHeight: 0, scaleX: 1, scaleY: 1, pixelRatio: 1 });
  canvas.hidden = false; canvas.rect = { width: 80, height: 40 }; window.emit('resize'); assert.equal(binding.metrics.width, 80); assert.equal(canvas.width, 80);
  for (const options of [{ height: -1 }, { height: NaN }, { height: '112' }, { onResize: true }]) assert.throws(() => surface.bindCanvas(canvas, options));
  assert.throws(() => surface.bindCanvas('missing'), /surface canvas/); assert.throws(() => surface.bindCanvas(new Element('canvas')), /surface canvas/);
  surface.dispose(); assert.equal(window.count('resize'), 0);
});

test('a failed initial redraw cleans its canvas binding before propagating the host error', () => {
  const { surface, window, resizeObservers, queries } = fixture();
  assert.throws(() => surface.bindCanvas('canvas', { onResize: () => { throw new Error('domain draw failed'); } }), /domain draw failed/);
  assert.equal(resizeObservers[0].disconnected, true); assert.equal(window.count('resize'), 0); assert.equal(queries[0].count('change'), 0);
  surface.dispose();
});
