import type {Point} from './officeSimulation';

export type Camera = {x:number;y:number;zoom:number};
export const MIN_ZOOM=.12,MAX_ZOOM=2.5;
/** All scenery and actors share this 2:1 isometric projection. */
export function iso(p:Point,z=0):Point {return {x:(p.x-p.y)*.86,y:(p.x+p.y)*.43-z};}
export function uniso(p:Point):Point {return {x:p.x/1.72+p.y/.86,y:p.y/.86-p.x/1.72};}
export function screenPoint(p:Point,c:Camera):Point {return {x:p.x*c.zoom+c.x,y:p.y*c.zoom+c.y};}
export function scenePoint(p:Point,c:Camera):Point {return {x:(p.x-c.x)/c.zoom,y:(p.y-c.y)/c.zoom};}
export function zoomAt(c:Camera,p:Point,zoom:number):Camera {
 const before=scenePoint(p,c),next=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,zoom));
 return {zoom:next,x:p.x-before.x*next,y:p.y-before.y*next};
}
export function focusCamera(p:Point,width:number,height:number,zoom:number):Camera {
 const projected=iso(p);return {x:width/2-projected.x*zoom,y:height/2-projected.y*zoom,zoom};
}
export function fitCamera(w:number,h:number,width:number,height:number):Camera {
 const zoom=Math.max(MIN_ZOOM,Math.min(1,(width-60)/((w+h)*.86),(height-130)/((w+h)*.43+110)));
 return focusCamera({x:w/2,y:h/2},width,height,zoom);
}
