// ================================================================
// REPORTS — report pages and SQL query library UI
// ================================================================
// ══ REPORTS TAB (5 รายงาน + คลัง SQL Query 22 คำสั่ง) ═══════════════
const REPORT_META = {
  customer:    { title:'รายงานลูกค้า (Customer Report)',        url:'/api/reports/customer',    cols:['CustomerID','CustomerName','Phone','Email','OrderCount','TotalSpent'],
    labels:{CustomerID:'รหัส',CustomerName:'ชื่อลูกค้า',Phone:'โทร',Email:'อีเมล',OrderCount:'จำนวนคำสั่งซื้อ',TotalSpent:'ยอดใช้จ่ายสะสม'}, money:['TotalSpent'] },
  book:        { title:'รายงานสินค้า (Book Report)',            url:'/api/reports/book',        cols:['ISBN','BookName','Price','Stock','Categories','TotalSold'],
    labels:{ISBN:'ISBN',BookName:'ชื่อหนังสือ',Price:'ราคา',Stock:'คงเหลือ',Categories:'หมวดหมู่',TotalSold:'ยอดขายสะสม'}, money:['Price'] },
  sales:       { title:'รายงานยอดขายรายเดือน (Sales Report)',   url:'/api/reports/sales',       cols:['SaleMonth','OrderCount','Revenue'],
    labels:{SaleMonth:'เดือน',OrderCount:'จำนวนคำสั่งซื้อ',Revenue:'ยอดขาย'}, money:['Revenue'] },
  bestseller:  { title:'สินค้าขายดี Top 5 (Best-Seller Report)', url:'/api/reports/bestseller',  cols:['BookName','TotalQty','Revenue'],
    labels:{BookName:'ชื่อหนังสือ',TotalQty:'จำนวนที่ขายได้ (เล่ม)',Revenue:'รายได้'}, money:['Revenue'] },
  topcustomer: { title:'ลูกค้าซื้อสูงสุด Top 5 (Top Customer Report)', url:'/api/reports/topcustomer', cols:['CustomerName','OrderCount','TotalSpent'],
    labels:{CustomerName:'ชื่อลูกค้า',OrderCount:'จำนวนคำสั่งซื้อ',TotalSpent:'ยอดใช้จ่ายสะสม'}, money:['TotalSpent'] }
};

function renderReportTable(rows, meta){
  if(!rows||!rows.length) return emptyState('ไม่มีข้อมูล');
  const isNumCol = c => (meta.money&&meta.money.includes(c)) || typeof rows[0][c]==='number';
  return `<table><thead><tr>${meta.cols.map(c=>`<th${isNumCol(c)?' class="num"':''}>${esc(meta.labels[c]||c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${meta.cols.map(c=>{
      const v=r[c];
      const num=isNumCol(c);
      const out=(meta.money&&meta.money.includes(c)&&v!=null)?money.format(v):esc(v ?? '—');
      return `<td${num?' class="num"':''}>${out}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`;
}

async function loadReport(key){
  document.querySelectorAll('.btn-report').forEach(b=>b.classList.toggle('active', b.dataset.report===key));
  const meta = REPORT_META[key];
  document.getElementById('reportTitle').textContent = meta.title;
  const box = document.getElementById('reportResult');
  box.innerHTML = `<div class="loading"><div class="spinner"></div>กำลังโหลด…</div>`;
  try{
    const rows = await api(meta.url);
    box.innerHTML = renderReportTable(rows, meta);
  }catch(e){ box.innerHTML = emptyState(e.message); }
}

document.getElementById('reportButtons')?.addEventListener('click', e=>{
  const btn = e.target.closest('.btn-report');
  if(btn) loadReport(btn.dataset.report);
});

let queryLibraryLoaded = false;
async function loadReportsTab(){
  loadBusinessDashboard();
  await loadReport('customer');
  if(queryLibraryLoaded) return;
  queryLibraryLoaded = true;
  try{
    const list = await api('/api/reports/queries');
    const sel = document.getElementById('querySelect');
    const groups = {};
    list.forEach(q=>{ (groups[q.group] ||= []).push(q); });
    sel.innerHTML = Object.entries(groups).map(([g,items])=>
      `<optgroup label="${esc(g)}">${items.map(q=>`<option value="${q.id}">Query ${q.id} — ${esc(q.title)}</option>`).join('')}</optgroup>`
    ).join('');
    sel._meta = list;
    sel.onchange = ()=>{
      const def = list.find(q=>q.id===Number(sel.value));
      const wrap = document.getElementById('queryParamWrap');
      const usedInBox = document.getElementById('queryUsedIn');
      usedInBox.innerHTML = def && def.usedIn ? `<span class="dev-usedin">✓ ใช้จริงที่: ${esc(def.usedIn)}</span>` : '';
      if(def && def.paramName){
        wrap.style.display='';
        document.getElementById('queryParamLabel').textContent = def.paramLabel;
        const input = document.getElementById('queryParamInput');
        input.type = def.paramType==='number' ? 'number' : 'text';
        input.value = def.paramDefault ?? '';
      } else {
        wrap.style.display='none';
      }
    };
    if(list.length) sel.onchange();
  }catch(e){ toast(e.message,'error'); }
}

async function runQuery(){
  const sel = document.getElementById('querySelect');
  const id = Number(sel.value);
  if(!id){ toast('กรุณาเลือก Query ก่อน','error'); return; }
  const def = (sel._meta||[]).find(q=>q.id===id);
  const paramInput = document.getElementById('queryParamInput');
  const v = (def && def.paramName) ? paramInput.value : '';
  const sqlBox = document.getElementById('querySqlBox');
  const resBox = document.getElementById('queryResult');
  resBox.innerHTML = `<div class="loading"><div class="spinner"></div>กำลังรัน Query…</div>`;
  try{
    const data = await api(`/api/reports/query/${id}?v=${encodeURIComponent(v)}`);
    sqlBox.style.display=''; sqlBox.textContent = data.sql;
    if(!data.rows.length){ resBox.innerHTML = emptyState('ไม่มีข้อมูลที่ตรงกับเงื่อนไข'); return; }
    const cols = Object.keys(data.rows[0]);
    const isNumCol = c => typeof data.rows[0][c]==='number';
    resBox.innerHTML = `<table><thead><tr>${cols.map(c=>`<th${isNumCol(c)?' class="num"':''}>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${data.rows.map(r=>`<tr>${cols.map(c=>`<td${isNumCol(c)?' class="num"':''}>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <div style="padding:8px 4px;font-size:12px;color:var(--muted)">พบ ${data.rows.length} แถว</div>`;
  }catch(e){ resBox.innerHTML = emptyState(e.message); }
}
