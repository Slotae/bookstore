// ================================================================
// PAYMENTS — payment list, status checks, slip upload
// ================================================================
function renderPaymentSummaryStrip(){
  const el=document.getElementById('paymentSummaryStrip');
  if(!el) return;
  const rows=state.payments||[];
  if(!rows.length){ el.innerHTML=''; return; }
  const counts={'รอชำระ':0,'รอตรวจสอบ':0,'ยืนยันแล้ว':0,'ปฏิเสธ':0};
  let confirmedTotal=0;
  rows.forEach(p=>{
    const s=p.PaymentStatus||'รอชำระ';
    counts[s]=(counts[s]||0)+1;
    if(s==='ยืนยันแล้ว') confirmedTotal+=(p.Amount||0);
  });
  const items=[
    {label:'รอชำระ',       value:counts['รอชำระ'],      color:'gray'},
    {label:'รอตรวจสอบ',     value:counts['รอตรวจสอบ'],    color:'amber'},
    {label:'ยืนยันแล้ว',    value:counts['ยืนยันแล้ว'],   color:'sage'},
    {label:'ปฏิเสธ',        value:counts['ปฏิเสธ'],       color:'rust'},
    {label:'ยอดรับแล้ว',    value:money.format(confirmedTotal), color:'blue', wide:true}
  ];
  el.innerHTML=items.map(i=>`
    <div class="pay-summary-chip ${i.color}${i.wide?' wide':''}">
      <span class="pay-summary-value">${i.value}</span>
      <span class="pay-summary-label">${esc(i.label)}</span>
    </div>`).join('');
}

