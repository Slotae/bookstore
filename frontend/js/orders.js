function renderOrders(){
  const box = document.getElementById('orderTable');
  if(!box) return;
  if(!state.orders.length){box.innerHTML=emptyState('ยังไม่มีคำสั่งซื้อ');return}

  const q = (document.getElementById('orderSearch')?.value||'').trim().toLowerCase();
  const payFilter = document.getElementById('orderPayFilter')?.value || '';

  // Query 14 (RIGHT JOIN Orders→Payment): ออเดอร์ที่ยังไม่มีการชำระถือเป็น "รอชำระ" เสมอ
  let rows = state.orders.filter(o=>{
    const status = o.PaymentStatus || 'รอชำระ';
    if(payFilter && status!==payFilter) return false;
    if(!q) return true;
    return String(o.OrderID).includes(q) || (o.CustomerName||'').toLowerCase().includes(q);
  });

  if(!rows.length){box.innerHTML=emptyState('ไม่พบคำสั่งซื้อที่ตรงกับเงื่อนไข');return}

  // [FIX-12] Admin/พนักงานขาย ยกเลิกออเดอร์ได้จากตารางนี้เช่นกัน (พร้อมหมายเหตุ)
  const canCancel = ME?.role==='Admin' || ME?.role==='พนักงานขาย';

  // แสดงเป็นการ์ด (รูปแบบเดียวกับ "คำสั่งซื้อของฉัน" ฝั่งลูกค้า) แทนตารางแถวยาว
  // เพื่อไม่ให้ badge/ปุ่มดูสลิป/ใบเสร็จเบียดกันจนอ่านยากเหมือนตารางเดิม
  box.innerHTML = `<div class="order-list">${rows.map(o=>`
    <div class="order-card">
      <div class="order-card-head">
        <div>
          <div class="order-card-id">#${o.OrderID}</div>
          <div class="order-card-date">${esc(o.OrderDate)}</div>
        </div>
        <div class="order-card-amount">${money.format(o.Amount||0)}</div>
      </div>
      <div class="order-card-items">${esc(o.Items)||'—'}</div>
      <div class="order-card-meta">
        <div class="order-meta-item">
          <span class="order-meta-label">ลูกค้า</span>
          <strong style="font-size:13.5px">${esc(o.CustomerName)}</strong>
          <small style="color:var(--muted)">${esc(o.Phone)||'—'}</small>
        </div>
        <div class="order-meta-item">
          <span class="order-meta-label">การชำระ</span>
          ${payBadge(o.PaymentMethod)}
        </div>
        <div class="order-meta-item">
          <span class="order-meta-label">สถานะชำระเงิน</span>
          ${payStatusBadge(o.PaymentStatus)}
        </div>
        <div class="order-meta-item">
          <span class="order-meta-label">สถานะจัดส่ง</span>
          ${statusBadge(o.Status)}
          ${o.TrackingNo?`<code style="font-size:11.5px;color:var(--muted)">${esc(o.TrackingNo)}</code>`:''}
          ${o.Status==='ยกเลิก' && o.CancelNote?`<small style="display:block;color:var(--muted);font-size:11px;max-width:200px;word-break:break-word;margin-top:3px">หมายเหตุ: ${esc(o.CancelNote)}</small>`:''}
        </div>
      </div>
      ${(o.SlipImage || o.PaymentStatus==='ยืนยันแล้ว' || (canCancel && o.Status==='รอจัดส่ง')) ? `<div class="order-card-foot">
        ${o.SlipImage?`<button class="btn-sm sage" onclick="viewSlip(state.orders.find(x=>x.OrderID===${o.OrderID}).SlipImage)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>ดูสลิป
        </button>`:''}
        ${o.PaymentStatus==='ยืนยันแล้ว'?`<button class="btn-sm amber" onclick="viewReceipt(${o.OrderID})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>ใบเสร็จ
        </button>`:''}
        ${canCancel && o.Status==='รอจัดส่ง'?`<button class="btn-sm rust" onclick="cancelOrderAdmin(${o.OrderID})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>ยกเลิก
        </button>`:''}
      </div>`:''}
    </div>`).join('')}</div>
    <div style="padding:12px 4px 4px;font-size:12px;color:var(--muted)">พบ ${rows.length} จาก ${state.orders.length} รายการ</div>`;
}

// [FIX-12] ยกเลิกออเดอร์จากฝั่งแอดมิน/พนักงานขาย พร้อมหมายเหตุ (ไม่บังคับ)
// ใช้ cancelOrderModal ร่วมกับฝั่งลูกค้า — เปิดโมดัลแทน confirm()/prompt() ของเบราว์เซอร์
function cancelOrderAdmin(orderId){
  openCancelModal(orderId, { onDone: loadAll });
}

