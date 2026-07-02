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
