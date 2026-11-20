/** Find an actual empty interval, never a guessed offset over Start, pinned apps or the tray. */
function freeTaskbarBounds(layout){
 const bar=layout?.bar;
 if(!layout?.visible||!layout.measured||!bar||![bar.x,bar.y,bar.width,bar.height].every(Number.isFinite)||bar.width<1||bar.height<1)return null;
 const vertical=bar.height>bar.width,start=vertical?bar.y:bar.x,end=start+(vertical?bar.height:bar.width);
 const ranges=(layout.blocked||[]).filter(r=>[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0&&r.x<bar.x+bar.width&&r.x+r.width>bar.x&&r.y<bar.y+bar.height&&r.y+r.height>bar.y).map(r=>[Math.max(start,(vertical?r.y:r.x)-8),Math.min(end,(vertical?r.y+r.height:r.x+r.width)+8)]).sort((a,b)=>a[0]-b[0]);
 let cursor=start+8,best=[0,0];
 for(const [left,right] of [...ranges,[end-8,end]]){if(left-cursor>best[1]-best[0])best=[cursor,left];cursor=Math.max(cursor,right);}
 if(best[1]-best[0]<140)return null;
 return {x:vertical?bar.x:best[0],y:vertical?best[0]:bar.y,width:vertical?bar.width:best[1]-best[0],height:vertical?best[1]-best[0]:bar.height,vertical};
}
module.exports={freeTaskbarBounds};
