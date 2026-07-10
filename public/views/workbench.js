(function registerWorkbenchView() {
  function resolveLayoutId(view, domain) {
    return window.fwe.normalizeWorkbenchLayoutId(
      view?.layout
      || domain?.workbench?.layout
      || domain?.workbench?.type
      || domain?.workbench?.profile
      || 'catalog'
    );
  }

  function resolveLayout(view, domain) {
    const id = resolveLayoutId(view, domain);
    return {
      id,
      view,
      domain,
      collections: resolveCollections(view, domain),
      renderer: window.fwe.getWorkbenchLayout(id)
    };
  }

  function resolveCollections(view, domain) {
    return view?.collections || domain?.workbench?.collections || [];
  }

  function buildWorkbench(layoutInfo, ctx = null) {
    const state = ctx?.selection?.workbench || {};
    const defaultState = resolveDefault(layoutInfo);
    const initialCollectionId = defaultState.collection || layoutInfo.collections[0]?.id || '';
    const collectionId = state.collectionId || initialCollectionId;
    const collection = layoutInfo.collections.find((item) => item.id === collectionId)
      || layoutInfo.collections[0]
      || null;
    return {
      id: layoutInfo.id,
      layout: layoutInfo.id,
      view: layoutInfo.view,
      domain: layoutInfo.domain,
      collections: layoutInfo.collections,
      collection,
      default: defaultState,
      state,
      getRows(target = collection) {
        return ctx && target?.path ? ctx.getArray(target.path) : [];
      }
    };
  }

  function resolveDefault(layoutInfo) {
    const view = layoutInfo.view || {};
    const workbench = layoutInfo.domain?.workbench || {};
    const viewDefault = readDefaultObject(view.default);
    const workbenchDefault = readDefaultObject(workbench.default);
    return {
      collection: viewDefault.collection
        || viewDefault.collectionId
        || view.defaultCollection
        || readDefaultScalar(view.default)
        || workbenchDefault.collection
        || workbenchDefault.collectionId
        || workbench.defaultCollection
        || readDefaultScalar(workbench.default)
        || layoutInfo.collections[0]?.id
        || '',
      list: viewDefault.list
        || viewDefault.listLayout
        || view.defaultList
        || view.defaultLayout
        || view.defaultView
        || workbenchDefault.list
        || workbenchDefault.listLayout
        || workbench.defaultList
        || workbench.defaultLayout
        || workbench.defaultView
        || 'detail',
      mode: viewDefault.mode
        || view.defaultMode
        || workbenchDefault.mode
        || workbench.defaultMode
        || 'overview'
    };
  }

  function readDefaultObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function readDefaultScalar(value) {
    return value && (typeof value !== 'object' || Array.isArray(value)) ? value : '';
  }

  function normalizeIssues(result) {
    if (result === undefined || result === null || result === true) {
      return [];
    }
    if (result === false) {
      return ['validation failed'];
    }
    if (typeof result === 'string') {
      return result ? [result] : [];
    }
    if (Array.isArray(result)) {
      return result.flatMap((item) => normalizeIssues(item)).filter(Boolean);
    }
    if (result && typeof result === 'object' && Array.isArray(result.errors)) {
      return normalizeIssues(result.errors);
    }
    if (result && typeof result === 'object' && result.message) {
      return [String(result.message)];
    }
    return [String(result)];
  }

  window.fwe.registerWorkbenchLayout('catalog', {
    noInspector(ctx) {
      return ctx.domain?.workbench?.inspector === false;
    },
    render(ctx) {
      ctx.showView('collection');
      ctx.renderCollectionWorkbench();
    }
  });

  window.fwe.registerWorkbenchLayout('panels', {
    noInspector() {
      return true;
    },
    render(ctx) {
      ctx.showView('sidepanel');
      ctx.renderSidepanelWorkbench();
    }
  });

  window.fwe.registerView('workbench', {
    test(view, domain) {
      const type = String(view?.type || '').trim().toLowerCase();
      if (view?.view === 'workbench' || type === 'workbench') {
        return 100;
      }
      if (type === 'browser' || type === 'sidepanel' || domain?.workbench) {
        return 90;
      }
      return 0;
    },
    noInspector(ctx) {
      const layoutInfo = resolveLayout(ctx.view, ctx.domain);
      const renderer = layoutInfo.renderer;
      if (typeof renderer?.noInspector === 'function') {
        return !!renderer.noInspector(ctx, layoutInfo, buildWorkbench(layoutInfo, ctx));
      }
      return ctx.domain?.workbench?.inspector === false;
    },
    validateView(view, domain) {
      const layoutInfo = resolveLayout(view, domain);
      const renderer = layoutInfo.renderer;
      const collections = resolveCollections(view, domain);
      const issues = Array.isArray(collections) && collections.length
        ? []
        : ['workbench view needs at least one collection.'];
      if (!renderer || typeof renderer.render !== 'function') {
        issues.push(`workbench layout "${layoutInfo.id}" is not registered.`);
      } else if (typeof renderer.validateLayout === 'function') {
        issues.push(...normalizeIssues(renderer.validateLayout(layoutInfo, buildWorkbench(layoutInfo), domain)));
      }
      return issues;
    },
    render(ctx) {
      const layoutInfo = resolveLayout(ctx.view, ctx.domain);
      const renderer = layoutInfo.renderer;
      if (!renderer || typeof renderer.render !== 'function') {
        throw new Error(`Workbench layout "${layoutInfo.id}" is not registered.`);
      }
      renderer.render(ctx, layoutInfo, buildWorkbench(layoutInfo, ctx));
      ctx.renderInspector();
    }
  });
}());
