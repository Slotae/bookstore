// ================================================================
// DASHBOARD — role UI, welcome banner, KPIs, trends, business data
// ================================================================
// ══ AUTH ════════════════════════════════════════════════════════════

function showApp(){
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('registerScreen').classList.add('hidden');
  document.getElementById('appHeader').classList.add('visible');
  document.getElementById('userFullName').textContent=ME.fullName;
  document.getElementById('userRole').textContent=ME.role;

  // แสดง/ซ่อน tabs ตาม role
  document.querySelectorAll('.tab').forEach(btn=>{
    const roles=(btn.dataset.roles||'').split(',').map(r=>r.trim());
    btn.style.display=roles.includes(ME.role)?'':'none';
  });

  // เลือก tab แรกที่ visible
  const firstTab=document.querySelector('.tab:not([style*="display: none"]):not([style*="display:none"])');
  if(firstTab){
    document.querySelectorAll('.tab,.view').forEach(el=>el.classList.remove('active'));
    firstTab.classList.add('active');
    document.getElementById(firstTab.dataset.view)?.classList.add('active');
  }

  // Stats bar: ลูกค้า และ พนักงานจัดส่ง ไม่เห็น stats เต็ม (ไม่มีสิทธิ์เข้าถึงยอดขาย/ข้อมูลลูกค้า)
  if(ME.role==='ลูกค้า' || ME.role==='พนักงานจัดส่ง'){
    document.getElementById('statsBar').style.display='none';
  } else {
    document.getElementById('statsBar').style.display='';
  }
  document.getElementById('appTabs').style.display='';
  document.getElementById('appMain').style.display='';

  renderWelcomeBanner();
  loadAll();
}

// ══ ROLE WELCOME BANNER ════════════════════════════════════════════
const roleConfig={
  'Admin':{
    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M6 20v-1a6 6 0 0 1 12 0v1"/><path d="M19 11l2 2-4 4-2-2"/></svg>',
    color:'var(--rust-light)',iconColor:'var(--rust)',
    title:'สวัสดี ผู้ดูแลระบบ',sub:'คุณมีสิทธิ์เข้าถึงทุกส่วนของระบบ'
  },
  'พนักงานขาย':{
    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    color:'#FEF3DC',iconColor:'var(--amber)',
    title:'สวัสดี พนักงานขาย',sub:'จัดการลูกค้า หนังสือ คำสั่งซื้อ และการชำระเงิน'
  },
  'พนักงานจัดส่ง':{
    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    color:'var(--blue-light)',iconColor:'var(--blue)',
    title:'สวัสดี พนักงานจัดส่ง',sub:'ดูและอัปเดตสถานะการจัดส่งพัสดุ'
  },
  'ลูกค้า':{
    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
    color:'var(--sage-light)',iconColor:'var(--sage)',
    title:'สวัสดี สมาชิก',sub:'ติดตามคำสั่งซื้อและสถานะการจัดส่งของคุณ'
  }
};

