// ================================================================
// USERS — admin user management
// ================================================================
function renderUsers(){
  if(!state.users.length){document.getElementById('userTable').innerHTML=emptyState('ยังไม่มีผู้ใช้งาน');return}
  const roleColor={Admin:'badge-rust',พนักงานขาย:'badge-amber',พนักงานจัดส่ง:'badge-blue',ลูกค้า:'badge-sage'};
  document.getElementById('userTable').innerHTML=`<table>
    <thead><tr><th>รหัส</th><th>ชื่อ</th><th>Username</th><th>ตำแหน่ง</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
    <tbody>${state.users.map(u=>`<tr>
      <td><span class="badge badge-gray">${u.UserID}</span></td>
      <td><strong>${esc(u.FullName)}</strong></td>
      <td><code style="font-size:12px">${esc(u.Username)}</code></td>
      <td><span class="badge ${roleColor[u.Role]||'badge-gray'}">${esc(u.Role)}</span></td>
      <td><span class="badge ${u.IsActive?'badge-sage':'badge-rust'}">${u.IsActive?'ใช้งานอยู่':'ปิดใช้งาน'}</span></td>
      <td style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn-sm ${u.IsActive?'rust':'sage'}" onclick="toggleUser(${u.UserID},${u.IsActive?0:1})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${u.IsActive?'M18 6L6 18M6 6l12 12':'M20 6L9 17l-5-5'}"/></svg>
          ${u.IsActive?'ปิด':'เปิด'}
        </button>
        ${!u.IsActive?`<button class="btn-sm rust" onclick="deleteUser(${u.UserID},'${encodeURIComponent(u.FullName)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>ลบถาวร
        </button>`:''}
      </td>
    </tr>`).join('')}</tbody></table>`;
}

// ── MY ORDERS (ลูกค้า) ────────────────────────────────────────────

document.getElementById('userForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.currentTarget;
  const err=document.getElementById('userError'); err.textContent='';
  await withSubmitLock(form, async()=>{
    try{
      await api('/api/users',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      form.reset(); toast('เพิ่มผู้ใช้งานสำเร็จ ✓'); await loadAll();
    }catch(ex){err.textContent=ex.message}
  });
});

async function deleteUser(id, name){
  name = decodeURIComponent(name);
  if(!confirm(`ยืนยันลบบัญชี "${name}" ถาวร?\nการลบนี้ย้อนกลับไม่ได้ และลบได้เฉพาะบัญชีที่ปิดใช้งานอยู่แล้วเท่านั้น`)) return;
  try{
    await api(`/api/users/${id}`,{method:'DELETE'});
    toast('ลบผู้ใช้งานสำเร็จ ✓');
    const users=await api('/api/users'); state.users=users; renderUsers();
  }catch(ex){ toast(ex.message,'error'); }
}

async function toggleUser(id,active){
  try{
    await api(`/api/users/${id}`,{method:'PATCH',body:JSON.stringify({isActive:active})});
    toast((active?'เปิด':'ปิด')+'ใช้งานสำเร็จ ✓'); await loadAll();
  }catch(ex){toast(ex.message,'error')}
}
