// E2E check for user levels + business owner against a RUNNING throwaway server (never production).
// Usage: CRM_E2E_BASE=http://127.0.0.1:3999/api CRM_E2E_ADMIN_PASSWORD=... node scripts/e2e-access-levels.mjs
const B=process.env.CRM_E2E_BASE||'http://127.0.0.1:3999/api';
const j=async(m,p,b,t)=>{const r=await fetch(B+p,{method:m,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined});return [r.status,await r.json().catch(()=>({}))];};
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c) process.exitCode=1;};
const [,lg]=await j('POST','/auth/login',{username:'admin',password:process.env.CRM_E2E_ADMIN_PASSWORD}); const A=lg.token;
let [s,me]=await j('GET','/auth/me',null,A); ok(me.user.level_id==='full_admin'&&me.user.permissions.users,'env admin full_admin');
[s]=await j('PUT','/access-levels/full_admin',{name:'x',permissions:{users:false}},A); ok(s===400,'full_admin locked '+s);
[s]=await j('POST','/access-levels',{id:'accountant',name:'حسابدار',base_role:'admin',permissions:{payments:true,students:true,hamraz:true}},A); ok(s===200,'create level');
[s]=await j('POST','/staff',{username:'acc1',full_name:'حسابدار تست',password:'secret12',level_id:'accountant'},A); ok(s===200,'create user');
const [,l2]=await j('POST','/auth/login',{username:'acc1',password:'secret12'}); const U=l2.token;
[s,me]=await j('GET','/auth/me',null,U); ok(me.user.level_id==='accountant'&&me.user.role==='admin','acc level');
[s]=await j('GET','/staff',null,U); ok(s===403,'acc /staff 403 '+s);
[s]=await j('POST','/settings',{x:1},U); ok(s===403,'acc settings write 403 '+s);
[s]=await j('GET','/settings/hamraz',null,U); ok(s===403,'acc hamraz settings 403 '+s);
[s]=await j('GET','/refunds',null,U); ok(s===403,'acc refunds 403 '+s);
[s]=await j('POST','/settings/business-owner',{phone:'09120000000'},U); ok(s===403,'acc owner 403 '+s);
[s]=await j('GET','/payments',null,U); ok(s!==403,'acc payments allowed '+s);
[s]=await j('POST','/settings/business-owner',{name:'تست',phone:'09121112233',telegram:'@owner_test',rubika:'ownr1',bale:'ownr_b'},A); ok(s===200,'admin owner save');
let [,o]=await j('GET','/settings/business-owner',null,A); ok(o.owner.links.telegram==='https://t.me/owner_test'&&o.owner.links.phone==='tel:09121112233','owner links');
[s]=await j('POST','/settings/business-owner',{telegram:'x'},A); ok(s===400,'owner validation');
let [,pub]=await j('GET','/settings',null,A); ok(!JSON.stringify(pub).includes('09121112233'),'owner not in publicSettings');
[s]=await j('PUT','/staff/2',{level_id:'cashier'},A); [s,me]=await j('GET','/auth/me',null,U); ok(me.user.role==='cashier'&&me.user.level_id==='cashier','reassign level -> cashier');
[s]=await j('DELETE','/access-levels/cashier',null,A); ok(s===400,'system level not deletable');
[s]=await j('DELETE','/access-levels/accountant',null,A); ok(s===200,'delete unused level '+s);
[s]=await j('GET','/access-levels',null,A); ok(s===200,'admin still has access');
