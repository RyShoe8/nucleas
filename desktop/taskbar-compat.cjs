const {EventEmitter}=require('node:events');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {app,screen}=require('electron');
const {freeTaskbarBounds}=require('./taskbar-layout.cjs');

/** Windows 10 and shell-compatibility mode: a local toolbar in measured free taskbar space.
 * It owns only its own window; Explorer, pinned buttons and the tray are never modified. */
class CompatibleTaskbarController extends EventEmitter{
 constructor(factory){super();this.factory=factory;this.stopped=false;this.mode='connecting';}
 start(){
  this.window=this.factory();this.window.setAlwaysOnTop(true,'pop-up-menu');
  const executable=app.isPackaged?path.join(process.resourcesPath,'native/TaskbarLayout.exe'):path.join(__dirname,'native/bin/TaskbarLayout.exe');
  let buffer='';
  this.child=spawn(executable,[String(process.pid)],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  this.child.stdout.on('data',chunk=>{
   buffer+=chunk.toString();if(buffer.length>100000){buffer='';return;}
   let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);try{this.layout=JSON.parse(line);this.lastProbe=Date.now();this.place();}catch{/* Wait for the next complete sample. */}}
  });
  this.child.on('error',()=>this.fallback());this.child.on('exit',()=>{if(!this.stopped)this.fallback();});
  this.window.once('ready-to-show',()=>{this.loaded=true;this.place();});
  this.changed=()=>this.place();screen.on('display-metrics-changed',this.changed);screen.on('display-removed',this.changed);screen.on('display-added',this.changed);
  this.watchdog=setTimeout(()=>{if(this.mode==='connecting')this.fallback();},7000);
  this.stale=setInterval(()=>{if(this.lastProbe&&Date.now()-this.lastProbe>15000){this.lastProbe=0;this.child?.kill();this.fallback();}},5000);
 }
 fallback(){if(this.stopped)return;this.layout={visible:true,measured:false};this.place();}
 place(){
  if(this.stopped||!this.loaded||this.window.isDestroyed())return;
  if(this.layout&&!this.layout.visible){this.window.hide();return;}
  const physical=freeTaskbarBounds(this.layout),display=physical?screen.getDisplayMatching(screen.screenToDipRect(null,physical)):screen.getPrimaryDisplay();
  let rect,mode;
  if(physical){
   rect=screen.screenToDipRect(null,physical);
   const bounds=display.bounds;
   // Auto-hidden taskbars live almost entirely off-screen. Never leave a floating strip behind.
   if(rect.x<bounds.x||rect.y<bounds.y||rect.x+rect.width>bounds.x+bounds.width||rect.y+rect.height>bounds.y+bounds.height){this.window.hide();if(this.mode!=='taskbar'){this.mode='taskbar';this.emit('attached',{mode:'taskbar'});}return;}
   mode='taskbar';this.emit('taskbarEdgeChanged',{taskbarEdge:physical.vertical?'vertical':'horizontal'});
  }else{
   const area=display.workArea,width=Math.min(640,area.width-24);
   rect={x:area.x+Math.round((area.width-width)/2),y:area.y+area.height-52,width,height:44};mode='edge';this.emit('taskbarEdgeChanged',{taskbarEdge:'horizontal'});
  }
  rect={x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)};
  if(JSON.stringify(rect)!==this.bounds){this.window.setBounds(rect,false);this.bounds=JSON.stringify(rect);}
  if(!this.window.isVisible())this.window.showInactive();
  if(this.mode!==mode){this.mode=mode;this.emit('attached',{mode});}
 }
 stop(){this.stopped=true;clearTimeout(this.watchdog);clearInterval(this.stale);this.child?.kill();for(const event of ['display-metrics-changed','display-removed','display-added'])if(this.changed)screen.removeListener(event,this.changed);if(this.window&&!this.window.isDestroyed())this.window.destroy();}
}
module.exports={CompatibleTaskbarController};
