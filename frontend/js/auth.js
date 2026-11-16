// ================================================================
// AUTH — login, register, logout, and session restore
// ================================================================
// ══ SCREEN HELPERS ══════════════════════════════════════════════════
// [FIX-AUTH-REDIRECT] จำว่าผู้ใช้กำลังอยู่หน้าล็อกอิน/สมัครสมาชิกหรือไม่
// เพื่อกัน API/session ที่ตอบกลับช้าจากการพาหน้านี้หายไประหว่างกำลังกรอกข้อมูล
let AUTH_SCREEN = null;

function showLogin(){
  AUTH_SCREEN = 'login';
  document.getElementById('registerScreen').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
}
function showRegister(){
  AUTH_SCREEN = 'register';
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('registerScreen').classList.remove('hidden');
  goToRegStep(1); // เข้าหน้าสมัครสมาชิกใหม่ให้เริ่มที่ขั้นตอนแรกเสมอ
}

// ══ REGISTER — ตัวช่วย wizard 2 ขั้นตอน ═══════════════════════════════
function togglePw(inputId, btn){
  const input = document.getElementById(inputId);
  const showing = input.type === 'password';
  input.type = showing ? 'text' : 'password';
  btn.classList.toggle('showing', showing);
  btn.innerHTML = showing
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-2.61 3.87M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>';
}

function checkRegPwMatch(){
  const p1 = document.getElementById('regPass').value;
  const p2 = document.getElementById('regPass2').value;
  const hint = document.getElementById('regPwMatchHint');
  if(!p2){ hint.textContent=''; hint.className='auth-field-hint'; return; }
  if(p1===p2){ hint.textContent='✓ รหัสผ่านตรงกัน'; hint.className='auth-field-hint ok'; }
  else { hint.textContent='✕ รหัสผ่านยังไม่ตรงกัน'; hint.className='auth-field-hint bad'; }
}

function goToRegStep(step){
  const err1 = document.getElementById('regStep1Error'); err1.textContent='';
  if(step===2){
    // เช็คข้อมูลขั้นที่ 1 ให้ครบก่อนไปขั้นถัดไป
    const name=document.getElementById('regName').value.trim();
    const phone=document.getElementById('regPhone').value.trim();
    const email=document.getElementById('regEmail').value.trim();
    const address=document.getElementById('regAddress').value.trim();
    if(!name||!phone||!address){ err1.textContent='กรุณากรอกข้อมูลให้ครบ'; return; }
    if(!/^0[0-9\-]{8,11}$/.test(phone)){ err1.textContent='เบอร์โทรศัพท์ไม่ถูกต้อง'; return; }
    if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ err1.textContent='รูปแบบอีเมลไม่ถูกต้อง'; return; }
  }
  document.getElementById('regPanel1').classList.toggle('active', step===1);
  document.getElementById('regPanel2').classList.toggle('active', step===2);
  document.getElementById('regStepDot1').classList.toggle('active', step===1);
  document.getElementById('regStepDot1').classList.toggle('done', step===2);
  document.getElementById('regStepDot2').classList.toggle('active', step===2);
  document.getElementById('regStepLine').classList.toggle('done', step===2);
  document.getElementById('regStepLabel').textContent = step===1
    ? 'ขั้นตอน 1 จาก 2 — ข้อมูลส่วนตัว'
    : 'ขั้นตอน 2 จาก 2 — ตั้งรหัสผ่าน';
  if(step===1) document.getElementById('regName').focus();
  else document.getElementById('regUser').focus();
}
async function doLogin(){
  const u=document.getElementById('loginUser').value.trim();
  const p=document.getElementById('loginPass').value;
  const err=document.getElementById('loginError'); err.textContent='';
  if(!u||!p){err.textContent='กรุณากรอกชื่อผู้ใช้และรหัสผ่าน';return}
  await withBtnLock('loginSubmitBtn','กำลังเข้าสู่ระบบ…', async()=>{
    try{
      const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||'เข้าสู่ระบบไม่สำเร็จ');
      TOKEN=d.token; ME=d;
      localStorage.setItem('bms_token',TOKEN);
      localStorage.setItem('bms_me',JSON.stringify(ME));
      AUTH_SCREEN = null;
      showAuthSuccess('เข้าสู่ระบบสำเร็จ', `ยินดีต้อนรับกลับ, ${ME.fullName||ME.username||''}`, showApp);
    }catch(e){err.textContent=e.message}
  });
}

async function doRegister(){
  const err=document.getElementById('registerError'); err.textContent='';
  const name=document.getElementById('regName').value.trim();
  const phone=document.getElementById('regPhone').value.trim();
  const email=document.getElementById('regEmail').value.trim();
  const address=document.getElementById('regAddress').value.trim();
  const username=document.getElementById('regUser').value.trim();
  const pass=document.getElementById('regPass').value;
  const pass2=document.getElementById('regPass2').value;
  if(!name||!phone||!address||!username||!pass){err.textContent='กรุณากรอกข้อมูลให้ครบ';return}
  if(pass!==pass2){err.textContent='รหัสผ่านไม่ตรงกัน';return}
  if(pass.length<6){err.textContent='รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';return}
  await withBtnLock('registerSubmitBtn','กำลังสมัครสมาชิก…', async()=>{
    try{
      const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({customerName:name,phone,email,address,username,password:pass})});
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||'สมัครสมาชิกไม่สำเร็จ');
      TOKEN=d.token; ME=d;
      localStorage.setItem('bms_token',TOKEN);
      localStorage.setItem('bms_me',JSON.stringify(ME));
      AUTH_SCREEN = null;
      showAuthSuccess('สมัครสมาชิกสำเร็จ', `ยินดีต้อนรับ, ${ME.fullName||ME.username||''}`, showApp);
    }catch(e){
      // ถ้า error เกี่ยวกับอีเมล/เบอร์โทร (ข้อมูลอยู่ในขั้นที่ 1) ให้พากลับไปขั้นที่ 1 พร้อมโชว์ error ตรงนั้นเลย
      if(e.message.includes('อีเมล') || e.message.includes('เบอร์โทร')){
        goToRegStep(1);
        document.getElementById('regStep1Error').textContent = e.message;
      } else {
        err.textContent = e.message;
      }
    }
  });
}

