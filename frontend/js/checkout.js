// ================================================================
// CHECKOUT — payment method, card validation, checkout, success modal
// ================================================================
// ══ วิธีชำระเงิน — สลับการ์ด/แผงข้อมูล ═══════════════════════════
function selectPayMethod(method) {
  checkoutMethod = method;
  document.getElementById('checkoutPayMethod').value = method;
  document.querySelectorAll('.pay-method-card').forEach(el => {
    el.classList.toggle('active', el.dataset.method === method);
  });
  document.getElementById('panelTransfer').style.display = method === 'โอน' ? '' : 'none';
  document.getElementById('panelCash').style.display     = method === 'เงินสด' ? '' : 'none';
  document.getElementById('panelCOD').style.display      = method === 'ปลายทาง' ? '' : 'none';
  document.getElementById('panelCard').style.display     = method === 'บัตร' ? '' : 'none';
  document.getElementById('checkoutError').textContent = '';
}

// [FIX] จำกัดขนาดไฟล์สลิปฝั่ง frontend ก่อนอ่าน/ส่งขึ้น server (จุดเดียวกับที่แก้ไว้ใน payments.js —
// เดิมมีแค่จุดเดียว จุดแนบสลิปตอน checkout นี้หลุดไป ทำให้ผู้ใช้เลือกไฟล์ใหญ่เกินได้และไปโดน
// server (limit 5MB) ปฏิเสธตอนกดยืนยันคำสั่งซื้อแทน ใช้ SLIP_MAX_BYTES ตัวเดียวกับ payments.js ที่ประกาศไว้ใน core.js)
function previewCheckoutSlip(input) {
  const file = input.files[0];
  const err  = document.getElementById('checkoutSlipError');
  if (err) err.textContent = '';
  if (!file) return;
  if (file.size > SLIP_MAX_BYTES) {
    if (err) err.textContent = `ไฟล์ใหญ่เกินไป (${(file.size/1024/1024).toFixed(1)}MB) กรุณาเลือกไฟล์ไม่เกิน 4MB`;
    input.value = '';
    checkoutSlipBase64 = null;
    document.getElementById('checkoutSlipPreview').style.display = 'none';
    document.getElementById('checkoutSlipLabel').textContent = 'แตะเพื่อเลือกไฟล์สลิป (ไม่บังคับตอนนี้)';
    return;
  }
  const r = new FileReader();
  r.onload = e => {
    checkoutSlipBase64 = e.target.result;
    const img = document.getElementById('checkoutSlipPreview');
    img.src = e.target.result;
    img.style.display = 'block';
    document.getElementById('checkoutSlipLabel').textContent = `เลือกแล้ว: ${file.name}`;
  };
  r.readAsDataURL(file);
}

