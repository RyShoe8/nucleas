const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('repairs only Nucleas shortcuts pointing at this installation',()=>{
 const icon=path.resolve('resources/nucleas-v2.ico'),exe=path.resolve('installed/Nucleas.exe'),updated=[],mod={};
 const target=path.join('desktop','Nucleas.lnk');
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'shortcut-icons.cjs'),'utf8'),{
  module:mod,process:{platform:'win32',execPath:exe},require:name=>name==='node:fs'?{existsSync:()=>true}:require(name),
 });
 mod.exports.repairShortcutIcons({isPackaged:true,getPath:key=>key},{
  readShortcutLink:file=>({target:file===target?exe:path.resolve('other/Nucleas.exe'),args:'--office',icon:'old.ico'}),
  writeShortcutLink:(file,operation,details)=>updated.push({file,operation,details}),
 },icon);
 assert.equal(updated.length,1);assert.equal(updated[0].file,target);assert.equal(updated[0].operation,'update');
 assert.equal(updated[0].details.icon,icon);assert.equal(updated[0].details.appUserModelId,'app.nucleas.desktop');
 assert.equal('args' in updated[0].details,false);assert.equal('target' in updated[0].details,false);
});
