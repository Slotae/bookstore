// ================================================================
// SHIPMENTS — delivery-center UX: queue → accept → live map → delivered
// ================================================================
const SHIP_STATUSES=['รอจัดส่ง','กำลังจัดส่ง','จัดส่งแล้ว','ยกเลิก'];
const SHIP_ICON={
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  truck:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  navigation:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>'
};
const SHIP_STATUS_META={
  'รอจัดส่ง':{color:'amber',icon:SHIP_ICON.clock},
  'กำลังจัดส่ง':{color:'blue',icon:SHIP_ICON.truck},
  'จัดส่งแล้ว':{color:'sage',icon:SHIP_ICON.check},
  'ยกเลิก':{color:'rust',icon:SHIP_ICON.x}
};
const SHIP_NEXT_STATUS={'รอจัดส่ง':'กำลังจัดส่ง','กำลังจัดส่ง':'จัดส่งแล้ว'};
const SHIP_NEXT_LABEL={'รอจัดส่ง':'เริ่มจัดส่ง','กำลังจัดส่ง':'ส่งสำเร็จแล้ว'};
let shipFilterStatus='all';
let shipOnlyMine=false;
let selectedShipmentId=null;
let deliveryMap=null, deliveryMarker=null, deliveryDestination=null, deliveryGeoCache={};
let locationWatchId=null, locationSending=false;

function shipCounts(){
  const c={'รอจัดส่ง':0,'กำลังจัดส่ง':0,'จัดส่งแล้ว':0,'ยกเลิก':0};
  (state.shipments||[]).forEach(s=>{if(c[s.Status]!=null)c[s.Status]++});
  return c;
}
function setShipFilter(status){shipFilterStatus=status;renderShipments()}
function toggleShipMine(){shipOnlyMine=!shipOnlyMine;renderShipments()}

function renderShipStats(){
  const el=document.getElementById('shipStatsRow'); if(!el)return;
  const c=shipCounts();
  el.innerHTML=SHIP_STATUSES.map(k=>{
    const m=SHIP_STATUS_META[k];
    return `<button type="button" class="ship-stat-chip ${shipFilterStatus===k?'active':''}" onclick="setShipFilter('${k}')">
      <span class="ship-stat-icon ${m.color}">${m.icon}</span><div><div class="ship-stat-count">${c[k]}</div><div class="ship-stat-label">${k}</div></div>
    </button>`;
  }).join('')+`<button type="button" class="ship-stat-chip ship-mine ${shipOnlyMine?'active':''}" onclick="toggleShipMine()">
    <span class="ship-stat-icon blue">${SHIP_ICON.pin}</span><div><div class="ship-stat-count">${(state.shipments||[]).filter(s=>s.AssignedDriverID===ME?.userID).length}</div><div class="ship-stat-label">งานของฉัน</div></div>
  </button>`;
}
function renderShipFilterTabs(){
  const el=document.getElementById('shipFilterTabs');if(!el)return;
  el.innerHTML=[['all','ทั้งหมด'],...SHIP_STATUSES.map(s=>[s,s])].map(([v,l])=>
    `<button type="button" class="ship-filter-tab ${shipFilterStatus===v?'active':''}" onclick="setShipFilter('${v}')">${esc(l)}</button>`).join('');
}

function shipmentAddressUrl(s){
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.Address||'ประเทศไทย')}`;
}
function shipmentRouteUrl(s){
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.Address||'ประเทศไทย')}`;
}

