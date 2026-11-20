// Read-only taskbar geometry probe. No Explorer injection, registry changes or app-title collection.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Collections.Generic;
class TaskbarLayout {
 [StructLayout(LayoutKind.Sequential)] struct RECT { public int left,top,right,bottom; }
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls,string name);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string name);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 static string Rect(RECT r){return "{\"x\":"+r.left+",\"y\":"+r.top+",\"width\":"+(r.right-r.left)+",\"height\":"+(r.bottom-r.top)+"}";}
 [MTAThread] static void Main(string[] args) {
  SetProcessDPIAware();
  Process parent=null;try{if(args.Length>0)parent=Process.GetProcessById(Int32.Parse(args[0]));}catch{return;}
  string previous="";int heartbeat=0;
  while(parent==null||!parent.HasExited){
   string result="{\"visible\":false}";
   try{
    IntPtr bar=FindWindow("Shell_TrayWnd",null);RECT bounds;
    if(bar!=IntPtr.Zero&&IsWindowVisible(bar)&&GetWindowRect(bar,out bounds)){
     var blocked=new List<string>();
     RECT tray;IntPtr trayWindow=FindWindowEx(bar,IntPtr.Zero,"TrayNotifyWnd",null);
     if(trayWindow!=IntPtr.Zero&&GetWindowRect(trayWindow,out tray))blocked.Add(Rect(tray));
     var root=AutomationElement.FromHandle(bar);
     var filter=new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.ListItem),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.MenuItem));
     var controls=root.FindAll(TreeScope.Descendants,filter);
     for(int i=0;i<controls.Count&&i<256;i++){
      var info=controls[i].Current;if(info.IsOffscreen)continue;var r=info.BoundingRectangle;
      if(r.IsEmpty||r.Width<1||r.Height<1)continue;
      blocked.Add(Rect(new RECT{left=(int)r.Left,top=(int)r.Top,right=(int)r.Right,bottom=(int)r.Bottom}));
     }
     // Without any measured controls we cannot safely place over the shell.
     result="{\"visible\":true,\"measured\":"+(controls.Count>0?"true":"false")+",\"bar\":"+Rect(bounds)+",\"blocked\":["+String.Join(",",blocked)+"]}";
    }
   }catch{result="{\"visible\":false}";}
   if(result!=previous||heartbeat++>=10){Console.WriteLine(result);Console.Out.Flush();previous=result;heartbeat=0;}
   if(args.Length>1&&args[1]=="--once")return;
   Thread.Sleep(1000);
  }
 }
}
