'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeGraphLayout, createGraph } = require('../public/graph-component');

const node = (id, extra = {}) => ({ id, title: id, ...extra });
const edge = (source, target, id = `${source}-${target}`) => ({ id, source, target });
const rank = (layout, id) => layout.nodes.find((value) => value.id === id).rank;

test('DAG joins are ranked after every predecessor, including unequal-length branches', () => {
  const graph = computeGraphLayout(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id)), [
    edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('d', 'e'), edge('e', 'f'), edge('c', 'f')
  ]);
  assert.equal(rank(graph, 'a'), 0);
  assert.equal(rank(graph, 'b'), 1);
  assert.equal(rank(graph, 'c'), 1);
  assert.equal(rank(graph, 'f'), 4);
  for (const value of graph.edges) assert.ok(rank(graph, value.source) < rank(graph, value.target));
  assert.equal(graph.cycles.length, 0);
});

test('relations and invalid DAG cycles terminate, preserve joins and report cycle groups', () => {
  for (const mode of ['dag', 'relations']) {
    const graph = computeGraphLayout(['a', 'b', 'c', 'd', 'self'].map((id) => node(id)), [
      edge('a', 'b'), edge('b', 'c'), edge('c', 'b'), edge('c', 'd'), edge('self', 'self')
    ], mode);
    assert.equal(rank(graph, 'b'), rank(graph, 'c'));
    assert.ok(rank(graph, 'a') < rank(graph, 'b'));
    assert.ok(rank(graph, 'c') < rank(graph, 'd'));
    assert.deepEqual(graph.cycles.map((ids) => ids.join(',')).sort(), ['b,c', 'self']);
    assert.equal(new Set(graph.nodes.map((value) => `${value.x},${value.y}`)).size, 5);
    assert.ok(graph.edges.every((value) => value.path && Number.isFinite(value.labelX)));
    const forwards = graph.edges.find((value) => value.id === 'b-c');
    const backwards = graph.edges.find((value) => value.id === 'c-b');
    assert.notEqual(forwards.labelX, backwards.labelX, 'reverse edges have separate lanes');
    assert.notEqual(forwards.labelY, backwards.labelY, 'reverse edge labels do not overlap');
  }
});

test('layout is deterministic under reordered data and presentation-only updates', () => {
  const nodes = ['z', 'a', 'd', 'b'].map((id) => node(id));
  const edges = [edge('a', 'b'), edge('a', 'd'), edge('b', 'z'), edge('d', 'z')];
  const positions = (value) => value.nodes.map(({ id, x, y, rank }) => ({ id, x, y, rank }));
  const first = computeGraphLayout(nodes, edges);
  const second = computeGraphLayout([...nodes].reverse().map((value) => ({ ...value, title: 'new', tone: 'success' })), [...edges].reverse());
  assert.deepEqual(positions(first), positions(second));
  assert.deepEqual(first.edges.map((value) => value.path), second.edges.map((value) => value.path));
});

test('missing endpoints are reported without inventing nodes; duplicate identities fail closed', () => {
  const layout = computeGraphLayout([node('a')], [edge('a', 'missing')]);
  assert.equal(layout.edges.length, 0);
  assert.deepEqual(layout.missingEdges.map((value) => value.id), ['a-missing']);
  assert.throws(() => computeGraphLayout([node('a'), node('a')]), /duplicated/);
  assert.throws(() => computeGraphLayout([node('a')], [edge('a', 'a'), edge('a', 'a')]), /duplicated/);
  assert.throws(() => computeGraphLayout([], [], 'tree'), /Unknown/);
  assert.equal(computeGraphLayout().nodes.length, 0);
});

test('layout never writes caller data and handles long chains without recursive stack overflow', () => {
  const input = Object.freeze([Object.freeze(node('a', { badges: Object.freeze(['x']) })), Object.freeze(node('b'))]);
  const edges = Object.freeze([Object.freeze(edge('a', 'b'))]);
  const before = JSON.stringify({ input, edges });
  computeGraphLayout(input, edges);
  assert.equal(JSON.stringify({ input, edges }), before);
  const many = Array.from({ length: 5000 }, (_, index) => node(String(index).padStart(5, '0')));
  const chain = many.slice(1).map((value, index) => edge(many[index].id, value.id));
  const layout = computeGraphLayout(many, chain);
  assert.equal(rank(layout, '04999'), 4999);
});

