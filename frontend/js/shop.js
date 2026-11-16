// ================================================================
// SHOP — customer orders, bookstore catalog, and cart
// ================================================================
let customerTrackingMaps = new Map();
let customerTrackingTimer = null;
let customerTrackingBusy = false;

function customerMapId(shipmentId){ return `customerTrackingMap_${Number(shipmentId)}`; }
function customerMapCleanup(){
  for(const m of customerTrackingMaps.values()) { try{m.remove()}catch{} }
  customerTrackingMaps.clear();
}
function refreshCustomerTrackingMapSizes(){
  for(const m of customerTrackingMaps.values()){
    try{m.invalidateSize(true)}catch{}
  }
}
if(!window._customerTrackingResizeBound){
  window._customerTrackingResizeBound=true;
  window.addEventListener('resize', debounce(refreshCustomerTrackingMapSizes, 120));
}
function customerTrackingStatusText(o){
  if(o.Status==='กำลังจัดส่ง') return 'พนักงานกำลังเดินทางมาหาคุณ';
  if(o.Status==='จัดส่งแล้ว') return 'จัดส่งสำเร็จแล้ว';
  if(o.Status==='รอจัดส่ง') return 'รอพนักงานรับงาน';
  return o.Status||'กำลังดำเนินการ';
}
function customerTrackingMapHtml(o){
  if(!o.ShipmentID || o.Status==='ยกเลิก') return '';
  const live=o.Status==='กำลังจัดส่ง';
  return `<section class="customer-live-tracking">
    <div class="customer-live-head">
      <div>
        <span class="tracking-kicker">LIVE DELIVERY TRACKING</span>
        <strong>${customerTrackingStatusText(o)}</strong>
      </div>
      ${live?'<span class="customer-live-pill"><i></i> LIVE</span>':''}
    </div>
    <div class="customer-live-map" id="${customerMapId(o.ShipmentID)}"></div>
    <div class="customer-live-footer">
      <div><span>ปลายทาง</span><strong>${esc(o.Address||'—')}</strong></div>
      <div><span>อัปเดตล่าสุด</span><strong>${o.LastLocationAt?fmtDate(o.LastLocationAt,true):live?'รอรับตำแหน่งจากพนักงาน':'—'}</strong></div>
    </div>
    ${live && o.AssignedDriverName?`<div class="customer-driver-row"><span>พนักงานจัดส่ง</span><strong>${esc(o.AssignedDriverName)}</strong></div>`:''}
  </section>`;
}
async function renderCustomerTrackingMaps(orders){
  if(typeof L==='undefined') return;
  customerMapCleanup();
  for(const o of (orders||[])){
    if(!o.ShipmentID || o.Status==='ยกเลิก') continue;
    const el=document.getElementById(customerMapId(o.ShipmentID));
    if(!el) continue;
    const map=L.map(el,{zoomControl:true,scrollWheelZoom:false}).setView([13.7563,100.5018],6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
    customerTrackingMaps.set(o.ShipmentID,map);
    const pts=[];
    const dest=await geocodeAddress(o.Address);
    if(dest){
      pts.push([dest.lat,dest.lng]);
      L.marker([dest.lat,dest.lng]).addTo(map).bindPopup(`<strong>ปลายทางของคุณ</strong><br>${esc(o.Address||'')}`);
    }
    if(o.DriverLat!=null && o.DriverLng!=null && o.Status==='กำลังจัดส่ง'){
      const driver=L.circleMarker([Number(o.DriverLat),Number(o.DriverLng)],{radius:9}).addTo(map);
      driver.bindTooltip('ตำแหน่งพนักงานจัดส่ง',{permanent:false});
      pts.push([Number(o.DriverLat),Number(o.DriverLng)]);
    }
    if(pts.length===1) map.setView(pts[0],15);
    else if(pts.length>1) map.fitBounds(L.latLngBounds(pts),{padding:[30,30],maxZoom:15});
    requestAnimationFrame(()=>map.invalidateSize(true));
    setTimeout(()=>map.invalidateSize(true),120);
    setTimeout(()=>map.invalidateSize(true),500);
  }
}
function ensureCustomerTrackingPolling(){
  if(customerTrackingTimer || !ME || ME.role!=='ลูกค้า') return;
  customerTrackingTimer=setInterval(async()=>{
    if(customerTrackingBusy || document.hidden) return;
    if(document.getElementById('shop')?.classList.contains('active')===false && document.getElementById('myorders')?.classList.contains('active')===false) return;
    customerTrackingBusy=true;
    try{
      const fresh=await api('/api/my/orders');
      const active=fresh.some(o=>o.Status==='กำลังจัดส่ง');
      const oldKey=(myOrdersCache||[]).map(o=>`${o.OrderID}:${o.Status}:${o.DriverLat}:${o.DriverLng}:${o.LastLocationAt}`).join('|');
      const newKey=fresh.map(o=>`${o.OrderID}:${o.Status}:${o.DriverLat}:${o.DriverLng}:${o.LastLocationAt}`).join('|');
      if(oldKey!==newKey) renderMyOrders(fresh);
      if(!active){ clearInterval(customerTrackingTimer); customerTrackingTimer=null; }
    }catch{}
    finally{customerTrackingBusy=false;}
  },7000);
}
function renderMyOrders(orders){
  const el=document.getElementById('myOrderTable');
  if(!el)return;
  if(!orders||!orders.length){el.innerHTML=emptyState('ยังไม่มีคำสั่งซื้อ');return}

  const statusSteps=['รอจัดส่ง','กำลังจัดส่ง','จัดส่งแล้ว'];
  const statusIndex=s=>statusSteps.indexOf(s);

  el.innerHTML=`<div class="customer-order-list-simple">${orders.map(o=>{
    const current=statusIndex(o.Status);
    const cancelled=o.Status==='ยกเลิก';
    const timeline=o.Timeline||[];
    const slipCell=NO_PROOF_METHODS.includes(o.PaymentMethod)
      ? (o.PaymentStatus==='ยืนยันแล้ว'?'<span class="order-slip-note">ชำระเงินเรียบร้อย</span>':'<span class="order-slip-note">รอยืนยันการชำระเงิน</span>')
      : (o.SlipImage
        ? `<button class="btn-sm sage" onclick="viewSlip(myOrdersCache.find(x=>x.OrderID===${o.OrderID}).SlipImage)">ดูหลักฐาน</button>`
        : (o.PaymentID&&o.Status!=='ยกเลิก'?`<button class="btn-sm rust" onclick="openMySlipUpload(${o.PaymentID},'${o.OrderID}')">แนบสลิป</button>`:''));
    return `<article class="customer-order-row ${cancelled?'is-cancelled':''}">
      <div class="customer-order-main">
        <div class="customer-order-head">
          <div>
            <div class="order-card-id">คำสั่งซื้อ #${o.OrderID}</div>
            <div class="order-card-date">${esc(o.OrderDate)}</div>
          </div>
          <div class="order-card-amount">${money.format(o.Amount||0)}</div>
        </div>
        <div class="order-card-items">${esc(o.Items)||'—'}</div>
      </div>
      <div class="customer-order-actions">
        <div class="customer-payment-status">${payBadge(o.PaymentMethod)} ${payStatusBadge(o.PaymentStatus)}</div>
        <div class="customer-order-buttons">
          ${!cancelled && o.ShipmentID?`<button class="order-action-primary tracking-btn" onclick="openCustomerDeliveryDetail(${o.OrderID})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/></svg><span>ติดตามการจัดส่ง</span><svg class="action-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h13"/><path d="m13 6 6 6-6 6"/></svg></button>`:''}
          <div class="order-action-secondary">
            ${o.PaymentStatus==='ยืนยันแล้ว'?`<button class="order-action-btn receipt-action" onclick="viewReceipt(${o.OrderID})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg><span>ใบเสร็จ</span></button>`:''}
            ${slipCell}
            ${!cancelled?`<a class="order-action-btn map-action" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.Address||'')}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span>ปลายทาง</span></a>`:''}
          </div>
        </div>
      </div>
    </article>`;
  }).join('')}</div>`;
  myOrdersCache=orders;
  if(orders.some(o=>o.Status==='กำลังจัดส่ง')) ensureCustomerTrackingPolling();
  if(customerDetailOrderId){
    const fresh=myOrdersCache.find(o=>o.OrderID===Number(customerDetailOrderId));
    if(fresh) renderCustomerDeliveryDetail(fresh, false);
  }
}

let myOrdersCache = [];
let customerDetailOrderId = null;
let customerDetailMap = null;

function openCustomerDeliveryDetail(orderId){
  const order=myOrdersCache.find(o=>o.OrderID===Number(orderId));
  if(!order)return;
  customerDetailOrderId=Number(orderId);
  document.getElementById('customerDeliveryDetailModal')?.classList.add('open');
  renderCustomerDeliveryDetail(order, true);
}

function closeCustomerDeliveryDetail(){
  customerDetailOrderId=null;
  if(customerDetailMap){try{customerDetailMap.remove()}catch{} customerDetailMap=null;}
  document.getElementById('customerDeliveryDetailModal')?.classList.remove('open');
}

async function renderCustomerDeliveryDetail(o, resetMap=true){
  const body=document.getElementById('customerDeliveryDetailBody');
  if(!body)return;
  if(resetMap && customerDetailMap){try{customerDetailMap.remove()}catch{} customerDetailMap=null;}
  const steps=['รอจัดส่ง','กำลังจัดส่ง','จัดส่งแล้ว'];
  const current=Math.max(0,steps.indexOf(o.Status));
  const history=(o.Timeline||[]).slice().reverse();
  const live=o.Status==='กำลังจัดส่ง';
  body.innerHTML=`
    <div class="customer-detail-summary">
      <div class="customer-detail-title-row">
        <div><span class="detail-kicker">ORDER TRACKING</span><h3>คำสั่งซื้อ #${o.OrderID}</h3><small>${esc(o.Items||'')}</small></div>
        <div class="customer-detail-price">${money.format(o.Amount||0)}</div>
      </div>
      <div class="customer-detail-status ${live?'is-live':''}">
        <div><span>สถานะปัจจุบัน</span><strong>${esc(o.Status||'รอจัดส่ง')}</strong></div>
        ${live?'<span class="customer-live-pill"><i></i> LIVE</span>':''}
      </div>
      ${o.Status!=='ยกเลิก'?`<div class="customer-detail-stepper">${steps.map((s,i)=>`<div class="customer-detail-step ${i<current?'done':''} ${i===current?'current':''}"><span>${i<current?'✓':i+1}</span><small>${s}</small>${i<steps.length-1?'<i></i>':''}</div>`).join('')}</div>`:''}
      <div class="customer-detail-info-grid">
        <div><span>พนักงานจัดส่ง</span><strong>${esc(o.AssignedDriverName||'รอพนักงานรับงาน')}</strong></div>
        <div><span>Tracking</span><strong>${esc(o.TrackingNo||'ยังไม่มี')}</strong></div>
        <div class="wide"><span>ที่อยู่จัดส่ง</span><strong>${esc(o.Address||'—')}</strong></div>
        <div><span>อัปเดตล่าสุด</span><strong>${o.LastLocationAt?fmtDate(o.LastLocationAt,true):'—'}</strong></div>
        <div><span>เวลาจัดส่งสำเร็จ</span><strong>${o.DeliveredAt?fmtDate(o.DeliveredAt,true):'—'}</strong></div>
      </div>
    </div>
    <div class="customer-detail-map-wrap">
      <div class="customer-detail-map-head"><div><span class="detail-kicker">DELIVERY MAP</span><strong>${live?'พนักงานกำลังเดินทางมาหาคุณ':'ตำแหน่งปลายทาง'}</strong></div>${live?'<span class="customer-map-live-dot"><i></i> อัปเดตอัตโนมัติ</span>':''}</div>
      <div id="customerDeliveryDetailMap" class="customer-detail-map"></div>
      <div class="customer-detail-map-note">${live?'ตำแหน่งพนักงานจะอัปเดตตามข้อมูล GPS ล่าสุด':'แผนที่แสดงตำแหน่งปลายทางของคำสั่งซื้อนี้'}</div>
    </div>
    <div class="customer-detail-history">
      <h4>ประวัติการจัดส่ง</h4>
      ${history.length?history.map((h,i)=>`<div class="customer-detail-history-row"><span class="history-dot"></span><div><strong>${esc(h.Status)}</strong><small>${fmtDate(h.CreatedAt,true)}${h.Note?` · ${esc(h.Note)}`:''}</small></div></div>`).join(''):`<div class="empty" style="padding:16px 0">ยังไม่มีประวัติการจัดส่ง</div>`}
    </div>`;

  if(typeof L==='undefined')return;
  const el=document.getElementById('customerDeliveryDetailMap');
  if(!el)return;
  if(customerDetailMap){try{customerDetailMap.remove()}catch{} customerDetailMap=null;}
  customerDetailMap=L.map(el,{zoomControl:true,scrollWheelZoom:false}).setView([13.7563,100.5018],6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(customerDetailMap);
  const pts=[];
  const dest=await geocodeAddress(o.Address);
  if(dest){
    pts.push([dest.lat,dest.lng]);
    L.marker([dest.lat,dest.lng]).addTo(customerDetailMap).bindPopup(`<strong>ปลายทางของคุณ</strong><br>${esc(o.Address||'')}`);
  }
  if(live && o.DriverLat!=null && o.DriverLng!=null){
    const p=[Number(o.DriverLat),Number(o.DriverLng)];
    pts.push(p);
    L.circleMarker(p,{radius:9}).addTo(customerDetailMap).bindTooltip('พนักงานจัดส่ง');
  }
  if(pts.length===1)customerDetailMap.setView(pts[0],15);
  else if(pts.length>1)customerDetailMap.fitBounds(L.latLngBounds(pts),{padding:[30,30],maxZoom:15});
  requestAnimationFrame(()=>customerDetailMap?.invalidateSize(true));
  setTimeout(()=>customerDetailMap?.invalidateSize(true),150);
}



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
    document.getElementById('myAccountSummary').innerHTML=renderMyAccountSummary(orders);
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
let checkoutSlipBase64 = null;

async function loadShop() {
  try {
    shopBooks = await api('/api/books');
    renderCategoryChips();
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

// [FIX-11] เวอร์ชันสำหรับผู้เยี่ยมชมที่ยังไม่ล็อกอิน — ดูสินค้า/หยิบตะกร้าได้
// ไม่เรียก /api/my/profile เพราะยังไม่มีบัญชี ที่อยู่จัดส่งจะกรอกตอนล็อกอิน/สมัครสมาชิกแทน
async function loadGuestShop() {
  try {
    shopBooks = await api('/api/books');
    renderCategoryChips();
    renderShopCatalog(shopBooks);
    renderCart();
  } catch(e) { toast(e.message, 'error'); }
}

// ══ หมวดหมู่ (chips ด้านบน) ═══════════════════════════════════════
// [FIX-12] ดึงรายชื่อหมวดหมู่ที่ไม่ซ้ำจากข้อมูลหนังสือที่มีอยู่แล้ว (ไม่ต้องยิง API เพิ่ม)
let activeCategory = null; // null = "ทั้งหมด"
function renderCategoryChips() {
  const el = document.getElementById('categoryChips');
  if (!el) return;
  const set = new Set();
  shopBooks.forEach(b => (b.Categories||'').split(',').map(c=>c.trim()).filter(Boolean).forEach(c=>set.add(c)));
  const cats = Array.from(set).sort((a,b)=>a.localeCompare(b,'th'));
  el.innerHTML = `<button type="button" class="category-chip ${activeCategory===null?'active':''}" onclick="selectCategory(null)">ทั้งหมด</button>` +
    cats.map(c => `<button type="button" class="category-chip ${activeCategory===c?'active':''}" onclick="selectCategory('${encodeURIComponent(c)}')">${esc(c)}</button>`).join('');
}
function selectCategory(cat) {
  activeCategory = cat === null ? null : decodeURIComponent(cat);
  renderCategoryChips();
  filterShop();
}

function filterShop() {
  const q = document.getElementById('shopSearch').value.toLowerCase();
  let filtered = shopBooks;
  if (activeCategory) {
    filtered = filtered.filter(b => (b.Categories||'').split(',').map(c=>c.trim()).includes(activeCategory));
  }
  if (q) {
    filtered = filtered.filter(b =>
      b.BookName.toLowerCase().includes(q) ||
      (b.Authors||'').toLowerCase().includes(q) ||
      (b.Categories||'').toLowerCase().includes(q) ||
      (b.ISBN||'').toLowerCase().includes(q)
    );
  }
  renderShopCatalog(filtered);
}

// ══ ปกหนังสือ (สร้างจากสี+ไอคอนตามหมวดหมู่ เพราะไม่มีคอลัมน์รูปปกจริงในฐานข้อมูล) ══
// [FIX-12] หนังสือในระบบนี้เป็นข้อมูลจำลองสำหรับโปรเจกต์ ไม่มีปกจริงให้ใช้ และการไปหยิบภาพปก
// หนังสือจริงจากอินเทอร์เน็ตมาแปะจะกลายเป็นการใช้ภาพที่มีเจ้าของ/สินค้าจริงมาแทนหนังสือปลอม
// จึงสร้าง "ปก" แบบไล่เฉดสีธีมร้าน + ไอคอนหนังสือให้แทน ดูมีมิติกว่าการ์ดตัวหนังสือเปล่าๆ
const COVER_PALETTES = [
  ['#8A0F28','#C41F3D'], ['#2C5A82','#86AFC9'], ['#2E7D46','#7FC494'],
  ['#B9862A','#E3B65C'], ['#7A4A22','#C79A67'], ['#5B3B7A','#9C7CC4']
];
function hashStr(s){ let h=0; for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;} return Math.abs(h); }
function bookCoverGradient(b){
  const key=(b.Categories||b.BookName||'x').split(',')[0].trim()||'x';
  const p=COVER_PALETTES[hashStr(key)%COVER_PALETTES.length];
  return `linear-gradient(150deg, ${p[0]}, ${p[1]})`;
}
function bookCoverHtml(b){
  return `<div class="book-cover" style="background:${bookCoverGradient(b)}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
    <div class="book-cover-name">${esc(b.BookName)}</div>
  </div>`;
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
    return `<div class="book-card" onclick="openBookDetail('${encodeURIComponent(b.ISBN)}')" style="cursor:pointer">
      ${bookCoverHtml(b)}
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
      <button class="btn-add-cart" onclick="event.stopPropagation();addToCart('${encodeURIComponent(b.ISBN)}','${encodeURIComponent(b.BookName)}',${b.Price},${b.Stock})" ${outOfStock?'disabled':''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ${outOfStock ? 'หมดสต็อก' : inCart ? 'เพิ่มอีก' : 'เพิ่มในตะกร้า'}
      </button>
    </div>`;
  }).join('');
}

// ══ Dropdown ตะกร้า (ไอคอนมุมบน) ═════════════════════════════════════
function positionCartDropdown() {
  const dropdown = document.getElementById('cartDropdown');
  const btn = document.getElementById('cartIconBtn');
  if (!dropdown || !btn) return;
  const rect = btn.getBoundingClientRect();
  const width = Math.min(340, window.innerWidth - 20);
  let left = rect.right - width;
  left = Math.max(10, Math.min(left, window.innerWidth - width - 10));
  dropdown.style.width = width + 'px';
  dropdown.style.top = (rect.bottom + 10) + 'px';
  dropdown.style.left = left + 'px';
}
function toggleCartDropdown(evt) {
  if (evt) evt.stopPropagation();
  const dropdown = document.getElementById('cartDropdown');
  if (!dropdown) return;
  if (!dropdown.classList.contains('open')) positionCartDropdown();
  dropdown.classList.toggle('open');
}
function closeCartDropdown() {
  document.getElementById('cartDropdown')?.classList.remove('open');
}
// ปิด dropdown เมื่อคลิกที่อื่นนอกกล่องตะกร้า / เลื่อนหน้าจอ / ปรับขนาดหน้าต่าง
document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.cart-icon-wrap');
  if (wrap && !wrap.contains(e.target)) closeCartDropdown();
});
window.addEventListener('scroll', () => closeCartDropdown(), true);
window.addEventListener('resize', () => closeCartDropdown());

