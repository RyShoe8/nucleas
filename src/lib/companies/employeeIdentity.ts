/** Pure, stable identity choices. Company + role identifies a person, not a shared role avatar. */
export function identityHash(value:string){return [...value].reduce((n,c)=>Math.imul(n^c.charCodeAt(0),16777619)>>>0,2166136261);}
const first=['Maya','Theo','Iris','Leo','Nora','Elias','Amara','Jules','Finn','Sage','Zara','Milo','Ada','Rowan','Leila','Noah','Esme','Owen','Aria','Kai','Rhea','Felix','Lena','Alex','Anika','Ezra','Mina','Remy','Clara','Ash','Nadia','Rory'];
const last=['Hart','Reed','Brooks','Chen','Patel','Rivera','Shaw','Park','Ellis','Singh','Vale','Hayes','Morgan','Costa','Lane','Silva','Wells','Kim','Flores','Bennett','Stone','Santos','Quinn','Moss','Nguyen','Gray','Cruz','Young','Marin','Blake','Ortiz','Wren'];
export function suggestedEmployeeName(key:string,attempt=0){const n=(identityHash(key)+attempt)>>>0;const cycle=Math.floor(attempt/(first.length*last.length));return `${first[n%first.length]} ${last[Math.floor(n/first.length)%last.length]}${cycle?` ${cycle+1}`:''}`;}
export function employeeAppearance(key:string){
 const n=identityHash(key),v=identityHash(`${key}:look`);
 return {head:n%6,outfit:(n>>>4)%6,skin:['#f0cfb0','#dfb08c','#c28c66','#a76f4e','#815339','#5e3c2c'][(n>>>8)%6],
  hair:['#302a25','#694630','#9b663b','#c5ad74','#d1cbc1','#47352e'][(n>>>12)%6],
  shirtHue:v%360,accessory:(n>>>16)%4,height:.94+((n>>>20)%9)/100};
}
