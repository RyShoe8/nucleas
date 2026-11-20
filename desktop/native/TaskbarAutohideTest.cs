// Compiled only by native-test.cjs. Uses its own transparent test window, never Explorer.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

partial class TaskbarLayout {
 internal static IntPtr TestWindow;
 internal static void StartTest(){Main(new[]{Process.GetCurrentProcess().Id.ToString()});}
 internal static void StopTest(){Volatile.Write(ref stopping,true);}
}
class TaskbarAutohideTest {
 class TestBar:Form {
  protected override bool ShowWithoutActivation {get{return true;}}
  protected override CreateParams CreateParams {get{var p=base.CreateParams;p.ExStyle|=0x08000020;return p;}}
 }
 class Capture:TextWriter {
  internal readonly object gate=new object();
  internal readonly List<long> delays=new List<long>();
  internal long started;
  internal bool expected,pending,measured;
  internal readonly Stopwatch clock=Stopwatch.StartNew();
  public override Encoding Encoding {get{return Encoding.UTF8;}}
  public override void WriteLine(string value){lock(gate){
   if(value.Contains("\"measured\":true"))measured=true;
   if(pending&&value.Contains("\"visible\":"+(expected?"true":"false"))){delays.Add(clock.ElapsedMilliseconds-started);pending=false;}
  }}
  internal void Expect(bool visible){lock(gate){if(pending)throw new Exception("Previous visibility transition never arrived");expected=visible;pending=true;started=clock.ElapsedMilliseconds;}}
 }
 [STAThread] static void Main(){
  TaskbarLayout.SetTestDpi();var output=Console.Out;var capture=new Capture();Console.SetOut(capture);
  var form=new TestBar{FormBorderStyle=FormBorderStyle.None,ShowInTaskbar=false,Opacity=0,StartPosition=FormStartPosition.Manual,Text="Nucleas taskbar regression test"};
  var screen=Screen.PrimaryScreen.Bounds;int height=48,width=Math.Min(1000,screen.Width);
  form.Bounds=new Rectangle(screen.Left,screen.Bottom-2,width,height);
  form.Controls.Add(new Button{Bounds=new Rectangle(0,0,160,height),Text="Start"});
  form.Controls.Add(new Button{Bounds=new Rectangle(width-160,0,160,height),Text="Tray"});
  int phase=0;string error=null;Thread observer=null;var timer=new System.Windows.Forms.Timer{Interval=2000};
  form.Shown+=(s,e)=>{TaskbarLayout.TestWindow=form.Handle;observer=new Thread(TaskbarLayout.StartTest){IsBackground=true};observer.SetApartmentState(ApartmentState.MTA);observer.Start();timer.Start();};
  timer.Tick+=(s,e)=>{try{
   if(phase==10){timer.Stop();form.Close();return;}
   bool reveal=phase%2==0;capture.Expect(reveal);
   form.Bounds=new Rectangle(screen.Left,screen.Bottom-(reveal?height:12),width,height);
   phase++;timer.Interval=350;
  }catch(Exception ex){error=ex.Message;timer.Stop();form.Close();}};
  try{Application.Run(form);}finally{TaskbarLayout.StopTest();if(observer!=null)observer.Join(2000);timer.Dispose();form.Dispose();Console.SetOut(output);}
  lock(capture.gate){
   long max=0;foreach(long delay in capture.delays)max=Math.Max(max,delay);
   if(error!=null||capture.delays.Count!=10||!capture.measured||max>300){Console.Error.WriteLine("Native auto-hide test failed: "+error+" transitions="+capture.delays.Count+" measured="+capture.measured+" maxMs="+max);Environment.ExitCode=1;}
   else output.WriteLine("Native auto-hide: 5 reveal/hide cycles, controls measured; max response "+max+"ms.");
  }
 }
}
partial class TaskbarLayout {internal static void SetTestDpi(){SetProcessDPIAware();}}
