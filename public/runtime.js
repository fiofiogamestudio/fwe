(function () {
  'use strict';

  function normalizeRegistration(value) {
    return typeof value === 'function' ? { render: value } : value;
  }

  function createRegistry(runtime) {
    const entries = new Map();
    return {
      register(id, value = {}) {
        const key = String(id || '').trim();
        if (!key) {
          throw new Error('Registry id is empty.');
        }
        const entry = value && typeof value === 'object' && !Array.isArray(value)
          ? { ...value, id: key }
          : { id: key, value };
        entries.set(key, entry);
        return runtime;
      },
      get(id) {
        return entries.get(String(id || '').trim()) || null;
      },
      all() {
        return [...entries.values()];
      },
      has(id) {
        return entries.has(String(id || '').trim());
      }
    };
  }

  function normalizeWorkbenchLayoutId(value) {
    const key = String(value || '').trim().toLowerCase();
    if (['panels', 'panel', 'sidepanel', 'sidepanel-editor', 'adventure-editor', 'sidebar-editor'].includes(key)) {
      return 'panels';
    }
    if (['', 'catalog', 'browser', 'browser-editor', 'content-browser', 'collection-browser', 'workbench'].includes(key)) {
      return 'catalog';
    }
    return key;
  }

  const MULTI_SELECT_TAG = 'fwe-multi-select';
  const MULTI_SELECT_OPEN_EVENT = 'fwe:multi-select-opened';

  function normalizeMultiSelectValues(value) {
    const source = value instanceof Set
      ? [...value]
      : (Array.isArray(value) ? value : []);
    return [...new Set(source.map((item) => String(item ?? '').trim()).filter(Boolean))];
  }

  function normalizeMultiSelectItems(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const normalizedValue = String(item.value ?? '').trim();
        return {
          value: normalizedValue,
          label: String(item.label ?? normalizedValue),
          group: String(item.group ?? '').trim(),
          count: item.count,
          disabled: item.disabled === true
        };
      })
      .filter((item) => {
        if (!item.value || seen.has(item.value)) return false;
        seen.add(item.value);
        return true;
      });
  }

  function ensureMultiSelectElement() {
    if (!window.customElements || !window.HTMLElement || !window.document) {
      throw new Error('FWE multi-select requires a browser DOM.');
    }
    if (window.customElements.get(MULTI_SELECT_TAG)) {
      return;
    }

    class FweMultiSelectElement extends window.HTMLElement {
      constructor() {
        super();
        this._items = [];
        this._selected = new Set();
        this._config = {
          placeholder: 'Select',
          selectAllLabel: 'Select all',
          clearLabel: 'Clear',
          emptyText: 'No options',
          showActions: true,
          formatSummary: null
        };
        this._connected = false;
        this._onDocumentPointerDown = this._onDocumentPointerDown.bind(this);
        this._onOtherControlOpened = this._onOtherControlOpened.bind(this);

        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = `
          <style>
            :host {
              position: relative;
              display: inline-block;
              flex: 0 0 var(--fwe-multi-select-width, 150px);
              inline-size: var(--fwe-multi-select-width, 150px);
              min-inline-size: 0;
              color: var(--text, #213043);
              font: inherit;
            }
            :host([hidden]) { display: none; }
            * { box-sizing: border-box; }
            details { position: relative; inline-size: 100%; }
            summary {
              min-block-size: var(--fwe-control-height, var(--control-height, 34px));
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 8px;
              padding: var(--fwe-control-padding, 7px 10px);
              border: 1px solid var(--control-border, var(--line-strong, #4a5a70));
              background: var(--panel, #fff);
              color: var(--text, #213043);
              cursor: pointer;
              list-style: none;
              white-space: nowrap;
            }
            summary::-webkit-details-marker { display: none; }
            summary::after {
              content: '';
              inline-size: 0;
              block-size: 0;
              border-inline: 4px solid transparent;
              border-block-start: 6px solid var(--muted, #66758b);
              flex: 0 0 auto;
            }
            details[open] > summary {
              border-color: var(--accent, #516e9e);
              outline: 2px solid color-mix(in srgb, var(--accent, #516e9e) 24%, transparent);
            }
            :host([disabled]) summary {
              cursor: default;
              opacity: 0.5;
            }
            .menu {
              position: absolute;
              z-index: 100;
              inset-block-start: calc(100% + 4px);
              inset-inline-end: 0;
              inline-size: var(--fwe-multi-select-menu-width, 250px);
              max-block-size: var(--fwe-multi-select-menu-max-height, 360px);
              overflow: auto;
              padding: 8px;
              border: 1px solid var(--line-strong, #4a5a70);
              background: var(--panel, #fff);
              box-shadow: 0 8px 20px rgb(33 48 67 / 18%);
            }
            .actions {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 4px;
              padding-block-end: 8px;
              border-block-end: 1px solid var(--line, #c4cfdd);
            }
            button {
              min-inline-size: 0;
              min-block-size: 30px;
              padding: 4px 8px;
              border: 1px solid var(--button-border, var(--line-strong, #4a5a70));
              border-radius: 0;
              background: var(--button-bg, #e8eef7);
              color: var(--button-text, var(--text, #213043));
              font: inherit;
              font-weight: 700;
              cursor: pointer;
            }
            button:hover { background: var(--button-bg-hover, #dce7f5); }
            .heading {
              padding: 8px 4px 4px;
              color: var(--muted, #66758b);
              font-size: 12px;
              font-weight: 700;
            }
            .option {
              min-inline-size: 0;
              display: grid;
              grid-template-columns: 18px minmax(0, 1fr) auto;
              align-items: center;
              gap: 8px;
              min-block-size: 34px;
              padding: 5px 4px;
              cursor: pointer;
            }
            .option:hover { background: #f1f5f9; }
            .option:has(input:disabled) { cursor: default; opacity: 0.55; }
            input {
              inline-size: 16px;
              min-inline-size: 16px;
              block-size: 16px;
              min-block-size: 16px;
              margin: 0;
              padding: 0;
            }
            .option-label { min-inline-size: 0; overflow-wrap: anywhere; }
            .option-count { color: var(--muted, #66758b); font-size: 12px; }
            .empty {
              padding: 12px 4px 4px;
              color: var(--muted, #66758b);
              text-align: center;
            }
          </style>
          <details>
            <summary></summary>
            <div class="menu"></div>
          </details>
        `;
        this._details = root.querySelector('details');
        this._summary = root.querySelector('summary');
        this._menu = root.querySelector('.menu');
        this._details.addEventListener('toggle', () => this._handleToggle());
        this._summary.addEventListener('click', (event) => {
          if (this.disabled) event.preventDefault();
        });
        root.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape' || !this.open) return;
          event.preventDefault();
          this.close();
          this._summary.focus();
        });
        this._render();
      }

      connectedCallback() {
        if (this._connected) return;
        this._connected = true;
        window.document.addEventListener('pointerdown', this._onDocumentPointerDown, true);
        window.addEventListener(MULTI_SELECT_OPEN_EVENT, this._onOtherControlOpened);
      }

      disconnectedCallback() {
        if (!this._connected) return;
        this._connected = false;
        window.document.removeEventListener('pointerdown', this._onDocumentPointerDown, true);
        window.removeEventListener(MULTI_SELECT_OPEN_EVENT, this._onOtherControlOpened);
      }

      configure(options = {}) {
        if ('items' in options) this._items = normalizeMultiSelectItems(options.items);
        if ('selected' in options) this._selected = new Set(normalizeMultiSelectValues(options.selected));
        ['placeholder', 'selectAllLabel', 'clearLabel', 'emptyText'].forEach((key) => {
          if (key in options) this._config[key] = String(options[key] ?? '');
        });
        if ('showActions' in options) this._config.showActions = options.showActions !== false;
        if ('formatSummary' in options) {
          this._config.formatSummary = typeof options.formatSummary === 'function'
            ? options.formatSummary
            : null;
        }
        if ('disabled' in options) this.disabled = options.disabled === true;
        this._removeUnavailableValues();
        this._render();
        return this;
      }

      get items() {
        return this._items.map((item) => ({ ...item }));
      }

      get value() {
        return this._items
          .filter((item) => this._selected.has(item.value))
          .map((item) => item.value);
      }

      set value(values) {
        this.setValue(values);
      }

      get open() {
        return this._details.open;
      }

      set open(value) {
        this._details.open = value === true && !this.disabled;
      }

      get disabled() {
        return this.hasAttribute('disabled');
      }

      set disabled(value) {
        this.toggleAttribute('disabled', value === true);
        this._summary.setAttribute('aria-disabled', value === true ? 'true' : 'false');
        if (value === true) this.close();
      }

      setValue(values, options = {}) {
        this._selected = new Set(normalizeMultiSelectValues(values));
        this._removeUnavailableValues();
        this._render();
        if (options.emit === true) {
          this._emitChange(options.source || 'api', options.changedValue || '', options.checked);
        }
        return this;
      }

      selectAll(options = {}) {
        const values = this._items
          .filter((item) => !item.disabled || this._selected.has(item.value))
          .map((item) => item.value);
        return this.setValue(values, { emit: options.emit !== false, source: 'select-all' });
      }

      clear(options = {}) {
        const disabledValues = this._items
          .filter((item) => item.disabled && this._selected.has(item.value))
          .map((item) => item.value);
        return this.setValue(disabledValues, { emit: options.emit !== false, source: 'clear' });
      }

      close() {
        this._details.open = false;
      }

      _removeUnavailableValues() {
        const available = new Set(this._items.map((item) => item.value));
        this._selected = new Set([...this._selected].filter((value) => available.has(value)));
      }

      _render() {
        const selectedItems = this._items.filter((item) => this._selected.has(item.value));
        const summaryContext = {
          placeholder: this._config.placeholder,
          selectedItems: selectedItems.map((item) => ({ ...item })),
          selectedValues: selectedItems.map((item) => item.value)
        };
        this._summary.textContent = this._formatSummary(summaryContext);
        this._summary.title = selectedItems.map((item) => item.label).join(', ') || this._config.placeholder;
        this._summary.setAttribute('aria-label', this._config.placeholder);
        this._summary.setAttribute('aria-haspopup', 'true');
        this._summary.setAttribute('aria-disabled', this.disabled ? 'true' : 'false');
        this._menu.setAttribute('role', 'group');
        this._menu.replaceChildren();

        if (this._config.showActions) {
          const actions = window.document.createElement('div');
          actions.className = 'actions';
          const selectAll = window.document.createElement('button');
          selectAll.type = 'button';
          selectAll.textContent = this._config.selectAllLabel;
          selectAll.addEventListener('click', () => this.selectAll());
          const clear = window.document.createElement('button');
          clear.type = 'button';
          clear.textContent = this._config.clearLabel;
          clear.addEventListener('click', () => this.clear());
          actions.append(selectAll, clear);
          this._menu.append(actions);
        }

        if (!this._items.length) {
          const empty = window.document.createElement('div');
          empty.className = 'empty';
          empty.textContent = this._config.emptyText;
          this._menu.append(empty);
          return;
        }

        let currentGroup = null;
        this._items.forEach((item) => {
          if (!item.group) currentGroup = null;
          if (item.group && item.group !== currentGroup) {
            currentGroup = item.group;
            const heading = window.document.createElement('div');
            heading.className = 'heading';
            heading.textContent = item.group;
            this._menu.append(heading);
          }
          const label = window.document.createElement('label');
          label.className = 'option';
          const input = window.document.createElement('input');
          input.type = 'checkbox';
          input.value = item.value;
          input.checked = this._selected.has(item.value);
          input.disabled = item.disabled;
          input.addEventListener('change', () => {
            if (input.checked) this._selected.add(item.value);
            else this._selected.delete(item.value);
            this._render();
            this._emitChange('option', item.value, input.checked);
          });
          const text = window.document.createElement('span');
          text.className = 'option-label';
          text.textContent = item.label;
          label.append(input, text);
          if (item.count !== undefined && item.count !== null) {
            const count = window.document.createElement('span');
            count.className = 'option-count';
            count.textContent = String(item.count);
            label.append(count);
          }
          this._menu.append(label);
        });
      }

      _formatSummary(context) {
        if (this._config.formatSummary) {
          return String(this._config.formatSummary(context) ?? '');
        }
        if (!context.selectedItems.length) return `${context.placeholder} 0`;
        if (context.selectedItems.length === 1) return context.selectedItems[0].label;
        return `${context.placeholder} ${context.selectedItems.length}`;
      }

      _emitChange(source, changedValue = '', checked = undefined) {
        this.dispatchEvent(new window.CustomEvent('change', {
          bubbles: true,
          detail: {
            values: this.value,
            source,
            changedValue,
            checked
          }
        }));
      }

      _handleToggle() {
        if (!this.open) return;
        if (this.disabled) {
          this.close();
          return;
        }
        window.dispatchEvent(new window.CustomEvent(MULTI_SELECT_OPEN_EVENT, {
          detail: { control: this }
        }));
      }

      _onDocumentPointerDown(event) {
        if (!this.open) return;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (path.includes(this) || this.contains(event.target)) return;
        this.close();
      }

      _onOtherControlOpened(event) {
        if (event.detail?.control !== this) this.close();
      }
    }

    window.customElements.define(MULTI_SELECT_TAG, FweMultiSelectElement);
  }

  function createMultiSelect(options = {}) {
    ensureMultiSelectElement();
    const control = window.document.createElement(MULTI_SELECT_TAG);
    if (options.id) control.id = String(options.id);
    control.configure(options);
    return control;
  }

  function createResourceLink(runtime, options = {}) {
    const link = window.document.createElement('a');
    const navigation = options.navigation && typeof options.navigation === 'object'
      ? options.navigation
      : options;
    const label = options.label ?? options.text ?? navigation.itemId ?? navigation.fileName ?? '';
    const href = options.href || runtime.navigation?.href?.(navigation) || '';
    const presentation = options.presentation === 'icon' ? 'icon' : 'text';
    link.className = [
      'fwe-resource-link',
      presentation === 'icon' ? 'fwe-resource-link--icon' : '',
      options.className
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ');
    if (presentation === 'icon') {
      const accessibleLabel = String(options.ariaLabel || options.title || label || 'Open resource');
      const icon = window.document.createElement('span');
      icon.className = 'fwe-resource-link__icon fwe-resource-link__icon--external-link';
      icon.setAttribute('aria-hidden', 'true');
      link.setAttribute('aria-label', accessibleLabel);
      link.title = String(options.title || accessibleLabel);
      link.append(icon);
    } else {
      link.textContent = String(label);
      if (options.title) link.title = String(options.title);
    }
    if (href) {
      link.href = href;
      link.target = options.target || '_blank';
      if (link.target === '_blank') link.rel = 'noopener noreferrer';
    } else {
      link.setAttribute('aria-disabled', 'true');
    }
    return link;
  }

  function installBrowserCompatibilityAliases(runtime) {
    runtime.registerRenderer = runtime.registerView;
    runtime.renderer = runtime.registerRenderer;
    runtime.getRenderer = runtime.getView;
    runtime.registerWidget = runtime.registerForm;
    runtime.widget = runtime.registerWidget;
    runtime.getWidget = runtime.getForm;
  }

  function createFweRuntime(options = {}) {
    const runtime = {};
    const viewRegistry = createRegistry(runtime);
    const formRegistry = createRegistry(runtime);
    const slotRegistry = createRegistry(runtime);
    const workbenchLayoutRegistry = createRegistry(runtime);

    Object.assign(runtime, {
      registerView: (id, view) => viewRegistry.register(id, normalizeRegistration(view)),
      view: (id, view) => viewRegistry.register(id, normalizeRegistration(view)),
      getView: (id) => viewRegistry.get(id),
      registerForm: (id, form) => formRegistry.register(id, normalizeRegistration(form)),
      form: (id, form) => formRegistry.register(id, normalizeRegistration(form)),
      getForm: (id) => formRegistry.get(id),
      registerSlot: (id, slot) => slotRegistry.register(id, slot),
      slot: (id, slot) => slotRegistry.register(id, slot),
      getSlot: (id) => slotRegistry.get(id),
      registerWorkbenchLayout: (id, layout) => workbenchLayoutRegistry.register(id, normalizeRegistration(layout)),
      workbenchLayout: (id, layout) => workbenchLayoutRegistry.register(id, normalizeRegistration(layout)),
      getWorkbenchLayout: (id) => workbenchLayoutRegistry.get(id),
      normalizeWorkbenchLayoutId: options.normalizeWorkbenchLayoutId || normalizeWorkbenchLayoutId,
      ui: {
        createMultiSelect,
        createResourceLink: (linkOptions) => createResourceLink(runtime, linkOptions)
      },
      context: typeof options.context === 'function' ? options.context : () => null,
      registries: {
        viewRegistry,
        formRegistry,
        slotRegistry,
        workbenchLayoutRegistry
      }
    });

    installBrowserCompatibilityAliases(runtime);
    return runtime;
  }

  window.createFweRuntime = createFweRuntime;
}());
