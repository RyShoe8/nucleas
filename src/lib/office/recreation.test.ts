import {describe,it,expect} from 'vitest';
import {newRecreation,changeRecreation,simulateShot,rack} from './recreation';
describe('shared office recreation',()=>{
 it('simulates a repeatable break with collisions and stops in bounded time',()=>{
  const balls=rack(),a=simulateShot(balls,0,400),b=simulateShot(balls,0,400);
  expect(a).toEqual(b);expect(a.duration).toBeLessThanOrEqual(15.01);expect(balls).toEqual(rack());
  expect(a.balls.some((ball,i)=>i>0&&(ball.pocketed||Math.abs(ball.x-balls[i].x)>5))).toBe(true);
  for(const ball of a.balls){expect(ball.vx).toBe(0);expect(ball.vy).toBe(0);if(!ball.pocketed){expect(ball.x).toBeGreaterThanOrEqual(5);expect(ball.x).toBeLessThanOrEqual(315);}}
 });
 it('detects pockets and respots a scratched cue away from other balls',()=>{
  const balls=rack();balls[0].x=35;balls[0].y=35;
  const result=simulateShot(balls,-3*Math.PI/4,120);
  expect(result.scratch).toBe(true);expect(result.balls[0].pocketed).toBe(false);
  expect(result.balls.slice(1).every(b=>b.pocketed||Math.hypot(b.x-result.balls[0].x,b.y-result.balls[0].y)>10)).toBe(true);
 });
 it('rejects stale actions, invalid power and shots during an existing shot',()=>{
  const first=newRecreation(100),second=changeRecreation(first,{kind:'pool-shot',revision:0,angle:0,power:300},100);
  expect(()=>changeRecreation(second,{kind:'pool-reset',revision:0},200)).toThrow(/Someone else/);
  expect(()=>changeRecreation(second,{kind:'pool-shot',revision:1,angle:0,power:200},200)).toThrow(/Wait/);
  expect(()=>changeRecreation(first,{kind:'pool-shot',revision:0,angle:NaN,power:1},200)).toThrow(/Invalid/);
  expect(first.pool.shots).toBe(0);
 });
 it('matches TV cards and respects the reveal time for mismatches',()=>{
  let state=newRecreation(100);const first=0,match=state.tv.cards.findIndex((v,i)=>i!==first&&v===state.tv.cards[first]);
  state=changeRecreation(state,{kind:'tv-card',revision:0,card:first},100);
  state=changeRecreation(state,{kind:'tv-card',revision:1,card:match},200);
  expect(state.tv.matched).toEqual([first,match]);expect(state.tv.moves).toBe(1);
  const a=state.tv.cards.findIndex((_,i)=>!state.tv.matched.includes(i)),b=state.tv.cards.findIndex((v,i)=>!state.tv.matched.includes(i)&&v!==state.tv.cards[a]);
  state=changeRecreation(state,{kind:'tv-card',revision:2,card:a},300);
  state=changeRecreation(state,{kind:'tv-card',revision:3,card:b},400);
  expect(()=>changeRecreation(state,{kind:'tv-card',revision:4,card:5},500)).toThrow(/Let everyone/);
  state=changeRecreation(state,{kind:'tv-card',revision:4,card:a},2500);expect(state.tv.open).toEqual([a]);
 });
});
