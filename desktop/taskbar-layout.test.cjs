const {test}=require('node:test');const assert=require('node:assert/strict');
const {freeTaskbarBounds}=require('./taskbar-layout.cjs');
test('measured free space avoids Start, apps and the tray, including negative monitor coordinates',()=>{
 const result=freeTaskbarBounds({visible:true,measured:true,bar:{x:-1920,y:1040,width:1920,height:40},blocked:[{x:-1920,y:1040,width:600,height:40},{x:-220,y:1040,width:220,height:40}]});
 assert.deepEqual(result,{x:-1312,y:1040,width:1084,height:40,vertical:false});
});
test('vertical bars and split gaps preserve real controls',()=>{
 const result=freeTaskbarBounds({visible:true,measured:true,bar:{x:0,y:0,width:60,height:1000},blocked:[{x:0,y:0,width:60,height:200},{x:0,y:700,width:60,height:300}]});
 assert.deepEqual(result,{x:0,y:208,width:60,height:484,vertical:true});
});
test('missing, unmeasured or full taskbars never use a guessed overlay',()=>{
 assert.equal(freeTaskbarBounds(null),null);assert.equal(freeTaskbarBounds({visible:false}),null);
 const sample={visible:true,measured:true,bar:{x:0,y:0,width:800,height:40},blocked:[{x:0,y:0,width:700,height:40}]};
 assert.equal(freeTaskbarBounds(sample),null);assert.equal(freeTaskbarBounds({...sample,measured:false}),null);
});
