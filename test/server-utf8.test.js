const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const {loadAppConfig, startServer} = require('../src/server');

test('JSON saves preserve multibyte text split across request chunks', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwe-utf8-'));
  const file = path.join(root, 'value.json');
  fs.writeFileSync(file, JSON.stringify({text:'原始'}));
  const appFile = path.join(root, 'app.json');
  fs.writeFileSync(appFile, JSON.stringify({id:'utf8-test', workspace:root, domains:[{id:'value',kind:'document',source:'single-json:value.json'}]}));
  const server = await startServer(loadAppConfig(appFile), '127.0.0.1', 0, {quiet:true});
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root,{recursive:true,force:true});
  });
  const url = `http://127.0.0.1:${server.address().port}/api/domains/value/files/value.json`;
  const original = await (await fetch(url)).json();
  const data = {text:'铁冠国王：标记不追踪守卫。撤回喵喵 🐈'};
  const body = Buffer.from(JSON.stringify({data,revision:original.revision}));
  const first = body.indexOf(Buffer.from('铁'));
  const cuts = [first+1,first+2,body.length-4];
  const result = await new Promise((resolve,reject) => {
    const request = http.request(url,{method:'PUT',headers:{'Content-Type':'application/json','Content-Length':body.length}}, response => {
      const chunks=[];
      response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>resolve({status:response.statusCode,text:Buffer.concat(chunks).toString('utf8')}));
    });
    request.on('error',reject);
    (async()=>{
      let offset=0;
      for(const cut of cuts){request.write(body.subarray(offset,cut));offset=cut;await new Promise(resolve=>setTimeout(resolve,15));}
      request.end(body.subarray(offset));
    })().catch(reject);
  });
  assert.equal(result.status,200,result.text);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),data);
  assert.deepEqual((await (await fetch(url)).json()).data,data);
});