function renderShipments(){
  renderShipStats();renderShipFilterTabs();
  const tableEl=document.getElementById('shipmentTable');if(!tableEl)return;
  let rows=[...(state.shipments||[])];
  if(shipFilterStatus!=='all')rows=rows.filter(s=>s.Status===shipFilterStatus);
  if(shipOnlyMine)rows=rows.filter(s=>s.AssignedDriverID===ME?.userID);
  const q=(document.getElementById('shipSearch')?.value||'').trim().toLowerCase();
  if(q)rows=rows.filter(s=>`${s.OrderID} ${s.CustomerName||''} ${s.Phone||''} ${s.TrackingNo||''} ${s.Address||''}`.toLowerCase().includes(q));
  if(!rows.length){tableEl.innerHTML=emptyState('ไม่พบงานที่ตรงกับเงื่อนไข');return}

  const isDriver=ME?.role==='พนักงานจัดส่ง';
  const canManage=['Admin','พนักงานขาย','พนักงานจัดส่ง'].includes(ME?.role);
  tableEl.innerHTML=`<div class="delivery-job-list">${rows.map(s=>{
    const mine=s.AssignedDriverID===ME?.userID;
    const next=SHIP_NEXT_STATUS[s.Status];
    const active=selectedShipmentId===s.ShipmentID;
    let action='';
    if(isDriver && s.Status==='รอจัดส่ง') action=`<button class="btn-ship-accept" onclick="acceptShipment(${s.ShipmentID})">${SHIP_ICON.check}รับงาน</button>`;
    else if(isDriver && mine && next) action=`<button class="btn-ship-advance" onclick="quickAdvanceShipment(${s.ShipmentID},'${next}')">${SHIP_ICON.check}${SHIP_NEXT_LABEL[s.Status]}</button>`;
    else if(!isDriver && canManage && next) action=`<button class="btn-ship-advance" onclick="quickAdvanceShipment(${s.ShipmentID},'${next}')">${SHIP_ICON.check}${SHIP_NEXT_LABEL[s.Status]}</button>`;
    return `<article class="delivery-job ${active?'selected':''}" onclick="selectShipment(${s.ShipmentID})">
      <div class="delivery-job-top">
        <div class="delivery-job-id">#${s.OrderID}<span>S${s.ShipmentID}</span></div>
        ${statusBadge(s.Status)}
      </div>
      <div class="delivery-job-main">
        <div><strong>${esc(s.CustomerName)}</strong><span>${esc(s.Phone)||'—'}</span></div>
        <div class="delivery-address">${SHIP_ICON.pin}<span>${esc(s.Address)}</span></div>
      </div>
      <div class="delivery-job-bottom">
        <span>${esc(s.TrackingNo)||'ยังไม่มี Tracking'}</span>
        <span>${s.AssignedDriverName?`ผู้รับงาน: ${esc(s.AssignedDriverName)}`:'ยังไม่มีผู้รับงาน'}</span>
        <div class="delivery-job-actions">
          <a class="btn-sm outline" href="${shipmentAddressUrl(s)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${SHIP_ICON.navigation}แผนที่</a>
          ${action}
        </div>
      </div>
    </article>`;
  }).join('')}</div>`;
}

async function acceptShipment(id){
  try{
    await api(`/api/shipments/${id}/accept`,{method:'POST'});
    selectedShipmentId=id;
    toast('รับงานแล้ว — สถานะเปลี่ยนเป็น “กำลังจัดส่ง”');
    await loadAll();
    selectShipment(id);
    startDriverLocation(id);
    openShipmentDetail(id);
  }catch(e){toast(e.message,'error')}
}

async function quickAdvanceShipment(id,nextStatus){
  try{
    await api(`/api/shipments/${id}`,{method:'PATCH',body:JSON.stringify({status:nextStatus})});
    toast(`อัปเดตเป็น "${nextStatus}" แล้ว`);
    await loadAll();
    selectShipment(id);
  }catch(e){toast(e.message,'error')}
}

function fillShipmentForm(){
  const sel=document.getElementById('shipSelect');if(!sel)return;
  const opts=(state.shipments||[]).map(s=>`<option value="${s.ShipmentID}">#${s.OrderID} — ${esc(s.CustomerName)} (${esc(s.Status)})</option>`).join('');
  sel.innerHTML='<option value="">— เลือกรายการจัดส่ง —</option>'+opts;
  renderShipStepper(null);
}

