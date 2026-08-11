function renderBooks(){
  const box = document.getElementById('bookTable');
  if(!box) return;
  if(!state.books.length){box.innerHTML=emptyState('ยังไม่มีหนังสือ');return}

  const q = (document.getElementById('bookSearch')?.value||'').trim();
  const minPrice = Number(document.getElementById('bookMinPrice')?.value||0);
  const sortBy = document.getElementById('bookSort')?.value || 'name';
  const bestOnly = document.getElementById('bookBestOnly')?.checked;

  // Query 1 (WHERE Price > @minPrice), Query 2 (LIKE ชื่อ) และ Query 7 (HAVING TotalQty > @minQty)
  // รันจริงบนเซิร์ฟเวอร์ผ่าน runLiveQuery() (ดู liveBookPrice/liveBookKeyword/liveBookBestOnly ด้านบน)
  // ผลลัพธ์ (เซตของ ISBN/ชื่อหนังสือที่ตรงเงื่อนไขจริงจาก SQL) เก็บไว้ใน state.live แล้วนำมากรองที่นี่
  let rows = state.books.filter(b=>{
    if(minPrice>0 && state.live.bookPriceISBN && !state.live.bookPriceISBN.has(b.ISBN)) return false;
    if(bestOnly && state.live.bookBestNames && !state.live.bookBestNames.has(b.BookName)) return false;
    if(!q) return true;
    return state.live.bookKeywordISBN ? state.live.bookKeywordISBN.has(b.ISBN) : true;
  });

  if(sortBy==='priceDesc') rows = [...rows].sort((a,b)=>b.Price-a.Price);       // Query 5
  else if(sortBy==='soldDesc') rows = [...rows].sort((a,b)=>b.TotalSold-a.TotalSold); // Query 6/11
  else rows = [...rows].sort((a,b)=>a.BookName.localeCompare(b.BookName,'th'));

  if(!rows.length){box.innerHTML=emptyState('ไม่พบหนังสือที่ตรงกับเงื่อนไข');return}

  box.innerHTML=`<table>
    <thead><tr><th>ISBN</th><th>หนังสือ</th><th>ราคา</th><th>คงเหลือ</th><th>ยอดขาย</th><th></th></tr></thead>
    <tbody>${rows.map(b=>`<tr>
      <td><code style="font-size:11px;color:var(--muted)">${esc(b.ISBN)}</code></td>
      <td><strong>${esc(b.BookName)}</strong><small>หมวด: ${esc(b.Categories)||'—'}</small><small>ผู้แต่ง: ${esc(b.Authors)||'—'}</small></td>
      <td><strong>${money.format(b.Price)}</strong></td>
      <td><span class="badge ${b.Stock<=5?'badge-rust':b.Stock<=15?'badge-amber':'badge-sage'}">${b.Stock} เล่ม</span></td>
      <td>${b.TotalSold>5?`<span class="badge badge-sage"><svg class="icon-inline" viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 17a2.5 2.5 0 0 0 2.5-2.5c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7.5 7.5 0 1 1-15 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5"/></svg> ขายดี (${b.TotalSold})</span>`:b.TotalSold===0?'<span class="badge badge-gray">ยังไม่เคยขาย</span>':`<span class="badge badge-gray">${b.TotalSold} เล่ม</span>`}</td>
      <td>
        <button class="btn-sm" onclick="editBook('${encodeURIComponent(b.ISBN)}')" style="margin-right:6px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>แก้ไข
        </button>
        <button class="btn-sm rust" onclick="deleteBook('${encodeURIComponent(b.ISBN)}','${encodeURIComponent(b.BookName)}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>ลบ
      </button></td>
    </tr>`).join('')}</tbody></table>
    <div style="padding:8px 4px;font-size:12px;color:var(--muted)">พบ ${rows.length} จาก ${state.books.length} เล่ม</div>`;
}


let editingBookISBN = null; // null = โหมดเพิ่มใหม่ / มีค่า = กำลังแก้ไขเล่มนี้อยู่

function editBook(isbnEncoded){
  const isbn = decodeURIComponent(isbnEncoded);
  const b = state.books.find(x=>x.ISBN===isbn);
  if(!b) return;
  const form = document.getElementById('bookForm');
  form.isbn.value = b.ISBN;
  form.bookName.value = b.BookName;
  form.price.value = b.Price;
  form.stock.value = b.Stock;
  form.categories.value = b.Categories || '';
  form.authors.value = b.Authors || '';

  editingBookISBN = b.ISBN;
  document.getElementById('bookFormIsbn').readOnly = true; // แก้ไข ISBN เดิมไม่ได้ (เป็น primary key)
  document.getElementById('bookFormTitle').textContent = `แก้ไขหนังสือ: ${b.BookName}`;
  document.getElementById('bookFormSubmitBtn').innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>บันทึกการแก้ไข`;
  document.getElementById('bookFormCancelBtn').style.display = '';
  document.getElementById('bookError').textContent='';
  form.scrollIntoView({behavior:'smooth', block:'start'});
}

function cancelEditBook(){
  editingBookISBN = null;
  const form = document.getElementById('bookForm');
  form.reset();
  document.getElementById('bookFormIsbn').readOnly = false;
  document.getElementById('bookFormTitle').textContent = 'เพิ่มหนังสือใหม่';
  document.getElementById('bookFormSubmitBtn').innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>บันทึกหนังสือ`;
  document.getElementById('bookFormCancelBtn').style.display = 'none';
  document.getElementById('bookError').textContent='';
}

document.getElementById('bookForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.currentTarget;
  const err=document.getElementById('bookError'); err.textContent='';
  const data = Object.fromEntries(new FormData(form));
  await withSubmitLock(form, async()=>{
    try{
      if(editingBookISBN){
        await api(`/api/books/${encodeURIComponent(editingBookISBN)}`,{method:'PUT',body:JSON.stringify(data)});
        toast('แก้ไขหนังสือสำเร็จ ✓');
        cancelEditBook();
      } else {
        await api('/api/books',{method:'POST',body:JSON.stringify(data)});
        form.reset(); toast('เพิ่มหนังสือสำเร็จ ✓');
      }
      await loadAll();
    }catch(ex){err.textContent=ex.message}
  });
});


async function deleteBook(isbn, name){
  isbn = decodeURIComponent(isbn);
  name = decodeURIComponent(name);
  if(!confirm(`ยืนยันลบหนังสือ "${name}" ?\n(ไม่สามารถลบได้หากมีประวัติคำสั่งซื้ออยู่ในระบบ)`)) return;
  try{
    await api(`/api/books/${isbn}`,{method:'DELETE'});
    toast('ลบหนังสือสำเร็จ ✓'); await loadAll();
  }catch(ex){toast(ex.message,'error')}
}
