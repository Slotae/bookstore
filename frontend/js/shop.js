// ================================================================
// SHOP — customer orders, bookstore catalog, and cart
// ================================================================
function renderMyOrders(orders){
  const el=document.getElementById('myOrderTable');
  if(!el) return;
  if(!orders||!orders.length){el.innerHTML=emptyState('ยังไม่มีคำสั่งซื้อ');return}
  el.innerHTML=`<div class="order-list">${orders.map(o=>{
    const slipCell = NO_PROOF_METHODS.includes(o.PaymentMethod)
        ? (o.PaymentStatus==='ยืนยันแล้ว'
            ? '<span class="order-slip-note">ไม่ต้องแนบสลิป</span>'
            : (o.PaymentStatus==='ปฏิเสธ'
                ? '<span class="order-slip-note" style="color:var(--rust,#b0413e)">การชำระเงินถูกปฏิเสธ — กรุณาติดต่อร้าน</span>'
                : '<span class="order-slip-note">รอพนักงานยืนยันรับเงิน</span>'))
        : (o.SlipImage
        ? `<div class="order-slip-actions">
             <button class="btn-sm sage" onclick="viewSlip(myOrdersCache.find(x=>x.OrderID===${o.OrderID}).SlipImage)">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>ดูสลิป
             </button>
             ${o.PaymentID && o.PaymentStatus!=='ยืนยันแล้ว' && o.Status!=='ยกเลิก'?`<button class="btn-sm amber" onclick="openMySlipUpload(${o.PaymentID},'${o.OrderID}')">เปลี่ยนสลิป</button>`:''}
           </div>`
        : (o.PaymentID
            ? (o.Status!=='ยกเลิก' ? `<button class="btn-sm rust" onclick="openMySlipUpload(${o.PaymentID},'${o.OrderID}')">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>แนบสลิป
               </button>` : '')
            : '<span class="order-slip-note">ไม่มี payment</span>'));
    return `<div class="order-card">
      <div class="order-card-head">
        <div>
          <div class="order-card-id">คำสั่งซื้อ #${o.OrderID}</div>
          <div class="order-card-date">${esc(o.OrderDate)}</div>
        </div>
        <div class="order-card-amount">${money.format(o.Amount||0)}</div>
      </div>
      <div class="order-card-items">${esc(o.Items)||'—'}</div>
      <div class="order-card-meta">
        <div class="order-meta-item">
          <span class="order-meta-label">การชำระ</span>
          ${payBadge(o.PaymentMethod)}
        </div>
        <div class="order-meta-item">
          <span class="order-meta-label">สถานะชำระเงิน</span>
          ${payStatusBadge(o.PaymentStatus)}
        </div>
        <div class="order-meta-item">
          <span class="order-meta-label">สลิป</span>
          ${slipCell}
        </div>
        <div class="order-meta-item">
          <span class="order-meta-label">สถานะจัดส่ง</span>
          ${statusBadge(o.Status)}
          ${o.Status==='ยกเลิก' && o.CancelNote ? `<small style="display:block;color:var(--muted);font-size:11px;max-width:180px;word-break:break-word;margin-top:3px">หมายเหตุ: ${esc(o.CancelNote)}</small>` : ''}
        </div>
        <div class="order-meta-item">
          <span class="order-meta-label">Tracking</span>
          <code style="font-size:12px">${esc(o.TrackingNo)||'—'}</code>
        </div>
      </div>
      ${o.Status==='รอจัดส่ง' || o.PaymentStatus==='ยืนยันแล้ว' ? `<div class="order-card-foot">
        ${o.PaymentStatus==='ยืนยันแล้ว' ? `<button class="btn-sm amber" onclick="viewReceipt(${o.OrderID})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>ดูใบเสร็จ
        </button>` : ''}
        ${o.Status==='รอจัดส่ง' ? `<button class="btn-sm rust" onclick="cancelOrder(${o.OrderID})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>ยกเลิกคำสั่งซื้อ
        </button>` : ''}
      </div>` : ''}
    </div>`;
  }).join('')}</div>`;
  myOrdersCache = orders; // [FIX-8] เก็บไว้ให้ viewSlip อ้างอิงแทนการฝังbase64ลงใน onclick โดยตรง
}
let myOrdersCache = [];

function openMySlipUpload(paymentId, orderId){
  document.getElementById('mySlipPaymentId').value = paymentId;
  document.getElementById('mySlipOrderLabel').textContent = `#${orderId}`;
  document.getElementById('mySlipFile').value = '';
  document.getElementById('mySlipPreview').style.display = 'none';
  document.getElementById('mySlipError').textContent = '';
  document.getElementById('mySlipModal').classList.add('open');
}

function closeMySlipModal(){
  document.getElementById('mySlipModal').classList.remove('open');
}

function previewMySlip(input){
  if(!input.files[0]) return;
  const r=new FileReader();
  r.onload=e=>{
    const img=document.getElementById('mySlipPreview');
    img.src=e.target.result;
    img.style.display='block';
  };
  r.readAsDataURL(input.files[0]);
}

