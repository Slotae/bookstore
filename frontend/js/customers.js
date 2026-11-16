function renderCustomers(){
  const box = document.getElementById('customerTable');
  if(!box) return;
  if(!state.customers.length){box.innerHTML=emptyState('ยังไม่มีลูกค้า');return}

  // Query 19 (Subquery + HAVING): ค่าเฉลี่ยยอดใช้จ่ายของลูกค้าที่เคยสั่งซื้อ ใช้ตัดสินป้าย "ลูกค้า VIP"
  const spenders = state.customers.filter(c=>c.OrderCount>0);
  const avgSpent = spenders.length ? spenders.reduce((s,c)=>s+Number(c.TotalSpent||0),0)/spenders.length : 0;

  const q = (document.getElementById('customerSearch')?.value||'').trim().toLowerCase();
  const sortBy = document.getElementById('customerSort')?.value || 'recent';
  const freqOnly = document.getElementById('customerFreqOnly')?.checked;
  const phonePrefix = (document.getElementById('customerPhonePrefix')?.value||'').trim();

  // Query 3 (LIKE เบอร์โทร) และ Query 8 (HAVING OrderCount) รันจริงบนเซิร์ฟเวอร์ผ่าน runLiveQuery()
  // (state.live.customerPhoneNames / customerFreqNames อัปเดตจาก liveCustomerPhone()/liveCustomerFreqOnly() ด้านบน)
  // ที่นี่แค่ใช้ผลลัพธ์ที่ได้จริงจาก SQL มากรองแถวที่จะแสดง (ไม่ได้คำนวณ WHERE/HAVING ซ้ำฝั่ง client)
  let rows = state.customers.filter(c=>{
    if(freqOnly && state.live.customerFreqNames && !state.live.customerFreqNames.has(c.CustomerName)) return false;
    if(phonePrefix && state.live.customerPhoneNames && !state.live.customerPhoneNames.has(c.CustomerName)) return false;
    if(!q) return true;
    return (c.CustomerName||'').toLowerCase().includes(q) || (c.Phone||'').includes(q);
  });

  // Query 4 (ORDER BY ชื่อ) / เรียงตามยอดใช้จ่าย / เรียงตามจำนวนคำสั่งซื้อ (Query 8/12)
  if(sortBy==='name') rows = [...rows].sort((a,b)=>a.CustomerName.localeCompare(b.CustomerName,'th'));
  else if(sortBy==='spent') rows = [...rows].sort((a,b)=>b.TotalSpent-a.TotalSpent);
  else if(sortBy==='orders') rows = [...rows].sort((a,b)=>b.OrderCount-a.OrderCount);

  if(!rows.length){box.innerHTML=emptyState('ไม่พบลูกค้าที่ตรงกับเงื่อนไข');return}

  box.innerHTML=`<table>
    <thead><tr><th>รหัส</th><th>ชื่อลูกค้า</th><th>ติดต่อ</th><th>คำสั่งซื้อ / ยอดใช้จ่าย</th><th>สมาชิก</th><th></th></tr></thead>
    <tbody>${rows.map(c=>`<tr>
      <td><span class="badge badge-gray">${c.CustomerID}</span></td>
      <td><strong>${esc(c.CustomerName)}</strong>${c.OrderCount>0 && c.TotalSpent>avgSpent?'<small><span class="badge badge-amber"><svg class="icon-inline" viewBox="0 0 24 24"><path d="M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2Z"/></svg> ลูกค้า VIP</span></small>':''}${c.OrderCount===0?'<small><span class="badge badge-gray">ยังไม่เคยสั่งซื้อ</span></small>':''}</td>
      <td>${esc(c.Phone)}<small>${esc(c.Email)||'—'}</small></td>
      <td><strong>${c.OrderCount}</strong> ครั้ง<small>${money.format(c.TotalSpent||0)}</small></td>
      <td>${c.HasAccount?'<span class="badge badge-sage">มีบัญชี</span>':'<span class="badge badge-gray">—</span>'}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn-sm blue" onclick="editCustomer(${c.CustomerID})">แก้ไข</button>
        <button class="btn-sm rust" onclick="deleteCustomer(${c.CustomerID},'${encodeURIComponent(c.CustomerName)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>ลบ
        </button>
      </td>
    </tr>`).join('')}</tbody></table>
    <div style="padding:8px 4px;font-size:12px;color:var(--muted)">พบ ${rows.length} จาก ${state.customers.length} คน</div>`;
}


document.getElementById('customerForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.currentTarget;
  const err=document.getElementById('customerError'); err.textContent='';
  await withSubmitLock(form, async()=>{
    try{
      await api('/api/customers',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      form.reset(); toast('เพิ่มลูกค้าสำเร็จ ✓'); await loadAll();
    }catch(ex){err.textContent=ex.message}
  });
});

function fillDatalist(id, names){
  const el = document.getElementById(id);
  if(!el) return;
  el.innerHTML = [...new Set(names)].sort().map(n=>`<option value="${esc(n)}">`).join('');
}


async function deleteCustomer(id, name){
  name = decodeURIComponent(name);
  if(!confirm(`ยืนยันลบลูกค้า "${name}" ?\n(ไม่สามารถลบได้หากมีคำสั่งซื้ออยู่ในระบบ)`)) return;
  try{
    await api(`/api/customers/${id}`,{method:'DELETE'});
    toast('ลบลูกค้าสำเร็จ ✓'); await loadAll();
  }catch(ex){toast(ex.message,'error')}
}


async function editCustomer(id){
  const c=state.customers.find(x=>x.CustomerID===id);
  if(!c) return toast('ไม่พบข้อมูลลูกค้า','error');
  const customerName=prompt('ชื่อลูกค้า',c.CustomerName||''); if(customerName===null)return;
  const phone=prompt('เบอร์โทรศัพท์',c.Phone||''); if(phone===null)return;
  const email=prompt('อีเมล (เว้นว่างได้)',c.Email||''); if(email===null)return;
  const address=prompt('ที่อยู่',c.Address||''); if(address===null)return;
  try{
    await api(`/api/customers/${id}`,{method:'PUT',body:JSON.stringify({customerName,phone,email,address})});
    toast('แก้ไขข้อมูลลูกค้าสำเร็จ ✓'); await loadAll();
  }catch(ex){toast(ex.message,'error')}
}