class Element {
  constructor(document, tag) {
    this.ownerDocument = document; this.tagName = tag; this.children = []; this.parentElement = null;
    this.attributes = new Map(); this.dataset = {}; this.style = {}; this.listeners = new Map();
    this.className = ''; this.textContent = ''; this.clientWidth = 900; this.clientHeight = 500;
    this.classList = {
      contains: (name) => this.className.split(' ').includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(' ').filter((name) => !names.includes(name)).join(' '); },
      toggle: (name, enabled) => { if (enabled ?? !this.classList.contains(name)) this.classList.add(name); else this.classList.remove(name); }
    };
  }
  append(...children) { children.forEach((child) => { child.parentElement = this; this.children.push(child); }); }
  replaceChildren(...children) { this.children.forEach((child) => { child.parentElement = null; }); this.children = []; this.append(...children); }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type, extra = {}) {
    const event = { target: this, preventDefault() {}, ...extra };
    for (let current = this; current; current = current.parentElement) for (const handler of current.listeners.get(type) || []) handler(event);
  }
  contains(target) { for (let current = target; current; current = current.parentElement) if (current === this) return true; return false; }
  closest(selector) { for (let current = this; current; current = current.parentElement) if (selector === '[data-node-id]' && current.dataset.nodeId) return current; return null; }
  focus() { this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); this.parentElement = null; }
}

function fixture() {
  const observers = [];
  const document = { activeElement: null };
  const browser = new Element(document, 'window');
  browser.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  document.defaultView = browser;
  document.createElement = (tag) => new Element(document, tag);
  document.createElementNS = (_, tag) => new Element(document, tag);
  return { document, observers, host: document.createElement('div') };
}

function find(host, predicate) {
  if (predicate(host)) return host;
  for (const child of host.children) { const match = find(child, predicate); if (match) return match; }
  return null;
}
const byClass = (host, name) => find(host, (value) => value.classList.contains(name));
const byId = (host, id) => find(host, (value) => value.dataset.nodeId === id);

test('independent instances expose DOM ids, user callbacks, silent sync and upstream/downstream highlights', () => {
  const { host, document } = fixture();
  const other = document.createElement('div');
  const calls = [];
  const data = { nodes: ['a', 'b', 'c', 'isolated'].map((id) => node(id)), edges: [edge('a', 'b'), edge('b', 'c')] };
  const first = createGraph({ host, ...data, onSelect: (id) => calls.push(id) });
  const second = createGraph({ host: other, ...data, selectedId: 'a' });
  byId(host, 'b').emit('click');
  assert.deepEqual(calls, ['b']);
  assert.equal(byId(host, 'a').dataset.relation, 'upstream');
  assert.equal(byId(host, 'c').dataset.relation, 'downstream');
  assert.equal(byId(host, 'isolated').dataset.relation, 'unrelated');
  assert.equal(byId(other, 'a').dataset.relation, 'selected');
  assert.ok(find(host, (value) => value.dataset.edgeId === 'a-b').classList.contains('is-related'));
  first.select('c'); first.update({ selectedId: 'a' });
  assert.deepEqual(calls, ['b'], 'programmatic selection must not create notification loops');
  const input = JSON.stringify(data);
  byId(host, 'a').emit('click');
  assert.equal(JSON.stringify(data), input);
  first.destroy(); second.destroy();
});

test('keyboard selects, focus does not leak between instances, and invalid update is atomic', () => {
  const { host, document } = fixture();
  const other = document.createElement('div');
  const calls = [];
  const data = { nodes: [node('a'), node('b')], edges: [edge('a', 'b')] };
  const first = createGraph({ host, ...data, onSelect: (id) => calls.push(id) });
  const second = createGraph({ host: other, ...data });
  byId(host, 'a').emit('keydown', { key: 'ArrowRight' });
  assert.equal(document.activeElement.dataset.nodeId, 'b');
  assert.deepEqual(calls, ['b']);
  byId(other, 'b').focus();
  first.update({ nodes: data.nodes.map((value) => ({ ...value, tone: 'success' })) });
  assert.ok(other.contains(document.activeElement), 'updating another instance cannot steal focus');
  assert.throws(() => first.update({ nodes: [node('dup'), node('dup')] }), /duplicated/);
  assert.ok(byId(host, 'a'));
  byId(host, 'b').emit('keydown', { key: 'Escape' });
  assert.deepEqual(calls, ['b', null]);
  first.destroy(); second.destroy();
});

test('empty/update/destroy lifecycle is bounded; text is assigned as text and viewport survives data updates', () => {
  const { host, observers } = fixture();
  const sentinel = host.ownerDocument.createElement('p'); host.append(sentinel);
  const graph = createGraph({ host });
  assert.equal(byClass(host, 'fg-empty').hidden, false);
  graph.update({ nodes: [node('a', { title: '<img src=x onerror=alert(1)>', badges: ['<script>'] })] });
  assert.equal(byClass(host, 'fg-node-title').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(byClass(host, 'fg-node-title').children.length, 0);
  const viewport = byClass(host, 'fg-viewport');
  viewport.emit('wheel', { deltaY: -80, clientX: 100, clientY: 100 });
  const before = byClass(host, 'fg-world').style.transform;
  graph.update({ selectedId: 'a' });
  assert.equal(byClass(host, 'fg-world').style.transform, before);
  graph.destroy(); graph.destroy(); graph.update({ nodes: [] }); graph.select('a'); graph.fit();
  assert.deepEqual(host.children, [sentinel]);
  assert.ok(observers.every((observer) => observer.disconnected));
  assert.ok([...viewport.listeners.values()].every((listeners) => listeners.size === 0));
});