async function submitMySlip(){
  const err=document.getElementById('mySlipError');
  err.textContent='';
  const payId=document.getElementById('mySlipPaymentId').value;
  const file=document.getElementById('mySlipFile').files[0];
  if(!file){err.textContent='กรุณาเลือกไฟล์สลิป';return}
  const b64=await new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsDataURL(file);});
  try{
    await api(`/api/payments/${payId}`,{method:'PATCH',body:JSON.stringify({slip:b64})});
    toast('บันทึกสลิปสำเร็จ ✓');
    closeMySlipModal();
    const orders=await api('/api/my/orders');
    renderMyOrders(orders);
    document.getElementById('recentOrders').innerHTML=renderMyOrdersMini(orders.slice(0,5));
  }catch(e){err.textContent=e.message;}
}

function renderMyOrdersMini(orders){
  if(!orders||!orders.length) return emptyState('ยังไม่มีคำสั่งซื้อ');
  return `<div class="mini-order-list">${orders.map(o=>`
    <div class="mini-order-row">
      <div class="mini-order-main">
        <span class="mini-order-id">#${o.OrderID}</span>
        <span class="mini-order-items">${esc(o.Items)||'—'}</span>
        <span class="mini-order-date">${esc(o.OrderDate)}</span>
      </div>
      <div class="mini-order-side">
        <span class="mini-order-amount">${money.format(o.Amount||0)}</span>
        ${statusBadge(o.Status)}
      </div>
    </div>`).join('')}</div>`;
}

function renderMyAccountSummary(orders){
  if(!orders) orders=[];
  const active = orders.filter(o=>o.Status!=='ยกเลิก');
  const totalSpent = active.reduce((sum,o)=>sum+(Number(o.Amount)||0),0);
  const pending = orders.filter(o=>o.Status==='รอจัดส่ง').length;
  const shipped = orders.filter(o=>o.Status==='จัดส่งแล้ว').length;
  return `<div class="mini-list">
    <div class="mini-list-row">
      <span class="mini-list-name">คำสั่งซื้อทั้งหมด</span>
      <span class="mini-list-val">${orders.length}</span>
    </div>
    <div class="mini-list-row">
      <span class="mini-list-name">ยอดใช้จ่ายสะสม (ไม่รวมที่ยกเลิก)</span>
      <span class="mini-list-val">${money.format(totalSpent)}</span>
    </div>
    <div class="mini-list-row">
      <span class="mini-list-name">รอจัดส่ง</span>
      <span class="mini-list-val">${pending}</span>
    </div>
    <div class="mini-list-row">
      <span class="mini-list-name">จัดส่งแล้ว</span>
      <span class="mini-list-val">${shipped}</span>
    </div>
  </div>`;
}

// ══ SHOP / CART (ลูกค้า) ════════════════════════════════════════════
let shopBooks = [];
let cart = []; // [{isbn, bookName, price, quantity}]
let myCustomerID = null;
let checkoutMethod = 'โอน';
const NO_PROOF_METHODS = ['เงินสด', 'ปลายทาง']; // วิธีชำระที่ไม่ต้องแนบสลิป/ใบเสร็จ
let checkoutSlipBase64 = null;

async function loadShop() {
  try {
    shopBooks = await api('/api/books');
    renderShopCatalog(shopBooks);
    // โหลดที่อยู่ default จาก profile
    const profile = await api('/api/my/profile');
    if (profile) {
      myCustomerID = profile.CustomerID;
      if (!document.getElementById('checkoutAddress').value)
        document.getElementById('checkoutAddress').value = profile.Address || '';
    }
  } catch(e) { toast(e.message, 'error'); }
}

function filterShop() {
  const q = document.getElementById('shopSearch').value.toLowerCase();
  const filtered = q ? shopBooks.filter(b =>
    b.BookName.toLowerCase().includes(q) ||
    (b.Authors||'').toLowerCase().includes(q) ||
    (b.Categories||'').toLowerCase().includes(q)
  ) : shopBooks;
  renderShopCatalog(filtered);
}