// ══ รายละเอียดหนังสือ (เพจเต็ม แทน modal เดิม) ═══════════════════════
let detailBookISBN = null;
let detailQty = 1;

function openBookDetail(isbn) {
  isbn = decodeURIComponent(isbn);
  const b = shopBooks.find(x => x.ISBN === isbn);
  if (!b) return;
  detailBookISBN = b.ISBN;
  detailQty = 1;

  const outOfStock = b.Stock <= 0;
  const cats = (b.Categories || '').split(',').map(c => c.trim()).filter(Boolean);

  document.getElementById('bookDetailBreadcrumb').innerHTML =
    `<a href="javascript:void(0)" onclick="backToShopFromDetail()">หนังสือทั้งหมด</a>${cats.length ? ' / ' + esc(cats[0]) : ''}`;
  document.getElementById('bookDetailCover').style.background = bookCoverGradient(b);
  document.getElementById('bookDetailCover').innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
    <div class="book-cover-name">${esc(b.BookName)}</div>`;
  document.getElementById('bookDetailTitle').textContent = b.BookName;
  document.getElementById('bookDetailAuthor').textContent = 'โดย ' + (b.Authors || 'ไม่ระบุผู้แต่ง');
  document.getElementById('bookDetailBadges').innerHTML = `
    ${cats.map(c => `<span class="badge badge-gray">${esc(c)}</span>`).join('')}
    ${Number(b.TotalSold) > 0 ? `<span class="badge badge-sage">ขายแล้ว ${b.TotalSold} เล่ม</span>` : `<span class="badge badge-gray">ยังไม่มีคนสั่งซื้อ</span>`}`;
  document.getElementById('bookDetailPrice').textContent = money.format(b.Price);
  document.getElementById('bookDetailStockRow').innerHTML = `
    <span>รหัส ISBN: ${esc(b.ISBN)}</span>
    <span class="badge ${outOfStock?'badge-rust':b.Stock<=5?'badge-amber':'badge-sage'}">${outOfStock?'หมดสต็อก':b.Stock+' เล่มในสต็อก'}</span>`;
  document.getElementById('bookDetailQtyRow').style.display = outOfStock ? 'none' : '';
  document.getElementById('bookDetailQty').textContent = detailQty;

  const addBtn = document.getElementById('bookDetailAddBtn');
  const buyBtn = document.getElementById('bookDetailBuyBtn');
  addBtn.disabled = outOfStock;
  addBtn.innerHTML = outOfStock ? 'หมดสต็อก' : 'เพิ่มในตะกร้า';
  buyBtn.disabled = outOfStock;
  buyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:15px;height:15px"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>ซื้อเลย`;

  document.getElementById('shopBrowseStep').style.display = 'none';
  document.getElementById('shopCheckoutStep').style.display = 'none';
  document.getElementById('shopDetailStep').style.display = '';
  document.getElementById('shopDetailStep').scrollIntoView({block:'start'});
}

