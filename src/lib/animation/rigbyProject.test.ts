import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { zip } from '../../../vendor/rigby/src/editor/zip.js';
import { inspectRigby,RIGBY_MAX_BYTES } from './rigbyProject';

describe('Rigby company projects',()=>{
  it('opens all six actual office sources and their complete clip library',()=>{
    for(const role of ['design','creative','engineering','support','operations','marketing']) {
      const info=inspectRigby(readFileSync(`public/office/rigs/${role}.rigby`));
      expect(info.bones).toBe(11);
      expect(info.animations.map((a:{name:string})=>a.name)).toEqual(['idle','walk','type','sit','talk','coffee','pool','game']);
    }
  });
  it('rejects non-projects, oversized inputs and traversal attachments',()=>{
    expect(()=>inspectRigby(new Uint8Array())).toThrow();
    expect(()=>inspectRigby(new Uint8Array(RIGBY_MAX_BYTES+1))).toThrow();
    expect(()=>inspectRigby(zip([{path:'../project.json',bytes:new Uint8Array([1])}]))).toThrow(/path/);
    expect(()=>inspectRigby(zip([{path:'project.json',bytes:Buffer.from('{}')}]))).toThrow(/structure/);
  });
  it('rejects declared ZIP expansion before decompression allocates it',()=>{
    const bytes=zip([{path:'project.json',bytes:Buffer.from('{}')}]);
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const end=bytes.length-22,offset=view.getUint32(end+16,true);
    view.setUint32(offset+24,512*1024*1024,true);
    expect(()=>inspectRigby(bytes)).toThrow(/too large/);
  });
});
