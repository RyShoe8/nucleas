const {EventEmitter}=require('node:events');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {app,screen}=require('electron');
const {freeTaskbarBounds}=require('./taskbar-layout.cjs');

/** Windows 10 and shell-compatibility mode: a local toolbar in measured free taskbar space.
 * It owns only its own window; Explorer, pinned buttons and the tray are never modified. */
class CompatibleTaskbarController extends EventEmitter{
 constructor(factory){super();this.factory=factory;this.stopped=false;this.mode='connecting';this.retries=0;}
 start(){
  this.window=this.factory();this.window.setAlwaysOnTop(true,'pop-up-menu');
  this.window.once('ready-to-show',()=>{this.loaded=true;this.place();});
  this.changed=()=>this.place();screen.on('display-metrics-changed',this.changed);screen.on('display-removed',this.changed);screen.on('display-added',this.changed);
  this.watchdog=setTimeout(()=>{if(this.mode==='connecting')this.fallback();},7000);
  this.stale=setInterval(()=>{if(this.child&&Date.now()-this.lastProbe>15000)this.recover(this.child);},5000);
  this.startProbe();
 }
 startProbe(){
  if(this.stopped)return;
  const executable=app.isPackaged?path.join(process.resourcesPath,'native/TaskbarLayout.exe'):path.join(__dirname,'native/bin/TaskbarLayout.exe');
  let buffer='';
  const child=spawn(executable,[String(process.pid)],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  this.child=child;this.lastProbe=Date.now();
  child.stdout.on('data',chunk=>{
   if(this.stopped||this.child!==child)return;
   buffer+=chunk.toString();if(buffer.length>100000){this.recover(child);return;}
   let newline;while((newline=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);let layout;
    try{layout=JSON.parse(line);}catch{continue;}
    if(typeof layout?.visible!=='boolean')continue;
    this.layout=layout;this.lastProbe=Date.now();
    if(layout.stalled){this.recover(child);return;}
    if(layout.measured)this.retries=0;
    this.place();
   }
  });
  child.on('error',()=>this.recover(child));child.on('exit',()=>this.recover(child));
 }
 recover(child){
  if(this.stopped||this.child!==child)return;
  this.child=null;child.kill();this.fallback();
  // A temporary Explorer/UIA failure must not permanently strand the toolbar.
  const delay=Math.min(10000,250*2**Math.min(this.retries++,6));
  clearTimeout(this.retry);this.retry=setTimeout(()=>this.startProbe(),delay);
 }
 fallback(){
  if(this.stopped)return;
  // Preserve auto-hide while reconnecting instead of showing a detached strip.
  this.layout={...this.layout,visible:this.layout?.visible??true,measured:false,pending:false};this.place();
 }
 hide(){
  if(this.window.isVisible()){this.window.setOpacity(0);this.window.hide();}
  // Windows can alter a hidden window's native bounds; reapply them on every reveal.
  this.bounds=null;
 }
 status(mode){if(this.mode!==mode){this.mode=mode;this.emit('attached',{mode});}}
 place(){
  if(this.stopped||!this.loaded||this.window.isDestroyed()||!this.layout)return;
  if(!this.layout.visible){this.hide();if(this.layout.bar)this.status('taskbar');return;}
  if(this.layout.pending&&!this.layout.measured){this.hide();return;}
  const physical=freeTaskbarBounds(this.layout),display=physical?screen.getDisplayMatching(screen.screenToDipRect(null,physical)):screen.getPrimaryDisplay();
  let rect,mode;
  if(physical){
   rect=screen.screenToDipRect(null,physical);
   const bounds=display.bounds;
   // Auto-hidden taskbars live almost entirely off-screen. Never leave a floating strip behind.
   if(rect.x<bounds.x-1||rect.y<bounds.y-1||rect.x+rect.width>bounds.x+bounds.width+1||rect.y+rect.height>bounds.y+bounds.height+1){this.hide();this.status('taskbar');return;}
   mode='taskbar';this.emit('taskbarEdgeChanged',{taskbarEdge:physical.vertical?'vertical':'horizontal'});
  }else{
   const area=display.workArea,width=Math.min(640,area.width-24);
   rect={x:area.x+Math.round((area.width-width)/2),y:area.y+area.height-52,width,height:44};mode='edge';this.emit('taskbarEdgeChanged',{taskbarEdge:'horizontal'});
  }
  rect={x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)};
  if(JSON.stringify(rect)!==this.bounds){this.window.setBounds(rect,false);this.bounds=JSON.stringify(rect);}
  if(!this.window.isVisible()){
   this.window.setAlwaysOnTop(true,'pop-up-menu');this.window.setOpacity(1);this.window.showInactive();
  }
  this.status(mode);
 }
 stop(){this.stopped=true;clearTimeout(this.watchdog);clearTimeout(this.retry);clearInterval(this.stale);this.child?.kill();this.child=null;for(const event of ['display-metrics-changed','display-removed','display-added'])if(this.changed)screen.removeListener(event,this.changed);if(this.window&&!this.window.isDestroyed())this.window.destroy();}
}
module.exports={CompatibleTaskbarController};
