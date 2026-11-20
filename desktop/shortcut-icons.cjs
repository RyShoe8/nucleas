const fs=require('node:fs');
const path=require('node:path');
function repairShortcutIcons(app,shell,icon,executable=process.execPath){
 if(!app.isPackaged||process.platform!=='win32'||!fs.existsSync(icon))return;
 const roots=[app.getPath('desktop'),path.join(app.getPath('appData'),'Microsoft/Windows/Start Menu/Programs'),path.join(app.getPath('appData'),'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar')];
 for(const root of roots)for(const filename of ['Nucleas.lnk','Nucleas/Nucleas.lnk']){
  const shortcut=path.join(root,filename);if(!fs.existsSync(shortcut))continue;
  try{const existing=shell.readShortcutLink(shortcut);if(path.resolve(existing.target).toLowerCase()!==path.resolve(executable).toLowerCase())continue;
   if(existing.icon!==icon)shell.writeShortcutLink(shortcut,'update',{icon,iconIndex:0,appUserModelId:'app.nucleas.desktop'});
  }catch{/* A managed/read-only shortcut must not stop launch. */}
 }
}
module.exports={repairShortcutIcons};