function changeDetailQty(delta) {
  const b = shopBooks.find(x => x.ISBN === detailBookISBN);
  if (!b) return;
  detailQty = Math.min(b.Stock, Math.max(1, detailQty + delta));
  document.getElementById('bookDetailQty').textContent = detailQty;
}

function addDetailToCart() {
  const b = shopBooks.find(x => x.ISBN === detailBookISBN);
  if (!b) return;
  for (let i = 0; i < detailQty; i++) {
    addToCart(encodeURIComponent(b.ISBN), encodeURIComponent(b.BookName), b.Price, b.Stock);
  }
}

// [ซื้อเลย] หยิบลงตะกร้าตามจำนวนที่เลือก แล้วพาไปหน้าชำระเงินทันที (ไม่ต้องกลับไปหน้าร้านก่อน)
function buyNowFromDetail() {
  const b = shopBooks.find(x => x.ISBN === detailBookISBN);
  if (!b) return;
  addDetailToCart();
  goToCheckoutStep();
}

function backToShopFromDetail() {
  document.getElementById('shopDetailStep').style.display = 'none';
  document.getElementById('shopCheckoutStep').style.display = 'none';
  document.getElementById('shopBrowseStep').style.display = '';
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
  const proceedBtn = document.getElementById('proceedCheckoutBtn');
  const badge = document.getElementById('cartBadge');

  const totalQty = cart.reduce((s,c) => s+c.quantity, 0);
  badge.textContent = totalQty;
  badge.style.display = totalQty > 0 ? '' : 'none';

  if (!cart.length) {
    el.innerHTML = '<div class="empty" style="padding:24px 14px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:30px;height:30px;margin:0 auto 6px;display:block;color:var(--border)"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>ยังไม่มีสินค้าในตะกร้า</div>';
    totalEl.style.display = 'none';
    checkoutBtn.disabled = true;
    if (proceedBtn) proceedBtn.disabled = true;
    return;
  }

  el.innerHTML = cart.map(c => `
    <div class="cart-item">
      <div style="flex:1">
        <div class="cart-item-name">${esc(c.bookName)}</div>
        <div class="cart-item-price">${money.format(c.price)} × ${c.quantity} = ${money.format(c.price * c.quantity)}</div>
      </div>
      <div class="cart-qty">
        <button onclick="event.stopPropagation();updateCartQty('${c.isbn}',-1)">−</button>
        <span>${c.quantity}</span>
        <button onclick="event.stopPropagation();updateCartQty('${c.isbn}',1)">+</button>
      </div>
      <button class="cart-remove" onclick="event.stopPropagation();removeFromCart('${c.isbn}')" title="ลบออก" aria-label="ลบ ${esc(c.bookName)} ออกจากตะกร้า">×</button>
    </div>
  `).join('');

  const total = cart.reduce((s,c) => s + c.price * c.quantity, 0);
  totalAmt.textContent = money.format(total);
  totalEl.style.display = '';
  checkoutBtn.disabled = false;
  if (proceedBtn) proceedBtn.disabled = false;
}

