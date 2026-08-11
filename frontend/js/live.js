// ================================================================
// LIVE QUERIES — server-side filters used by books/customers
// ================================================================
// ── เรียก Query จริงจาก QUERY_LIBRARY (server.js) ผ่าน /api/reports/query/:id ─
// ใช้กับตัวกรองที่หน้าลูกค้า/หน้าคลังหนังสือ เพื่อให้การกรองเป็นการรัน SQL จริงบนเซิร์ฟเวอร์
// ทุกครั้ง (ไม่ใช่แค่กรองซ้ำข้อมูลที่โหลดมาแล้วฝั่ง client) — ผลที่ได้ (คีย์ที่ตรงเงื่อนไข)
// จะถูกใช้เป็นตัวกรองแถวจาก state.books/state.customers ที่โหลดไว้ เพื่อคงรายละเอียดครบ (หมวดหมู่,
// ผู้แต่ง, ที่อยู่ ฯลฯ) โดยไม่ต้องดึงข้อมูลซ้ำซ้อน
async function runLiveQuery(id, v){
  try{ const data = await api(`/api/reports/query/${id}?v=${encodeURIComponent(v ?? '')}`); return data.rows; }
  catch(e){ return []; }
}
const liveBookPrice = debounce(async (v)=>{
  state.live.bookPriceISBN = v>0 ? new Set((await runLiveQuery(1, v)).map(r=>r.ISBN)) : null; // Query 1: WHERE Price > @minPrice
  renderBooks();
}, 350);
const liveBookKeyword = debounce(async (v)=>{
  state.live.bookKeywordISBN = v ? new Set((await runLiveQuery(2, v)).map(r=>r.ISBN)) : null; // Query 2: WHERE BookName LIKE @kw
  renderBooks();
}, 350);
async function liveBookBestOnly(checked){
  state.live.bookBestNames = checked ? new Set((await runLiveQuery(7, 5)).map(r=>r.BookName)) : null; // Query 7: HAVING SUM(Quantity) > @minQty
  renderBooks();
}
const liveCustomerPhone = debounce(async (v)=>{
  state.live.customerPhoneNames = v ? new Set((await runLiveQuery(3, v)).map(r=>r.CustomerName)) : null; // Query 3: WHERE Phone LIKE @px
  renderCustomers();
}, 350);
async function liveCustomerFreqOnly(checked){
  state.live.customerFreqNames = checked ? new Set((await runLiveQuery(8, 1)).map(r=>r.CustomerName)) : null; // Query 8: HAVING COUNT(OrderID) > @minOrders
  renderCustomers();
}