// ══ บัตรเครดิต/เดบิต — จัดรูปแบบ + ตรวจสอบความสมจริง ═══════════════
function detectCardBrand(digits) {
  if (/^4/.test(digits)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'MASTERCARD';
  if (/^3[47]/.test(digits)) return 'AMEX';
  if (/^6(011|5)/.test(digits)) return 'DISCOVER';
  return 'CARD';
}

function formatCardNumber(input) {
  let digits = input.value.replace(/\D/g,'').slice(0,16);
  const brand = detectCardBrand(digits);
  // Amex ใช้รูปแบบ 4-6-5, บัตรอื่นๆ ใช้ 4-4-4-4
  const groups = brand === 'AMEX'
    ? [digits.slice(0,4), digits.slice(4,10), digits.slice(10,15)]
    : (digits.match(/.{1,4}/g) || []);
  input.value = groups.filter(Boolean).join(' ');
  document.getElementById('ccBrand').textContent = brand;

  const maskLen = brand === 'AMEX' ? 15 : 16;
  const padded  = digits.padEnd(maskLen, '•');
  const previewGroups = brand === 'AMEX'
    ? [padded.slice(0,4), padded.slice(4,10), padded.slice(10,15)]
    : (padded.match(/.{1,4}/g) || []);
  document.getElementById('ccNumberPreview').textContent = previewGroups.join(' ');
}

function formatCardExpiry(input) {
  let digits = input.value.replace(/\D/g,'').slice(0,4);
  if (digits.length >= 3) input.value = digits.slice(0,2) + '/' + digits.slice(2);
  else input.value = digits;
  document.getElementById('ccExpPreview').textContent = input.value || 'MM/YY';
}

function formatCardCvv(input) {
  input.value = input.value.replace(/\D/g,'').slice(0,4);
}

function onCardNameInput(input) {
  document.getElementById('ccNamePreview').textContent = input.value.trim().toUpperCase() || 'YOUR NAME';
}

function luhnValid(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function validateCardForm() {
  const digits = document.getElementById('ccNumber').value.replace(/\D/g,'');
  const expiry = document.getElementById('ccExpiry').value.trim();
  const cvv    = document.getElementById('ccCvv').value.trim();
  const name   = document.getElementById('ccName').value.trim();

  if (digits.length < 13 || digits.length > 16) return 'กรุณากรอกหมายเลขบัตรให้ครบถ้วน';
  if (!luhnValid(digits)) return 'หมายเลขบัตรไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
  const m = expiry.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return 'กรุณากรอกวันหมดอายุให้ถูกรูปแบบ (MM/YY)';
  const expMonth = Number(m[1]), expYear = 2000 + Number(m[2]);
  if (expMonth < 1 || expMonth > 12) return 'เดือนหมดอายุไม่ถูกต้อง';
  const now = new Date();
  const expDate = new Date(expYear, expMonth, 0, 23, 59, 59);
  if (expDate < now) return 'บัตรหมดอายุแล้ว กรุณาใช้บัตรใบอื่น';
  if (cvv.length < 3 || cvv.length > 4) return 'CVV ไม่ถูกต้อง';
  if (!name) return 'กรุณากรอกชื่อบนบัตร';
  return null;
}

async function doCheckout() {
  const err = document.getElementById('checkoutError');
  err.textContent = '';
  if (!cart.length) { err.textContent = 'กรุณาเพิ่มสินค้าในตะกร้าก่อน'; return; }
  // [FIX-11] เผื่อไว้กันเหนียว — ปกติเข้าหน้านี้ไม่ได้ตั้งแต่แรกถ้ายังไม่ล็อกอิน (เช็คที่ goToCheckoutStep() แล้ว)
  if (!TOKEN) {
    guestCheckoutIntent = true;
    toast('กรุณาเข้าสู่ระบบหรือสมัครสมาชิกก่อนยืนยันการสั่งซื้อ', 'error');
    showLogin();
    return;
  }
  const address = document.getElementById('checkoutAddress').value.trim();
  if (!address) { err.textContent = 'กรุณากรอกที่อยู่จัดส่ง'; return; }
  if (!myCustomerID) {
    try {
      const profile = await api('/api/my/profile');
      if (profile) myCustomerID = profile.CustomerID;
    } catch(e) {}
  }
  if (!myCustomerID) { err.textContent = 'ไม่พบข้อมูลลูกค้า กรุณาติดต่อเจ้าหน้าที่'; return; }

  // ตรวจสอบข้อมูลบัตรก่อน ถ้าเลือกชำระด้วยบัตรเครดิต/เดบิต
  if (checkoutMethod === 'บัตร') {
    const cardErr = validateCardForm();
    if (cardErr) { err.textContent = cardErr; return; }
  }

  const btn = document.getElementById('checkoutBtn');
  btn.disabled = true;
  btn.innerHTML = checkoutMethod === 'บัตร'
    ? '<div class="btn-spinner"></div>กำลังตรวจสอบบัตร…'
    : '<div class="btn-spinner"></div>กำลังดำเนินการ…';

  try {
    // จำลองเวลาตรวจสอบ/อนุมัติบัตรสั้นๆ เพื่อความสมจริง
    if (checkoutMethod === 'บัตร') await new Promise(r => setTimeout(r, 900));

    const created = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerId: myCustomerID,
        items: cart.map(c => ({ isbn: c.isbn, quantity: c.quantity })),
        paymentMethod: checkoutMethod,
        address,
        orderDate: new Date().toISOString().slice(0,10),
        shipDate: new Date().toISOString().slice(0,10)
      })
    });

    const cardLast4 = checkoutMethod === 'บัตร'
      ? document.getElementById('ccNumber').value.replace(/\D/g,'').slice(-4)
      : null;
    const orderTotal = created && created.total != null
      ? created.total
      : cart.reduce((s,c) => s + c.price * c.quantity, 0);

    // ถ้าเลือกโอนเงินและแนบสลิปไว้แล้ว ให้บันทึกสลิปทันทีหลังสร้างออเดอร์สำเร็จ
    let slipAttached = false;
    if (checkoutMethod === 'โอน' && checkoutSlipBase64 && created && created.OrderID) {
      try {
        const myOrders = await api('/api/my/orders');
        const match = myOrders.find(o => o.OrderID === created.OrderID);
        if (match && match.PaymentID) {
          await api(`/api/payments/${match.PaymentID}`, { method: 'PATCH', body: JSON.stringify({ slip: checkoutSlipBase64 }) });
          slipAttached = true;
        }
      } catch(e) { /* ไม่บล็อกการสั่งซื้อถ้าแนบสลิปตอนนี้ไม่สำเร็จ ผู้ใช้แนบทีหลังได้ */ }
    }

    // เคลียร์ตะกร้าและฟอร์ม
    cart = [];
    renderCart();
    renderShopCatalog(shopBooks);
    backToBrowseStep(); // [FIX-11] สั่งซื้อสำเร็จแล้ว กลับไปหน้าเลือกซื้อสินค้าตามปกติ
    checkoutSlipBase64 = null;
    document.getElementById('checkoutSlipFile').value = '';
    document.getElementById('checkoutSlipPreview').style.display = 'none';
    document.getElementById('checkoutSlipLabel').textContent = 'แตะเพื่อเลือกไฟล์สลิป (ไม่บังคับตอนนี้)';
    ['ccNumber','ccExpiry','ccCvv','ccName'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('ccBrand').textContent = 'CARD';
    document.getElementById('ccNumberPreview').textContent = '•••• •••• •••• ••••';
    document.getElementById('ccNamePreview').textContent = 'YOUR NAME';
    document.getElementById('ccExpPreview').textContent = 'MM/YY';

    // โหลด orders ใหม่ไว้เบื้องหลัง (สำหรับตอนกดปุ่ม "ดูคำสั่งซื้อของฉัน")
    const orders = await api('/api/my/orders');
    renderMyOrders(orders);
    document.getElementById('recentOrders').innerHTML = renderMyOrdersMini(orders.slice(0,5));

    showOrderSuccessModal({
      orderId: created ? created.OrderID : null,
      total: orderTotal,
      method: checkoutMethod,
      address,
      cardLast4,
      slipAttached
    });
  } catch(e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px"><polyline points="20 6 9 17 4 12"/></svg>ยืนยันคำสั่งซื้อ';
  }
}

