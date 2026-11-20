// Read-only shell observer. Fast geometry/events never wait for UI Automation.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Collections.Generic;
partial class TaskbarLayout {
 [StructLayout(LayoutKind.Sequential)] struct RECT { public int left,top,right,bottom; }
 [StructLayout(LayoutKind.Sequential)] struct POINT { public int x,y; }
 [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; public uint lPrivate; }
 [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int size; public RECT monitor,work; public uint flags; }
 delegate void WinEvent(IntPtr hook,uint type,IntPtr hwnd,int obj,int child,uint thread,uint time);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls,string name);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string name);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr child);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint process);
 [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd,uint flags);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor,ref MONITORINFO info);
 [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,WinEvent callback,uint process,uint thread,uint flags);
 [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
 [DllImport("user32.dll")] static extern UIntPtr SetTimer(IntPtr hwnd,UIntPtr id,uint ms,IntPtr callback);
 [DllImport("user32.dll")] static extern bool KillTimer(IntPtr hwnd,UIntPtr id);
 [DllImport("user32.dll")] static extern int GetMessage(out MSG msg,IntPtr hwnd,uint min,uint max);
 [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
 [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
 class Measurement { public IntPtr hwnd; public RECT bar; public RECT[] blocked; public bool valid; }
 static readonly Stopwatch clock=Stopwatch.StartNew();
 static readonly AutoResetEvent measure=new AutoResetEvent(false);
 static Measurement cached;
 static IntPtr taskbar,hook;
 static WinEvent callback=OnEvent;
 static long scanStarted=-1,lastOutput,lastParentCheck;
 static string previous="";
 static bool shown,stopping;
 static IntPtr FindBar(){
#if TASKBAR_TEST
  return TestWindow;
#else
  return FindWindow("Shell_TrayWnd",null);
#endif
 }
 static string Rect(RECT r){return "{\"x\":"+r.left+",\"y\":"+r.top+",\"width\":"+(r.right-r.left)+",\"height\":"+(r.bottom-r.top)+"}";}
 static string Bool(bool b){return b?"true":"false";}
 static bool Same(RECT a,RECT b){return a.left==b.left&&a.top==b.top&&a.right==b.right&&a.bottom==b.bottom;}
 static bool FullyShown(IntPtr hwnd,RECT r){
  var info=new MONITORINFO{size=Marshal.SizeOf(typeof(MONITORINFO))};
  return IsWindowVisible(hwnd)&&GetMonitorInfo(MonitorFromWindow(hwnd,2),ref info)&&r.left>=info.monitor.left&&r.top>=info.monitor.top&&r.right<=info.monitor.right&&r.bottom<=info.monitor.bottom;
 }
 static void OnEvent(IntPtr h,uint type,IntPtr hwnd,int obj,int child,uint thread,uint time){
  if(hwnd==taskbar){Probe();if(type!=0x800B)measure.Set();}
  else if(taskbar!=IntPtr.Zero&&IsChild(taskbar,hwnd))measure.Set();
 }
 static void Probe(){
  IntPtr found=FindBar();
  if(found!=taskbar){
   if(hook!=IntPtr.Zero)UnhookWinEvent(hook);hook=IntPtr.Zero;taskbar=found;Volatile.Write(ref cached,null);
   if(found!=IntPtr.Zero){uint process;GetWindowThreadProcessId(found,out process);hook=SetWinEventHook(0x8000,0x800B,IntPtr.Zero,callback,process,0,2);measure.Set();}
  }
  RECT bounds;string result="{\"visible\":false}";
  if(found!=IntPtr.Zero&&GetWindowRect(found,out bounds)){
   bool visible=FullyShown(found,bounds);if(visible&&!shown)measure.Set();shown=visible;
   var snapshot=Volatile.Read(ref cached);
   bool matched=snapshot!=null&&snapshot.hwnd==found&&snapshot.bar.right-snapshot.bar.left==bounds.right-bounds.left&&snapshot.bar.bottom-snapshot.bar.top==bounds.bottom-bounds.top;
   if(snapshot!=null&&!matched)measure.Set();
   var blocks=new List<string>();
   if(matched)foreach(var b in snapshot.blocked){int dx=bounds.left-snapshot.bar.left,dy=bounds.top-snapshot.bar.top;blocks.Add(Rect(new RECT{left=b.left+dx,right=b.right+dx,top=b.top+dy,bottom=b.bottom+dy}));}
   long busy=Interlocked.Read(ref scanStarted);
   result="{\"visible\":"+Bool(visible)+",\"measured\":"+Bool(matched&&snapshot.valid)+",\"pending\":"+Bool(snapshot==null&&clock.ElapsedMilliseconds<3000)+",\"stalled\":"+Bool(busy>=0&&clock.ElapsedMilliseconds-busy>10000)+",\"bar\":"+Rect(bounds)+",\"blocked\":["+String.Join(",",blocks)+"]}";
  }
  if(result!=previous||clock.ElapsedMilliseconds-lastOutput>=5000){Console.WriteLine(result);Console.Out.Flush();previous=result;lastOutput=clock.ElapsedMilliseconds;}
 }
 static void MeasureLoop(){
  long lastScan=-1000;
  while(!Volatile.Read(ref stopping)){
   measure.WaitOne(1500);
   long delay=500-(clock.ElapsedMilliseconds-lastScan);if(delay>0)Thread.Sleep((int)delay);
   IntPtr bar=FindBar();RECT before,after;
   if(bar==IntPtr.Zero||!GetWindowRect(bar,out before))continue;
   var old=Volatile.Read(ref cached);
   // Offscreen UIA flags must not erase a verified control layout or block visibility updates.
   if(old!=null&&old.hwnd==bar&&!FullyShown(bar,before))continue;
   lastScan=clock.ElapsedMilliseconds;Interlocked.Exchange(ref scanStarted,lastScan);
   try{
    var blocked=new List<RECT>();RECT tray;IntPtr trayWindow=FindWindowEx(bar,IntPtr.Zero,"TrayNotifyWnd",null);
    if(trayWindow!=IntPtr.Zero&&GetWindowRect(trayWindow,out tray))blocked.Add(tray);
    var root=AutomationElement.FromHandle(bar);
    var filter=new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.ListItem),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.MenuItem));
    var controls=root.FindAll(TreeScope.Descendants,filter);bool valid=controls.Count>0&&controls.Count<=256;
    for(int i=0;i<controls.Count&&i<256;i++){
     try{var r=controls[i].Current.BoundingRectangle;if(r.IsEmpty||r.Width<1||r.Height<1){valid=false;continue;}blocked.Add(new RECT{left=(int)r.Left,top=(int)r.Top,right=(int)r.Right,bottom=(int)r.Bottom});}
     catch{valid=false;}
    }
    // Discard scans captured partway through the slide animation.
    if(GetWindowRect(bar,out after)&&Same(before,after))Volatile.Write(ref cached,new Measurement{hwnd=bar,bar=before,blocked=blocked.ToArray(),valid=valid});else measure.Set();
   }catch{Volatile.Write(ref cached,new Measurement{hwnd=bar,bar=before,blocked=new RECT[0],valid=false});}
   finally{Interlocked.Exchange(ref scanStarted,-1);}
  }
 }
 [MTAThread] static void Main(string[] args){
  SetProcessDPIAware();Process parent=null;
  try{if(args.Length>0)parent=Process.GetProcessById(Int32.Parse(args[0]));}catch{return;}
  var root=GCHandle.Alloc(callback);UIntPtr timer=UIntPtr.Zero;
  try{
   var worker=new Thread(MeasureLoop){IsBackground=true};worker.SetApartmentState(ApartmentState.MTA);worker.Start();Probe();
   if(args.Length>1&&args[1]=="--once"){for(int i=0;i<30&&Volatile.Read(ref cached)==null;i++)Thread.Sleep(100);Probe();return;}
   // Shell movement events are immediate; a cheap geometry check covers missed notifications.
   timer=SetTimer(IntPtr.Zero,UIntPtr.Zero,100,IntPtr.Zero);MSG msg;
   while(!Volatile.Read(ref stopping)&&GetMessage(out msg,IntPtr.Zero,0,0)>0){
    if(msg.message==0x113)Probe();else{TranslateMessage(ref msg);DispatchMessage(ref msg);}
    if(clock.ElapsedMilliseconds-lastParentCheck>=1000){lastParentCheck=clock.ElapsedMilliseconds;if(parent!=null&&parent.HasExited)break;}
   }
  }finally{Volatile.Write(ref stopping,true);measure.Set();if(hook!=IntPtr.Zero)UnhookWinEvent(hook);if(timer!=UIntPtr.Zero)KillTimer(IntPtr.Zero,timer);root.Free();}
 }
}
