const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
if(process.platform==='win32'){
 const framework=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET','Framework64','v4.0.30319');
 const out=path.join(root,'native/bin');fs.mkdirSync(out,{recursive:true});
 execFileSync(path.join(framework,'csc.exe'),['/nologo','/target:exe','/optimize+','/platform:anycpu','/out:'+path.join(out,'TaskbarLayout.exe'),...['UIAutomationClient.dll','UIAutomationTypes.dll','WindowsBase.dll'].map(f=>'/reference:'+path.join(framework,'WPF',f)),path.join(root,'native/TaskbarLayout.cs')],{windowsHide:true,stdio:'pipe'});
}
