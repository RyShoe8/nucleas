const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const handlers=new Map(),timers=new Map(),windows=[],opened=[],requests=[];let timerId=0;
 let data={userId:'user',intervalMinutes:0,items:[{id:'run:1',title:'Review result',companyName:'PlayBound',moduleId:'team',payload:{companyId:'c',runId:'1'}}]};
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;windows.push(this);this.webContents=new EventEmitter();this.webContents.mainFrame={url:pathToFileURL(path.join(__dirname,'renderer/attention.html')).href};this.webContents.send=()=>{};this.webContents.setWindowOpenHandler=()=>{};}
  isDestroyed(){return !!this.destroyed;}destroy(){this.destroyed=true;this.emit('closed');}getSize(){return[this.options.width,this.options.height];}setBounds(bounds){Object.assign(this.options,bounds);}show(){}showInactive(){this.passive=true;}focus(){this.emit('focus');}async loadFile(){queueMicrotask(()=>this.emit('ready-to-show'));}
 }
 const profile={cookies:new EventEmitter(),fetch:async(url,options)=>{requests.push({url,options});return{ok:true,status:200,json:async()=>data};}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'attention.cjs'),'utf8'),{module,__dirname,AbortController,AbortSignal,console,
  setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),
  require:name=>name==='electron'?{BrowserWindow:Window,screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1600,height:900}})},ipcMain:{handle:(id,fn)=>handlers.set(id,fn),removeHandler:id=>handlers.delete(id)}}:require(name),
 });
 const app=module.exports.startAttention({profile,catalog:[{id:'team'}],openModule:value=>opened.push(value),changed(){}});
 const event=()=>({sender:windows.at(-1).webContents,senderFrame:windows.at(-1).webContents.mainFrame});
 const fire=ms=>{for(const [id,t]of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}};
 return{app,handlers,windows,profile,requests,opened,event,fire,data:next=>{data=next;},timers};
}
test('notifications use the saved session and accept IPC only from their own trusted local frame',async()=>{
 const f=fixture();await flush();assert.equal(f.windows.length,1);assert.equal(f.windows[0].passive,true);
 assert.equal(f.app.snapshot().count,1);assert.equal(f.requests[0].url,'https://nucleas.app/api/os/attention');
 assert.throws(()=>f.handlers.get('attention:state')({sender:{},senderFrame:{}}),/Not allowed/);
 assert.throws(()=>f.handlers.get('attention:state')({...f.event(),senderFrame:{...f.event().senderFrame}}),/Not allowed/);
 await assert.rejects(f.handlers.get('attention:interval')(f.event(),5),/available interval/);
 await f.handlers.get('attention:interval')(f.event(),120);assert.equal(JSON.parse(f.requests.at(-1).options.body).intervalMinutes,120);
 assert.throws(()=>f.handlers.get('attention:open')(f.event(),'not-current'),/no longer waiting/);
 f.handlers.get('attention:open')(f.event(),'run:1');assert.equal(f.opened[0].payload.runId,'1');f.app.stop();assert.equal(f.handlers.size,0);assert.equal(f.timers.size,0);
});
test('resolved work disappears, repeated polls do not create duplicate popups, and sign-out clears data',async()=>{
 const f=fixture();await flush();f.fire(9000);f.fire(60000);await flush();assert.equal(f.windows.length,1);
 f.data({userId:'user',intervalMinutes:60,items:[]});f.fire(60000);await flush();assert.equal(f.app.snapshot().count,0);
 f.profile.cookies.emit('changed',{}, {name:'session',domain:'nucleas.app'});assert.equal(f.app.snapshot().count,0);assert.ok([...f.timers.values()].some(t=>t.ms===1500));
 f.app.stop();assert.equal(f.profile.cookies.listenerCount('changed'),0);
});
