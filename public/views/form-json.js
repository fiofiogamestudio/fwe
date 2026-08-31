(function registerFormJsonView() {
  window.fwe.registerView('form-json', {
    test: (view, domain) => view?.type === 'form' || domain?.kind === 'document' ? 10 : 1,
    validateView: () => [],
    noInspector(ctx) {
      return ctx.view?.presentation === 'page';
    },
    render(ctx) {
      if (ctx.view?.presentation === 'page') {
        ctx.showView('document');
        ctx.hosts.documentTree.classList.add('form-page');
        ctx.renderRootForm(ctx.hosts.documentTree);
        return;
      }
      ctx.hosts.documentTree.classList.remove('form-page');
      ctx.renderInspector();
      ctx.showView('document');
      ctx.renderDocument();
    }
  });
}());