// ── หน้าคลังหนังสือ: วิดเจ็ตด้านข้าง (Query 5 + Query 13/22) ──
async function loadBookSideWidgets(){
  try{
    const [topPrice, categories] = await Promise.all([
      // Query 5: หนังสือ 5 อันดับราคาแพงที่สุด (TOP 5 + ORDER BY)
      state.books.length ? Promise.resolve([...state.books].sort((a,b)=>b.Price-a.Price || a.Stock-b.Stock).slice(0,5)) : [],
      api('/api/categories/stats')
    ]);
    document.getElementById('topPriceWidget').innerHTML = topPrice.length
      ? `<div class="mini-list">${topPrice.map((b,i)=>`<div class="mini-list-row">
          <span class="mini-list-rank">${i+1}</span>
          <span class="mini-list-name">${esc(b.BookName)}</span>
          <span class="mini-list-val">${money.format(b.Price)}</span>
        </div>`).join('')}</div>`
      : emptyState('ยังไม่มีข้อมูล');

    const maxRev = Math.max(1, ...categories.map(c=>Number(c.Revenue||0)));
    document.getElementById('categoryWidget').innerHTML = categories.length
      ? `<div class="bar-chart">${categories.map(c=>`<div class="bar-row">
          <span class="bar-label">${esc(c.CategoryName)}</span>
          <div class="bar-track"><div class="bar-fill sage" style="width:${Math.max(3,c.Revenue/maxRev*100)}%"></div></div>
          <span class="bar-value">${money.format(c.Revenue||0)}</span>
        </div>`).join('')}
        <div class="toolbar-hint" style="padding-top:4px">จำนวนหนังสือต่อหมวด: ${categories.map(c=>`${esc(c.CategoryName)} (${c.BookCount})`).join(' · ')}</div></div>`
      : emptyState('ยังไม่มีหมวดหมู่');
  }catch(e){
    document.getElementById('topPriceWidget').innerHTML = emptyState(e.message);
    document.getElementById('categoryWidget').innerHTML = emptyState(e.message);
  }
}


let _orderItemCount = 0;
function fillOrderForm(){
  const custOpts=state.customers.map(c=>`<option value="${c.CustomerID}">${esc(c.CustomerName)}</option>`).join('');
  document.getElementById('orderCustomer').innerHTML='<option value="">— เลือกลูกค้า —</option>'+custOpts;
  document.querySelector('[name=orderDate]').value=bangkokToday();
  // รีเซ็ต rows แล้วเพิ่มแถวแรก
  _orderItemCount = 0;
  document.getElementById('orderItems').innerHTML = '';
  addOrderItem(true);
}
function _bookOptions(required){
  const req = required ? 'required' : '';
  const placeholder = required ? '— เลือกหนังสือ —' : '— ไม่เลือก —';
  return `<option value="">${placeholder}</option>`
    + state.books.map(b=>`<option value="${esc(b.ISBN)}">${esc(b.BookName)} (เหลือ ${b.Stock})</option>`).join('');
}
function addOrderItem(required=false){
  _orderItemCount++;
  const n = _orderItemCount;
  const div = document.createElement('div');
  div.className = 'form-row';
  div.id = `orderRow${n}`;
  div.style.marginBottom = '9px';
  div.innerHTML = `
    <label>หนังสือรายการที่ ${n}
      <select name="isbn${n}" id="bookSelect${n}" ${required?'required':''}>${_bookOptions(required)}</select>
    </label>
    <label>จำนวน <input name="qty${n}" type="number" min="1" value="1" ${required?'required':''}></label>
    ${n > 1 ? `<button type="button" class="btn-sm rust" style="align-self:flex-end;margin-bottom:2px" onclick="removeOrderItem(${n})">✕</button>` : ''}
  `;
  document.getElementById('orderItems').appendChild(div);
}
function removeOrderItem(n){
  document.getElementById(`orderRow${n}`)?.remove();
}

document.getElementById('orderCustomer').addEventListener('change',e=>{
  const c=state.customers.find(x=>x.CustomerID===Number(e.target.value));
  if(c) document.querySelector('#orderForm [name=address]').value=c.Address;
});


document.getElementById('orderForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.currentTarget;
  const err=document.getElementById('orderError'); err.textContent='';
  await withSubmitLock(form, async()=>{
    try{
      const f=Object.fromEntries(new FormData(form));
      const items=[];
      for(let i=1;i<=_orderItemCount;i++){
        if(f[`isbn${i}`]) items.push({isbn:f[`isbn${i}`],quantity:Number(f[`qty${i}`]||1)});
      }
      const created = await api('/api/orders',{method:'POST',body:JSON.stringify({
        customerId:Number(f.customerId),orderDate:f.orderDate,
        items,paymentMethod:f.paymentMethod,address:f.address
      })});
      form.reset();
      await loadAll();
      showOrderSuccessModal({
        orderId: created ? created.OrderID : null,
        total: created ? created.total : null,
        method: f.paymentMethod,
        address: f.address,
        cardLast4: null,
        slipAttached: false,
        viewMode: 'staff'
      });
    }catch(ex){err.textContent=ex.message}
  });
});

