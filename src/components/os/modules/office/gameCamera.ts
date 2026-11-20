import type {Point} from './officeSimulation';

export type Camera = {x:number;y:number;zoom:number;portrait?:boolean};
export const MIN_ZOOM=.04,MAX_ZOOM=2.5;
/** Shallow game-camera perspective fills a rectangular viewport. Mobile turns the
 * same shared space, rather than creating a different office or moving employees. */
export function iso(p:Point,z=0,portrait=false):Point {return portrait?{x:p.y*.86+p.x*.035,y:p.x*.9-z}:{x:p.x*.86+p.y*.12,y:p.y*.9-z};}
export function uniso(p:Point,portrait=false):Point {const depth=p.y/.9,across=(p.x-depth*(portrait?.035:.12))/.86;return portrait?{x:depth,y:across}:{x:across,y:depth};}
export function screenPoint(p:Point,c:Camera):Point {return {x:p.x*c.zoom+c.x,y:p.y*c.zoom+c.y};}
export function scenePoint(p:Point,c:Camera):Point {return {x:(p.x-c.x)/c.zoom,y:(p.y-c.y)/c.zoom};}
export function zoomAt(c:Camera,p:Point,zoom:number):Camera {
 const before=scenePoint(p,c),next=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,zoom));
 return {...c,zoom:next,x:p.x-before.x*next,y:p.y-before.y*next};
}
export function focusCamera(p:Point,width:number,height:number,zoom:number):Camera {
 const portrait=height>width,projected=iso(p,0,portrait);return {x:width/2-projected.x*zoom,y:height/2-projected.y*zoom,zoom,portrait};
}
export function fitCamera(w:number,h:number,width:number,height:number):Camera {
 const portrait=height>width,across=portrait?h:w,depth=portrait?w:h;
 const zoom=Math.max(.04,Math.min(1.35,(width-32)/(across*.86+depth*(portrait?.035:.12)),(height-80)/(depth*.9+100)));
 const camera=focusCamera({x:w/2,y:h/2},width,height,zoom);camera.y+=35*zoom-8;return camera;
}

/** Keep a useful part of the office in view; zooming cannot lose the building. */
export function clampCamera(c:Camera,w:number,h:number,width:number,height:number):Camera {
 const across=(c.portrait?h:w)*.86+(c.portrait?w:h)*(c.portrait?.035:.12),depth=(c.portrait?w:h)*.9;
 const bound=(value:number,size:number,view:number)=>size<=view-32?(view-size)/2:Math.max(view-size-24,Math.min(24,value));
 return {...c,x:bound(c.x,across*c.zoom,width),y:bound(c.y,depth*c.zoom,height)};
}
