import type { Actor } from './officeSimulation';

type Quad = [number,number,number,number,number,number,number];
type Motion = {fps:number;regions:[number,number,number,number][];clips:Record<string,Quad[][]>};
type Player = {clip:string;started:number;lastFrame:number;last:Quad[];from:Quad[];change:number;facing:number;texture:string};
let motion:Motion|undefined;
let loading:Promise<void>|undefined;
const textures=new Map<string,HTMLImageElement>();
const players=new WeakMap<HTMLCanvasElement,Player>();

export function loadOfficeRigs() {
    if (!loading) loading=Promise.all([
        fetch('/office/rigs/motion.json').then(async r=>{if(!r.ok)throw new Error('Animation data unavailable');motion=await r.json();}),
        ...['design','creative','engineering','support','operations','marketing'].flatMap(role=>[role,`${role}-rear`]).map(role=>new Promise<void>((resolve,reject)=>{
            const image=new Image();image.onload=()=>{textures.set(role,image);resolve();};image.onerror=()=>reject(new Error('Character texture unavailable'));image.src=`/office/rigs/${role}.webp`;
        })),
    ]).then(()=>{}).catch(error=>{loading=undefined;throw error;});
    return loading;
}

export function officeClip(actor:Actor,working:boolean) {
    if(!actor.arrived)return 'walk';
    const d=actor.destination;
    if(d.view==='rear')return 'lounge';
    if(d.amenity==='gaming')return 'game';
    if(d.pose==='pool'||d.pose==='coffee')return d.pose;
    if(d.pose==='seated')return d.amenity?'sit':working?'type':'sit';
    return d.collaboration?'talk':'idle';
}

/** Called by the building's single clock, only for visible actors. No per-character RAF or GIF decoder. */
export function drawOfficeRig(canvas:HTMLCanvasElement,role:string,actor:Actor,working:boolean,time:number,rear=actor.arrived&&actor.destination.view==='rear') {
    const textureKey=role+(rear?'-rear':'');
    const texture=textures.get(textureKey);
    if(!motion||!texture)return false;
    const ctx=canvas.getContext('2d');if(!ctx)return false;
    const clip=officeClip(actor,working);
    let player=players.get(canvas);
    if(!player){player={clip,started:0,lastFrame:-1,last:[],from:[],change:time,facing:actor.facing,texture:textureKey};players.set(canvas,player);}
    if(player.clip!==clip){player.from=player.last;player.clip=clip;player.started=0;player.change=time;player.lastFrame=-1;}
    const frames=motion.clips[clip]??motion.clips.idle;
    const index=Math.floor((time-player.started)*motion.fps)%frames.length;
    // Reduced motion or a scene reset can move the presentation clock backwards.
    if(time<player.change){player.change=time;player.lastFrame=-1;player.from=[];}
    const blend=Math.max(0,Math.min(1,(time-player.change)/.28));
    if(player.lastFrame===index&&blend===1&&player.facing===actor.facing&&player.texture===textureKey)return true;
    player.texture=textureKey;
    player.lastFrame=index;player.facing=actor.facing;
    const quads=frames[index].map(q=>{
        const previous=player.from.find(p=>p[0]===q[0]);
        return previous&&blend<1?q.map((n,i)=>i?n*blend+previous[i]*(1-blend):n) as Quad:q;
    });
    player.last=quads;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,256,240);
    for(const [part,a,b,c,d,x,y] of quads) {
        const [sx,sy,w,h]=motion.regions[part];
        const flip=actor.arrived?(actor.destination.key==='pool:1'?-1:1):actor.facing;
        ctx.setTransform(.53*flip*a/w,-.53*b/w,.53*flip*c/h,-.53*d/h,128+.53*flip*x,224-.53*y);
        ctx.drawImage(texture,sx,sy,w,h,0,0,w,h);
    }
    return true;
}
