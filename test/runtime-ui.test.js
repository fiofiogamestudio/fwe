'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const runtimeSource = fs.readFileSync(path.resolve(__dirname, '../public/runtime.js'), 'utf8');

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatchEvent(event) {
    event.target = this;
    (this.listeners.get(event.type) || []).forEach((listener) => listener.call(this, event));
    return true;
  }
}

class FakeElement extends FakeEventTarget {
  constructor() {
    super();
    this.attributes = new Map();
    this.children = [];
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.title = '';
  }

  attachShadow() {
    const root = new FakeElement();
    const details = new FakeElement();
    details.open = false;
    const summary = new FakeElement();
    const menu = new FakeElement();
    root.querySelector = (selector) => ({ details, summary, '.menu': menu }[selector] || null);
    this.shadowRoot = root;
    return root;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  toggleAttribute(name, force) {
    if (force) this.attributes.set(name, '');
    else this.attributes.delete(name);
  }

  contains(target) {
    return target === this;
  }

  focus() {}
}

class FakeCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

function createRuntime() {
  const registry = new Map();
  const document = new FakeEventTarget();
  document.createElement = (tagName) => {
    const Constructor = registry.get(tagName);
    return Constructor ? new Constructor() : new FakeElement();
  };
  const browserWindow = new FakeEventTarget();
  browserWindow.HTMLElement = FakeElement;
  browserWindow.CustomEvent = FakeCustomEvent;
  browserWindow.document = document;
  browserWindow.customElements = {
    define(tagName, Constructor) {
      registry.set(tagName, Constructor);
    },
    get(tagName) {
      return registry.get(tagName);
    }
  };
  vm.runInNewContext(runtimeSource, { window: browserWindow });
  return browserWindow.createFweRuntime();
}

test('generic multi-select normalizes values and emits framework change events', () => {
  const runtime = createRuntime();
  const control = runtime.ui.createMultiSelect({
    id: 'characterFilter',
    placeholder: '角色',
    items: [
      { value: 'cat', label: '胡椒', count: 3 },
      { value: 'jiao', label: '蛟', count: 1 },
      { value: 'cat', label: '重复项' }
    ],
    selected: ['cat', 'missing']
  });

  assert.equal(control.id, 'characterFilter');
  assert.deepEqual(control.items.map((item) => item.value), ['cat', 'jiao']);
  assert.deepEqual([...control.value], ['cat']);

  const changes = [];
  control.addEventListener('change', (event) => changes.push(event.detail));
  control.selectAll();
  assert.deepEqual([...control.value], ['cat', 'jiao']);
  control.clear();
  assert.deepEqual([...control.value], []);
  control.setValue(['jiao'], { emit: true, source: 'test' });

  assert.deepEqual([...control.value], ['jiao']);
  assert.deepEqual(changes.map((change) => change.source), ['select-all', 'clear', 'test']);
  assert.deepEqual([...changes.at(-1).values], ['jiao']);
});

test('collection filters resolve relational options and default selections', () => {
  const runtime = createRuntime();
  const collection = {
    filters: [{
      id: 'pool',
      label: '骰组',
      itemValue: 'id',
      options: {
        path: '_editor.dicePools.groups',
        value: 'id',
        label: 'name',
        count: 'matchedDiceCount',
        members: 'memberDiceIds',
        defaultWhen: ['starter', 'primary']
      }
    }]
  };
  const data = {
    _editor: {
      dicePools: {
        groups: [
          { id: 'starter', name: '基础骰组', starter: true, memberDiceIds: ['basic'], matchedDiceCount: 1 },
          { id: 'reward', name: '随机遭遇池', primary: true, memberDiceIds: ['reward'], matchedDiceCount: 1 },
          { id: 'other', name: '其他骰子', memberDiceIds: ['other'], matchedDiceCount: 1 }
        ]
      }
    }
  };

  const [filter] = runtime.collectionFilters.normalize(collection);
  const options = runtime.collectionFilters.resolveOptions(filter, data);
  assert.deepEqual(options.map((option) => option.label), ['基础骰组', '随机遭遇池', '其他骰子']);
  assert.deepEqual(runtime.collectionFilters.defaultSelection(filter, options), ['starter', 'reward']);
  assert.equal(runtime.collectionFilters.matches(filter, options, ['starter'], { id: 'basic' }), true);
  assert.equal(runtime.collectionFilters.matches(filter, options, ['starter'], { id: 'reward' }), false);
  assert.equal(runtime.collectionFilters.matches(filter, options, [], { id: 'basic' }), false);
  assert.deepEqual(runtime.collectionFilters.matchingValues(filter, options, { id: 'other' }), ['other']);
});

test('generic resource links delegate href construction to framework navigation', () => {
  const runtime = createRuntime();
  runtime.navigation = {
    href(target) {
      return `http://127.0.0.1/editor?collection=${target.collectionId}&item=${target.itemId}`;
    }
  };

  const link = runtime.ui.createResourceLink({
    label: '培土',
    title: '打开印刻',
    collectionId: 'imprints',
    itemId: 'rootsheng_cultivate'
  });

  assert.equal(link.textContent, '培土');
  assert.equal(link.title, '打开印刻');
  assert.equal(link.href, 'http://127.0.0.1/editor?collection=imprints&item=rootsheng_cultivate');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.className, 'fwe-resource-link');
});

test('generic resource links support accessible icon-only presentation', () => {
  const runtime = createRuntime();
  runtime.navigation = {
    href(target) {
      return `http://127.0.0.1/editor?collection=${target.collectionId}&item=${target.itemId}`;
    }
  };

  const link = runtime.ui.createResourceLink({
    label: '培土',
    title: '在新标签页打开印刻：培土',
    presentation: 'icon',
    collectionId: 'imprints',
    itemId: 'rootsheng_cultivate'
  });

  assert.equal(link.textContent, '');
  assert.equal(link.title, '在新标签页打开印刻：培土');
  assert.equal(link.attributes.get('aria-label'), '在新标签页打开印刻：培土');
  assert.equal(link.href, 'http://127.0.0.1/editor?collection=imprints&item=rootsheng_cultivate');
  assert.equal(link.target, '_blank');
  assert.equal(link.className, 'fwe-resource-link fwe-resource-link--icon');
  assert.equal(link.children.length, 1);
  assert.equal(link.children[0].className, 'fwe-resource-link__icon fwe-resource-link__icon--external-link');
  assert.equal(link.children[0].attributes.get('aria-hidden'), 'true');
});