document.getElementById('loginPass').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});
document.getElementById('loginUser').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('loginPass').focus()});

async function doLogout(){
  await fetch('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+TOKEN}}).catch(()=>{});
  TOKEN=''; ME=null; AUTH_SCREEN=null;
  localStorage.removeItem('bms_token'); localStorage.removeItem('bms_me');
  // ผู้ใช้กดออกจากระบบเอง จึงบังคับกลับหน้าร้านได้
  showGuestShop(true);
}

// ══ SHOW APP + ROLE-BASED SETUP ════════════════════════════════════

// [FIX-11] โหมดผู้เยี่ยมชม — ดูรายการหนังสือ/หยิบลงตะกร้าได้โดยไม่ต้องล็อกอิน
// จะเจอหน้าล็อกอินก็ต่อเมื่อกด "เข้าสู่ระบบ/สมัครสมาชิก" เอง หรือกด "สั่งซื้อ" ที่ต้องยืนยันตัวตนก่อนตัดสต็อก/บันทึกคำสั่งซื้อจริง
function showGuestShop(force=false){
  // [FIX-AUTH-REDIRECT] ถ้ากำลังกรอก login/register ห้าม response เบื้องหลังมาทับหน้า
  if(!force && (AUTH_SCREEN==='register' || AUTH_SCREEN==='login')) return;
  AUTH_SCREEN = null;
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('registerScreen').classList.add('hidden');
  document.getElementById('appHeader').classList.add('visible');
  document.getElementById('guestActions').style.display='';
  document.getElementById('userChip').style.display='none';
  document.getElementById('logoutBtn').style.display='none';
  document.getElementById('headerCartWrap').style.display='';
  document.getElementById('statsBar').style.display='none';
  document.getElementById('appTabs').style.display='';
  document.querySelectorAll('.tab').forEach(btn=>{
    const roles=(btn.dataset.roles||'').split(',').map(r=>r.trim());
    btn.style.display=roles.includes('guest')?'':'none';
  });
  document.querySelectorAll('.tab,.view').forEach(el=>el.classList.remove('active'));
  document.querySelector('.tab[data-view="shop"]')?.classList.add('active');
  document.getElementById('shop')?.classList.add('active');
  document.getElementById('appMain').style.display='';
  // [FIX-11] กลับมาที่ขั้นเลือกซื้อสินค้าเสมอ ไม่ให้ค้างอยู่หน้าชำระเงินจากรอบก่อน
  if (typeof backToBrowseStep === 'function') backToBrowseStep();
  loadGuestShop();
}

// Restore an existing session after every script has loaded.
// [FIX] เดิมโชว์หน้า login ให้กดได้ทันทีคู่ขนานกับการเช็ค session เบื้องหลัง —
// ถ้า session เดิมยังใช้ได้ พอเช็คเสร็จ (2-3 วิ) จะสั่ง showApp() ทับหน้าที่ผู้ใช้กำลังกรอกอยู่ทันที (เช่น หน้าสมัครสมาชิก)
// แก้โดยซ่อน login/register ไว้ก่อน โชว์ loading เฉย ๆ จนกว่าจะรู้ผลว่าจะพาไปหน้าไหนแน่ ๆ
function hideSessionLoading(){
  document.getElementById('sessionLoadingScreen').classList.add('hidden');
}
if(TOKEN&&ME){
  api('/api/me').then(me=>{
    // ระหว่างรอ /api/me ผู้ใช้อาจเปิดหน้าล็อกอิน/สมัครสมาชิกแล้ว
    // response เก่าจึงไม่มีสิทธิ์พาออกจากหน้าที่กำลังกรอก
    if(AUTH_SCREEN==='register' || AUTH_SCREEN==='login') return;
    ME=me;
    localStorage.setItem('bms_me',JSON.stringify(ME));
    showApp();
  }).catch(()=>{
    localStorage.removeItem('bms_token'); localStorage.removeItem('bms_me');
    TOKEN=''; ME=null;
    if(AUTH_SCREEN!=='register' && AUTH_SCREEN!=='login') showGuestShop();
  }).finally(hideSessionLoading);
} else {
  // [FIX-11] ต้องรอให้ทุกสคริปต์ (รวม shop.js ที่มี loadGuestShop) โหลด/รันเสร็จก่อน
  // ถ้าเรียก showGuestShop() ตรงนี้ทันทีจะพังเพราะ auth.js โหลดก่อน shop.js
  document.addEventListener('DOMContentLoaded', ()=>{
    if(AUTH_SCREEN!=='register' && AUTH_SCREEN!=='login') showGuestShop();
    hideSessionLoading();
  });
}
