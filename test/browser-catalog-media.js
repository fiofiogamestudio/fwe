'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startFwe, startChrome, stopProcess, getFreePort, waitForHttp, waitForTarget, connectCdp, evaluate, waitForExpression } = require('./browser-smoke');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-catalog-media-'));
  const at = process.argv.indexOf('--output'), output = at < 0 ? path.join(root, 'evidence') : path.resolve(process.argv[at + 1]);
  fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(path.join(root, 'workspace/catalog'), { recursive: true }); fs.mkdirSync(path.join(root, 'workspace/notes'));
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwXQAAAAASUVORK5CYII=';
  const items = Array.from({ length: 97 }, (_, i) => ({ id: 'item-' + String(i).padStart(2, '0'), name: 'Artwork ' + String(i).padStart(2, '0'), current: 'current', assetId: 'asset-' + i, group: i % 2 ? 'odd' : 'even', thumbnailUrl: png, value: 0 }));
  const assetOptions = Array.from({ length: 358 }, (_, i) => ({ value: 'asset-' + i, label: '美术素材 ' + i }));
  fs.writeFileSync(path.join(root, 'workspace/catalog/a.json'), JSON.stringify({ items, plain: items.slice(0, 5) })); fs.writeFileSync(path.join(root, 'workspace/notes/a.txt'), 'another resource');
  fs.writeFileSync(path.join(root, 'preview.js'), `(function(){
    window.mediaProbe={mounted:0,disposed:0,records:[],ticks:0};
    window.fwe.registerForm('media-preview',{render(ctx){
      const p=window.mediaProbe, record={id:++p.mounted,itemId:ctx.target.id,disposed:0};p.records.push(record);
      const element=document.createElement('div');element.dataset.mediaPreview=ctx.target.id;element.dataset.mountId=record.id;
      const title=document.createElement('h3');title.textContent=ctx.target.name;element.append(title);
      const input=document.createElement('input');input.id='mediaValue';input.type='number';input.value=ctx.value;input.addEventListener('change',()=>ctx.setValue(Number(input.value),{refresh:false}));element.append(input);
      let frame;function tick(){p.ticks++;frame=requestAnimationFrame(tick);}frame=requestAnimationFrame(tick);
      return {element,dispose(){record.disposed++;p.disposed++;cancelAnimationFrame(frame);}};
    }});
  }());`);
  const collection = { id: 'items', label: 'Artwork', path: 'items', title: 'name', subtitle: ['id', 'group'], search: ['id', 'name'], columns: ['id', 'group'], list: ['detail', 'grid'],
    pageSize: 48, thumbnail: { src: 'thumbnailUrl', alt: 'name' }, filters: [
      { id: 'current', label: '版本范围', default: ['current'], options: [{ value: 'current', label: '当前版本' }, { value: 'historical', label: '历史版本' }] },
      { id: 'assetId', label: '所属素材', options: assetOptions },
      { id: 'group', label: '素材类型', itemPath: 'group', options: [{ value: 'even', label: '图片' }, { value: 'odd', label: '骨骼动画' }] }
    ],
    modes: [{ id: 'preview', label: 'Preview', form: 'preview' }, { id: 'json', view: 'json' }] };
  fs.writeFileSync(path.join(root, 'app.fwe.json'), JSON.stringify({ id: 'catalog-media', title: 'Native catalog media test', workspace: './workspace', extensions: [{ client: './preview.js' }], domains: [
    { id: 'catalog', title: 'Catalog', kind: 'document', source: { type: 'folder-json', path: 'catalog' },
      workbench: { layout: 'catalog', inspector: false, default: { collection: 'items', list: 'detail', mode: 'preview' }, collections: [collection, { ...collection, id: 'plain', label: 'Unpaged', path: 'plain', pageSize: undefined, filters: [] }] },
      inspector: { forms: { preview: { groups: [{ fields: [{ path: 'value', label: false, form: 'media-preview' }] }] } } } },
    { id: 'notes', title: 'Notes', kind: 'text', source: { type: 'folder-text', path: 'notes' } }
  ] }));
  const port = await getFreePort(), debug = await getFreePort(), url = `http://127.0.0.1:${port}`, server = startFwe(path.join(root, 'app.fwe.json'), port);
  let chrome, cdp; const cases = [], errors = [], filterGeometry = []; const q = JSON.stringify;
  const read = expr => evaluate(cdp, expr), wait = expr => waitForExpression(cdp, expr, 12000);
  const click = css => read(`document.querySelector(${q(css)}).click()`);
  const settled = () => read('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const activeCount = () => read('mediaProbe.records.filter(x=>!x.disposed).length');
  async function search(value) { await read(`(()=>{const e=document.querySelector('#collectionSearch');e.value=${q(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`); await settled(); }
  async function navigate(collectionId, itemId) { assert.equal(await read(`fwe.navigation.navigate(${q({ domainId: 'catalog', fileName: 'a.json', collectionId, ...(itemId ? { itemId } : {}) })},{updateUrl:true})`), true); await settled(); }
  try {
    await waitForHttp(url + '/api/app', 12000); chrome = startChrome(url, debug); const target = await waitForTarget(debug, url, 12000); cdp = await connectCdp(target.webSocketDebuggerUrl);
    cdp.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails?.exception?.description || e.exceptionDetails?.text));
    await cdp.call('Runtime.enable'); await cdp.call('Page.enable'); await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
    await wait('document.querySelector("[data-media-preview]")'); await settled();
    // Exercise the real catalog filters at their container widths, independent
    // of viewport size. An external width alone cannot constrain shadow text.
    for (const width of [300, 450]) {
      await read(`document.querySelector('#collectionWorkbench').style.gridTemplateColumns=${q(width + 'px minmax(0, 1fr)')}`); await settled();
      const geometry = await read(`(() => {
        const parent=document.querySelector('#collectionFilters').getBoundingClientRect();
        const rows=Array.from(document.querySelectorAll('#collectionFilters fwe-multi-select'), host=>{
          const summary=host.shadowRoot.querySelector('summary'),label=summary.querySelector('span'),s=summary.getBoundingClientRect(),h=host.getBoundingClientRect(),l=label?.getBoundingClientRect();
          const css=getComputedStyle(summary),arrow=getComputedStyle(summary,'::after');
          const arrowRight=s.right-parseFloat(css.paddingRight)-parseFloat(css.borderRightWidth);
          const arrowLeft=arrowRight-parseFloat(arrow.width)-parseFloat(arrow.borderLeftWidth)-parseFloat(arrow.borderRightWidth);
          return {text:summary.textContent.trim(),host:{left:h.left,right:h.right,top:h.top,bottom:h.bottom,width:h.width},summary:{left:s.left,right:s.right},label:l?{left:l.left,right:l.right,clientWidth:label.clientWidth,scrollWidth:label.scrollWidth}:null,arrowLeft,arrowRight,gap:parseFloat(css.columnGap)};
        });return {width:${width},parent:{left:parent.left,right:parent.right},rows};
      })()`);
      filterGeometry.push(geometry);
      assert.deepEqual(geometry.rows.map(row=>row.text), ['当前版本', '所属素材 358', '素材类型 2']);
      for (const row of geometry.rows) {
        assert.ok(row.label, 'Multi-select summaries need a shrinkable text box');
        assert.ok(row.host.left>=geometry.parent.left-1 && row.host.right<=geometry.parent.right+1, JSON.stringify(row));
        assert.ok(row.label.left>=row.summary.left && row.label.right<=row.arrowLeft-row.gap+1, 'Summary text must not overlap its arrow: '+JSON.stringify(row));
        assert.ok(row.arrowRight<=row.host.right+1 && row.arrowLeft>=row.host.left, 'Arrow must remain inside its control');
        assert.equal(row.label.scrollWidth,row.label.clientWidth,'Normal Chinese summary/count must stay fully visible');
      }
      for (let i=0;i<geometry.rows.length;i++) for(let j=i+1;j<geometry.rows.length;j++) {
        const a=geometry.rows[i].host,b=geometry.rows[j].host;
        assert.ok(a.right<=b.left+1 || b.right<=a.left+1 || a.bottom<=b.top+1 || b.bottom<=a.top+1,'Filter controls must not overlap');
      }
      if(width===300) assert.ok(new Set(geometry.rows.map(row=>Math.round(row.host.top))).size>1,'Three filters must wrap inside the 300px catalog sidebar');
      geometry.menus=[];
      for (const id of ['current','assetId','group']) {
        await read(`document.querySelector('[data-filter-id="${id}"]').shadowRoot.querySelector('summary').click()`); await settled();
        const menu=await read(`(() => {const control=document.querySelector('[data-filter-id="${id}"]'),bounds=control.shadowRoot.querySelector('.menu').getBoundingClientRect(),pane=document.querySelector('.collection-browser'),p=pane.getBoundingClientRect();return {id:${q(id)},open:control.open,left:bounds.left,right:bounds.right,width:bounds.width,paneLeft:p.left+pane.clientLeft,paneRight:p.left+pane.clientLeft+pane.clientWidth};})()`);
        geometry.menus.push(menu); assert.equal(menu.open,true); assert.ok(menu.width>0&&menu.left>=menu.paneLeft-1&&menu.right<=menu.paneRight+1,'Filter menu must remain inside its clipping catalog pane: '+JSON.stringify(menu));
        await read(`document.querySelector('[data-filter-id="${id}"]').close()`); await settled();
      }
      if(width===300) {
        const clip=await read(`(() => {const r=document.querySelector('.collection-browser__header').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`);
        const shot=await cdp.call('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:false});
        fs.writeFileSync(path.join(output,'native-filter-header-300.png'),Buffer.from(shot.data,'base64'));
      }
    }
    const longTitle='暮色庄园吸血鬼领主·完整角色动作和装备素材版本';
    await read(`(() => {const host=document.createElement('div');host.id='narrowFilterProbe';host.style.cssText='position:fixed;left:340px;top:60px;width:120px;height:360px;overflow:hidden;z-index:1000';const control=fwe.ui.createMultiSelect({placeholder:'素材筛选',items:[{value:'long',label:${q(longTitle)}},{value:'short',label:'短标题'}],selected:['long']});control.style.setProperty('--fwe-multi-select-width','120px');control.addEventListener('change',()=>window.narrowFilterChanges=(window.narrowFilterChanges||0)+1);host.append(control);document.body.append(host);})()`); await settled();
    const narrow=await read(`(() => {const host=document.querySelector('#narrowFilterProbe fwe-multi-select'),summary=host.shadowRoot.querySelector('summary'),label=summary.querySelector('span'),s=summary.getBoundingClientRect(),l=label.getBoundingClientRect(),css=getComputedStyle(summary),arrow=getComputedStyle(summary,'::after');return {width:host.getBoundingClientRect().width,title:summary.title,text:label.textContent,overflow:getComputedStyle(label).textOverflow,clipped:label.scrollWidth>label.clientWidth,labelRight:l.right,arrowLeft:s.right-parseFloat(css.paddingRight)-parseFloat(css.borderRightWidth)-parseFloat(arrow.width)-parseFloat(arrow.borderLeftWidth)-parseFloat(arrow.borderRightWidth),gap:parseFloat(css.columnGap)};})()`);
    filterGeometry.push({narrow}); assert.equal(narrow.width,120); assert.equal(narrow.title,longTitle); assert.equal(narrow.text,longTitle); assert.equal(narrow.overflow,'ellipsis'); assert.equal(narrow.clipped,true); assert.ok(narrow.labelRight<=narrow.arrowLeft-narrow.gap+1);
    await read(`document.querySelector('#narrowFilterProbe fwe-multi-select').shadowRoot.querySelector('summary').click()`); await settled();
    assert.equal(await read(`document.querySelector('#narrowFilterProbe fwe-multi-select').open`),true);
    narrow.menu=await read(`(() => {const host=document.querySelector('#narrowFilterProbe'),control=host.querySelector('fwe-multi-select'),m=control.shadowRoot.querySelector('.menu').getBoundingClientRect(),h=host.getBoundingClientRect(),o=control.shadowRoot.querySelector('input[value="short"]').getBoundingClientRect();return {left:m.left,right:m.right,hostLeft:h.left,hostRight:h.right,x:o.x+o.width/2,y:o.y+o.height/2};})()`);
    assert.ok(narrow.menu.left>=narrow.menu.hostLeft-1&&narrow.menu.right<=narrow.menu.hostRight+1,'Narrow filter menu must fit its 120px clipping ancestor');
    await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',x:narrow.menu.x,y:narrow.menu.y,button:'left',clickCount:1});
    await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:narrow.menu.x,y:narrow.menu.y,button:'left',clickCount:1}); await settled();
    assert.deepEqual(await read(`document.querySelector('#narrowFilterProbe fwe-multi-select').value`),['long','short']);
    assert.equal(await read('window.narrowFilterChanges'),1);
    await read(`document.querySelector('#narrowFilterProbe').remove();document.querySelector('#collectionWorkbench').style.removeProperty('grid-template-columns')`); await settled();
    cases.push('Chinese catalog filters wrap at 300/450px without text/arrow overlap; a 120px long title truncates with its full tooltip and selection still works');
    assert.equal(await read('document.querySelectorAll("#collectionList .collection-item").length'), 48);
    assert.equal(await read('document.querySelectorAll("#collectionList img[loading=lazy]").length'), 48);
    await wait('document.querySelector("#collectionList img").naturalWidth===1');
    assert.equal(await activeCount(), 1); assert.match(await read('document.querySelector("#collectionPageInfo").textContent'), /1 \/ 3.*1–48 \/ 97/);
    cases.push('Native list shows only one 48-item page with lazy image thumbnails');

    await click('#collectionGridButton'); await settled(); assert.equal(await activeCount(), 0);
    assert.equal(await read('document.querySelectorAll(".collection-grid-card").length'), 48);
    assert.equal(await read('document.querySelectorAll(".collection-grid-card img").length'), 48);
    await click('#collectionNextPageButton'); await settled(); assert.equal(await read('document.querySelector(".collection-grid-card").dataset.itemId'), 'item-48');
    await click('.collection-grid-card[data-item-id="item-60"]'); await click('#collectionDetailButton'); await settled();
    assert.equal(await read('document.querySelector("[data-media-preview]").dataset.mediaPreview'), 'item-60'); assert.equal(await activeCount(), 1);
    await click('#collectionNextPageButton'); await settled(); assert.equal(await read('document.querySelectorAll("#collectionList .collection-item").length'), 1);
    assert.equal(await read('document.querySelector("[data-media-preview]").dataset.mediaPreview'), 'item-96');
    cases.push('Grid and list share pagination and selection; switching views disposes the old preview once');

    await search('Artwork 0'); assert.match(await read('document.querySelector("#collectionPageInfo").textContent'), /1 \/ 1.*10/);
    await navigate('items', 'item-96'); assert.equal(await read('document.querySelector("#collectionSearch").value'), ''); assert.match(await read('document.querySelector("#collectionPageInfo").textContent'), /3 \/ 3/);
    await read(`document.querySelector('[data-filter-id="group"]').dispatchEvent(new CustomEvent('change',{detail:{values:['odd']}}))`); await settled();
    assert.equal(await read('document.querySelectorAll("#collectionList .collection-item").length'), 48); assert.match(await read('document.querySelector("#collectionPageInfo").textContent'), /1 \/ 1/);
    await navigate('items', 'item-96'); assert.equal(await read('document.querySelector("[data-media-preview]").dataset.mediaPreview'), 'item-96');
    await navigate('plain'); assert.equal(await read('document.querySelector("#collectionPagination").hidden'), true); assert.equal(await read('document.querySelectorAll("#collectionList .collection-item").length'), 5);
    await navigate('items'); assert.match(await read('document.querySelector("#collectionPageInfo").textContent'), /1 \/ 3/);
    assert.equal(await read('fwe.resources.current().dirty'), false);
    cases.push('Search/filter/collection reset pages, deep links reveal selected pages, unconfigured collections stay unpaged and browsing stays clean');

    const mount = await read('document.querySelector("[data-media-preview]").dataset.mountId');
    await read('(()=>{const field=document.querySelector(".field--form-extension");field.parentElement.append(field);})()'); await settled();
    assert.equal(await read('document.querySelector("[data-media-preview]").dataset.mountId'), mount); assert.equal(await activeCount(), 1);
    await read('(()=>{const input=document.querySelector("#mediaValue");input.value="7";input.dispatchEvent(new Event("change",{bubbles:true}));})()');
    assert.equal(await read('fwe.resources.current().dirty'), true);
    assert.equal(await read('fwe.resources.saveCurrent({refresh:false})'), true); await settled();
    assert.equal(await read('document.querySelector("[data-media-preview]").dataset.mountId'), mount); assert.equal(await read('fwe.resources.current().dirty'), false);
    assert.equal(await read('fwe.resources.saveCurrent()'), true); await settled(); assert.notEqual(await read('document.querySelector("[data-media-preview]").dataset.mountId'), mount); assert.equal(await activeCount(), 1);
    cases.push('Mounted forms survive DOM moves and nonrefreshing saves; normal save redraws and releases the old renderer');

    await read('document.querySelectorAll("#collectionModeTabs button")[1].click()'); await settled(); assert.equal(await activeCount(), 0);
    await read('document.querySelectorAll("#collectionModeTabs button")[0].click()'); await settled(); assert.equal(await activeCount(), 1);
    assert.equal(await read('fwe.navigation.navigate({domainId:"notes",fileName:"a.txt"})'), true); await settled(); assert.equal(await activeCount(), 0);
    assert.equal(await read('mediaProbe.records.every(x=>x.disposed===1)'), true);
    cases.push('JSON mode, item/collection changes and resource navigation clean each professional form exactly once');
    await navigate('items', 'item-12'); await click('#collectionGridButton'); await settled();
    const shot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(output, 'native-grid.png'), Buffer.from(shot.data, 'base64'));
    assert.deepEqual(errors, []); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ok: true, cases, errors, filterGeometry }, null, 2)); console.log(JSON.stringify({ ok: true, cases, output }, null, 2));
  } catch (error) { fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ok: false, cases, errors, filterGeometry, error: error.stack, page: cdp ? await read('document.body.innerText').catch(()=>'') : '' }, null, 2)); throw error; }
  finally { cdp?.close(); if (chrome) await stopProcess(chrome); await stopProcess(server); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