function renderPayments(){
  renderPaymentSummaryStrip();
  if(!state.payments.length){document.getElementById('paymentTable').innerHTML=emptyState('ยังไม่มีรายการชำระเงิน');return}

  const q=(document.getElementById('paymentSearch')?.value||'').trim().toLowerCase();
  const methodFilter=document.getElementById('paymentMethodFilter')?.value||'';
  const statusFilter=document.getElementById('paymentStatusFilter')?.value||'';
  const rows=state.payments.filter(p=>{
    if(methodFilter && p.PaymentMethod!==methodFilter) return false;
    if(statusFilter && (p.PaymentStatus||'รอชำระ')!==statusFilter) return false;
    if(q){
      const hay=`${p.CustomerName||''} ${p.OrderID||''} ${p.PaymentID||''}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
  if(!rows.length){document.getElementById('paymentTable').innerHTML=emptyState('ไม่พบรายการที่ตรงกับเงื่อนไข');return}

  document.getElementById('paymentTable').innerHTML=`<table>
    <thead><tr><th>รหัส</th><th>คำสั่งซื้อ</th><th>ลูกค้า</th><th>ยอดเงิน</th><th>ช่องทาง</th><th>สลิป</th><th>สถานะ</th><th>ตรวจสอบ</th></tr></thead>
    <tbody>${rows.map(p=>`<tr>
      <td><span class="badge badge-gray">P${p.PaymentID}</span><small>${esc(p.PaymentDate)||'ยังไม่ชำระ'}</small></td>
      <td>#${p.OrderID}</td>
      <td>${esc(p.CustomerName)}</td>
      <td><strong>${money.format(p.Amount)}</strong></td>
      <td>${payBadge(p.PaymentMethod)}</td>
      <td>${p.SlipImage
        ?`<button class="btn-sm amber" onclick="viewSlip(state.payments.find(x=>x.PaymentID===${p.PaymentID}).SlipImage)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>ดูสลิป</button>`
        :'<span style="color:var(--muted);font-size:12px">ไม่มี</span>'}</td>
      <td>${payStatusBadge(p.PaymentStatus)}</td>
      <td>${!NO_PROOF_METHODS.includes(p.PaymentMethod)
        ? (p.SlipImage && p.PaymentStatus==='รอตรวจสอบ'
            ? `<div style="display:flex;gap:4px">
                 <button class="btn-sm sage" onclick="setPaymentStatus(${p.PaymentID},'ยืนยันแล้ว')">ยืนยัน</button>
                 <button class="btn-sm rust" onclick="setPaymentStatus(${p.PaymentID},'ปฏิเสธ')">ปฏิเสธ</button>
               </div>`
            : (p.PaymentStatus==='ปฏิเสธ' || p.PaymentStatus==='ยืนยันแล้ว'
                ? `<button class="btn-sm blue" onclick="confirmReopenPayment(${p.PaymentID})">เปิดตรวจสอบใหม่</button>${p.PaymentStatus==='ยืนยันแล้ว'?`<button class="btn-sm amber" onclick="viewReceipt(${p.OrderID})" style="margin-top:4px">ใบเสร็จ</button>`:''}`
                : '<span style="font-size:11px;color:var(--muted)">รอแนบสลิป/ใบเสร็จ</span>'))
        : (p.PaymentStatus==='ยืนยันแล้ว'
            ? `<button class="btn-sm blue" onclick="setPaymentStatus(${p.PaymentID},'รอชำระ')">ยกเลิกการยืนยัน</button><button class="btn-sm amber" onclick="viewReceipt(${p.OrderID})" style="margin-top:4px">ใบเสร็จ</button>`
            : `<div style="display:flex;gap:4px">
                 <button class="btn-sm sage" onclick="setPaymentStatus(${p.PaymentID},'ยืนยันแล้ว')">ยืนยันรับเงิน</button>
                 <button class="btn-sm rust" onclick="setPaymentStatus(${p.PaymentID},'ปฏิเสธ')">ปฏิเสธ</button>
               </div>`)
      }</td>
    </tr>`).join('')}</tbody></table>`;
}

async function confirmReopenPayment(id){
  if(!confirm('ยืนยันเปิดตรวจสอบใหม่? สถานะจะเปลี่ยนกลับเป็น "รอตรวจสอบ"')) return;
  await setPaymentStatus(id,'รอตรวจสอบ');
}

async function setPaymentStatus(id, status){
  // FIX: disable ปุ่มระหว่างรอ เพื่อป้องกันกดซ้ำ
  const btns = document.querySelectorAll(`[onclick*="setPaymentStatus(${id}"],  [onclick*="confirmReopenPayment(${id}"]`);
  btns.forEach(b=>b.disabled=true);
  try{
    await api(`/api/payments/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});
    const [payments, orders, shipments] = await Promise.all([
      api('/api/payments'), api('/api/orders'), api('/api/shipments')
    ]);
    state.payments = payments;
    state.orders   = orders;
    state.shipments = shipments;
    renderPayments(); renderOrders(); renderShipments();
  }catch(e){ alert(e.message); }
  finally{ btns.forEach(b=>b.disabled=false); }
}
function fillSlipForm(){
  // แสดงเฉพาะรายการที่ต้องมีหลักฐานจริง (โอน/บัตร) — เงินสดและเก็บเงินปลายทางไม่ต้องแนบสลิป
  const relevant = state.payments.filter(p => !NO_PROOF_METHODS.includes(p.PaymentMethod));
  const opts=relevant.map(p=>`<option value="${p.PaymentID}">P${p.PaymentID} — #${p.OrderID} ${esc(p.CustomerName)} · ${methodLabel(p.PaymentMethod)} (${money.format(p.Amount)})</option>`).join('');
  document.getElementById('slipPaymentId').innerHTML='<option value="">— เลือก Payment ID —</option>'+(opts||'');
  if(!relevant.length){
    document.getElementById('slipPaymentId').innerHTML='<option value="">— ไม่มีรายการที่ต้องแนบสลิป —</option>';
  }
  onSlipPaymentSelect(document.getElementById('slipPaymentId').value);
}

// ══ FORMS ═══════════════════════════════════════════════════════════

// [FIX] จำกัดขนาดไฟล์สลิปฝั่ง frontend ก่อนอ่าน/ส่งขึ้น server — ค่าคงที่ SLIP_MAX_BYTES
// ย้ายไปประกาศรวมไว้ที่ core.js แล้ว (โหลดก่อนไฟล์นี้เสมอ) เพื่อให้ทุกจุดอัปโหลดสลิปใช้ค่าเดียวกัน

function previewSlip(input){
  const file=input.files[0];
  const label=document.getElementById('slipFileLabel');
  const err=document.getElementById('slipError');
  if(!file){ if(label) label.textContent='คลิกหรือลากไฟล์มาวางที่นี่'; return }
  if(file.size > SLIP_MAX_BYTES){
    if(err) err.textContent = `ไฟล์ใหญ่เกินไป (${(file.size/1024/1024).toFixed(1)}MB) กรุณาเลือกไฟล์ไม่เกิน 4MB`;
    input.value='';
    if(label) label.textContent='คลิกหรือลากไฟล์มาวางที่นี่';
    document.getElementById('slipPreview').style.display='none';
    return;
  }
  if(err) err.textContent='';
  if(label) label.textContent=file.name;
  const reader=new FileReader();
  reader.onload=e=>{const img=document.getElementById('slipPreview');img.src=e.target.result;img.style.display='block';};
  reader.readAsDataURL(file);
}

// แสดงสรุปรายการที่เลือก (ลูกค้า/ยอดเงิน/ช่องทาง) + คำแนะนำบัญชีถ้าเป็นการโอน
function onSlipPaymentSelect(id){
  const summary=document.getElementById('slipOrderSummary');
  const bankHint=document.getElementById('slipBankHint');
  const p=state.payments.find(x=>x.PaymentID===Number(id));
  if(!p){
    summary.style.display='none'; summary.innerHTML='';
    bankHint.style.display='none';
    return;
  }
  summary.style.display='';
  summary.innerHTML=`
    <div class="pay-order-summary-row"><span>คำสั่งซื้อ</span><strong>#${p.OrderID}</strong></div>
    <div class="pay-order-summary-row"><span>ลูกค้า</span><strong>${esc(p.CustomerName)}</strong></div>
    <div class="pay-order-summary-row"><span>ยอดเงิน</span><strong>${money.format(p.Amount)}</strong></div>
    <div class="pay-order-summary-row"><span>ช่องทาง</span>${payBadge(p.PaymentMethod)}</div>
  `;
  bankHint.style.display = (p.PaymentMethod==='โอน') ? '' : 'none';
}

async function uploadSlip(){
  const err=document.getElementById('slipError'); err.textContent='';
  const payId=Number(document.getElementById('slipPaymentId').value);
  const file=document.getElementById('slipFile').files[0];
  if(!payId){err.textContent='กรุณาเลือกรายการชำระเงิน';return}
  if(!file){err.textContent='กรุณาเลือกไฟล์สลิป';return}
  if(file.size > SLIP_MAX_BYTES){err.textContent=`ไฟล์ใหญ่เกินไป (${(file.size/1024/1024).toFixed(1)}MB) กรุณาเลือกไฟล์ไม่เกิน 4MB`;return}
  try{
    const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});
    await api(`/api/payments/${payId}`,{method:'PATCH',body:JSON.stringify({slip:b64})});
    document.getElementById('slipFile').value='';
    document.getElementById('slipPreview').style.display='none';
    document.getElementById('slipFileLabel').textContent='คลิกหรือลากไฟล์มาวางที่นี่';
    document.getElementById('slipPaymentId').value='';
    onSlipPaymentSelect('');
    toast('บันทึกสลิปสำเร็จ ✓'); await loadAll();
  }catch(ex){err.textContent=ex.message}
}

function viewSlip(src){document.getElementById('slipModalImg').src=src;document.getElementById('slipModal').classList.add('open')}
function closeSlipModal(){document.getElementById('slipModal').classList.remove('open')}