function renderShipStepper(status){
  const wrap=document.getElementById('shipStepperWrap');if(!wrap)return;
  if(!status){wrap.innerHTML='';return}
  if(status==='ยกเลิก'){wrap.innerHTML=`<div class="status-stepper-hint rust">${SHIP_ICON.x} รายการนี้ถูกยกเลิกแล้ว</div>`;return}
  const steps=[['รอจัดส่ง',SHIP_ICON.clock],['กำลังจัดส่ง',SHIP_ICON.truck],['จัดส่งแล้ว',SHIP_ICON.check]];
  const idx=steps.findIndex(x=>x[0]===status);
  wrap.innerHTML=`<div class="status-stepper">${steps.map((s,i)=>`<button type="button" class="status-stepper-step ${i<idx?'done':i===idx?'current':''}" onclick="document.getElementById('shipStatus').value='${s[0]}'"><span class="status-stepper-dot">${i<idx?SHIP_ICON.check:s[1]}</span><span class="status-stepper-label">${s[0]}</span><span class="status-stepper-line"></span></button>`).join('')}</div>`;
}

function selectShipment(id){
  selectedShipmentId=Number(id);
  const s=state.shipments.find(x=>x.ShipmentID===selectedShipmentId);
  if(!s)return;
  const sel=document.getElementById('shipSelect');if(sel)sel.value=s.ShipmentID;
  const status=document.getElementById('shipStatus');if(status)status.value=s.Status;
  const tr=document.getElementById('shipTracking');if(tr)tr.value=s.TrackingNo||'';
  const co=document.getElementById('shipCompany');if(co)co.value=s.ShippingCompany||'';
  renderShipStepper(s.Status);renderDeliveryMap(s);
  document.querySelectorAll('.delivery-job').forEach(x=>x.classList.remove('selected'));
  // no rerender here — selected card gets visual after next render
}

const shipSelectEl=document.getElementById('shipSelect');
shipSelectEl?.addEventListener('change',e=>selectShipment(Number(e.target.value)));



