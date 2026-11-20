import {describe,it,expect} from 'vitest';
import {iso,uniso,screenPoint,scenePoint,zoomAt,focusCamera,fitCamera,clampCamera,MAX_ZOOM} from './gameCamera';
describe('office game camera',()=>{
 it.each([[1600,900],[390,844]])('fits the shared building inside %s × %s, without changing world positions',(width,height)=>{
  const camera=fitCamera(3300,1800,width,height);
  for(const p of [{x:0,y:0},{x:3300,y:0},{x:0,y:1800},{x:3300,y:1800}]){
   const q=screenPoint(iso(p,0,camera.portrait),camera);expect(q.x).toBeGreaterThanOrEqual(0);expect(q.x).toBeLessThanOrEqual(width);expect(q.y).toBeGreaterThanOrEqual(0);expect(q.y).toBeLessThanOrEqual(height);
   const restored=uniso(scenePoint(q,camera),camera.portrait);expect(restored.x).toBeCloseTo(p.x);expect(restored.y).toBeCloseTo(p.y);
  }
  const moved=clampCamera({...camera,x:100000,y:-100000},3300,1800,width,height);
  expect(moved.x).toBeLessThan(width);expect(moved.y).toBeGreaterThan(-1800);
 });
 it('projects floor coordinates back exactly for pointer picking',()=>{
  const p={x:850,y:2200},c=focusCamera(p,1440,900,.7);
  const q=uniso(scenePoint(screenPoint(iso(p),c),c));
  expect(q.x).toBeCloseTo(p.x);expect(q.y).toBeCloseTo(p.y);
 });
 it('keeps the world point beneath the pointer fixed when zooming, including at the limit',()=>{
  const c={x:-300,y:120,zoom:.7},pointer={x:233,y:412};
  const before=scenePoint(pointer,c),after=zoomAt(c,pointer,99);
  expect(after.zoom).toBe(MAX_ZOOM);
  expect(scenePoint(pointer,after).x).toBeCloseTo(before.x);
  expect(scenePoint(pointer,after).y).toBeCloseTo(before.y);
 });
});
