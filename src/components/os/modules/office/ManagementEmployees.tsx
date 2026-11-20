'use client';
import {useEffect,useState} from 'react';
import styles from './OfficeGame.module.css';
type Employee={id:string;name:string;jobTitle?:string;role:string;canRemove:boolean};
type Roster={canManage:boolean;employees:Employee[]};
export default function ManagementEmployees({employeeId,onRemoved}:{employeeId?:string;onRemoved:()=>void}){
 const [roster,setRoster]=useState<Roster|null>(null),[adding,setAdding]=useState(false),[removing,setRemoving]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{const abort=new AbortController();void fetch('/api/os/office/employees',{signal:abort.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('Could not load employee controls.');setRoster(await r.json());}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[employeeId]);
 const changed=()=>window.dispatchEvent(new Event('nucleas:employees-changed'));
 const add=async(e:React.FormEvent<HTMLFormElement>)=>{
  e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true);setError('');setNotice('');
  try{const response=await fetch('/api/os/office/employees',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:form.get('name'),jobTitle:form.get('jobTitle'),email:form.get('email'),role:form.get('role'),weeklyHours:Number(form.get('weeklyHours')),employeeType:form.get('employeeType')})});const body=await response.json();if(!response.ok)throw Error(body.error??'Could not add employee.');
   setAdding(false);setNotice(body.emailError?`Employee added. Invitation was not delivered: ${body.emailError}`:body.emailSent?'Employee added and invitation sent.':'Employee added. Their desk is being placed in Management.');changed();
  }catch(e){setError(e instanceof Error?e.message:'Could not add employee.');}finally{setBusy(false);}
 };
 const remove=async()=>{setBusy(true);setError('');try{const response=await fetch('/api/os/office/employees',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:employeeId})});const body=await response.json();if(!response.ok)throw Error(body.error??'Could not remove employee.');changed();onRemoved();}catch(e){setError(e instanceof Error?e.message:'Could not remove employee.');}finally{setBusy(false);}};
 const employee=roster?.employees.find(p=>p.id===employeeId);
 return <div className={styles.employeeControls}>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {roster?.canManage&&!employeeId&&!adding&&<button type="button" className={styles.primary} onClick={()=>setAdding(true)}>+ Add employee</button>}
  {adding&&<form onSubmit={add}><strong>Add a human teammate</strong><label>Name<input name="name" required maxLength={120} autoFocus/></label><label>Job title<input name="jobTitle" maxLength={120}/></label><label>Email to invite (optional)<input name="email" type="email" maxLength={254}/></label><small>Enter an email to send an invitation. Leave blank to add a roster entry without sending anything.</small><label>Access<select name="role" defaultValue="User"><option>User</option><option>Manager</option><option>Administrator</option></select></label><label>Employment<select name="employeeType" defaultValue="full-time"><option value="full-time">Full-time</option><option value="part-time">Part-time</option><option value="contractor">Contractor</option></select></label><label>Hours per week<input name="weeklyHours" type="number" min={0} max={168} defaultValue={40} required/></label><button className={styles.primary} disabled={busy}>{busy?'Adding…':'Add employee'}</button><button type="button" disabled={busy} onClick={()=>setAdding(false)}>Cancel</button></form>}
  {employee?.canRemove&&!removing&&<button type="button" onClick={()=>setRemoving(true)}>Remove employee</button>}
  {removing&&employee&&<div role="group" aria-label="Confirm employee removal"><p>Remove {employee.name} from the organization? Their desk and organization access will be removed. Virtual employees and jobs stay; their reviews return to the organization owner.</p><button type="button" disabled={busy} onClick={()=>void remove()}>{busy?'Removing…':'Confirm removal'}</button><button type="button" disabled={busy} onClick={()=>setRemoving(false)}>Cancel</button></div>}
 </div>;
}
