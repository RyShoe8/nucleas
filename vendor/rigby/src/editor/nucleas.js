// Nucleas integration. The parent owns authentication and company asset storage.
// No API tokens or arbitrary tool/script commands cross this bridge.
export function connectNucleas(app) {
  if (parent === window) return;
  const send = message => parent.postMessage({ channel:'nucleas-animation', ...message }, location.origin);
  addEventListener('message', async event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== 'nucleas-animation') return;
    const { type, id, bytes, name } = event.data;
    try {
      if (type === 'visibility' && event.data.visible === false) {
        app.playing=false;
        app.changed();
      } else if (type === 'open' && bytes instanceof ArrayBuffer && bytes.byteLength <= 3 * 1024 * 1024) {
        if (!(await app.confirmDiscard())) return;
        await app.openFiles([new File([bytes], typeof name === 'string' ? name : 'project.rigby')]);
        send({type:'opened',id});
      } else if (type === 'save') {
        let result;
        const {warnings} = await app.writeWorkfile('project.rigby', {writeFile:async (_path,data)=>{result=data;} });
        if (warnings.length) throw new Error(warnings.join('; '));
        if (!result || result.byteLength > 3 * 1024 * 1024) throw new Error('Company saves support up to 3 MB. Use File → Save for a larger local project.');
        // The parent acknowledges persistence before this document is marked saved.
        app.syncJson();
        app.nucleasPendingSave = {id, snapshot:app.docJson};
        send({type:'save-result',id,name:app.doc.name||'Animation',bytes:result.buffer.slice(result.byteOffset,result.byteOffset+result.byteLength)});
      } else if (type === 'saved' && app.nucleasPendingSave?.id === id) {
        app.saved = app.nucleasPendingSave.snapshot;
        app.nucleasPendingSave = null;
        app.setStatus('Saved a new version to Nucleas');
      }
    } catch(error) { send({type:'error',id,message:error instanceof Error?error.message:'Animation operation failed'}); }
  });
  send({type:'ready'});
}
