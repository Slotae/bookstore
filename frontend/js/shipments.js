// ================================================================
// SHIPMENTS — shipment list and shipment update form
// ================================================================
function renderShipments(){
  if(!state.shipments.length){document.getElementById('shipmentTable').innerHTML=emptyState('ยังไม่มีรายการจัดส่ง');return}
  // [FIX-12] มิติแอดมิน/พนักงานขายในหน้าจัดส่ง: ยกเลิกออเดอร์ได้ตรงนี้เลย (เฉพาะที่ยังไม่ส่ง)
  // และเห็นหมายเหตุ+เวลาที่ยกเลิกของรายการที่ถูกยกเลิกแล้ว — พนักงานจัดส่งเห็นได้แต่กดยกเลิกไม่ได้ (ตามสิทธิ์ backend)
  const canCancel = ME?.role==='Admin' || ME?.role==='พนักงานขาย';
  document.getElementById('shipmentTable').innerHTML=`<table>
    <thead><tr><th>รหัส</th><th>คำสั่งซื้อ</th><th>ลูกค้า</th><th>วันจัดส่ง</th><th>บริษัทขนส่ง</th><th>Tracking</th><th>สถานะ</th><th>ยอด</th>${canCancel?'<th></th>':''}</tr></thead>
    <tbody>${state.shipments.map(s=>`<tr>
      <td><span class="badge badge-blue">S${s.ShipmentID}</span></td>
      <td>#${s.OrderID}</td>
      <td>${esc(s.CustomerName)}</td>
      <td>${esc(s.ShipDate)}</td>
      <td>${s.ShippingCompany?esc(s.ShippingCompany):'<span style="color:var(--muted);font-size:12px">—</span>'}</td>
      <td><code style="font-size:11px">${esc(s.TrackingNo)||'—'}</code></td>
      <td>${statusBadge(s.Status)}${s.Status==='ยกเลิก' && s.CancelNote?`<small style="display:block;color:var(--muted);font-size:11px;max-width:160px;word-break:break-word">หมายเหตุ: ${esc(s.CancelNote)}</small>`:''}</td>
      <td>${money.format(s.Amount||0)}</td>
      ${canCancel?`<td>${s.Status==='รอจัดส่ง'
        ? `<button class="btn-sm rust" onclick="cancelOrderAdmin(${s.OrderID})">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>ยกเลิก
           </button>`
        : (s.Status==='กำลังจัดส่ง' ? '<span style="font-size:11px;color:var(--muted)">กำลังจัดส่งแล้ว ยกเลิกไม่ได้</span>' : '')}</td>`:''}
    </tr>`).join('')}</tbody></table>`;
}


function fillShipmentForm(){
  const opts=state.shipments.map(s=>`<option value="${s.ShipmentID}">#${s.OrderID} — ${esc(s.CustomerName)} (${esc(s.Status)})</option>`).join('');
  document.getElementById('shipSelect').innerHTML='<option value="">— เลือกรายการจัดส่ง —</option>'+opts;
}

document.getElementById('shipSelect').addEventListener('change',e=>{
  const s=state.shipments.find(x=>x.ShipmentID===Number(e.target.value));
  if(s){
    document.getElementById('shipStatus').value=s.Status;
    document.getElementById('shipTracking').value=s.TrackingNo||'';
    document.getElementById('shipCompany').value=s.ShippingCompany||'';
  }
});
