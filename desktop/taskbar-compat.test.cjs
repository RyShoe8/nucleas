const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function fixture(t){
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});
 const children=[],screen=new EventEmitter(),events=[],window=new EventEmitter();
 Object.assign(window,{visible:false,destroyed:false,isVisible(){return this.visible;},isDestroyed(){return this.destroyed;},getNativeWindowHandle(){return Buffer.from([42,0,0,0,0,0,0,0]);},setBounds(bounds){events.push(['bounds',bounds]);},setAlwaysOnTop(){events.push(['top']);},moveTop(){events.push(['raise']);},setOpacity(value){events.push(['opacity',value]);},showInactive(){this.visible=true;events.push(['show']);},hide(){this.visible=false;events.push(['hide']);},destroy(){this.destroyed=true;}});
 screen.getPrimaryDisplay=()=>({bounds:{x:0,y:0,width:1920,height:1080},workArea:{x:0,y:0,width:1920,height:1080}});
 screen.getDisplayMatching=screen.getPrimaryDisplay;screen.screenToDipRect=(_win,rect)=>({...rect});
 const mod={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'taskbar-compat.cjs'),'utf8'),{
  module:mod,__dirname,process:{pid:123,resourcesPath:'/resources'},Date,setTimeout,clearTimeout,setInterval,clearInterval,
  require:name=>name==='electron'?{app:{isPackaged:false},screen}:name==='node:child_process'?{spawn(_exe,args){const child=new EventEmitter();child.args=args;child.stdout=new EventEmitter();child.kill=()=>{child.killed=true;child.emit('exit');};children.push(child);return child;}}:require(name),
 });
 const controller=new mod.exports.CompatibleTaskbarController(()=>window);controller.start();window.emit('ready-to-show');
 t.after(()=>controller.stop());
 const send=(sample,child=children.at(-1))=>child.stdout.emit('data',Buffer.from(JSON.stringify(sample)+'\n'));
 return {controller,window,events,children,screen,send};
}
const shown={visible:true,measured:true,bar:{x:0,y:1040,width:1920,height:40},blocked:[{x:0,y:1040,width:600,height:40},{x:1700,y:1040,width:220,height:40}]};
const hidden={...shown,visible:false,bar:{...shown.bar,y:1078}};

test('waits for shell geometry instead of flashing an unplaced bar during startup',t=>{
 const f=fixture(t);assert.equal(f.window.visible,false);
 f.send({...shown,measured:false,pending:true});assert.equal(f.window.visible,false);
 f.send(shown);assert.equal(f.window.visible,true);
});
test('repeated auto-hide cycles hide before moving and reposition on every reveal',t=>{
 const f=fixture(t);f.send(shown);
 for(let i=0;i<8;i++){
  const before=f.events.length;f.send(hidden);
  assert.equal(f.window.visible,false);assert.deepEqual(f.events.slice(before).map(e=>e[0]),['opacity','hide']);
  f.send(shown);assert.equal(f.window.visible,true);
  assert.deepEqual(f.events.slice(-4).map(e=>e[0]),['bounds','top','opacity','show']);
 }
 assert.equal(f.events.filter(e=>e[0]==='show').length,9);
});

test('keeps controls above Explorer when hovering other shortcuts without hiding or taking focus',t=>{
 const f=fixture(t);f.send(shown);
 assert.deepEqual(Array.from(f.children[0].args),['123','--toolbar-hwnd','42']);
 const before=f.events.length;
 for(let i=0;i<5;i++){
  f.send({...shown,obscuredByTaskbar:true});
  assert.equal(f.window.visible,true);
  f.send({...shown,obscuredByTaskbar:false});
 }
 assert.deepEqual(f.events.slice(before),Array.from({length:5},()=>['raise']));
 f.send({...hidden,obscuredByTaskbar:true});
 assert.equal(f.window.visible,false);
 assert.equal(f.events.filter(e=>e[0]==='raise').length,5);
});
test('offscreen/partial animation frames never move the toolbar down the screen',t=>{
 const f=fixture(t);f.send(shown);const count=f.events.filter(e=>e[0]==='bounds').length;
 f.send({...shown,bar:{...shown.bar,y:1060},blocked:[]});
 assert.equal(f.window.visible,false);assert.equal(f.events.filter(e=>e[0]==='bounds').length,count);
 f.send(shown);assert.equal(f.window.visible,true);
});
test('probe failures while hidden reconnect without a lingering quick bar or stale callbacks',t=>{
 const f=fixture(t);f.send(hidden);const old=f.children[0];old.emit('error',Error('Explorer changed'));
 assert.equal(f.window.visible,false);assert.equal(old.killed,true);
 t.mock.timers.tick(250);assert.equal(f.children.length,2);
 f.send(shown,old);assert.equal(f.window.visible,false);
 f.send(shown);assert.equal(f.window.visible,true);
});
test('a hung UI Automation scan restarts while geometry stays responsive',t=>{
 const f=fixture(t);f.send({...hidden,stalled:true});assert.equal(f.children[0].killed,true);
 t.mock.timers.tick(250);f.send(shown);assert.equal(f.window.visible,true);
});
test('stale heartbeat recovers, and stopping releases timers, probe and display listeners',t=>{
 const f=fixture(t);f.send(hidden);t.mock.timers.tick(20000);assert.equal(f.children[0].killed,true);
 t.mock.timers.tick(250);assert.equal(f.children.length,2);f.controller.stop();
 const count=f.children.length;t.mock.timers.tick(60000);
 assert.equal(f.children.length,count);assert.equal(f.window.destroyed,true);assert.equal(f.children.at(-1).killed,true);
 for(const event of ['display-metrics-changed','display-removed','display-added'])assert.equal(f.screen.listenerCount(event),0);
});