// [FIX-12] เปิดโมดัลยืนยันยกเลิก — แทนที่ confirm()/prompt() ของเบราว์เซอร์ด้วย UI ที่แจ้งเตือนชัดเจนกว่า
function cancelOrder(orderId){
  openCancelModal(orderId, { onDone: async () => {
    // FIX: โหลด orders + books พร้อมกัน เพื่ออัปเดต stock ในร้านด้วย
    const [orders, books] = await Promise.all([api('/api/my/orders'), api('/api/books')]);
    shopBooks = books;
    renderMyOrders(orders);
    document.getElementById('recentOrders').innerHTML=renderMyOrdersMini(orders.slice(0,5));
    renderShopCatalog(shopBooks);
  }});
}

// ── โมดัลยกเลิกคำสั่งซื้อ (ใช้ร่วมกันทั้งฝั่งลูกค้าและแอดมิน/พนักงานขาย) ──
let cancelModalState = { orderId: null, onDone: null };
function openCancelModal(orderId, { onDone } = {}){
  cancelModalState = { orderId, onDone };
  document.getElementById('cancelOrderLabel').textContent = `#${orderId}`;
  document.getElementById('cancelOrderNote').value = '';
  document.getElementById('cancelOrderError').textContent = '';
  document.getElementById('cancelOrderModal').classList.add('open');
}
function closeCancelModal(){
  document.getElementById('cancelOrderModal').classList.remove('open');
  cancelModalState = { orderId: null, onDone: null };
}
async function submitCancelOrder(){
  const { orderId, onDone } = cancelModalState;
  if(!orderId) return;
  const note = document.getElementById('cancelOrderNote').value.trim().slice(0, 500);
  const errEl = document.getElementById('cancelOrderError');
  errEl.textContent = '';
  try{
    await api(`/api/orders/${orderId}/cancel`,{method:'PATCH',body:JSON.stringify({note})});
    closeCancelModal();
    toast('ยกเลิกคำสั่งซื้อสำเร็จ ✓');
    if(onDone) await onDone();
  }catch(ex){ errEl.textContent = ex.message; }
}

// ══ SLIP ════════════════════════════════════════════════════════════

async function viewReceipt(orderId){
  document.getElementById('receiptModal').classList.add('open');
  const body=document.getElementById('receiptBody');
  body.innerHTML='<div class="loading"><div class="spinner"></div>กำลังโหลด…</div>';
  try{
    const r = await api(`/api/orders/${orderId}/receipt`);
    body.innerHTML = renderReceiptHtml(r);
  }catch(e){
    body.innerHTML = `<div class="form-error" style="display:block">${esc(e.message)}</div>`;
  }
}
function closeReceiptModal(){document.getElementById('receiptModal').classList.remove('open')}

function renderReceiptHtml(r){
  const o = r.order;
  return `
    <div class="receipt-doc">
      <div class="receipt-shop">ร้านหนังสือ The Ledger</div>
      <div class="receipt-shop-sub">ใบเสร็จรับเงิน / Payment Receipt</div>
      <div class="receipt-rule"></div>
      <div class="receipt-row"><span>เลขที่ใบเสร็จ</span><strong>${esc(r.receiptNo)}</strong></div>
      <div class="receipt-row"><span>คำสั่งซื้อ</span><strong>#${o.OrderID}</strong></div>
      <div class="receipt-row"><span>วันที่สั่งซื้อ</span><strong>${esc(o.OrderDate)}</strong></div>
      <div class="receipt-row"><span>วันที่ชำระเงิน</span><strong>${esc(o.PaymentDate)||'—'}</strong></div>
      <div class="receipt-rule"></div>
      <div class="receipt-row"><span>ลูกค้า</span><strong>${esc(o.CustomerName)}</strong></div>
      <div class="receipt-row"><span>เบอร์โทร</span><strong>${esc(o.Phone)||'—'}</strong></div>
      ${o.ShipAddress?`<div class="receipt-row"><span>ที่อยู่จัดส่ง</span><strong style="text-align:right;max-width:220px">${esc(o.ShipAddress)}</strong></div>`:''}
      <div class="receipt-rule"></div>
      <table class="receipt-items">
        <thead><tr><th>รายการ</th><th>จำนวน</th><th>ราคา/หน่วย</th><th>รวม</th></tr></thead>
        <tbody>${r.items.map(it=>`<tr>
          <td>${esc(it.BookName)}</td>
          <td style="text-align:center">${it.Quantity}</td>
          <td style="text-align:right">${money.format(it.UnitPrice)}</td>
          <td style="text-align:right">${money.format(it.Subtotal)}</td>
        </tr>`).join('')}</tbody>
      </table>
      <div class="receipt-rule"></div>
      <div class="receipt-row receipt-total"><span>ยอดชำระทั้งหมด</span><strong>${money.format(o.Amount||0)}</strong></div>
      <div class="receipt-row"><span>ช่องทางชำระเงิน</span>${payBadge(o.PaymentMethod)}</div>
      <div class="receipt-row"><span>สถานะ</span>${payStatusBadge(o.PaymentStatus)}</div>
      <div class="receipt-rule"></div>
      <div class="receipt-footer">ขอบคุณที่อุดหนุนร้านหนังสือ The Ledger</div>
    </div>`;
}