function renderShopCatalog(books) {
  const el = document.getElementById('shopCatalog');
  if (!books || !books.length) {
    el.innerHTML = '<div class="empty" style="grid-column:1/-1">ไม่พบหนังสือ</div>';
    return;
  }
  el.innerHTML = books.map(b => {
    const inCart = cart.find(c => c.isbn === b.ISBN);
    const outOfStock = b.Stock <= 0;
    return `<div class="book-card">
      <div class="book-card-body">
        <div class="book-card-title">${esc(b.BookName)}</div>
        <div class="book-card-author">${esc(b.Authors) || '—'}</div>
        <div class="book-card-author" style="margin-top:2px">หมวด: ${esc(b.Categories) || '—'}</div>
        <div class="book-card-price">${money.format(b.Price)}</div>
        <div class="book-card-stock ${b.Stock<=5?'':''}">
          <span class="badge ${b.Stock<=0?'badge-rust':b.Stock<=5?'badge-amber':'badge-sage'}">${b.Stock<=0?'หมดสต็อก':b.Stock+' เล่ม'}</span>
          ${inCart?`<span class="badge badge-blue" style="margin-left:4px">ในตะกร้า ${inCart.quantity} ชิ้น</span>`:''}
        </div>
      </div>
      <button class="btn-add-cart" onclick="addToCart('${encodeURIComponent(b.ISBN)}','${encodeURIComponent(b.BookName)}',${b.Price},${b.Stock})" ${outOfStock?'disabled':''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ${outOfStock ? 'หมดสต็อก' : inCart ? 'เพิ่มอีก' : 'เพิ่มในตะกร้า'}
      </button>
    </div>`;
  }).join('');
}

function addToCart(isbn, bookName, price, stock) {
  isbn = decodeURIComponent(isbn);
  bookName = decodeURIComponent(bookName);
  const existing = cart.find(c => c.isbn === isbn);
  if (existing) {
    if (existing.quantity >= stock) { toast('สินค้าในตะกร้าเท่ากับสต็อกแล้ว', 'error'); return; }
    existing.quantity++;
  } else {
    cart.push({ isbn, bookName, price, quantity: 1, stock });
  }
  renderCart();
  // [FIX-10] ใช้ filterShop() แทนการกรองซ้ำเอง เพื่อคงคำค้นหา/ผลลัพธ์เดิมไว้
  // (เดิมกรองเฉพาะ BookName ทำให้ผลลัพธ์ไม่ตรงกับ filterShop() ที่กรองทั้งชื่อ/ผู้แต่ง/หมวดหมู่)
  filterShop();
  toast(`เพิ่ม "${esc(bookName)}" ในตะกร้าแล้ว ✓`);
}

function updateCartQty(isbn, delta) {
  const item = cart.find(c => c.isbn === isbn);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) cart = cart.filter(c => c.isbn !== isbn);
  else if (item.quantity > item.stock) { item.quantity = item.stock; toast('เกินสต็อกที่มี', 'error'); }
  renderCart();
  // [FIX-10] เดิมเรียก renderShopCatalog(shopBooks) ตรงๆ ทำให้ตัวกรองค้นหาที่พิมพ์ไว้ในช่อง
  // "ค้นหาหนังสือ" หายไปทันทีที่กดปรับจำนวนในตะกร้า (แสดงหนังสือทุกเล่มแทนที่จะแสดงตามคำค้นหาเดิม)
  // แก้โดยเรียก filterShop() เพื่อคงการกรองปัจจุบันไว้เสมอ
  filterShop();
}

function removeFromCart(isbn) {
  cart = cart.filter(c => c.isbn !== isbn);
  renderCart();
  filterShop(); // [FIX-10] คงตัวกรองค้นหาเดิมไว้ (ดูรายละเอียดใน updateCartQty ด้านบน)
}

function clearCart() {
  cart = [];
  renderCart();
  filterShop(); // [FIX-10] คงตัวกรองค้นหาเดิมไว้ (ดูรายละเอียดใน updateCartQty ด้านบน)
}

function renderCart() {
  const el = document.getElementById('cartItems');
  const totalEl = document.getElementById('cartTotal');
  const totalAmt = document.getElementById('cartTotalAmt');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const badge = document.getElementById('cartBadge');

  const totalQty = cart.reduce((s,c) => s+c.quantity, 0);
  badge.textContent = totalQty;
  badge.style.display = totalQty > 0 ? '' : 'none';

  if (!cart.length) {
    el.innerHTML = '<div class="empty" style="padding:24px 14px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:30px;height:30px;margin:0 auto 6px;display:block;color:var(--border)"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>ยังไม่มีสินค้าในตะกร้า</div>';
    totalEl.style.display = 'none';
    checkoutBtn.disabled = true;
    return;
  }

  el.innerHTML = cart.map(c => `
    <div class="cart-item">
      <div style="flex:1">
        <div class="cart-item-name">${esc(c.bookName)}</div>
        <div class="cart-item-price">${money.format(c.price)} × ${c.quantity} = ${money.format(c.price * c.quantity)}</div>
      </div>
      <div class="cart-qty">
        <button onclick="updateCartQty('${c.isbn}',-1)">−</button>
        <span>${c.quantity}</span>
        <button onclick="updateCartQty('${c.isbn}',1)">+</button>
      </div>
      <button class="cart-remove" onclick="removeFromCart('${c.isbn}')" title="ลบออก" aria-label="ลบ ${esc(c.bookName)} ออกจากตะกร้า">×</button>
    </div>
  `).join('');

  const total = cart.reduce((s,c) => s + c.price * c.quantity, 0);
  totalAmt.textContent = money.format(total);
  totalEl.style.display = '';
  checkoutBtn.disabled = false;
}
