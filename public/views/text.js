(function registerTextView() {
  window.fwe.registerView('text', {
    test: (view, domain) => view?.type === 'text' || domain?.kind === 'text' ? 100 : 0,
    validateView: () => [],
    render(ctx) {
      ctx.showView('text');
      ctx.hosts.textView.value = ctx.text;
      ctx.setInspectorTitle(ctx.file.name);
      ctx.setInspectorMode('form');
      ctx.hosts.inspectorForm.innerHTML = `<div class="inspector-empty">${ctx.label('textDirectEdit', '文本文件在左侧直接编辑。')}</div>`;
      ctx.hosts.jsonEditor.value = '';
    }
  });
}());
