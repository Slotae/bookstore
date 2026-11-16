// ================================================================
// CORE — shared state, API, tabs, loading, and render helpers
// ================================================================
const money = new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'});
function bangkokToday(){ return new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'}); }
// [FIX] จำกัดขนาดไฟล์สลิปฝั่ง frontend ก่อนอ่าน/ส่งขึ้น server (server จำกัด body รวมไว้ประมาณ 7MB)
// อยู่ที่ core.js (โหลดก่อนไฟล์อื่นทั้งหมด) เพื่อให้ทุกจุดที่อัปโหลดสลิป (payments.js, checkout.js) ใช้ค่าเดียวกัน
const SLIP_MAX_BYTES = 4 * 1024 * 1024; // 4MB (เผื่อ overhead ของ base64 ~33% ให้ไม่เกิน limit ของ server)
const NO_PROOF_METHODS = ['เงินสด', 'ปลายทาง', 'บัตร']; // ช่องทางที่ไม่บังคับไฟล์หลักฐานใน API
let TOKEN = localStorage.getItem('bms_token') || '';
let ME    = JSON.parse(localStorage.getItem('bms_me') || 'null');
const state = {customers:[],books:[],orders:[],payments:[],shipments:[],users:[],dashboard:null,
  // ── ผลลัพธ์สดจาก Query Library (Query 1,2,3,7,8) — null = ยังไม่ได้กรอง/รอผลจากเซิร์ฟเวอร์ ─
  live: { bookPriceISBN:null, bookKeywordISBN:null, bookBestNames:null, customerPhoneNames:null, customerFreqNames:null }
};
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

// ══ API ═════════════════════════════════════════════════════════════
async function api(path,opts={}){
  const res=await fetch(path,{headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},...opts});
  if(res.status===401){
    // [FIX-AUTH-REDIRECT] 401 จาก request เบื้องหลังไม่ควรเรียก doLogout()
    // เพราะ doLogout() เปลี่ยนหน้าจอทันทีและเคยทำให้ฟอร์มสมัครสมาชิกเด้งหายระหว่างกรอก
    TOKEN=''; ME=null;
    localStorage.removeItem('bms_token');
    localStorage.removeItem('bms_me');

    const authOpen = typeof AUTH_SCREEN !== 'undefined' &&
      (AUTH_SCREEN==='register' || AUTH_SCREEN==='login');
    if(!authOpen && typeof showGuestShop==='function') showGuestShop();

    throw new Error('กรุณาเข้าสู่ระบบใหม่');
  }
  const data=await res.json();
  if(!res.ok) throw new Error(data.error||'เกิดข้อผิดพลาด');
  return data;
}

function toast(msg,type='success'){
  const el=document.getElementById('toast');
  el.textContent=msg; el.className=`show ${type}`;
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),3200);
}

// ══ ป๊อปอัพแจ้งสำเร็จกลางจอ (ใช้กับ login/register) ═══════════════════
// โชว์เครื่องหมายถูกพร้อมข้อความสั้น ๆ กลางจอ แล้วค่อยพาไปหน้าแอปให้อัตโนมัติ
function showAuthSuccess(title, sub, proceedFn){
  const overlay = document.getElementById('authSuccessModal');
  const wrap    = document.getElementById('authSuccessCheckWrap');
  document.getElementById('authSuccessTitle').textContent = title;
  document.getElementById('authSuccessSub').textContent   = sub || '';
  wrap.classList.remove('animate');
  void wrap.offsetWidth; // reflow กันไม่ให้แอนิเมชันไม่รีสตาร์ท
  wrap.classList.add('animate');
  overlay.classList.add('open');
  setTimeout(()=>{
    overlay.classList.remove('open');
    proceedFn();
  }, 1300);
}

// ══ กันการกดปุ่มส่งฟอร์มซ้ำ (double-submit) ═══════════════════════════
// ล็อกปุ่ม submit ของฟอร์มระหว่างรอ API ตอบกลับ แล้วคืนสถานะเดิมให้เสมอ
// ไม่ว่าจะสำเร็จหรือ error กันปัญหาผู้ใช้กดรัว ๆ แล้วเกิดรายการซ้ำ
async function withSubmitLock(form, task){
  const btn = form.querySelector('button[type="submit"]');
  const original = btn ? btn.innerHTML : null;
  const LOADING_MARK = 'btn-spin';
  if(btn){
    btn.disabled = true;
    btn.innerHTML = `<span class="${LOADING_MARK}"></span>กำลังบันทึก…`;
  }
  try{
    await task();
  } finally {
    if(btn){
      btn.disabled = false;
      // ถ้า task ระหว่างทางเปลี่ยน label ปุ่มเอง (เช่น cancelEditBook สลับโหมด
      // แก้ไข/เพิ่มใหม่) ให้เคารพค่านั้น ไม่ทับกลับเป็นค่าก่อนกดปุ่ม
      if(btn.innerHTML.includes(LOADING_MARK)) btn.innerHTML = original;
    }
  }
}

