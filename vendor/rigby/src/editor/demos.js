// SPDX-License-Identifier: MIT OR Apache-2.0
// Nucleas supplies its own editable characters; upstream proprietary demos are not redistributed.
export const DEMOS_REMOTE = false;
export const DEMOS = ['design','creative','engineering','support','operations','marketing'].map(id=>({
  id,name: 'Nucleas '+id,file:id+'.rigby',url:'/office/rigs/'+id+'.rigby',thumbnail:'/office/characters/'+id+'-idle.webp',animation:'idle',description:'An editable Nucleas office character: walk, work, talk and recreation clips.',
}));
export const DEMO_LICENSE_URL = '/animation-studio/THIRD_PARTY_NOTICES.md';
export const demoById = id => DEMOS.find(d=>d.id===id) ?? DEMOS[0];
