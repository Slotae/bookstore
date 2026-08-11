// ================================================================
// AUTH — login, register, logout, and session restore
// ================================================================
// ══ SCREEN HELPERS ══════════════════════════════════════════════════
function showLogin(){
  document.getElementById('registerScreen').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
}
function showRegister(){
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('registerScreen').classList.remove('hidden');
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
      showApp();
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
      showApp();
    }catch(e){err.textContent=e.message}
  });
}

document.getElementById('loginPass').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});
document.getElementById('loginUser').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('loginPass').focus()});

async function doLogout(){
  await fetch('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+TOKEN}}).catch(()=>{});
  TOKEN=''; ME=null;
  localStorage.removeItem('bms_token'); localStorage.removeItem('bms_me');
  document.getElementById('appHeader').classList.remove('visible');
  document.getElementById('statsBar').style.display='none';
  document.getElementById('appTabs').style.display='none';
  document.getElementById('appMain').style.display='none';
  showLogin();
}

// ══ SHOW APP + ROLE-BASED SETUP ════════════════════════════════════

// Restore an existing session after every script has loaded.
if(TOKEN&&ME){
  api('/api/me').then(me=>{
    ME=me; localStorage.setItem('bms_me',JSON.stringify(ME)); showApp();
  }).catch(()=>{
    localStorage.removeItem('bms_token'); localStorage.removeItem('bms_me');
    TOKEN=''; ME=null;
  });
}
