import {describe,it,expect} from 'vitest';
import {iso,uniso,screenPoint,scenePoint,zoomAt,focusCamera,MAX_ZOOM} from './gameCamera';
describe('office game camera',()=>{
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
