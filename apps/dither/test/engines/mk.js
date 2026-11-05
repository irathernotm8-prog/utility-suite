// builds a test character and exports everything into ./out
const D=require('path').join(__dirname,'../../')+'/'; const FX=require(D+'src/core/fxruntime'); const SP=require(D+'src/core/sprite'); const { Library }=require(D+'src/core/project'); const { makeCharacters }=require(D+'src/characters'); const fs=require('fs'); const path=require('path');
const K=require('./knight');
(async()=>{ const root=path.join(__dirname,'lib'); fs.rmSync(root,{recursive:true,force:true}); const lib=new Library(root); const p=lib.create('Val'); const C=makeCharacters({active:()=>p,decodeImage:()=>null,poses:null,changed:()=>{}});
 const s=K.side(), f=K.front(); const a=SP.fromFrames({name:'K',w:s.w,h:s.h,frames:[s.data]}); p.saveSprite(a); const b=SP.fromFrames({name:'F',w:f.w,h:f.h,frames:[f.data]}); p.saveSprite(b);
 const sw=SP.create({name:'Sword',w:4,h:14,palette:['#c0cbdc','#5a3a24']}); SP.apply(sw,[{op:'rect',x:1,y:0,w:2,h:10,color:0,fill:true},{op:'rect',x:0,y:10,w:4,h:4,color:1,fill:true}]); p.saveSprite(sw);
 const r=await C.create({name:'Knight',source:{sprite:a.id},view:'side',directions:4}); const id=r.character.id; await C.addView(id,'front',{sprite:b.id});
 C.skin(id,{action:'attach',sprite:sw.id,bone:'hand_f',py:12});
 const out=path.join(__dirname,'out'); fs.rmSync(out,{recursive:true,force:true}); console.log(C.exportTo(id,out,'all',{gifs:false}).map(x=>path.basename(x)).join(' '));
})();