// [FIX-11] ตั้ง flag ไว้ตอนผู้เยี่ยมชม (ยังไม่ล็อกอิน) กด "ดำเนินการชำระเงิน" — ใช้เด้งกลับมาหน้าชำระเงิน
// หลังล็อกอิน/สมัครสมาชิกสำเร็จ (ดูใน showApp(), dashboard.js) เพื่อให้กรอกที่อยู่/ยืนยันสั่งซื้อต่อได้ทันที
let guestCheckoutIntent = false;

// ══ ขั้นตอนชำระเงิน — แยกหน้าจากการเลือกซื้อสินค้า ═══════════════════
function goToCheckoutStep() {
  if (!cart.length) return;
  closeCartDropdown();
  // [FIX-11] ดูสินค้า/หยิบตะกร้าได้โดยไม่ต้องล็อกอิน แต่ต้องล็อกอินก่อนเข้าหน้าที่อยู่จัดส่ง/ชำระเงิน
  if (!TOKEN) {
    guestCheckoutIntent = true;
    toast('กรุณาเข้าสู่ระบบหรือสมัครสมาชิกก่อนดำเนินการชำระเงิน', 'error');
    showLogin();
    return;
  }
  const detailStep = document.getElementById('shopDetailStep');
  if (detailStep) detailStep.style.display = 'none';
  document.getElementById('shopBrowseStep').style.display = 'none';
  document.getElementById('shopCheckoutStep').style.display = '';
  renderCheckoutOrderSummary();
  document.getElementById('shopCheckoutStep').scrollIntoView({block:'start'});
}

function backToBrowseStep() {
  document.getElementById('shopCheckoutStep').style.display = 'none';
  const detailStep = document.getElementById('shopDetailStep');
  if (detailStep) detailStep.style.display = 'none';
  document.getElementById('shopBrowseStep').style.display = '';
}

function renderCheckoutOrderSummary() {
  const el = document.getElementById('checkoutOrderSummary');
  if (!el) return;
  const total = cart.reduce((s,c) => s + c.price * c.quantity, 0);
  el.innerHTML = `<div class="order-list" style="margin-bottom:0">
    ${cart.map(c => `
      <div class="cart-item" style="cursor:default">
        <div style="flex:1">
          <div class="cart-item-name">${esc(c.bookName)}</div>
          <div class="cart-item-price">${money.format(c.price)} × ${c.quantity} = ${money.format(c.price * c.quantity)}</div>
        </div>
      </div>`).join('')}
  </div>
  <div class="cart-total" style="margin-top:8px">
    <span class="cart-total-label">ยอดรวม</span>
    <span class="cart-total-amount">${money.format(total)}</span>
  </div>`;
}