// เวอร์ชันสำหรับปุ่มที่ไม่ได้อยู่ใน <form> (เช่น เข้าสู่ระบบ/สมัครสมาชิก)
// ใช้ id ปุ่มตรงๆ แทนการหา button[type=submit] ในฟอร์ม
async function withBtnLock(btnId, loadingText, task){
  const btn = document.getElementById(btnId);
  const original = btn ? btn.innerHTML : null;
  if(btn){ btn.disabled = true; btn.innerHTML = `<span class="btn-spin"></span>${loadingText}`; }
  try{
    await task();
  } finally {
    if(btn){ btn.disabled = false; btn.innerHTML = original; }
  }
}

// ══ TABS ════════════════════════════════════════════════════════════
document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab,.view').forEach(el=>el.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.view)?.classList.add('active');
    if(btn.dataset.view==='reports') loadReportsTab();
    // [FIX-11] เข้าแท็บร้านหนังสือใหม่ทุกครั้ง ให้เริ่มที่ขั้นเลือกซื้อสินค้าเสมอ
    if(btn.dataset.view==='shop' && typeof backToBrowseStep==='function') backToBrowseStep();
  });
});

// ══ LOAD ALL ════════════════════════════════════════════════════════
async function loadAll(){
  try{
    if(ME?.role==='ลูกค้า'){
      // ลูกค้า: โหลดเฉพาะคำสั่งซื้อของตัวเอง + ร้านหนังสือ (ไม่มีแท็บ "ภาพรวม" สำหรับลูกค้าแล้ว
      // — หน้าแรกของลูกค้าคือร้านหนังสือ ส่วนสรุปบัญชี/ประวัติสั่งซื้อย้ายไปอยู่ในแท็บ "คำสั่งซื้อของฉัน")
      const orders=await api('/api/my/orders');
      renderMyOrders(orders);
      document.getElementById('myAccountSummary').innerHTML=renderMyAccountSummary(orders);
      await loadShop();
      return;
    }

    if(ME?.role==='พนักงานจัดส่ง'){
      // พนักงานจัดส่ง: เห็นเฉพาะรายการจัดส่ง ตาม Business Rule ที่จำกัดสิทธิ์ตามบทบาท
      const shipments=await api('/api/shipments');
      state.shipments=shipments;
      renderShipments();
      fillShipmentForm();
      renderDeliveryDashboard();
      return;
    }

    const [dashboard,customers,books,orders,payments,shipments,categories,authors,salesTrend]=await Promise.all([
      api('/api/dashboard'),api('/api/customers'),api('/api/books'),
      api('/api/orders'),api('/api/payments'),api('/api/shipments'),
      api('/api/categories'),api('/api/authors'),
      api('/api/reports/sales').catch(()=>[])
    ]);
    resetDashboardCards();
    state.customers=customers; state.books=books; state.orders=orders;
    state.payments=payments; state.shipments=shipments; state.dashboard=dashboard;
    fillDatalist('categoryList', categories.map(c=>c.CategoryName));
    fillDatalist('authorList', authors.map(a=>a.AuthorName));

    const t=dashboard.totals;
    countUp(document.getElementById('sc'), t.customers);
    countUp(document.getElementById('sb'), t.books);
    countUp(document.getElementById('so'), t.orders);
    countUp(document.getElementById('sr'), t.revenue, true);
    countUp(document.getElementById('sp'), t.pendingShip||0);

    renderSalesTrend(salesTrend);
    renderRecentOrders(dashboard.recentOrders);
    renderLowStock(dashboard.lowStock);
    renderCustomers(); renderBooks(); renderOrders();
    renderPayments(); renderShipments();
    fillOrderForm(); fillShipmentForm(); fillSlipForm();
    loadBookSideWidgets();

    if(ME?.role==='Admin'){
      const users=await api('/api/users');
      state.users=users; renderUsers();
    }
  }catch(e){toast(e.message,'error')}
}

