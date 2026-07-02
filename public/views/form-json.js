(function registerFormJsonView() {
  window.fwe.registerView('form-json', {
    test: (view, domain) => view?.type === 'form' || domain?.kind === 'document' ? 10 : 1,
    validateView: () => [],
    render(ctx) {
      ctx.renderInspector();
      ctx.showView('document');
      ctx.renderDocument();
    }
  });
}());
