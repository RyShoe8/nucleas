const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
if(process.platform==='win32'){
 const root=path.resolve(__dirname,'..'),framework=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319');
 const output=path.join(root,'native/bin');fs.mkdirSync(output,{recursive:true});const exe=path.join(output,'TaskbarAutohideTest.exe');
 const refs=['UIAutomationClient.dll','UIAutomationTypes.dll','WindowsBase.dll'].map(f=>path.join(framework,'WPF',f));
 refs.push(path.join(framework,'System.Windows.Forms.dll'),path.join(framework,'System.Drawing.dll'));
 execFileSync(path.join(framework,'csc.exe'),['/nologo','/target:exe','/optimize+','/define:TASKBAR_TEST','/main:TaskbarAutohideTest','/out:'+exe,...refs.map(f=>'/reference:'+f),path.join(root,'native/TaskbarLayout.cs'),path.join(root,'native/TaskbarAutohideTest.cs')],{windowsHide:true,stdio:'pipe'});
 process.stdout.write(execFileSync(exe,[],{windowsHide:true,timeout:15000,encoding:'utf8'}));
}
