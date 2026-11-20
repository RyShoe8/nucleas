import {it,expect} from 'vitest';
import {employeeAppearance,suggestedEmployeeName} from './employeeIdentity';
it('gives company-specific marketing employees persistent, different names and appearances',()=>{
 const a='playbound:marketing',b='frugalgambler:marketing';
 expect(employeeAppearance(a)).toEqual(employeeAppearance(a));expect(employeeAppearance(a)).not.toEqual(employeeAppearance(b));
 expect(suggestedEmployeeName(a)).not.toBe(suggestedEmployeeName(b));
 const looks=Array.from({length:100},(_,i)=>JSON.stringify(employeeAppearance(`company-${i}:marketing`)));
 expect(new Set(looks).size).toBe(100);
});