function renderWelcomeBanner(){
  const cfg=roleConfig[ME?.role]||{};
  const el=document.getElementById('roleWelcomeBanner');
  if(!cfg.title){el.innerHTML='';return}
  const dateStr=new Date().toLocaleDateString('th-TH-u-ca-buddhist',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  el.innerHTML=`<div class="role-welcome">
    <div class="role-welcome-icon" style="background:${cfg.color};color:${cfg.iconColor}">${cfg.icon}</div>
    <div>
      <div class="role-welcome-title">${cfg.title} — ${ME.fullName}</div>
      <div class="role-welcome-sub">${cfg.sub}</div>
    </div>
    <div class="role-welcome-date">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${dateStr}
    </div>
  </div>`;
  renderQuickActions();
}

// ══ QUICK ACTIONS (ทางลัดในหน้าภาพรวม) ══════════════════════════════
const QUICK_ACTIONS_BY_ROLE={
  'Admin':[
    {view:'orders',   color:'amber', label:'สร้างคำสั่งซื้อ', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>'},
    {view:'payments', color:'blue',  label:'ตรวจสอบชำระเงิน', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>'},
    {view:'books',    color:'sage',  label:'จัดการหนังสือ', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>'},
    {view:'reports',  color:'rust',  label:'ดูรายงาน', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>'}
  ],
  'พนักงานขาย':[
    {view:'orders',   color:'amber', label:'สร้างคำสั่งซื้อ', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>'},
    {view:'customers',color:'sage',  label:'เพิ่มลูกค้า', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>'},
    {view:'payments', color:'blue',  label:'ตรวจสอบชำระเงิน', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>'},
    {view:'shipments',color:'rust',  label:'ดูการจัดส่ง', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>'}
  ],
  'พนักงานจัดส่ง':[
    {view:'shipments',color:'blue',  label:'รายการจัดส่งวันนี้', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>'}
  ],
  'ลูกค้า':[
    {view:'shop',    color:'amber', label:'เลือกซื้อหนังสือ', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>'},
    {view:'myorders',color:'sage',  label:'ติดตามคำสั่งซื้อ', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>'}
  ]
};

function goToTab(view){
  document.querySelector(`.tab[data-view="${view}"]`)?.click();
}

function renderQuickActions(){
  const el=document.getElementById('dashQuickActions');
  if(!el) return;
  const actions=QUICK_ACTIONS_BY_ROLE[ME?.role]||[];
  el.innerHTML=actions.map(a=>`
    <button type="button" class="quick-action" onclick="goToTab('${a.view}')">
      <span class="quick-action-icon stat-icon ${a.color}">${a.icon}</span>${esc(a.label)}
    </button>`).join('');
}

// ══ COUNT-UP ANIMATION สำหรับตัวเลขในแถบสถิติ ═══════════════════════
function countUp(el, endValue, isMoney=false){
  if(!el) return;
  const end=Number(endValue)||0;
  const duration=650;
  const t0=performance.now();
  function frame(now){
    const p=Math.min(1,(now-t0)/duration);
    const eased=1-Math.pow(1-p,3);
    const val=end*eased;
    el.textContent=isMoney?money.format(val):Math.round(val).toLocaleString('th-TH');
    if(p<1) requestAnimationFrame(frame);
    else el.textContent=isMoney?money.format(end):end.toLocaleString('th-TH');
  }
  requestAnimationFrame(frame);
}

// ══ SALES TREND SPARKLINE (แดชบอร์ด) ════════════════════════════════
function renderSalesTrend(rows){
  const wrap=document.getElementById('dashTrendWrap');
  if(!wrap) return;
  if(!rows || !rows.length){ wrap.innerHTML=''; return; }
  const recent=rows.slice(-6);
  const max=Math.max(...recent.map(r=>r.Revenue||0), 1);
  const totalRevenue=recent.reduce((s,r)=>s+(r.Revenue||0),0);
  const last=recent[recent.length-1]?.Revenue||0;
  const prev=recent.length>1?(recent[recent.length-2]?.Revenue||0):0;
  const delta=prev>0?((last-prev)/prev*100):(last>0?100:0);
  const isUp=delta>=0;
  wrap.innerHTML=`<div class="card" style="margin-bottom:20px">
    <div class="card-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>
      <span class="card-title">แนวโน้มยอดขาย ${recent.length} เดือนล่าสุด</span>
    </div>
    <div class="trend-card-body">
      <div class="trend-summary">
        <span class="trend-summary-value">${money.format(totalRevenue)}</span>
        <span class="trend-summary-label">ยอดขายรวม ${recent.length} เดือน</span>
        <span class="trend-summary-delta ${isUp?'up':'down'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">${isUp?'<polyline points="18 15 12 9 6 15"/>':'<polyline points="6 9 12 15 18 9"/>'}</svg>
          ${Math.abs(delta).toFixed(1)}%
        </span>
      </div>
      <div class="sparkline-wrap">${recent.map((r,i)=>{
        const h=Math.max(6,(r.Revenue||0)/max*100);
        const isCur=i===recent.length-1;
        return `<div class="spark-bar${isCur?' current':''}" style="height:${h}%;animation-delay:${i*60}ms" title="${esc(r.SaleMonth)}: ${money.format(r.Revenue||0)}"></div>`;
      }).join('')}</div>
      <div class="spark-labels">${recent.map(r=>`<span>${esc(r.SaleMonth)}</span>`).join('')}</div>
    </div>
  </div>`;
}

async function loadBusinessDashboard(){
  const t = state.dashboard?.totals || {};
  document.getElementById('kpiRevenue').textContent = money.format(t.revenue||0);
  document.getElementById('kpiAvgOrder').textContent = money.format(t.avgOrderValue||0);
  document.getElementById('kpiPriceRange').textContent = `${money.format(t.minPrice||0)} – ${money.format(t.maxPrice||0)}`;
  document.getElementById('kpiOrders').textContent = t.orders ?? '—';

  try{
    const [categories, frequent, neverSold, sales] = await Promise.all([
      api('/api/categories/stats'),          // Query 13 + 22
      api('/api/reports/frequent-customers'), // Query 21
      api('/api/reports/never-sold'),         // Query 20
      api('/api/reports/sales')               // Query สรุปยอดขายรายเดือน
    ]);

    const maxRev = Math.max(1, ...categories.map(c=>Number(c.Revenue||0)));
    document.getElementById('bdCategoryChart').innerHTML = categories.length
      ? `<div class="bar-chart">${categories.map(c=>`<div class="bar-row">
          <span class="bar-label">${esc(c.CategoryName)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3,c.Revenue/maxRev*100)}%"></div></div>
          <span class="bar-value">${money.format(c.Revenue||0)}</span>
        </div>`).join('')}</div>`
      : emptyState('ยังไม่มีข้อมูล');

    document.getElementById('bdFrequentCustomers').innerHTML = frequent.length
      ? `<div class="mini-list">${frequent.map((c,i)=>`<div class="mini-list-row">
          <span class="mini-list-rank">${i+1}</span>
          <span class="mini-list-name">${esc(c.CustomerName)}</span>
          <span class="mini-list-val">${c.OrderCount} ครั้ง</span>
        </div>`).join('')}</div>`
      : emptyState('ยังไม่มีข้อมูล');

    document.getElementById('bdNeverSold').innerHTML = neverSold.length
      ? `<div class="mini-list">${neverSold.map(b=>`<div class="mini-list-row">
          <span class="mini-list-name"><svg class="icon-inline" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> ${esc(b.BookName)}</span>
          <span class="mini-list-val">คงเหลือ ${b.Stock} เล่ม</span>
        </div>`).join('')}</div>`
      : `<div class="empty"><svg class="icon-inline" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg> ไม่มีสินค้าค้างขาย — ทุกเล่มเคยถูกสั่งซื้อแล้ว</div>`;

    const maxOrderRev = Math.max(1, ...sales.map(s=>Number(s.Revenue||0)));
    document.getElementById('bdSalesChart').innerHTML = sales.length
      ? `<div class="bar-chart">${sales.map(s=>`<div class="bar-row">
          <span class="bar-label">${esc(s.SaleMonth)}</span>
          <div class="bar-track"><div class="bar-fill sage" style="width:${Math.max(3,s.Revenue/maxOrderRev*100)}%"></div></div>
          <span class="bar-value">${money.format(s.Revenue||0)}</span>
        </div>`).join('')}</div>`
      : emptyState('ยังไม่มีข้อมูล');
  }catch(e){
    ['bdCategoryChart','bdFrequentCustomers','bdNeverSold','bdSalesChart'].forEach(id=>{
      document.getElementById(id).innerHTML = emptyState(e.message);
    });
  }
}
// ══ BUSINESS DASHBOARD (KPI + กราฟ) ══════════════════════════════════
