(function () {
  'use strict';

  const TYPES = Object.freeze({
    stack: 'div', row: 'div', columns: 'div', card: 'section', toolbar: 'div',
    text: 'div', heading: 'h3', button: 'button', image: 'img', link: 'a',
    canvas: 'canvas', slot: 'div', list: 'div', form: 'form', fieldset: 'fieldset',
    details: 'details', summary: 'summary', pre: 'pre', badge: 'span', option: 'option',
    label: 'label', separator: 'hr'
  });
  const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const MODEL_CONSTRAINTS = ['options', 'min', 'max', 'step', 'minLength', 'maxLength', 'pattern', 'required', 'valueType', 'value'];
  const EVENTS = new Set(['click', 'input', 'change', 'submit', 'keydown', 'keyup', 'focus', 'blur', 'pointerdown', 'pointerup']);

  function readPath(data, path) {
    const parts = String(path ?? '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let value = data;
    for (const key of parts) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`Unsafe surface path: ${path}`);
      if (value == null || !Object.prototype.hasOwnProperty.call(Object(value), key)) return undefined;
      value = value[key];
    }
    return value;
  }

  function assertJson(value, path = 'config', seen = new Set()) {
    if (value === null || ['string', 'boolean'].includes(typeof value)) return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (!value || typeof value !== 'object' || seen.has(value)) throw new Error(`Surface ${path} must be JSON data.`);
    seen.add(value);
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`Unsafe surface configuration key: ${key}`);
      assertJson(value[key], `${path}.${key}`, seen);
    }
    seen.delete(value);
  }

  function createSurface(config, bindings = {}) {
    assertJson(config);
    if (!config.templates || typeof config.templates !== 'object') throw new Error('Surface templates are required.');
    const refs = Object.create(null);
    const roots = new Set();
    const listeners = new Set();
    const fieldControls = new WeakMap();
    const records = new Set();
    let sharedData = {};
    let disposed = false;
    const surface = { root: null, refs, render, update, text, setOptions, release, dispose };
    // Fragment-heavy views refresh lists without disposing the whole workbench.
    // Release only roots observed leaving the DOM; freshly rendered fragments
    // that have not been mounted yet remain usable by the controller.
    const observer = typeof MutationObserver === 'function' && document.documentElement
      ? new MutationObserver(records => {
        const removed = records.flatMap(record => Array.from(record.removedNodes));
        for (const root of roots) {
          if (!root.isConnected && removed.some(node => node === root || node.contains?.(root))) release(root);
        }
      }) : null;
    observer?.observe(document.documentElement, { childList: true, subtree: true });

    function text(key, vars = {}) {
      if (!Object.prototype.hasOwnProperty.call(config.texts || {}, key)) throw new Error(`Unknown surface text: ${key}`);
      return String(config.texts[key]).replace(/\{([\w.$[\]-]+)\}/g, (_, path) => String(readPath(vars, path) ?? ''));
    }

    function resolve(value, data) {
      if (Array.isArray(value)) return value.map(item => resolve(item, data));
      if (value === null || typeof value !== 'object') return value;
      if (Object.prototype.hasOwnProperty.call(value, '$path')) {
        const found = readPath(data, value.$path);
        return found === undefined && Object.prototype.hasOwnProperty.call(value, 'default') ? resolve(value.default, data) : found;
      }
      if (Object.prototype.hasOwnProperty.call(value, '$text')) return text(value.$text, value.vars ? resolve(value.vars, data) : data);
      if (Object.prototype.hasOwnProperty.call(value, '$not')) return !resolve(value.$not, data);
      if (Object.prototype.hasOwnProperty.call(value, '$if')) return resolve(value.$if[resolve(value.$if[0], data) ? 1 : 2], data);
      if (Object.prototype.hasOwnProperty.call(value, '$eq')) {
        const values = resolve(value.$eq, data);
        return values[0] === values[1];
      }
      if (Object.prototype.hasOwnProperty.call(value, '$and')) return value.$and.every(item => !!resolve(item, data));
      if (Object.prototype.hasOwnProperty.call(value, '$or')) return value.$or.some(item => !!resolve(item, data));
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, data)]));
    }

    function remember(key, element, localRefs) {
      if (!key) return;
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`Unsafe surface ref: ${key}`);
      localRefs[key] = element;
      refs[key] = element;
    }

    function bindEvent(element, eventName, callback) {
      element.addEventListener(eventName, callback);
      listeners.add({ element, eventName, callback });
    }

    function applyPresentation(element, node, data, localRefs, transient = false, patch = null, previousData = null) {
      if (node.ref) remember(node.ref, element, localRefs);
      if (node.id) { element.id = String(resolve(node.id, data)); remember(element.id, element, localRefs); }
      if (node.testId) { element.dataset.testid = String(resolve(node.testId, data)); remember(element.dataset.testid, element, localRefs); }
      if (node.visible !== undefined) element.hidden = !resolve(node.visible, data);
      if (node.hidden !== undefined) element.hidden = !!resolve(node.hidden, data);
      const presets = Array.isArray(node.preset) ? node.preset : (node.preset ? [node.preset] : []);
      for (const preset of presets) {
        if (!['editor', 'workspace', 'comparison', 'preview', 'stage', 'thumbnail', 'overlay', 'image', 'ghost', 'scroll', 'compact'].includes(preset)) throw new Error(`Unknown surface preset: ${preset}`);
        element.classList.add(`fwe-surface--${preset}`);
      }
      if (node.tone !== undefined) {
        const tone = resolve(node.tone, data) || '';
        if (!['muted', 'info', 'success', 'warning', 'danger', 'primary', 'default', ''].includes(tone)) throw new Error(`Unknown surface tone: ${tone}`);
        if (tone) element.dataset.tone = tone; else delete element.dataset.tone;
      }
      if (node.columns !== undefined) {
        const columns = Number(resolve(node.columns, data));
        if (![1, 2, 3, 4].includes(columns)) throw new Error('Surface columns must be between 1 and 4.');
        element.dataset.columns = String(columns);
      }
      for (const [key, source] of Object.entries(node.attrs || {})) {
        if (/^on/i.test(key) || ['style', 'class', 'className', 'innerHTML', 'outerHTML', 'srcdoc'].includes(key) || FORBIDDEN_KEYS.has(key)) throw new Error(`Unsupported surface attribute: ${key}`);
        const value = resolve(source, data);
        // Native disclosure state belongs to the user until its configured
        // condition changes. Unrelated polling must not repeatedly reopen it.
        if (patch && key === 'open' && (!touchesBinding(source, patch) || resolve(source, previousData) === value)) continue;
        if (transient && ['value', 'defaultValue'].includes(key)) continue;
        if (patch && ['value', 'defaultValue', 'checked'].includes(key) && !touchesBinding(source, patch)) continue;
        if (['href', 'src', 'action', 'formaction'].includes(key.toLowerCase()) && typeof value === 'string') {
          const prefix = value.slice(0, 160).replace(/[\u0000-\u0020]/g, '').toLowerCase();
          if (/^(javascript|vbscript):/.test(prefix) || (prefix.startsWith('data:') && !(key.toLowerCase() === 'src' && prefix.startsWith('data:image/')))) throw new Error('Unsafe surface URL.');
        }
        if (value === undefined || value === null) {
          if (typeof element[key] === 'boolean') element[key] = false;
          element.removeAttribute(key);
          continue;
        }
        if (key in element && !key.startsWith('aria-') && !key.startsWith('data-')) element[key] = value;
        else if (key.startsWith('aria-') || key.startsWith('data-')) element.setAttribute(key, String(value));
        else if (value !== false) element.setAttribute(key, value === true ? '' : String(value));
        else element.removeAttribute(key);
      }
    }

    function configure(element, node, data, localRefs, transient = false) {
      applyPresentation(element, node, data, localRefs, transient);
      const record = { element, node, data, localRefs, transient };
      records.add(record);
      for (const [eventName, actionName] of Object.entries(node.on || {})) {
        if (!EVENTS.has(eventName)) throw new Error(`Unsupported surface event: ${eventName}`);
        const action = bindings.actions?.[actionName];
        if (typeof action !== 'function') throw new Error(`Unknown surface action: ${actionName}`);
        bindEvent(element, eventName, event => {
          if (disposed) return;
          if (eventName === 'submit') event.preventDefault();
          const field = fieldControls.get(element)?.field;
          return action({ event, element, data: record.data, refs: localRefs, surface, value: field ? readInspectorControlValue(field, element) : element.value });
        });
      }
      return record;
    }

    function fieldConfig(node, data) {
      const id = typeof node.field === 'string' ? node.field : null;
      const declared = id ? config.fields?.[id] : (node.field || {});
      if (!declared) throw new Error(`Unknown surface field: ${id}`);
      const model = (declared.schemaPath ? bindings.resolveField?.(declared.schemaPath, declared) : null) || bindings.fields?.[id] || {};
      if (declared.schemaPath && !Object.keys(model).length) throw new Error(`Unknown surface model field: ${declared.schemaPath}`);
      const field = { ...model, ...resolve(declared, data) };
      for (const key of MODEL_CONSTRAINTS) if (model[key] !== undefined) field[key] = model[key];
      if (field.control) field.type = field.control;
      field.type = ({ string: 'text', boolean: 'checkbox', integer: 'number', int: 'number', bool: 'checkbox' })[field.type] || field.type;
      if (!field.type) field.type = 'text';
      if (field.options && !['select', 'reference'].includes(field.type)) throw new Error('Model enums require a select or reference field.');
      if (field.options) field.options = field.options.map(item => item && typeof item === 'object' ? item : { value: item, label: String(item) });
      return { field, model };
    }

    function makeField(node, data, localRefs) {
      if (typeof createInspectorControl !== 'function') throw new Error('FWE inspector.js is required by surface fields.');
      const { field, model } = fieldConfig(node, data);
      const bound = node.value === undefined ? (field.path ? readPath(data, field.path) : undefined) : resolve(node.value, data);
      const value = bound === undefined ? field.default : bound;
      const control = createInspectorControl({ ...field, options: field.options || [] }, value, { target: data }, data);
      fieldControls.set(control, { field, model });
      const wrapper = document.createElement('label');
      wrapper.className = `field fwe-surface-field${field.type === 'checkbox' ? ' fwe-surface-field--checkbox' : ''}`;
      if (field.label !== false && (field.label || field.path)) {
        const label = document.createElement('span');
        label.className = 'field__label';
        label.textContent = `${field.label || field.path}${field.required ? ' *' : ''}`;
        wrapper.append(label);
      }
      wrapper.append(control);
      if (field.description || field.hint) {
        const description = document.createElement('span');
        description.className = 'field__hint';
        description.textContent = field.description || field.hint;
        wrapper.append(description);
      }
      const record = configure(control, node, data, localRefs, isInspectorTransientControl(field));
      record.wrapper = wrapper; record.field = field; record.model = model;
      // HTML attributes cannot weaken constraints inherited from the model.
      const authoritative = Object.fromEntries(MODEL_CONSTRAINTS.filter(key => model[key] !== undefined).map(key => [key, model[key]]));
      for (const key of ['min', 'max', 'step', 'minLength', 'maxLength', 'pattern']) {
        if (authoritative[key] !== undefined) control[key] = String(authoritative[key]);
      }
      if (authoritative.required !== undefined) control.required = !!authoritative.required;
      if (node.visible !== undefined) wrapper.hidden = !resolve(node.visible, data);
      if (node.hidden !== undefined || node.attrs?.hidden !== undefined || field.hidden !== undefined) wrapper.hidden = !!resolve(node.hidden ?? node.attrs?.hidden ?? field.hidden, data);
      if (node.ref) remember(`${node.ref}Field`, wrapper, localRefs);
      if (typeof bindings.onChange === 'function' && !isInspectorTransientControl(field)) {
        bindEvent(control, field.commitEvent || getInspectorCommitEvent(field), event => {
          if (!disposed) bindings.onChange({ path: field.path || field.schemaPath || node.ref, value: readInspectorControlValue(field, control), event, data: record.data, element: control, field, refs: localRefs, surface });
        });
      }
      return wrapper;
    }

    function build(node, data, localRefs, depth = 0) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Surface node must be an object.');
      if (depth > 80) throw new Error('Surface template nesting is too deep.');
      if (node.type === 'template') return buildTemplate(node.template, node.data ? resolve(node.data, data) : data, localRefs, depth + 1);
      if (node.type === 'field') return makeField(node, data, localRefs);
      const tag = TYPES[node.type];
      if (!tag) throw new Error(`Unknown surface node type: ${node.type}`);
      const element = document.createElement(tag);
      element.className = `fwe-surface-${node.type}`;
      if (node.type === 'button') element.type = 'button';
      if (node.type === 'form') bindEvent(element, 'submit', event => event.preventDefault());
      let textNode;
      if (node.text !== undefined) {
        if (node.children?.length) { textNode = document.createTextNode(String(resolve(node.text, data) ?? '')); element.append(textNode); }
        else element.textContent = String(resolve(node.text, data) ?? '');
      }
      const record = configure(element, node, data, localRefs); record.textNode = textNode;
      if (node.type === 'list') {
        const items = resolve(node.items, data) || [];
        if (!Array.isArray(items)) throw new Error('Surface list items must be an array.');
        items.forEach((item, index) => {
          const rowData = { ...data, ...(item && typeof item === 'object' ? item : {}), $item: item, $index: index };
          const rowRefs = Object.create(null);
          const child = buildTemplate(node.template, rowData, rowRefs, depth + 1);
          child.refs = rowRefs;
          element.append(child);
        });
        if (!items.length && node.emptyTemplate) element.append(buildTemplate(node.emptyTemplate, data, localRefs, depth + 1));
      }
      for (const child of node.children || []) element.append(build(child, data, localRefs, depth + 1));
      return element;
    }

    function buildTemplate(id, data, localRefs, depth) {
      if (!Object.prototype.hasOwnProperty.call(config.templates, id)) throw new Error(`Unknown surface template: ${id}`);
      return build(config.templates[id], data, localRefs, depth);
    }

    function render(templateId, data = bindings.data || {}) {
      if (disposed) throw new Error('Surface has been disposed.');
      const localRefs = Object.create(null);
      const root = buildTemplate(templateId, { ...sharedData, ...data }, localRefs, 0);
      root.classList.add('fwe-surface');
      root.refs = localRefs;
      roots.add(root);
      return root;
    }

    function touchesBinding(value, patch) {
      if (!value || typeof value !== 'object') return false;
      if (value.$path !== undefined) {
        const prefix = String(value.$path).split(/[.[]/, 1)[0];
        return Object.prototype.hasOwnProperty.call(patch, prefix);
      }
      return Object.values(value).some(item => touchesBinding(item, patch));
    }

    function update(patch, subtree) {
      if (disposed) throw new Error('Surface has been disposed.');
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Surface update requires an object patch.');
      for (const key of Object.keys(patch)) if (FORBIDDEN_KEYS.has(key)) throw new Error(`Unsafe surface update key: ${key}`);
      if (!subtree) sharedData = { ...sharedData, ...patch };
      for (const record of records) {
        const { element, node, localRefs, transient, field, wrapper, model } = record;
        if (subtree && element !== subtree && !subtree.contains(element)) continue;
        const previousData = record.data;
        record.data = { ...previousData, ...patch };
        applyPresentation(element, node, record.data, localRefs, transient, patch, previousData);
        if (node.text !== undefined) {
          const value = String(resolve(node.text, record.data) ?? '');
          if (record.textNode) record.textNode.nodeValue = value; else element.textContent = value;
        }
        if (!field) continue;
        if (wrapper) {
          if (node.visible !== undefined) wrapper.hidden = !resolve(node.visible, record.data);
          if (node.hidden !== undefined || node.attrs?.hidden !== undefined || field.hidden !== undefined) wrapper.hidden = !!resolve(node.hidden ?? node.attrs?.hidden ?? field.hidden, record.data);
        }
        if (!transient && node.value !== undefined && touchesBinding(node.value, patch)) {
          const value = resolve(node.value, record.data);
          if (field.type === 'checkbox') element.checked = !!value;
          else if (field.type === 'readonly') element.textContent = String(value ?? '');
          else element.value = value ?? '';
        }
        for (const key of ['min', 'max', 'step', 'minLength', 'maxLength', 'pattern']) if (model?.[key] !== undefined) element[key] = String(model[key]);
        if (model?.required !== undefined) element.required = !!model.required;
      }
      return surface;
    }

    function setOptions(controlOrRef, rows, selected) {
      if (disposed) throw new Error('Surface has been disposed.');
      const control = typeof controlOrRef === 'string' ? refs[controlOrRef] : controlOrRef;
      const entry = fieldControls.get(control);
      if (!entry || control.tagName !== 'SELECT') throw new Error('Surface options require a surface select field.');
      const value = selected === undefined ? control.value : selected;
      const labels = new Map((rows || []).map(item => [String(item?.value ?? item), item?.label ?? String(item)]));
      const options = entry.model.options ? entry.field.options.map(item => ({ ...item, label: labels.get(String(item.value)) ?? item.label })) : rows;
      setInspectorControlOptions(control, entry.field, options, value);
    }

    function release(root) {
      if (!roots.has(root)) return;
      for (const listener of listeners) {
        if (listener.element === root || root.contains?.(listener.element)) {
          listener.element.removeEventListener(listener.eventName, listener.callback);
          listeners.delete(listener);
        }
      }
      root.querySelectorAll('input[type="password"], input[type="file"]').forEach(control => { control.value = ''; });
      for (const [key, element] of Object.entries(refs)) if (element === root || root.contains?.(element)) delete refs[key];
      for (const record of records) if (record.element === root || root.contains?.(record.element)) records.delete(record);
      roots.delete(root);
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      for (const { element, eventName, callback } of listeners) element.removeEventListener(eventName, callback);
      listeners.clear();
      for (const root of roots) {
        release(root);
        root.remove();
      }
      roots.clear();
      records.clear();
      for (const key of Object.keys(refs)) delete refs[key];
    }

    if (config.root) surface.root = render(config.root, bindings.data || {});
    return surface;
  }

  window.createFweSurface = createSurface;
})();
