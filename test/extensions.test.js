const assert = require('node:assert/strict');
const test = require('node:test');

const { createFweExtensionRegistry } = require('../src/extensions');

test('extension API handlers are scoped to their registered prefix', async () => {
  const registry = createFweExtensionRegistry();
  const calls = [];
  registry.api.registerApi('/api/example', ({ url }) => {
    calls.push(url.pathname);
    return true;
  });

  assert.equal(await registry.handleApi({ url: new URL('http://localhost/api/example') }), true);
  assert.equal(await registry.handleApi({ url: new URL('http://localhost/api/example/items') }), true);
  assert.equal(await registry.handleApi({ url: new URL('http://localhost/api/examples') }), false);
  assert.deepEqual(calls, ['/api/example', '/api/example/items']);
});

test('extension API prefixes and handlers are validated', () => {
  const registry = createFweExtensionRegistry();
  assert.throws(() => registry.api.registerApi('/content', () => true), /Invalid API prefix/);
  assert.throws(() => registry.api.registerApi('/api/domains/project', () => true), /Invalid API prefix/);
  assert.throws(() => registry.api.registerApi('/api/content', null), /must be a function/);
  registry.api.registerApi('/api/content', () => true);
  assert.throws(() => registry.api.registerApi('/api/content', () => true), /already registered/);
});

test('extension API handlers prefer the most specific matching prefix', async () => {
  const registry = createFweExtensionRegistry();
  const calls = [];
  registry.api.registerApi('/api/project', () => {
    calls.push('project');
    return true;
  });
  registry.api.registerApi('/api/project/preview', () => {
    calls.push('preview');
    return false;
  });

  assert.equal(await registry.handleApi({ url: new URL('http://localhost/api/project/preview/run') }), true);
  assert.deepEqual(calls, ['preview', 'project']);
});