// ── Delivery detail: หลังรับงานจะแสดงใบงานแบบเป็นระบบ ───────────────
function closeShipmentDetail(){
  const m=document.getElementById('deliveryDetailModal');
  if(m)m.classList.remove('open');
}
function shipmentTime(v){
  if(!v)return 'ยังไม่มีข้อมูล';
  try{return new Date(v).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'});}catch{return String(v)}
}
function shipmentStatusTone(status){
  if(status==='จัดส่งแล้ว')return 'sage';
  if(status==='รอจัดส่ง')return 'amber';
  if(status==='ยกเลิก')return 'rust';
  return '';
}
async function openShipmentDetail(id){
  const s=(state.shipments||[]).find(x=>Number(x.ShipmentID)===Number(id));
  const modal=document.getElementById('deliveryDetailModal'), body=document.getElementById('deliveryDetailBody');
  if(!s||!modal||!body)return;
  modal.classList.add('open');
  document.getElementById('deliveryDetailSub').textContent=`งาน #${s.OrderID} · ${s.CustomerName||'—'}`;
  body.innerHTML='<div class="loading"><div class="spinner"></div>กำลังโหลดรายละเอียดงาน…</div>';
  let history=[];
  try{history=await api(`/api/shipments/${s.ShipmentID}/timeline`);}catch{}
  const mine=s.AssignedDriverID===ME?.userID;
  const canAdvance=ME?.role==='พนักงานจัดส่ง'&&mine&&s.Status==='กำลังจัดส่ง';
  const mapId=`deliveryDetailMap_${s.ShipmentID}`;
  body.innerHTML=`
    <section class="delivery-detail-hero">
      <div class="delivery-detail-title">
        <div><span class="delivery-detail-kicker">Delivery Job</span><div class="delivery-detail-id">#${s.OrderID}</div></div>
        ${statusBadge(s.Status)}
      </div>
      <div class="delivery-detail-alert ${shipmentStatusTone(s.Status)}">
        ${s.Status==='กำลังจัดส่ง'?'งานนี้อยู่ในความรับผิดชอบของคุณแล้ว สามารถเปิดเส้นทางและอัปเดตสถานะได้ทันที':s.Status==='รอจัดส่ง'?'งานนี้ยังอยู่ในคิว รอพนักงานรับงาน':'สถานะล่าสุดของงานจัดส่ง'}
      </div>
      <div class="delivery-detail-grid">
        <div class="delivery-info-box"><span class="label">ลูกค้า</span><span class="value">${esc(s.CustomerName)}</span></div>
        <div class="delivery-info-box"><span class="label">โทรศัพท์</span><span class="value">${esc(s.Phone)||'—'}</span></div>
        <div class="delivery-info-box"><span class="label">Tracking Number</span><span class="value">${esc(s.TrackingNo)||'ยังไม่มี'}</span></div>
        <div class="delivery-info-box"><span class="label">บริษัทขนส่ง</span><span class="value">${esc(s.ShippingCompany)||'จัดส่งโดยร้าน'}</span></div>
        <div class="delivery-info-box" style="grid-column:1/-1"><span class="label">ที่อยู่จัดส่ง</span><span class="value">${esc(s.Address)||'—'}</span></div>
        <div class="delivery-info-box"><span class="label">ผู้รับงาน</span><span class="value">${esc(s.AssignedDriverName)||'ยังไม่มี'}</span></div>
        <div class="delivery-info-box"><span class="label">รับงานเมื่อ</span><span class="value">${shipmentTime(s.AcceptedAt)}</span></div>
      </div>
      <div class="delivery-detail-actions">
        <a class="btn-primary" href="${shipmentRouteUrl(s)}" target="_blank" rel="noopener">${SHIP_ICON.navigation}เปิดเส้นทางนำทาง</a>
        ${canAdvance?`<button class="btn-ship-advance" type="button" onclick="quickAdvanceShipment(${s.ShipmentID},'จัดส่งแล้ว');closeShipmentDetail()">${SHIP_ICON.check}ยืนยันจัดส่งสำเร็จ</button>`:''}
      </div>
    </section>
    <section class="delivery-detail-hero">
      <span class="delivery-detail-kicker">Destination</span>
      <div id="${mapId}" class="delivery-detail-map"></div>
    </section>
    <section class="delivery-detail-timeline">
      <h4>ประวัติการจัดส่ง</h4>
      <div class="delivery-history">
        ${(history.length?history:[{Status:s.Status,Note:'ยังไม่มีประวัติจากระบบ',CreatedAt:null,ActorName:'ระบบ'}]).map((h,i)=>`<div class="delivery-history-row ${i===history.length-1?'current':''}">
          <span class="delivery-history-dot"></span>
          <div class="delivery-history-content"><strong>${esc(h.Status)}</strong><small>${shipmentTime(h.CreatedAt)} · ${esc(h.ActorName)||'ระบบ'}</small>${h.Note?`<p>${esc(h.Note)}</p>`:''}</div>
        </div>`).join('')}
      </div>
    </section>`;
  setTimeout(async()=>{
    if(typeof L==='undefined')return;
    const el=document.getElementById(mapId); if(!el)return;
    const m=L.map(el,{zoomControl:true}).setView([13.7563,100.5018],6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(m);
    const dest=await geocodeAddress(s.Address);
    const pts=[];
    if(dest){pts.push([dest.lat,dest.lng]);L.marker([dest.lat,dest.lng]).addTo(m).bindPopup(`<strong>จุดส่ง</strong><br>${esc(s.CustomerName)}`).openPopup();}
    if(s.DriverLat&&s.DriverLng){const p=[Number(s.DriverLat),Number(s.DriverLng)];pts.push(p);L.circleMarker(p,{radius:8}).addTo(m).bindTooltip('ตำแหน่งพนักงาน');}
    if(pts.length===1)m.setView(pts[0],15); else if(pts.length>1)m.fitBounds(L.latLngBounds(pts),{padding:[25,25]});
    setTimeout(()=>m.invalidateSize(),80);
  },30);
}

async function updateShipment(){
  const err=document.getElementById('shipError');if(err)err.textContent='';
  const id=Number(document.getElementById('shipSelect')?.value);
  if(!id){if(err)err.textContent='กรุณาเลือกรายการจัดส่ง';return}
  try{
    await api(`/api/shipments/${id}`,{method:'PATCH',body:JSON.stringify({
      status:document.getElementById('shipStatus').value,
      trackingNo:document.getElementById('shipTracking').value||null,
      shippingCompany:document.getElementById('shipCompany').value||null,
      note:document.getElementById('shipNote')?.value||null
    })});
    toast('บันทึกสถานะสำเร็จ');await loadAll();selectShipment(id);
  }catch(e){if(err)err.textContent=e.message}
}

// ── Map: Leaflet + OpenStreetMap, destination is geocoded from the stored address.
async function geocodeAddress(address){
  if(!address)return null;
  if(deliveryGeoCache[address])return deliveryGeoCache[address];
  try{
    const u='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=th&q='+encodeURIComponent(address);
    const r=await fetch(u,{headers:{Accept:'application/json'}});
    const data=await r.json();
    if(!data[0])return null;
    const point={lat:Number(data[0].lat),lng:Number(data[0].lon)};
    deliveryGeoCache[address]=point;return point;
  }catch{return null}
}
function initDeliveryMap(){
  const el=document.getElementById('deliveryMap');
  if(!el||typeof L==='undefined'||deliveryMap)return;
  deliveryMap=L.map(el,{zoomControl:true}).setView([13.7563,100.5018],6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(deliveryMap);
}
async function renderDeliveryMap(s){
  const info=document.getElementById('deliveryMapInfo');if(!info)return;
  const statusEl=document.getElementById('mapStatus');if(statusEl)statusEl.textContent=s.Status==='กำลังจัดส่ง'?'กำลังติดตามตำแหน่ง':s.Status;
  initDeliveryMap();
  if(!deliveryMap){info.innerHTML='กำลังโหลดแผนที่…';return}
  info.innerHTML=`<strong>#${s.OrderID} · ${esc(s.CustomerName)}</strong><span>${esc(s.Address)}</span>`;
  if(deliveryDestination){deliveryMap.removeLayer(deliveryDestination);deliveryDestination=null}
  if(deliveryMarker){deliveryMap.removeLayer(deliveryMarker);deliveryMarker=null}
  const dest=await geocodeAddress(s.Address);
  if(dest){
    deliveryDestination=L.marker([dest.lat,dest.lng]).addTo(deliveryMap).bindPopup(`<strong>ปลายทาง</strong><br>${esc(s.CustomerName)}`).openPopup();
    deliveryMap.setView([dest.lat,dest.lng],15);
  }else{
    info.innerHTML+=`<small>ไม่พบพิกัดจากที่อยู่ — ใช้ปุ่ม “แผนที่” เพื่อเปิด Google Maps ได้ทันที</small>`;
  }
  if(s.DriverLat&&s.DriverLng){
    deliveryMarker=L.circleMarker([Number(s.DriverLat),Number(s.DriverLng)],{radius:9}).addTo(deliveryMap).bindTooltip('ตำแหน่งพนักงาน').openTooltip();
    if(dest)deliveryMap.fitBounds(L.latLngBounds([[dest.lat,dest.lng],[Number(s.DriverLat),Number(s.DriverLng)]]),{padding:[35,35]});
  }
}
function startDriverLocation(id){
  if(ME?.role!=='พนักงานจัดส่ง'||!navigator.geolocation)return;
  if(locationWatchId!==null)navigator.geolocation.clearWatch(locationWatchId);
  locationWatchId=navigator.geolocation.watchPosition(async pos=>{
    const s=state.shipments.find(x=>x.ShipmentID===Number(id));
    if(!s||s.Status!=='กำลังจัดส่ง')return;
    if(locationSending)return;
    locationSending=true;
    try{
      await api(`/api/shipments/${id}/location`,{method:'PATCH',body:JSON.stringify({lat:pos.coords.latitude,lng:pos.coords.longitude})});
    }catch{}
    finally{locationSending=false}
  },()=>{}, {enableHighAccuracy:true,maximumAge:10000,timeout:15000});
}
function stopDriverLocation(){
  if(locationWatchId!==null&&navigator.geolocation)navigator.geolocation.clearWatch(locationWatchId);
  locationWatchId=null;
}

window.addEventListener('beforeunload',stopDriverLocation);
document.addEventListener('visibilitychange',()=>{if(document.hidden){}});