// ══ SECURITY: HTML escaping ═══════════════════════════════════════
// [FIX-8] ข้อมูลที่มาจากผู้ใช้ (ชื่อลูกค้า ชื่อหนังสือ ที่อยู่ ฯลฯ) ต้อง escape ก่อนแทรกลง innerHTML
// เพื่อป้องกัน Stored XSS (เช่น ลูกค้าสมัครสมาชิกด้วยชื่อที่มี <script> อยู่ในนั้น)
function esc(v){
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ══ RENDER HELPERS ══════════════════════════════════════════════════
function emptyState(msg){
  return `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>${esc(msg)}</div>`;
}
// ── จัดรูปแบบวันที่ให้อ่านง่าย (พ.ศ., ย่อเดือนไทย) แทนการโชว์ ISO string ดิบ ──
const TH_MONTHS_SHORT=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function fmtDate(d, withTime=false){
  if(!d) return '—';
  const dt=new Date(d);
  if(isNaN(dt.getTime())) return esc(d);
  const day=dt.getDate();
  const month=TH_MONTHS_SHORT[dt.getMonth()];
  const year=dt.getFullYear()+543;
  let out=`${day} ${month} ${year}`;
  if(withTime) out+=` · ${dt.getHours().toString().padStart(2,'0')}:${dt.getMinutes().toString().padStart(2,'0')}`;
  return out;
}
// เทียบว่าวันที่ตรงกับ "วันนี้" หรือไม่ (ใช้ตัดวันแบบ local date เทียบ ไม่สนเวลา)
function isToday(d){
  if(!d) return false;
  const dt=new Date(d), now=new Date();
  return dt.getFullYear()===now.getFullYear() && dt.getMonth()===now.getMonth() && dt.getDate()===now.getDate();
}
function statusBadge(s){
  const map={'รอจัดส่ง':'badge-amber','กำลังจัดส่ง':'badge-blue','จัดส่งแล้ว':'badge-sage','ยกเลิก':'badge-rust'};
  return `<span class="badge ${map[s]||'badge-gray'}">${esc(s)||'—'}</span>`;
}
function payBadge(m){
  const map={'โอน':'badge-blue','เงินสด':'badge-sage','ปลายทาง':'badge-brown','บัตร':'badge-amber'};
  const iconMap={
    'โอน':'<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
    'เงินสด':'<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    'ปลายทาง':'<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    'บัตร':'<svg class="icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>'
  };
  return `<span class="badge ${map[m]||'badge-gray'}">${iconMap[m]||''}${esc(m)||'—'}</span>`;
}
function payStatusBadge(s){
  const map={'รอชำระ':'badge-gray','รอตรวจสอบ':'badge-amber','ยืนยันแล้ว':'badge-sage','ปฏิเสธ':'badge-rust'};
  return `<span class="badge ${map[s]||'badge-gray'}">${esc(s)||'รอชำระ'}</span>`;
}

function renderRecentOrders(rows){
  if(!rows||!rows.length){document.getElementById('recentOrders').innerHTML=emptyState('ยังไม่มีคำสั่งซื้อ');return}
  document.getElementById('recentOrders').innerHTML=`<table>
    <thead><tr><th>#</th><th>ลูกค้า</th><th>รายการ</th><th>ยอดเงิน</th><th>สถานะ</th></tr></thead>
    <tbody>${rows.slice(0,6).map(o=>`<tr>
      <td><strong>#${o.OrderID}</strong><small>${esc(o.OrderDate)}</small></td>
      <td>${esc(o.CustomerName)}</td>
      <td style="max-width:180px;word-break:break-word;font-size:12px">${esc(o.Items)||'—'}</td>
      <td><strong>${money.format(o.Amount||0)}</strong><small>${esc(o.PaymentMethod)||'—'}</small></td>
      <td>${statusBadge(o.Status)}</td>
    </tr>`).join('')}</tbody></table>`;
}

function renderLowStock(rows){
  if(!rows||!rows.length){document.getElementById('lowStock').innerHTML=emptyState('คลังหนังสือปกติ ✓');return}
  document.getElementById('lowStock').innerHTML=`<table>
    <thead><tr><th>หนังสือ</th><th>คงเหลือ</th></tr></thead>
    <tbody>${rows.map(b=>`<tr>
      <td>${esc(b.BookName)}<small>${esc(b.ISBN)}</small></td>
      <td><div class="stock-bar-wrap">
        <div class="stock-bar"><div class="stock-bar-fill ${b.Stock<=5?'low':b.Stock<=10?'mid':''}" style="width:${Math.min(100,b.Stock/15*100)}%"></div></div>
        <span class="badge ${b.Stock<=5?'badge-rust':b.Stock<=10?'badge-amber':'badge-gray'}">${b.Stock}</span>
      </div></td>
    </tr>`).join('')}</tbody></table>`;
}