// ══ ป๊อปอัพขอบคุณหลังชำระเงินสำเร็จ ═════════════════════════════════
function methodLabel(method) {
  return { 'โอน':'โอนเงิน', 'เงินสด':'เงินสด', 'ปลายทาง':'เก็บเงินปลายทาง', 'บัตร':'บัตรเครดิต/เดบิต' }[method] || method;
}

function showOrderSuccessModal({ orderId, total, method, address, cardLast4, slipAttached, viewMode = 'customer' }) {
  const rows = [
    ['หมายเลขคำสั่งซื้อ', orderId ? `#${orderId}` : '—'],
    ['ยอดชำระ', money.format(total || 0)],
    ['วิธีชำระเงิน', methodLabel(method) + (cardLast4 ? ` (•••• ${cardLast4})` : '')],
    ['ที่อยู่จัดส่ง', address]
  ];

  let noteHtml = '';
  if (method === 'โอน') {
    if (slipAttached) {
      noteHtml = '<div class="order-success-note sage">แนบสลิปเรียบร้อยแล้ว ✓ รอเจ้าหน้าที่ตรวจสอบยอดเงิน</div>';
    } else {
      noteHtml = viewMode === 'staff'
        ? '<div class="order-success-note amber">ยังไม่มีสลิปแนบมา — แนบแทนลูกค้าได้ที่แท็บ "ชำระเงิน"</div>'
        : '<div class="order-success-note amber">อย่าลืมแนบสลิปการโอนที่หน้า "คำสั่งซื้อของฉัน" เพื่อยืนยันการชำระเงิน</div>';
    }
  } else if (method === 'เงินสด') {
    noteHtml = '<div class="order-success-note amber">กรุณาชำระเงินสดกับเจ้าหน้าที่ร้านเพื่อยืนยันคำสั่งซื้อ</div>';
  } else if (method === 'ปลายทาง') {
    noteHtml = '<div class="order-success-note blue">เตรียมเงินสดไว้รับสินค้าจากพนักงานจัดส่งได้เลย</div>';
  } else if (method === 'บัตร') {
    noteHtml = '<div class="order-success-note sage">ทำรายการชำระเงินด้วยบัตรสำเร็จแล้ว ✓</div>';
  }

  document.getElementById('orderSuccessSummary').innerHTML =
    rows.map(([label,val]) => `
      <div class="order-success-row">
        <span class="order-success-label">${esc(label)}</span>
        <span class="order-success-value">${esc(val)}</span>
      </div>`).join('') + noteHtml;

  document.getElementById('orderSuccessTitle').textContent =
    viewMode === 'staff' ? 'บันทึกคำสั่งซื้อสำเร็จ!' : 'ขอบคุณสำหรับคำสั่งซื้อ!';
  document.getElementById('orderSuccessSub').textContent =
    viewMode === 'staff' ? 'ระบบได้บันทึกคำสั่งซื้อของลูกค้าเรียบร้อยแล้ว' : 'คำสั่งซื้อของคุณถูกบันทึกเรียบร้อยแล้ว';
  document.getElementById('successViewBtn').textContent =
    viewMode === 'staff' ? 'ดูคำสั่งซื้อ' : 'ดูคำสั่งซื้อของฉัน';

  const modal = document.getElementById('orderSuccessModal');
  modal.dataset.viewMode = viewMode;
  modal.classList.add('open');

  // รีสตาร์ทแอนิเมชันตราประทับทุกครั้งที่เปิด
  const wrap = document.getElementById('successCheckWrap');
  wrap.classList.remove('animate');
  void wrap.offsetWidth;
  wrap.classList.add('animate');
}

function closeOrderSuccessModal() {
  document.getElementById('orderSuccessModal').classList.remove('open');
}

function goToMyOrdersFromSuccess() {
  const modal = document.getElementById('orderSuccessModal');
  const viewMode = modal.dataset.viewMode || 'customer';
  closeOrderSuccessModal();
  const targetView = viewMode === 'staff' ? 'orders' : 'myorders';
  document.querySelectorAll('.tab,.view').forEach(el => el.classList.remove('active'));
  document.querySelector(`[data-view="${targetView}"]`).classList.add('active');
  document.getElementById(targetView).classList.add('active');
  if (viewMode === 'staff') {
    document.getElementById('orderTable').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
