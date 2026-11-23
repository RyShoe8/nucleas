const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {minimizedWindows}=require('./taskbar-state.cjs');

test('Office and app windows stay open on blur; explicit minimize enters the taskbar and close removes it',async()=>{
 const created=[],handlers=new Map(),shortcuts=new Map();let registered;
 const app=new EventEmitter();Object.assign(app,{isPackaged:false,requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),setAppUserModelId(){},getPath:()=>'',getVersion:()=> 'test'});
 class Window extends EventEmitter{
  constructor(options){super();this.title=options.title;this.visible=false;this.minimized=false;created.push(this);this.webContents=new EventEmitter();this.webContents.mainFrame={url:'https://nucleas.app/os/desktop'};Object.assign(this.webContents,{setWindowOpenHandler(){},send(){},isLoading:()=>false,isDestroyed:()=>false,debugger:{isAttached:()=>false,attach(){},detach(){},sendCommand:async()=>{}}});}
  loadURL(url){this.url=url;return Promise.resolve();} setIcon(){} setAppDetails(){} setAlwaysOnTop(){}
  isDestroyed(){return Boolean(this.destroyed);} isVisible(){return this.visible;} isMinimized(){return this.minimized;} isFocused(){return true;}
  show(){this.visible=true;this.emit('show');} focus(){} hide(){this.visible=false;this.emit('hide');}
  minimize(){this.minimized=true;this.emit('minimize');} restore(){this.minimized=false;this.emit('restore');}
  getTitle(){return this.title;} getNormalBounds(){return {x:0,y:0,width:1000,height:800};}
  close(){this.emit('close',{});this.destroyed=true;this.emit('closed');}
  static getFocusedWindow(){return null;}
 }
 const profile={setPermissionCheckHandler(){},setPermissionRequestHandler(){},webRequest:{onCompleted(){}}};
 const electron={app,BrowserWindow:Window,ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},screen:{getAllDisplays:()=>[{workArea:{x:0,y:0,width:1920,height:1080}}]},Tray:class extends EventEmitter{setToolTip(){}setContextMenu(){}},Menu:{buildFromTemplate:x=>x},nativeImage:{createFromPath:()=>({resize(){}})},globalShortcut:{register:(key,fn)=>{shortcuts.set(key,fn);return true;},unregisterAll(){}},session:{fromPartition:()=>profile}};
 const substitutes={electron,'electron-updater':{autoUpdater:new EventEmitter()},'node:fs':{readFileSync:()=>'{}',writeFileSync(){}},'node:os':{release:()=> '10.0.19045'},'./shortcut-icons.cjs':{repairShortcutIcons(){}},'./auth.cjs':{authFor:()=>({restore:async()=>false,stop(){}})},'./capture.cjs':{installDisplayCapture(){}},'./renderer/catalog.json':[{id:'office',title:'Office'},{id:'assistant',title:'Ask'}],'./taskbar.cjs':{createTaskbar:options=>{registered=options.windows;return{broadcast(){},stop(){}};}},'./attention.cjs':{startAttention:()=>({stop(){}})}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'main.cjs'),'utf8'),{require:id=>id in substitutes?substitutes[id]:require(id),__dirname,process:{argv:[],platform:'win32',arch:'x64'},URL,setTimeout,clearTimeout,setInterval,clearInterval,setImmediate,console});
 await new Promise(resolve=>setImmediate(resolve));
 const office=created[0];office.emit('ready-to-show');
 const event={sender:office.webContents,senderFrame:office.webContents.mainFrame};
 handlers.get('module:open')(event,{moduleId:'assistant'});const ask=created[1];ask.emit('ready-to-show');
 office.emit('blur');ask.emit('blur');await new Promise(resolve=>setTimeout(resolve,160));
 assert.equal(office.isVisible(),true);assert.equal(office.isMinimized(),false);assert.equal(ask.isVisible(),true);assert.equal(ask.isMinimized(),false);
 shortcuts.get('Alt+Space')();assert.equal(office.isVisible(),true,'repeated Office shortcut never hides it');
 office.minimize();ask.minimize();assert.deepEqual(minimizedWindows(registered).map(w=>w.title),['Office','Ask']);
 handlers.get('launcher:show')(event);assert.equal(office.isMinimized(),false);assert.deepEqual(minimizedWindows(registered).map(w=>w.title),['Ask']);
 ask.close();office.close();assert.equal(registered.size,0);assert.deepEqual(minimizedWindows(registered),[]);
 app.emit('before-quit');app.emit('will-quit');
});
