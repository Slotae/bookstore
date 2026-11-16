/**
 * Bookstore Management System — Node.js Server (Complete)
 * Stack: Node.js (built-in http) + mssql + Microsoft SQL Server
 *
 * รันด้วย:  npm start
 * ตั้งค่าผ่าน Environment Variables (หรือไฟล์ .env):
 *   DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD, PORT
 *
 */

const http   = require("node:http");
const fs     = require("node:fs");
const path   = require("node:path");
const net    = require("node:net");
const sql    = require("mssql");
const crypto = require("node:crypto");

// ── LOAD .env ──────────────────────────────────────────────────────
// ไฟล์ต้องชื่อ .env เท่านั้น — rename จาก _env → .env ก่อนรัน
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach(line => {
      const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    });
}
loadEnv();

// ── AUTO-OPEN BROWSER ─────────────────────────────────────────────
// เปิดเว็บเบราว์เซอร์อัตโนมัติเมื่อ server พร้อมใช้งาน (ใช้คำสั่งของแต่ละ OS โดยตรง ไม่ต้องลง package เพิ่ม)
function openBrowser(url) {
  const { exec } = require("node:child_process");
  const platform = process.platform;
  let cmd;
  if (platform === "win32")      cmd = `start "" "${url}"`;
  else if (platform === "darwin") cmd = `open "${url}"`;
  else                             cmd = `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) console.log(`  ℹ️  ไม่สามารถเปิดเบราว์เซอร์อัตโนมัติได้ กรุณาเปิดเองที่ ${url}`);
  });
}

// ── PORT FINDER ────────────────────────────────────────────────────
function isPortFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => { s.close(); resolve(true); });
    s.listen(port, "0.0.0.0");
  });
}

async function findPort(start) {
  for (let p = start; p < start + 20; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error("ไม่พบ port ว่างในช่วง " + start + "–" + (start + 19));
}

// ── DB CONFIG ──────────────────────────────────────────────────────
const rawServer = process.env.DB_SERVER || "localhost";
const [serverName, instanceName] = rawServer.split("\\");

const dbConfig = {
  server:   serverName,
  database: process.env.DB_NAME     || "BookstoreDB",
  user:     process.env.DB_USER     || "sa",
  password: process.env.DB_PASSWORD || "",
  options: {
    encrypt:                process.env.DB_ENCRYPT    === "true",
    trustServerCertificate: process.env.DB_TRUST_CERT !== "false",
    ...(instanceName ? { instanceName } : {})
  }
};

if (process.env.DB_PORT)   dbConfig.port = Number(process.env.DB_PORT);
else if (!instanceName)     dbConfig.port = 1433;

// Auto-cancel order ที่ค้างชำระนานเกินกำหนด (ยังไม่แนบสลิป/ยังไม่ชำระเลย)
//         ตั้งค่าได้ผ่าน ENV: ORDER_AUTO_CANCEL_DAYS (ค่าเริ่มต้น 3 วัน)
//                             ORDER_AUTO_CANCEL_CHECK_MINUTES (ค่าเริ่มต้น 60 นาที)
const ORDER_AUTO_CANCEL_DAYS          = Number(process.env.ORDER_AUTO_CANCEL_DAYS || 3);
const ORDER_AUTO_CANCEL_CHECK_MINUTES = Number(process.env.ORDER_AUTO_CANCEL_CHECK_MINUTES || 60);

let poolPromise = null;
function getPool() {
  if (!poolPromise) poolPromise = sql.connect(dbConfig);
  return poolPromise;
}

// ── HELPERS ────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, "../frontend");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

// readBody: เผื่อ overhead ของ Base64 (ไฟล์รูป 4 MB จะมี payload มากกว่า 5 MB)
const MAX_BODY_BYTES = 7 * 1024 * 1024;
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let settled = false;
    req.on("data", chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        settled = true;
        const err = new Error("ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป (สูงสุดประมาณ 7 MB ต่อคำขอ)");
        err.statusCode = 413;
        reject(err);
        req.resume();
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (settled) return;
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { e.statusCode = 400; reject(e); }
    });
    req.on("error", err => { if (!settled) reject(err); });
  });
}

async function query(sql_text, inputs = {}, transaction = null) {
  const req = transaction ? new sql.Request(transaction) : (await getPool()).request();
  for (const [name, { type, value }] of Object.entries(inputs))
    req.input(name, type, value);
  const result = await req.query(sql_text);
  return result.recordset || [];
}

// today(): ใช้ timezone Asia/Bangkok (UTC+7) แทน UTC
// ป้องกันวันที่คลาดเคลื่อนก่อน 07:00 น. เมื่อ server รันที่ UTC+0
function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
}

// ── VALIDATION HELPERS ────────────────────────────────────────────
// ตรวจข้อมูลฝั่ง server เสมอ — ฝั่ง client อาจถูกข้ามได้ (แก้ HTML, เรียก
// API ตรงๆ ด้วย curl/Postman) ดังนั้น server ต้องเป็นด่านสุดท้ายที่กันข้อมูลผิดรูปแบบ
function isValidPhone(phone) {
  const digits = String(phone || "").replace(/[\s-]/g, "");
  return /^0\d{8,9}$/.test(digits); // เบอร์ไทย: ขึ้นต้น 0 ตามด้วยเลข 8-9 หลัก (รวม 9-10 หลัก)
}
function isValidEmail(email) {
  if (!email) return true; // อีเมลเป็นช่องไม่บังคับ
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}
function isNonNegativeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0;
}
function isNonNegativeInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0;
}
function isValidISBN(isbn) {
  const s = String(isbn || "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(s)) {
    const sum = s.slice(0, 12).split("").reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
    return (10 - (sum % 10)) % 10 === Number(s[12]);
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum = s.split("").reduce((acc, ch, i) => acc + (ch === "X" ? 10 : Number(ch)) * (10 - i), 0);
    return sum % 11 === 0;
  }
  return false;
}
function isValidSlipDataUrl(value) {
  if (typeof value !== "string") return false;
  return /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\r\n]+$/i.test(value);
}

function legacyHashPwd(pwd) {
  return crypto.createHash("sha256").update(pwd + "bookstore_salt_2026").digest("hex");
}
function hashPwd(pwd) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pwd), salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
function verifyPwd(pwd, stored) {
  const value = String(stored || "");
  if (value.startsWith("scrypt$")) {
    const parts = value.split("$");
    if (parts.length !== 3) return false;
    const actual = crypto.scryptSync(String(pwd), parts[1], 32);
    const expected = Buffer.from(parts[2], "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  }
  return value === legacyHashPwd(pwd);
}

// ── AUTO-CANCEL UNPAID ORDERS ────────────────────────────────────────
// ยกเลิกคำสั่งซื้ออัตโนมัติเมื่อ "ค้างชำระ" (PaymentStatus = รอชำระ คือยังไม่แนบสลิปเลย)
//         นานเกิน ORDER_AUTO_CANCEL_DAYS วัน และยังไม่ถูกดำเนินการจัดส่ง (Status = รอจัดส่ง)
// ครอบคลุมเคส "ปฏิเสธ" ด้วย (สลิปถูกปฏิเสธแล้วลูกค้าไม่แนบใหม่) — เดิมช่องนี้ตกหล่น
//         เพราะเช็คแค่ PaymentStatus = 'รอชำระ' ทำให้ออเดอร์ที่ถูกปฏิเสธค้างอยู่ตลอดไปไม่มีวันโดนเก็บกวาด
//         นับวันของเคส "ปฏิเสธ" จาก RejectedAt (วันที่ถูกปฏิเสธ) ไม่ใช่ OrderDate เดิม เพราะลูกค้าควรมีเวลา
//         แนบสลิปใหม่นับจากวันที่ถูกปฏิเสธจริง ไม่ใช่โดนนับเวลาย้อนไปตั้งแต่วันสั่งซื้อ (จะไม่ยุติธรรม/อาจตัดสิทธิ์ทันที)
//         หมายเหตุ: ออเดอร์ที่แนบสลิปแล้วรอตรวจสอบ (รอตรวจสอบ) จะไม่ถูกยกเลิกอัตโนมัติ
//         เพราะลูกค้าได้ดำเนินการชำระเงินแล้ว รอเพียงเจ้าหน้าที่ตรวจสอบเท่านั้น
async function autoCancelUnpaidOrders() {
  const pool = await getPool();

  // หา OrderID ที่เข้าเงื่อนไข (ล็อกแถว Shipment ไว้กันแทรกซ้อนระหว่างประมวลผล)
  const candidates = await pool.request()
    .input("Days", sql.Int, ORDER_AUTO_CANCEL_DAYS)
    .query(`
      SELECT o.OrderID
      FROM dbo.Orders  o
      JOIN dbo.Payment  p ON p.OrderID = o.OrderID
      JOIN dbo.Shipment s ON s.OrderID = o.OrderID
      WHERE p.PaymentMethod IN (N'โอน', N'บัตร')
        AND p.PaymentStatus IN (N'รอชำระ', N'ปฏิเสธ')
        AND s.Status        = N'รอจัดส่ง'
        AND DATEDIFF(
              day,
              CASE WHEN p.PaymentStatus = N'ปฏิเสธ' THEN COALESCE(p.RejectedAt, o.OrderDate)
                   ELSE o.OrderDate END,
              CONVERT(date, GETDATE())
            ) >= @Days
    `);

  const orderIds = candidates.recordset.map(r => r.OrderID);
  if (!orderIds.length) return { cancelled: 0, orderIds: [] };

  const cancelledIds = [];
  for (const id of orderIds) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      // เช็คซ้ำในทรานแซกชัน (กันเคสสถานะเปลี่ยนไปแล้วระหว่างรอคิว) พร้อมล็อกแถว
      const ship = await new sql.Request(tx)
        .input("ID", sql.Int, id)
        .query("SELECT Status FROM dbo.Shipment WITH (UPDLOCK,ROWLOCK) WHERE OrderID=@ID");
      if (!ship.recordset.length || ship.recordset[0].Status !== "รอจัดส่ง") {
        await tx.commit();
        continue;
      }
      const pay = await new sql.Request(tx)
        .input("ID", sql.Int, id)
        .query("SELECT PaymentStatus,PaymentMethod FROM dbo.Payment WITH (UPDLOCK,ROWLOCK) WHERE OrderID=@ID");
      if (!pay.recordset.length || !["โอน", "บัตร"].includes(pay.recordset[0].PaymentMethod) || !["รอชำระ", "ปฏิเสธ"].includes(pay.recordset[0].PaymentStatus)) {
        await tx.commit();
        continue;
      }
      const rejectedCase = pay.recordset[0].PaymentStatus === "ปฏิเสธ";

      // คืน stock
      const details = await new sql.Request(tx)
        .input("OID", sql.Int, id)
        .query("SELECT ISBN, Quantity FROM dbo.Order_Detail WHERE OrderID=@OID");
      for (const d of details.recordset) {
        await new sql.Request(tx)
          .input("ISBN", sql.VarChar(20), d.ISBN)
          .input("Qty",  sql.Int, d.Quantity)
          .query("UPDATE dbo.Book SET Stock=Stock+@Qty WHERE ISBN=@ISBN");
      }

      // อัปเดตสถานะจัดส่งเป็น ยกเลิก พร้อมบันทึกหมายเหตุอัตโนมัติ + เวลาที่ยกเลิก
      const autoNote = rejectedCase
        ? `ยกเลิกอัตโนมัติ: สลิปถูกปฏิเสธและไม่แนบใหม่เกิน ${ORDER_AUTO_CANCEL_DAYS} วัน`
        : `ยกเลิกอัตโนมัติ: ค้างชำระเกิน ${ORDER_AUTO_CANCEL_DAYS} วัน`;
      await new sql.Request(tx)
        .input("OID", sql.Int, id)
        .input("Note", sql.NVarChar(500), autoNote)
        .query(`UPDATE dbo.Shipment
                SET Status=N'ยกเลิก', CancelNote=@Note, CancelledAt=GETDATE()
                WHERE OrderID=@OID`);

      await tx.commit();
      cancelledIds.push(id);
    } catch (err) {
      await tx.rollback();
      console.error(`  ⚠️  Auto-cancel: ยกเลิก Order #${id} ไม่สำเร็จ:`, err.message);
    }
  }

  if (cancelledIds.length) {
    console.log(`  🗑️  Auto-cancel: ยกเลิกคำสั่งซื้อค้างชำระเกิน ${ORDER_AUTO_CANCEL_DAYS} วัน จำนวน ${cancelledIds.length} รายการ (Order #${cancelledIds.join(", #")})`);
  }
  return { cancelled: cancelledIds.length, orderIds: cancelledIds };
}

function startAutoCancelScheduler() {
  const intervalMs = ORDER_AUTO_CANCEL_CHECK_MINUTES * 60 * 1000;
  // รันครั้งแรกทันทีตอน server เริ่มทำงาน แล้วค่อยรันซ้ำตามรอบเวลา
  autoCancelUnpaidOrders().catch(err => console.error("  ⚠️  Auto-cancel เริ่มต้นล้มเหลว:", err.message));
  setInterval(() => {
    autoCancelUnpaidOrders().catch(err => console.error("  ⚠️  Auto-cancel ล้มเหลว:", err.message));
  }, intervalMs);
}

// ── INIT USERS TABLE ───────────────────────────────────────────────
async function ensureUsersTable() {
  const pool = await getPool();
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.SystemUser', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.SystemUser (
        UserID      INT IDENTITY(1,1) NOT NULL,
        Username    NVARCHAR(60)  NOT NULL,
        PasswordHash VARCHAR(160) NOT NULL,
        FullName    NVARCHAR(100) NOT NULL,
        Role        NVARCHAR(30)  NOT NULL DEFAULT 'พนักงานขาย',
        IsActive    BIT           NOT NULL DEFAULT 1,
        CreatedAt   DATE          NOT NULL DEFAULT (CONVERT(date, GETDATE())),
        CustomerID  INT           NULL,
        CONSTRAINT PK_SystemUser PRIMARY KEY (UserID),
        CONSTRAINT UQ_SystemUser_Username UNIQUE (Username),
        CONSTRAINT CK_SystemUser_Role CHECK (Role IN (N'Admin', N'พนักงานขาย', N'พนักงานจัดส่ง', N'ลูกค้า'))
      );
    END
  `);
  // เติมคอลัมน์ CustomerID ให้ตารางเก่าที่ยังไม่มี (กรณีสร้างจาก server.js ครั้งก่อนๆ)
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.SystemUser') AND name='CustomerID')
      ALTER TABLE dbo.SystemUser ADD CustomerID INT NULL;
  `);
  await pool.request().query(`
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.SystemUser') AND name='PasswordHash' AND max_length < 160)
      ALTER TABLE dbo.SystemUser ALTER COLUMN PasswordHash VARCHAR(160) NOT NULL;
  `);

  // ถ้ายังไม่มี user เลย (ตารางว่าง) ให้สร้างบัญชีเริ่มต้น
  // Production ต้องกำหนดรหัสผ่านผ่าน environment เท่านั้น เพื่อไม่สร้างบัญชีด้วยรหัสผ่านเดาง่าย
  const countRows = await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.SystemUser;`);
  if (countRows.recordset[0].c === 0) {
    const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    const bootstrap = {
      admin: process.env.BOOTSTRAP_ADMIN_PASSWORD || (isProduction ? "" : "admin1234"),
      staff: process.env.BOOTSTRAP_STAFF_PASSWORD || (isProduction ? "" : "staff1234"),
      delivery: process.env.BOOTSTRAP_DELIVERY_PASSWORD || (isProduction ? "" : "delivery1234"),
    };
    if (!bootstrap.admin || !bootstrap.staff || !bootstrap.delivery) {
      throw new Error(
        "SystemUser is empty. Set BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_STAFF_PASSWORD and BOOTSTRAP_DELIVERY_PASSWORD before starting in production."
      );
    }

    // ใช้ parameterized query แทน string interpolation — ป้องกัน SQL Injection pattern
    const adminHash = hashPwd(bootstrap.admin);
    const staffHash = hashPwd(bootstrap.staff);
    const delivHash = hashPwd(bootstrap.delivery);
    await pool.request()
      .input("h1", sql.VarChar(160), adminHash)
      .input("h2", sql.VarChar(160), staffHash)
      .input("h3", sql.VarChar(160), delivHash)
      .query(`
        INSERT INTO dbo.SystemUser (Username, PasswordHash, FullName, Role) VALUES
          ('admin',     @h1, N'ผู้ดูแลระบบ',      N'Admin'),
          ('staff1',    @h2, N'พนักงานขาย 1',     N'พนักงานขาย'),
          ('delivery1', @h3, N'พนักงานจัดส่ง 1',  N'พนักงานจัดส่ง');
      `);
    console.log("  ➕ สร้างบัญชีผู้ใช้เริ่มต้น: admin / staff1 / delivery1");
    if (!isProduction && !process.env.BOOTSTRAP_ADMIN_PASSWORD) {
      console.warn("  ⚠️  Development mode is using demo bootstrap passwords. Change them before deployment.");
    }
  }
  // เชื่อม CustomerID ของบัญชี "ลูกค้า" เก่าที่ยังไม่ได้ผูก (best-effort จาก FullName)
  await pool.request().query(`
    UPDATE u SET u.CustomerID = c.CustomerID
    FROM dbo.SystemUser u
    JOIN dbo.Customer c ON c.CustomerName = u.FullName
    WHERE u.Role = N'ลูกค้า' AND u.CustomerID IS NULL
      AND (SELECT COUNT(*) FROM dbo.Customer c2 WHERE c2.CustomerName = u.FullName) = 1;
  `);
}

// ── FIX: PaymentDate ต้องเป็น NULL ได้ (ยังไม่ได้ชำระจริง = ยังไม่มีวันที่ชำระ) ─
async function ensurePaymentDateNullable() {
  const pool = await getPool();
  const col = await pool.request().query(`
    SELECT is_nullable FROM sys.columns
    WHERE object_id=OBJECT_ID('dbo.Payment') AND name='PaymentDate';
  `);
  if (col.recordset.length && col.recordset[0].is_nullable === false) {
    // ต้องดรอป default constraint ก่อนจึงแก้ความเป็น NULL ได้
    const dc = await pool.request().query(`
      SELECT dc.name FROM sys.default_constraints dc
      JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
      WHERE dc.parent_object_id=OBJECT_ID('dbo.Payment') AND c.name='PaymentDate';
    `);
    for (const row of dc.recordset) {
      await pool.request().query(`ALTER TABLE dbo.Payment DROP CONSTRAINT [${row.name}];`);
    }
    await pool.request().query(`ALTER TABLE dbo.Payment ALTER COLUMN PaymentDate DATE NULL;`);
  }
}

// ── ENSURE PAYMENT STATUS COLUMN (สถานะการตรวจสอบสลิป) ─────────────
async function ensurePaymentStatusColumn() {
  const pool = await getPool();
  // ตรวจแยกก่อน — ไม่รวม ALTER + UPDATE ไว้ใน batch เดียวกัน
  // (SQL Server compile ทั้ง batch ก่อนรัน → พบคอลัมน์ที่ยังไม่มีตอน compile → error)
  const col = await pool.request().query(`
    SELECT 1 AS x FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Payment') AND name = 'PaymentStatus';
  `);
  if (!col.recordset.length) {
    // query 1: เพิ่มคอลัมน์
    await pool.request().query(`
      ALTER TABLE dbo.Payment
        ADD PaymentStatus NVARCHAR(20) NOT NULL
          CONSTRAINT DF_Payment_PaymentStatus DEFAULT (N'รอชำระ');
    `);
    // query 2: อัปเดตข้อมูลเก่า (แยก request — หลัง ALTER เสร็จแล้ว)
    await pool.request().query(`
      UPDATE dbo.Payment
      SET PaymentStatus = CASE
        WHEN SlipImage IS NOT NULL THEN N'รอตรวจสอบ'
        ELSE N'รอชำระ'
      END;
    `);
  }
  // query 3: เพิ่ม CHECK constraint (ปลอดภัยไม่ว่าจะผ่านเงื่อนไขด้านบนหรือเปล่า)
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Payment_PaymentStatus'
    )
      ALTER TABLE dbo.Payment ADD CONSTRAINT CK_Payment_PaymentStatus
        CHECK (PaymentStatus IN (N'รอชำระ', N'รอตรวจสอบ', N'ยืนยันแล้ว', N'ปฏิเสธ'));
  `);
}

// ── FIX: อนุญาตลูกค้าหลายคนไม่กรอกอีเมล (NULL ซ้ำได้) ───────────────
async function ensureEmailNullableUnique() {
  const pool = await getPool();
  // ถ้ายังเป็น UNIQUE constraint แบบเดิม (ไม่ยอมให้ NULL ซ้ำ) ให้แทนที่ด้วย filtered unique index
  const chk = await pool.request().query(`
    SELECT 1 AS x FROM sys.key_constraints WHERE name = 'UQ_Customer_Email';
  `);
  if (chk.recordset.length) {
    await pool.request().query(`ALTER TABLE dbo.Customer DROP CONSTRAINT UQ_Customer_Email;`);
  }
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UQ_Customer_Email_Filtered' AND object_id=OBJECT_ID('dbo.Customer'))
      CREATE UNIQUE INDEX UQ_Customer_Email_Filtered ON dbo.Customer(Email) WHERE Email IS NOT NULL;
  `);
}

// ── SESSIONS (in-memory) ───────────────────────────────────────────
const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    userID: user.UserID, username: user.Username,
    fullName: user.FullName, role: user.Role,
    customerID: user.CustomerID || null,
    expires: Date.now() + 8 * 60 * 60 * 1000
  });
  return token;
}

// เพิกถอน session ที่กำลังใช้งานของ user คนหนึ่งทันที (เรียกเมื่อ Admin ปิดใช้งาน/
// เปลี่ยน role/เปลี่ยนรหัสผ่านให้ผู้ใช้คนนั้นผ่าน PATCH) — กันปัญหา token เดิมที่ login
// ค้างอยู่ยังใช้สิทธิ์เก่าต่อได้จนกว่าจะหมดอายุเอง (8 ชม.)
function revokeSessionsForUser(userID) {
  for (const [token, s] of sessions) {
    if (s.userID === userID) sessions.delete(token);
  }
}

// ── LOGIN RATE LIMITING (in-memory, กัน brute force เดารหัสผ่าน) ────
const loginAttempts = new Map(); // key: username (lowercase) -> {count, lockedUntil}
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS   = 15 * 60 * 1000; // 15 นาที

function assertLoginNotLocked(username) {
  const key = String(username).toLowerCase();
  const rec = loginAttempts.get(key);
  if (rec && rec.lockedUntil > Date.now()) {
    const minsLeft = Math.ceil((rec.lockedUntil - Date.now()) / 60000);
    throw new Error(`เข้าสู่ระบบผิดพลาดหลายครั้งเกินไป กรุณาลองใหม่อีกครั้งในอีก ${minsLeft} นาที`);
  }
}

function recordLoginFailure(username) {
  const key = String(username).toLowerCase();
  const rec = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_LOGIN_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
    rec.count = 0;
  }
  loginAttempts.set(key, rec);
}

function recordLoginSuccess(username) {
  loginAttempts.delete(String(username).toLowerCase());
}

function getSession(req) {
  const header = req.headers["authorization"] || "";
  const token  = header.replace("Bearer ", "").trim();
  const sess   = sessions.get(token);
  if (!sess || sess.expires < Date.now()) { sessions.delete(token); return null; }
  return sess;
}

function requireAuth(req, res) {
  const sess = getSession(req);
  if (!sess) { json(res, 401, { error: "กรุณาเข้าสู่ระบบ" }); return null; }
  return sess;
}

// Role-based authorization helper — ใช้ตรวจสิทธิ์ตาม Business Rule ที่ว่า
// "ลูกค้าและพนักงานสามารถเข้าถึงข้อมูลได้เฉพาะส่วนที่ตรงกับสิทธิ์ของบทบาทตนเองเท่านั้น"
// คืนค่า true ถ้าอนุญาต, false + ส่ง 403 กลับไปแล้วถ้าไม่มีสิทธิ์
function requireRole(sess, res, allowedRoles) {
  if (allowedRoles.includes(sess.role)) return true;
  json(res, 403, { error: "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" });
  return false;
}

// Session cleanup: ล้าง session ที่หมดอายุออกจาก memory ทุก 30 นาที
//          ป้องกัน memory leak บน server ที่รันต่อเนื่องนานๆ
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [k, v] of sessions) {
    if (v.expires < now) { sessions.delete(k); removed++; }
  }
  if (removed > 0) console.log(`  🧹 ล้าง session หมดอายุ ${removed} รายการ`);

  // ล้างสถิติ login-lockout ที่หมดเวลาล็อกไปแล้ว
  for (const [k, rec] of loginAttempts) {
    if (rec.lockedUntil && rec.lockedUntil < now) loginAttempts.delete(k);
  }
}, 30 * 60 * 1000);

// ── QUERIES ────────────────────────────────────────────────────────
async function getDashboard() {
  const [totals] = await query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Customer)              AS customers,
      (SELECT COUNT(*) FROM dbo.Book)                  AS books,
      (SELECT COUNT(*) FROM dbo.Orders)                AS orders,
      (SELECT ISNULL(SUM(p.Amount),0) FROM dbo.Payment p
        JOIN dbo.Shipment sh ON sh.OrderID=p.OrderID AND sh.Status<>N'ยกเลิก'
        WHERE p.PaymentStatus = N'ยืนยันแล้ว') AS revenue,
      (SELECT COUNT(*) FROM dbo.Shipment WHERE Status = N'รอจัดส่ง') AS pendingShip,
      -- Query 17 (MAX/MIN): ช่วงราคาหนังสือทั้งร้าน
      (SELECT MAX(Price) FROM dbo.Book)                AS maxPrice,
      (SELECT MIN(Price) FROM dbo.Book)                AS minPrice,
      -- Query 16 (Subquery + AVG): มูลค่าคำสั่งซื้อเฉลี่ยต่อออเดอร์
      (SELECT AVG(od_total) FROM (
        SELECT od.OrderID, SUM(od.Quantity*od.UnitPrice) AS od_total
        FROM dbo.Order_Detail od
        JOIN dbo.Payment p ON p.OrderID=od.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
        JOIN dbo.Shipment sh ON sh.OrderID=od.OrderID AND sh.Status<>N'ยกเลิก'
        GROUP BY od.OrderID
      ) t)                                              AS avgOrderValue;
  `);
  return {
    totals,
    recentOrders: (await getOrders()).slice(0, 6),
    lowStock: await query("SELECT ISBN, BookName, Stock FROM dbo.Book WHERE Stock <= 15 ORDER BY Stock ASC")
  };
}

async function getCustomers() {
  // ต่อยอดจาก Query 12 (LEFT JOIN ลูกค้า→คำสั่งซื้อ): ลูกค้าทุกคนต้องปรากฏ แม้ยังไม่เคยสั่งซื้อเลย (OrderCount=0)
  // รวมยอดใช้จ่ายสะสมไว้ในแถวเดียวกัน เพื่อใช้คำนวณป้าย "ลูกค้า VIP" (อิงหลัก Query 19) ที่หน้าลูกค้าโดยตรง
  return query(`
    SELECT c.CustomerID, c.CustomerName, c.Phone, c.Email, c.Address,
      CASE WHEN EXISTS (
        SELECT 1 FROM dbo.SystemUser u
        WHERE u.CustomerID=c.CustomerID AND u.Role=N'ลูกค้า')
      THEN 1 ELSE 0 END AS HasAccount,
      COUNT(DISTINCT CASE WHEN p.PaymentID IS NOT NULL AND sh.ShipmentID IS NOT NULL THEN o.OrderID END) AS OrderCount,
      ISNULL(SUM(od.Quantity*od.UnitPrice),0) AS TotalSpent
    FROM dbo.Customer c
    LEFT JOIN dbo.Orders o       ON o.CustomerID=c.CustomerID
    LEFT JOIN dbo.Payment p      ON p.OrderID=o.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
    LEFT JOIN dbo.Shipment sh    ON sh.OrderID=o.OrderID AND sh.Status<>N'ยกเลิก'
    LEFT JOIN dbo.Order_Detail od ON od.OrderID=o.OrderID AND p.PaymentID IS NOT NULL AND sh.ShipmentID IS NOT NULL
    GROUP BY c.CustomerID, c.CustomerName, c.Phone, c.Email, c.Address
    ORDER BY c.CustomerID DESC
  `);
}

async function getBooks() {
  // ต่อยอดจาก Query 11 (LEFT JOIN หนังสือ→รายการสั่งซื้อ): หนังสือทุกเล่มต้องปรากฏ แม้ยังไม่เคยถูกขาย (TotalSold=0)
  // ใช้ตัดสินป้าย "ขายดี" / "ยังไม่เคยขาย" ที่หน้าคลังหนังสือโดยตรง (อิงหลัก Query 7 และ 20)
  return query(`
    SELECT b.ISBN, b.BookName, b.Price, b.Stock,
      ISNULL((SELECT STRING_AGG(c.CategoryName,', ')
        FROM dbo.Book_Category bc JOIN dbo.Category c ON c.CategoryID=bc.CategoryID
        WHERE bc.ISBN=b.ISBN),'') AS Categories,
      ISNULL((SELECT STRING_AGG(a.AuthorName,', ')
        FROM dbo.Book_Author ba JOIN dbo.Author a ON a.AuthorID=ba.AuthorID
        WHERE ba.ISBN=b.ISBN),'') AS Authors,
      ISNULL(SUM(CASE WHEN p.PaymentID IS NOT NULL AND sh.ShipmentID IS NOT NULL THEN od.Quantity ELSE 0 END),0) AS TotalSold
    FROM dbo.Book b
    LEFT JOIN dbo.Order_Detail od ON od.ISBN=b.ISBN
    LEFT JOIN dbo.Payment p ON p.OrderID=od.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
    LEFT JOIN dbo.Shipment sh ON sh.OrderID=od.OrderID AND sh.Status<>N'ยกเลิก'
    GROUP BY b.ISBN, b.BookName, b.Price, b.Stock
    ORDER BY b.BookName;
  `);
}

// แปลง string "ธุรกิจ, พัฒนาตนเอง" -> ["ธุรกิจ","พัฒนาตนเอง"] (ตัดช่องว่าง/รายการว่างทิ้ง)
function splitNames(str) {
  return (str || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

// หา CategoryID จากชื่อ ถ้ายังไม่มีให้สร้างใหม่ (กันชื่อซ้ำด้วย UQ_Category_CategoryName)
async function findOrCreateCategoryID(name, tx = null) {
  const found = await query(
    "SELECT CategoryID FROM dbo.Category WHERE CategoryName=@Name",
    { Name: { type: sql.NVarChar(80), value: name } }, tx);
  if (found.length) return found[0].CategoryID;
  const inserted = await query(
    "INSERT INTO dbo.Category(CategoryName) OUTPUT INSERTED.CategoryID VALUES(@Name)",
    { Name: { type: sql.NVarChar(80), value: name } }, tx);
  return inserted[0].CategoryID;
}

// หา AuthorID จากชื่อ ถ้ายังไม่มีให้สร้างใหม่ (กันชื่อซ้ำด้วย UQ_Author_AuthorName)
async function findOrCreateAuthorID(name, tx = null) {
  const found = await query(
    "SELECT AuthorID FROM dbo.Author WHERE AuthorName=@Name",
    { Name: { type: sql.NVarChar(120), value: name } }, tx);
  if (found.length) return found[0].AuthorID;
  const inserted = await query(
    "INSERT INTO dbo.Author(AuthorName) OUTPUT INSERTED.AuthorID VALUES(@Name)",
    { Name: { type: sql.NVarChar(120), value: name } }, tx);
  return inserted[0].AuthorID;
}

// ผูกหมวดหมู่ของหนังสือ (ISBN) ตาม string ที่ระบุ (สร้างหมวดหมู่ใหม่อัตโนมัติถ้ายังไม่มี)
// replace=true: ล้างหมวดหมู่เดิมทั้งหมดก่อนผูกใหม่ (ใช้ตอนแก้ไข "และ" มีการกรอกค่าเข้ามาจริง)
async function linkBookCategories(isbn, categoriesStr, replace = false, tx = null) {
  const categoryNames = splitNames(categoriesStr);
  if (replace) {
    await query("DELETE FROM dbo.Book_Category WHERE ISBN=@ISBN", { ISBN: { type: sql.VarChar(20), value: isbn } }, tx);
  }
  for (const name of categoryNames) {
    const categoryId = await findOrCreateCategoryID(name, tx);
    await query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.Book_Category WHERE ISBN=@ISBN AND CategoryID=@CategoryID)
        INSERT INTO dbo.Book_Category(ISBN,CategoryID) VALUES(@ISBN,@CategoryID);`,
      {
        ISBN:       { type: sql.VarChar(20), value: isbn },
        CategoryID: { type: sql.Int,         value: categoryId }
      }, tx);
  }
}

// ผูกผู้แต่งของหนังสือ (ISBN) ตาม string ที่ระบุ (สร้างผู้แต่งใหม่อัตโนมัติถ้ายังไม่มี)
async function linkBookAuthors(isbn, authorsStr, replace = false, tx = null) {
  const authorNames = splitNames(authorsStr);
  if (replace) {
    await query("DELETE FROM dbo.Book_Author WHERE ISBN=@ISBN", { ISBN: { type: sql.VarChar(20), value: isbn } }, tx);
  }
  for (const name of authorNames) {
    const authorId = await findOrCreateAuthorID(name, tx);
    await query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.Book_Author WHERE ISBN=@ISBN AND AuthorID=@AuthorID)
        INSERT INTO dbo.Book_Author(ISBN,AuthorID) VALUES(@ISBN,@AuthorID);`,
      {
        ISBN:     { type: sql.VarChar(20), value: isbn },
        AuthorID: { type: sql.Int,         value: authorId }
      }, tx);
  }
}

// ใช้ตอนเพิ่มหนังสือใหม่ (ไม่มีของเดิมให้ล้าง จึงแค่เพิ่มตามที่กรอก)
async function linkBookTaxonomy(isbn, categoriesStr, authorsStr, tx = null) {
  await linkBookCategories(isbn, categoriesStr, false, tx);
  await linkBookAuthors(isbn, authorsStr, false, tx);
}

async function getCategoryStats() {
  // Query 13 (RIGHT JOIN): ทุกหมวดหมู่ต้องปรากฏ แม้ยังไม่มีหนังสือเล่มใดถูกจัดอยู่เลย
  // ผสาน Query 22 (ยอดขายแยกตามหมวดหมู่) ไว้ในคิวรีเดียว เพื่อใช้วาดกราฟในแดชบอร์ดธุรกิจ
  return query(`
    SELECT cat.CategoryName,
      COUNT(DISTINCT bc.ISBN) AS BookCount,
      ISNULL(SUM(CASE WHEN p.PaymentID IS NOT NULL AND sh.ShipmentID IS NOT NULL THEN od.Quantity*od.UnitPrice ELSE 0 END),0) AS Revenue
    FROM dbo.Book_Category bc
    RIGHT JOIN dbo.Category cat ON cat.CategoryID=bc.CategoryID
    LEFT JOIN dbo.Order_Detail od ON od.ISBN=bc.ISBN
    LEFT JOIN dbo.Payment p ON p.OrderID=od.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
    LEFT JOIN dbo.Shipment sh ON sh.OrderID=od.OrderID AND sh.Status<>N'ยกเลิก'
    GROUP BY cat.CategoryName
    ORDER BY Revenue DESC;
  `);
}

async function getOrders() {
  return query(`
    SELECT o.OrderID,
      CONVERT(varchar(10), o.OrderDate, 120) AS OrderDate,
      c.CustomerName, c.Phone,
      p.PaymentID, p.Amount, p.PaymentMethod, p.PaymentDate, p.PaymentStatus,
      p.SlipImage,
      s.ShipmentID, s.Status, s.TrackingNo, s.ShipDate, s.Address AS ShipAddress,
      s.CancelNote, s.CancelledAt,
      STRING_AGG(CONCAT(b.BookName,' x',od.Quantity),', ') AS Items
    FROM dbo.Orders o
    JOIN dbo.Customer c    ON c.CustomerID=o.CustomerID
    JOIN dbo.Order_Detail od ON od.OrderID=o.OrderID
    JOIN dbo.Book b        ON b.ISBN=od.ISBN
    LEFT JOIN dbo.Payment p  ON p.OrderID=o.OrderID
    LEFT JOIN dbo.Shipment s ON s.OrderID=o.OrderID
    GROUP BY o.OrderID, o.OrderDate,
      c.CustomerName, c.Phone,
      p.PaymentID, p.Amount, p.PaymentMethod, p.PaymentDate, p.PaymentStatus, p.SlipImage,
      s.ShipmentID, s.Status, s.TrackingNo, s.ShipDate, s.Address, s.CancelNote, s.CancelledAt
    ORDER BY o.OrderID DESC;
  `);
}

async function getShipments() {
  return query(`
    SELECT s.ShipmentID, s.ShipDate, s.TrackingNo, s.Status, s.Address,
      s.ShippingCompany, s.CancelNote, s.CancelledAt,
      s.AssignedDriverID, du.FullName AS AssignedDriverName,
      s.AcceptedAt, s.PickedUpAt, s.DeliveredAt,
      s.DriverLat, s.DriverLng, s.LastLocationAt,
      o.OrderID, c.CustomerName, c.Phone, p.Amount
    FROM dbo.Shipment s
    JOIN dbo.Orders o ON o.OrderID=s.OrderID
    JOIN dbo.Customer c ON c.CustomerID=o.CustomerID
    LEFT JOIN dbo.Payment p ON p.OrderID=o.OrderID
    LEFT JOIN dbo.SystemUser du ON du.UserID=s.AssignedDriverID
    ORDER BY CASE WHEN s.Status=N'รอจัดส่ง' THEN 0 WHEN s.Status=N'กำลังจัดส่ง' THEN 1 ELSE 2 END,
             s.ShipmentID DESC;
  `);
}

async function getPayments() {
  return query(`
    SELECT p.PaymentID, p.PaymentDate, p.Amount, p.PaymentMethod, p.PaymentStatus,
      p.SlipImage, p.OrderID, c.CustomerName
    FROM dbo.Payment p
    JOIN dbo.Orders o ON o.OrderID = p.OrderID
    JOIN dbo.Customer c ON c.CustomerID = o.CustomerID
    ORDER BY p.PaymentID DESC;
  `);
}

async function getUsers() {
  return query("SELECT UserID, Username, FullName, Role, IsActive, CreatedAt FROM dbo.SystemUser ORDER BY UserID");
}

// ── ENSURE SHIPPING COMPANY COLUMN ────────────────────────────────
async function ensureShippingCompanyColumn() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.Shipment') AND name='ShippingCompany')
      ALTER TABLE dbo.Shipment ADD ShippingCompany NVARCHAR(100) NULL;
  `);
}

// ── DELIVERY WORKFLOW: assignment + timestamps + live driver location + history
async function ensureDeliveryWorkflow() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.Shipment') AND name='AssignedDriverID')
      ALTER TABLE dbo.Shipment ADD AssignedDriverID INT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.Shipment') AND name='AcceptedAt')
      ALTER TABLE dbo.Shipment ADD AcceptedAt DATETIME2 NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.Shipment') AND name='PickedUpAt')
      ALTER TABLE dbo.Shipment ADD PickedUpAt DATETIME2 NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.Shipment') AND name='DeliveredAt')
      ALTER TABLE dbo.Shipment ADD DeliveredAt DATETIME2 NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.Shipment') AND name='DriverLat')
      ALTER TABLE dbo.Shipment ADD DriverLat DECIMAL(10,7) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.Shipment') AND name='DriverLng')
      ALTER TABLE dbo.Shipment ADD DriverLng DECIMAL(10,7) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.Shipment') AND name='LastLocationAt')
      ALTER TABLE dbo.Shipment ADD LastLocationAt DATETIME2 NULL;

    IF NOT EXISTS (
      SELECT 1 FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
      WHERE fk.parent_object_id = OBJECT_ID('dbo.Shipment') AND c.name = 'AssignedDriverID'
    )
      ALTER TABLE dbo.Shipment ADD CONSTRAINT FK_Shipment_AssignedDriver
        FOREIGN KEY (AssignedDriverID) REFERENCES dbo.SystemUser(UserID) ON DELETE SET NULL;

    IF OBJECT_ID('dbo.ShipmentHistory','U') IS NULL
    BEGIN
      CREATE TABLE dbo.ShipmentHistory (
        HistoryID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ShipmentID INT NOT NULL,
        Status NVARCHAR(30) NOT NULL,
        Note NVARCHAR(500) NULL,
        ActorUserID INT NULL,
        ActorName NVARCHAR(100) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ShipmentHistory_CreatedAt DEFAULT SYSDATETIME(),
        CONSTRAINT FK_ShipmentHistory_Shipment FOREIGN KEY (ShipmentID)
          REFERENCES dbo.Shipment(ShipmentID) ON DELETE CASCADE
      );
      CREATE INDEX IX_ShipmentHistory_ShipmentID_CreatedAt
        ON dbo.ShipmentHistory(ShipmentID,CreatedAt);
    END;

    INSERT INTO dbo.ShipmentHistory(ShipmentID,Status,Note,ActorName)
    SELECT s.ShipmentID,s.Status,N'สถานะเริ่มต้นของรายการจัดส่ง',N'ระบบ'
    FROM dbo.Shipment s
    WHERE NOT EXISTS (SELECT 1 FROM dbo.ShipmentHistory h WHERE h.ShipmentID=s.ShipmentID);
  `);
}
async function addShipmentHistory(shipmentId,status,note,actorUserID,actorName,tx=null){
  const req=tx?new sql.Request(tx):(await getPool()).request();
  await req.input("ShipmentID",sql.Int,shipmentId).input("Status",sql.NVarChar(30),status)
    .input("Note",sql.NVarChar(500),note||null).input("ActorUserID",sql.Int,actorUserID||null)
    .input("ActorName",sql.NVarChar(100),actorName||"ระบบ")
    .query(`INSERT INTO dbo.ShipmentHistory(ShipmentID,Status,Note,ActorUserID,ActorName)
            VALUES(@ShipmentID,@Status,@Note,@ActorUserID,@ActorName);`);
}
async function getShipmentTimeline(shipmentId){
  return query(`SELECT h.HistoryID,h.Status,h.Note,h.CreatedAt,h.ActorName
                FROM dbo.ShipmentHistory h WHERE h.ShipmentID=@ID ORDER BY h.HistoryID`,
    {ID:{type:sql.Int,value:shipmentId}});
}

// ── ENSURE CANCEL NOTE COLUMNS ────────────────────────────────────────
// เก็บ "หมายเหตุการยกเลิก" + เวลาที่ยกเลิก ไว้ที่ dbo.Shipment
// (ใช้ทั้งกรณีลูกค้า/แอดมินกดยกเลิกเอง และกรณี auto-cancel ออเดอร์ค้างชำระ)
async function ensureCancelNoteColumn() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.Shipment') AND name='CancelNote')
      ALTER TABLE dbo.Shipment ADD CancelNote NVARCHAR(500) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.Shipment') AND name='CancelledAt')
      ALTER TABLE dbo.Shipment ADD CancelledAt DATETIME NULL;
  `);
}

// ── ENSURE RejectedAt COLUMN ─────────────────────────────────────────
// เก็บวันที่สลิปถูก "ปฏิเสธ" ครั้งล่าสุด ไว้ใช้เป็นจุดเริ่มนับวันสำหรับ auto-cancel
// (แยกจาก OrderDate เพราะออเดอร์อาจถูกปฏิเสธหลังสั่งซื้อไปแล้วหลายวัน)
async function ensureRejectedAtColumn() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.Payment') AND name='RejectedAt')
      ALTER TABLE dbo.Payment ADD RejectedAt DATE NULL;
  `);
}

// ── ENSURE SLIP COLUMN ─────────────────────────────────────────────
async function ensureSlipColumn() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.Payment') AND name='SlipImage')
      ALTER TABLE dbo.Payment ADD SlipImage NVARCHAR(MAX) NULL;
  `);
}

// ── CREATE ORDER ───────────────────────────────────────────────────
async function createOrder(input) {
  const items = (Array.isArray(input.items) ? input.items : []).filter(i => i && i.isbn);
  if (!Number.isInteger(Number(input.customerId)) || Number(input.customerId) <= 0 || !items.length)
    throw new Error("กรุณาเลือกลูกค้าและหนังสืออย่างน้อย 1 รายการ");
  const PAYMENT_METHODS = ["เงินสด", "โอน", "บัตร", "ปลายทาง"];
  const paymentMethod = String(input.paymentMethod || "โอน");
  if (!PAYMENT_METHODS.includes(paymentMethod)) throw new Error("วิธีชำระเงินไม่ถูกต้อง");
  const seenISBN = new Set();
  for (const item of items) {
    const isbn = String(item.isbn).trim();
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error("จำนวนหนังสือต้องเป็นจำนวนเต็มมากกว่า 0");
    if (seenISBN.has(isbn)) throw new Error(`ISBN ${isbn} ซ้ำในคำสั่งซื้อ กรุณารวมจำนวนไว้ในรายการเดียว`);
    seenISBN.add(isbn);
  }

  const pool = await getPool();
  const tx   = new sql.Transaction(pool);
  await tx.begin();
  try {
    const r1 = new sql.Request(tx);
    const orderResult = await r1
      .input("OrderDate",  sql.Date, input.orderDate || today())
      .input("CustomerID", sql.Int,  Number(input.customerId))
      .query(`INSERT INTO dbo.Orders(OrderDate,CustomerID) OUTPUT INSERTED.* VALUES(@OrderDate,@CustomerID);`);
    const order = orderResult.recordset[0];
    let total = 0;

    for (const item of items) {
      const isbn     = String(item.isbn);
      const quantity = Number(item.quantity);
      const rBook = new sql.Request(tx);
      const bRes  = await rBook.input("ISBN", sql.VarChar(20), isbn)
        .query("SELECT ISBN,Price,Stock FROM dbo.Book WITH (UPDLOCK,ROWLOCK) WHERE ISBN=@ISBN;");
      const book = bRes.recordset[0];
      if (!book) throw new Error(`ไม่พบ ISBN ${isbn}`);
      if (book.Stock < quantity) throw new Error(`ISBN ${isbn} คงเหลือไม่พอ (มี ${book.Stock} เล่ม)`);
      const rDet = new sql.Request(tx);
      await rDet
        .input("OrderID",   sql.Int, order.OrderID)
        .input("ISBN",      sql.VarChar(20),   isbn)
        .input("Quantity",  sql.Int,           quantity)
        .input("UnitPrice", sql.Decimal(10,2), book.Price)
        .query(`INSERT INTO dbo.Order_Detail(OrderID,ISBN,Quantity,UnitPrice) VALUES(@OrderID,@ISBN,@Quantity,@UnitPrice);
                UPDATE dbo.Book SET Stock=Stock-@Quantity WHERE ISBN=@ISBN;`);
      total += Number(book.Price) * quantity;
    }

    // บัตรในโปรเจกต์เป็นเพียงแบบจำลองหน้าเว็บ จึงห้ามถือว่าชำระสำเร็จจากข้อมูล client โดยอัตโนมัติ
    // ให้พนักงานตรวจสอบ/ยืนยันอีกครั้งจากหน้า "ชำระเงิน"
    const initialPaymentStatus = paymentMethod === "บัตร" ? "รอตรวจสอบ" : "รอชำระ";
    const rPay = new sql.Request(tx);
    await rPay
      .input("Amount",        sql.Decimal(10,2),  total)
      .input("PaymentMethod", sql.NVarChar(20),   paymentMethod)
      .input("OrderID",       sql.Int,            order.OrderID)
      .input("PaymentStatus", sql.NVarChar(20),   initialPaymentStatus)
      .input("PaymentDate",   sql.Date,            null)
      .query(`INSERT INTO dbo.Payment(PaymentDate,Amount,PaymentMethod,OrderID,PaymentStatus)
              VALUES(@PaymentDate,@Amount,@PaymentMethod,@OrderID,@PaymentStatus);`);

    const rShip = new sql.Request(tx);
    await rShip
      .input("ShipDate",   sql.Date,          input.shipDate || today())
      .input("TrackingNo", sql.VarChar(50),   "TH" + crypto.randomBytes(5).toString("hex").toUpperCase())
      .input("Status",     sql.NVarChar(30),  "รอจัดส่ง")
      .input("Address",    sql.NVarChar(300), input.address || "รับที่ร้าน")
      .input("OrderID",    sql.Int,           order.OrderID)
      .query(`INSERT INTO dbo.Shipment(ShipDate,TrackingNo,Status,Address,OrderID) VALUES(@ShipDate,@TrackingNo,@Status,@Address,@OrderID);`);
    const createdShip = await new sql.Request(tx).input("OrderID",sql.Int,order.OrderID)
      .query(`SELECT ShipmentID FROM dbo.Shipment WHERE OrderID=@OrderID;`);
    if(createdShip.recordset[0])
      await addShipmentHistory(createdShip.recordset[0].ShipmentID,"รอจัดส่ง","สร้างรายการจัดส่ง",null,"ระบบ",tx);

    await tx.commit();
    return { ...order, total };
  } catch(err) {
    await tx.rollback();
    throw err;
  }
}

// ── REPORTS: QUERY LIBRARY (โครงงานระยะที่ 3 — 22 SQL Query) ─────────
// ทุก Query ในตารางนี้คือ Query จริงจากเอกสาร "รายงานโครงงานระยะที่ 3"
// ผูกเข้ากับแท็บ "รายงาน SQL" ในเว็บแอป เพื่อให้ใช้งานได้จริง ไม่ใช่แค่ตัวอย่างในเอกสาร
const QUERY_LIBRARY = [
  { id: 1, group: "SELECT / WHERE / LIKE", title: "หนังสือที่ราคามากกว่าที่กำหนด", tags: ["SELECT","WHERE"], usedIn: "หน้าคลังหนังสือ — ช่องกรอง 'ราคาขั้นต่ำ' (เรียกจริงผ่าน runLiveQuery ทุกครั้งที่พิมพ์)",
    paramName: "minPrice", paramLabel: "ราคาขั้นต่ำ (บาท)", paramType: "number", paramDefault: 400,
    build: (v) => ({ text: `SELECT ISBN, BookName, Price, Stock FROM dbo.Book WHERE Price > @minPrice ORDER BY Price DESC;`,
      inputs: { minPrice: { type: sql.Decimal(10,2), value: Number(v ?? 400) } } }) },
  { id: 2, group: "SELECT / WHERE / LIKE", title: "ค้นหาหนังสือจากชื่อเรื่องหรือ ISBN", tags: ["SELECT","WHERE","LIKE"], usedIn: "หน้าคลังหนังสือ — ช่องค้นหาชื่อหนังสือ (เรียกจริงผ่าน runLiveQuery ทุกครั้งที่พิมพ์)",
    paramName: "keyword", paramLabel: "ชื่อหนังสือหรือ ISBN", paramType: "text", paramDefault: "นิยาย",
    build: (v) => ({ text: `SELECT ISBN, BookName, Price FROM dbo.Book WHERE BookName LIKE @kw OR ISBN LIKE @kw;`,
      inputs: { kw: { type: sql.NVarChar(210), value: `%${v ?? "นิยาย"}%` } } }) },
  { id: 3, group: "SELECT / WHERE / LIKE", title: "ค้นหาลูกค้าจากเบอร์โทรศัพท์ที่ขึ้นต้นด้วย", tags: ["SELECT","WHERE","LIKE"], usedIn: "หน้าลูกค้า — ช่องค้นหา 'เบอร์ขึ้นต้นด้วย' (เรียกจริงผ่าน runLiveQuery ทุกครั้งที่พิมพ์)",
    paramName: "prefix", paramLabel: "ขึ้นต้นด้วย (เบอร์โทร)", paramType: "text", paramDefault: "08",
    build: (v) => ({ text: `SELECT CustomerName, Phone FROM dbo.Customer WHERE Phone LIKE @px ORDER BY CustomerName;`,
      inputs: { px: { type: sql.VarChar(22), value: `${v ?? "08"}%` } } }) },
  { id: 4, group: "ORDER BY", title: "รายชื่อลูกค้าเรียงตามชื่อ (A-Z)", tags: ["ORDER BY"], usedIn: "หน้าลูกค้า — ปุ่มเรียงชื่อ A-Z",
    build: () => ({ text: `SELECT CustomerID, CustomerName, Phone FROM dbo.Customer ORDER BY CustomerName ASC;`, inputs: {} }) },
  { id: 5, group: "ORDER BY", title: "หนังสือ 5 อันดับราคาแพงที่สุด", tags: ["ORDER BY","TOP"], usedIn: "หน้าคลังหนังสือ — วิดเจ็ต 'หนังสือราคาสูงสุด 5 อันดับ'",
    build: () => ({ text: `SELECT TOP 5 BookName, Price, Stock FROM dbo.Book ORDER BY Price DESC, Stock ASC;`, inputs: {} }) },
  { id: 6, group: "GROUP BY / HAVING", title: "ยอดขายรวม (จำนวนเล่ม) แยกตามหนังสือ", tags: ["GROUP BY"], usedIn: "หน้าคลังหนังสือ — ยอดขายสะสมต่อเล่ม (ต่อยอดใน Query 11)",
    build: () => ({ text: `SELECT b.BookName, SUM(od.Quantity) AS TotalQty
      FROM dbo.Order_Detail od JOIN dbo.Book b ON b.ISBN = od.ISBN
      JOIN dbo.Payment p ON p.OrderID=od.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
      JOIN dbo.Shipment sh ON sh.OrderID=od.OrderID AND sh.Status<>N'ยกเลิก'
      GROUP BY b.BookName ORDER BY TotalQty DESC;`, inputs: {} }) },
  { id: 7, group: "GROUP BY / HAVING", title: "หนังสือที่มียอดขายรวมมากกว่าที่กำหนด", tags: ["GROUP BY","HAVING"], usedIn: "หน้าคลังหนังสือ — checkbox 'เฉพาะขายดี' (เรียกจริงผ่าน runLiveQuery ทุกครั้งที่ติ๊ก)",
    paramName: "minQty", paramLabel: "ยอดขายรวมมากกว่า (เล่ม)", paramType: "number", paramDefault: 5,
    build: (v) => ({ text: `SELECT b.BookName, SUM(od.Quantity) AS TotalQty
      FROM dbo.Order_Detail od JOIN dbo.Book b ON b.ISBN = od.ISBN
      JOIN dbo.Payment p ON p.OrderID=od.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
      JOIN dbo.Shipment sh ON sh.OrderID=od.OrderID AND sh.Status<>N'ยกเลิก'
      GROUP BY b.BookName HAVING SUM(od.Quantity) > @minQty ORDER BY TotalQty DESC;`,
      inputs: { minQty: { type: sql.Int, value: Number(v ?? 5) } } }) },
  { id: 8, group: "GROUP BY / HAVING", title: "ลูกค้าที่มีจำนวนคำสั่งซื้อมากกว่าที่กำหนด", tags: ["GROUP BY","HAVING"], usedIn: "หน้าลูกค้า — checkbox 'เฉพาะลูกค้าประจำ' (เรียกจริงผ่าน runLiveQuery ทุกครั้งที่ติ๊ก)",
    paramName: "minOrders", paramLabel: "จำนวนคำสั่งซื้อมากกว่า (ครั้ง)", paramType: "number", paramDefault: 1,
    build: (v) => ({ text: `SELECT c.CustomerName, COUNT(o.OrderID) AS OrderCount
      FROM dbo.Orders o JOIN dbo.Customer c ON c.CustomerID = o.CustomerID
      JOIN dbo.Payment p ON p.OrderID=o.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
      JOIN dbo.Shipment sh ON sh.OrderID=o.OrderID AND sh.Status<>N'ยกเลิก'
      GROUP BY c.CustomerName HAVING COUNT(o.OrderID) > @minOrders ORDER BY OrderCount DESC;`,
      inputs: { minOrders: { type: sql.Int, value: Number(v ?? 1) } } }) },
  { id: 9, group: "INNER JOIN", title: "รายการคำสั่งซื้อพร้อมชื่อลูกค้า", tags: ["INNER JOIN"], usedIn: "หน้าคำสั่งซื้อ — รายการคำสั่งซื้อทั้งหมด (ฐานของรายการที่แสดง)",
    build: () => ({ text: `SELECT o.OrderID, o.OrderDate, c.CustomerName
      FROM dbo.Orders o INNER JOIN dbo.Customer c ON c.CustomerID = o.CustomerID
      ORDER BY o.OrderID;`, inputs: {} }) },
  { id: 10, group: "INNER JOIN", title: "รายละเอียดคำสั่งซื้อพร้อมชื่อหนังสือและชื่อลูกค้า (4 ตาราง)", tags: ["INNER JOIN"], usedIn: "หน้าคำสั่งซื้อ — คอลัมน์ 'รายการสินค้า' ต่อออเดอร์",
    build: () => ({ text: `SELECT o.OrderID, c.CustomerName, b.BookName, od.Quantity, od.UnitPrice
      FROM dbo.Order_Detail od
      INNER JOIN dbo.Orders o ON o.OrderID = od.OrderID
      INNER JOIN dbo.Customer c ON c.CustomerID = o.CustomerID
      INNER JOIN dbo.Book b ON b.ISBN = od.ISBN
      ORDER BY o.OrderID;`, inputs: {} }) },
  { id: 11, group: "LEFT JOIN", title: "หนังสือทุกเล่มพร้อมยอดขายรวม (รวมเล่มที่ยังไม่เคยขาย)", tags: ["LEFT JOIN"], usedIn: "หน้าคลังหนังสือ — ยอดขายสะสม + ป้าย 'ยังไม่เคยขาย'",
    build: () => ({ text: `SELECT b.BookName, ISNULL(SUM(CASE WHEN p.PaymentID IS NOT NULL AND sh.ShipmentID IS NOT NULL THEN od.Quantity ELSE 0 END), 0) AS TotalSold
      FROM dbo.Book b LEFT JOIN dbo.Order_Detail od ON od.ISBN = b.ISBN
      LEFT JOIN dbo.Payment p ON p.OrderID=od.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
      LEFT JOIN dbo.Shipment sh ON sh.OrderID=od.OrderID AND sh.Status<>N'ยกเลิก'
      GROUP BY b.BookName ORDER BY TotalSold DESC;`, inputs: {} }) },
  { id: 12, group: "LEFT JOIN", title: "ลูกค้าทุกคนพร้อมจำนวนคำสั่งซื้อ (รวมลูกค้าที่ยังไม่เคยสั่งซื้อ)", tags: ["LEFT JOIN"], usedIn: "หน้าลูกค้า — จำนวนคำสั่งซื้อต่อคน + ป้าย 'ยังไม่เคยสั่งซื้อ'",
    build: () => ({ text: `SELECT c.CustomerName, COUNT(CASE WHEN p.PaymentID IS NOT NULL AND sh.ShipmentID IS NOT NULL THEN o.OrderID END) AS OrderCount
      FROM dbo.Customer c LEFT JOIN dbo.Orders o ON o.CustomerID = c.CustomerID
      LEFT JOIN dbo.Payment p ON p.OrderID=o.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
      LEFT JOIN dbo.Shipment sh ON sh.OrderID=o.OrderID AND sh.Status<>N'ยกเลิก'
      GROUP BY c.CustomerName ORDER BY OrderCount DESC;`, inputs: {} }) },
  { id: 13, group: "RIGHT JOIN", title: "หมวดหมู่ทั้งหมดพร้อมจำนวนหนังสือในหมวด", tags: ["RIGHT JOIN"], usedIn: "แดชบอร์ดธุรกิจ — กราฟจำนวนหนังสือต่อหมวดหมู่",
    build: () => ({ text: `SELECT cat.CategoryName, COUNT(bc.ISBN) AS BookCount
      FROM dbo.Book_Category bc RIGHT JOIN dbo.Category cat ON cat.CategoryID = bc.CategoryID
      GROUP BY cat.CategoryName ORDER BY BookCount DESC;`, inputs: {} }) },
  { id: 14, group: "RIGHT JOIN", title: "คำสั่งซื้อทั้งหมดพร้อมสถานะการชำระเงิน", tags: ["RIGHT JOIN"], usedIn: "หน้าคำสั่งซื้อ — แสดงสถานะชำระเงินของทุกออเดอร์แม้ยังไม่มีการชำระ",
    build: () => ({ text: `SELECT o.OrderID, o.OrderDate, p.PaymentStatus, p.Amount
      FROM dbo.Payment p RIGHT JOIN dbo.Orders o ON o.OrderID = p.OrderID
      ORDER BY o.OrderID;`, inputs: {} }) },
  { id: 15, group: "Aggregate Function", title: "ยอดขายรวมทั้งหมด (เฉพาะรายการที่ยืนยันชำระเงินแล้ว)", tags: ["SUM"], usedIn: "แดชบอร์ด + แดชบอร์ดธุรกิจ — การ์ด 'ยอดขายรวม (ยืนยันแล้ว)'",
    build: () => ({ text: `SELECT SUM(p.Amount) AS TotalRevenue FROM dbo.Payment p
      JOIN dbo.Shipment sh ON sh.OrderID=p.OrderID AND sh.Status<>N'ยกเลิก'
      WHERE p.PaymentStatus = N'ยืนยันแล้ว';`, inputs: {} }) },
  { id: 16, group: "Aggregate Function", title: "มูลค่าคำสั่งซื้อเฉลี่ยต่อออเดอร์", tags: ["AVG","Subquery"], usedIn: "แดชบอร์ดธุรกิจ — การ์ด 'มูลค่าเฉลี่ยต่อออเดอร์'",
    build: () => ({ text: `SELECT AVG(od_total) AS AvgOrderValue FROM (
      SELECT od.OrderID, SUM(od.Quantity * od.UnitPrice) AS od_total
      FROM dbo.Order_Detail od
      JOIN dbo.Payment p ON p.OrderID=od.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
      JOIN dbo.Shipment sh ON sh.OrderID=od.OrderID AND sh.Status<>N'ยกเลิก'
      GROUP BY od.OrderID
      ) t;`, inputs: {} }) },
  { id: 17, group: "Aggregate Function", title: "ราคาหนังสือสูงสุดและต่ำสุด", tags: ["MAX","MIN"], usedIn: "แดชบอร์ดธุรกิจ + หน้าคลังหนังสือ — การ์ด 'ช่วงราคาหนังสือ'",
    build: () => ({ text: `SELECT MAX(Price) AS MaxPrice, MIN(Price) AS MinPrice FROM dbo.Book;`, inputs: {} }) },
  { id: 18, group: "Aggregate Function", title: "จำนวนคำสั่งซื้อทั้งหมดในระบบ", tags: ["COUNT"], usedIn: "แดชบอร์ด — การ์ด 'คำสั่งซื้อทั้งหมด'",
    build: () => ({ text: `SELECT COUNT(*) AS TotalOrders FROM dbo.Orders;`, inputs: {} }) },
  { id: 19, group: "Subquery", title: "ลูกค้าที่มียอดใช้จ่ายรวมมากกว่าค่าเฉลี่ยของลูกค้าทั้งหมด", tags: ["Subquery","HAVING"], usedIn: "หน้าลูกค้า — ป้าย 'ลูกค้า VIP'",
    build: () => ({ text: `SELECT c.CustomerName, SUM(od.Quantity * od.UnitPrice) AS TotalSpent
      FROM dbo.Customer c
      JOIN dbo.Orders o ON o.CustomerID = c.CustomerID
      JOIN dbo.Order_Detail od ON od.OrderID = o.OrderID
      JOIN dbo.Payment p ON p.OrderID=o.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
      JOIN dbo.Shipment sh ON sh.OrderID=o.OrderID AND sh.Status<>N'ยกเลิก'
      GROUP BY c.CustomerName
      HAVING SUM(od.Quantity * od.UnitPrice) > (
        SELECT AVG(t.TotalSpent) FROM (
          SELECT o2.CustomerID, SUM(od2.Quantity * od2.UnitPrice) AS TotalSpent
          FROM dbo.Orders o2 JOIN dbo.Order_Detail od2 ON od2.OrderID = o2.OrderID
          JOIN dbo.Payment p2 ON p2.OrderID=o2.OrderID AND p2.PaymentStatus=N'ยืนยันแล้ว'
          JOIN dbo.Shipment sh2 ON sh2.OrderID=o2.OrderID AND sh2.Status<>N'ยกเลิก'
          GROUP BY o2.CustomerID
        ) t
      )
      ORDER BY TotalSpent DESC;`, inputs: {} }) },
  { id: 20, group: "Subquery", title: "หนังสือที่ยังไม่เคยถูกสั่งซื้อเลย", tags: ["Subquery","NOT IN"], usedIn: "แดชบอร์ดธุรกิจ — วิดเจ็ต 'สินค้าที่ควรทำโปรโมชัน'",
    build: () => ({ text: `SELECT b.BookName, b.Stock FROM dbo.Book b
      WHERE NOT EXISTS (SELECT 1 FROM dbo.Order_Detail od
        JOIN dbo.Payment p ON p.OrderID=od.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
        JOIN dbo.Shipment sh ON sh.OrderID=od.OrderID AND sh.Status<>N'ยกเลิก'
        WHERE od.ISBN=b.ISBN);`, inputs: {} }) },
  { id: 21, group: "Subquery", title: "ลูกค้าที่มีจำนวนคำสั่งซื้อสูงสุด 5 อันดับแรก", tags: ["Correlated Subquery"], usedIn: "แดชบอร์ดธุรกิจ — วิดเจ็ต 'ลูกค้าขาประจำ Top 5' (นับความถี่)",
    build: () => ({ text: `SELECT TOP 5 c.CustomerName,
      (SELECT COUNT(*) FROM dbo.Orders o
       JOIN dbo.Payment p ON p.OrderID=o.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
       JOIN dbo.Shipment sh ON sh.OrderID=o.OrderID AND sh.Status<>N'ยกเลิก'
       WHERE o.CustomerID = c.CustomerID) AS OrderCount
      FROM dbo.Customer c ORDER BY OrderCount DESC;`, inputs: {} }) },
  { id: 22, group: "GROUP BY / JOIN หลายตาราง", title: "ยอดขายรวมแยกตามหมวดหมู่หนังสือ", tags: ["GROUP BY","JOIN"], usedIn: "แดชบอร์ดธุรกิจ — กราฟยอดขายแยกตามหมวดหมู่",
    build: () => ({ text: `SELECT cat.CategoryName, SUM(od.Quantity * od.UnitPrice) AS Revenue
      FROM dbo.Order_Detail od
      JOIN dbo.Book_Category bc ON bc.ISBN = od.ISBN
      JOIN dbo.Category cat ON cat.CategoryID = bc.CategoryID
      JOIN dbo.Payment p ON p.OrderID=od.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
      JOIN dbo.Shipment sh ON sh.OrderID=od.OrderID AND sh.Status<>N'ยกเลิก'
      GROUP BY cat.CategoryName ORDER BY Revenue DESC;`, inputs: {} }) }
];

async function runLibraryQuery(id, paramValue) {
  const def = QUERY_LIBRARY.find(q => q.id === id);
  if (!def) throw new Error("ไม่พบ Query หมายเลขนี้");
  const { text, inputs } = def.build(paramValue);
  const rows = await query(text, inputs);
  return { id: def.id, title: def.title, group: def.group, sql: text.trim(), rows };
}

// ── REPORTS: 5 รายงานหลัก (ส่วนที่ 2 ของโครงงานระยะที่ 3) ───────────
async function reportCustomer() {
  return query(`
    SELECT c.CustomerID, c.CustomerName, c.Phone, c.Email,
      COUNT(DISTINCT CASE WHEN p.PaymentID IS NOT NULL AND sh.ShipmentID IS NOT NULL THEN o.OrderID END) AS OrderCount,
      ISNULL(SUM(od.Quantity * od.UnitPrice), 0) AS TotalSpent
    FROM dbo.Customer c
    LEFT JOIN dbo.Orders o ON o.CustomerID = c.CustomerID
    LEFT JOIN dbo.Payment p ON p.OrderID=o.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
    LEFT JOIN dbo.Shipment sh ON sh.OrderID=o.OrderID AND sh.Status<>N'ยกเลิก'
    LEFT JOIN dbo.Order_Detail od ON od.OrderID = o.OrderID AND p.PaymentID IS NOT NULL AND sh.ShipmentID IS NOT NULL
    GROUP BY c.CustomerID, c.CustomerName, c.Phone, c.Email
    ORDER BY TotalSpent DESC;
  `);
}
async function reportBook() {
  return query(`
    SELECT b.ISBN, b.BookName, b.Price, b.Stock,
      ISNULL((SELECT STRING_AGG(cat.CategoryName, N', ')
        FROM dbo.Book_Category bc JOIN dbo.Category cat ON cat.CategoryID = bc.CategoryID
        WHERE bc.ISBN = b.ISBN), '') AS Categories,
      ISNULL(SUM(CASE WHEN p.PaymentID IS NOT NULL AND sh.ShipmentID IS NOT NULL THEN od.Quantity ELSE 0 END), 0) AS TotalSold
    FROM dbo.Book b
    LEFT JOIN dbo.Order_Detail od ON od.ISBN = b.ISBN
    LEFT JOIN dbo.Payment p ON p.OrderID=od.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
    LEFT JOIN dbo.Shipment sh ON sh.OrderID=od.OrderID AND sh.Status<>N'ยกเลิก'
    GROUP BY b.ISBN, b.BookName, b.Price, b.Stock
    ORDER BY b.BookName;
  `);
}
async function reportSales() {
  return query(`
    SELECT FORMAT(o.OrderDate, 'yyyy-MM') AS SaleMonth,
      COUNT(DISTINCT o.OrderID) AS OrderCount,
      SUM(od.Quantity * od.UnitPrice) AS Revenue
    FROM dbo.Orders o
    JOIN dbo.Order_Detail od ON od.OrderID = o.OrderID
    JOIN dbo.Payment p ON p.OrderID=o.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
    JOIN dbo.Shipment sh ON sh.OrderID=o.OrderID AND sh.Status<>N'ยกเลิก'
    GROUP BY FORMAT(o.OrderDate, 'yyyy-MM')
    ORDER BY SaleMonth;
  `);
}
async function reportBestSeller() {
  return query(`
    SELECT TOP 5 b.BookName,
      SUM(od.Quantity) AS TotalQty,
      SUM(od.Quantity * od.UnitPrice) AS Revenue
    FROM dbo.Order_Detail od
    JOIN dbo.Book b ON b.ISBN = od.ISBN
    JOIN dbo.Payment p ON p.OrderID=od.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
    JOIN dbo.Shipment sh ON sh.OrderID=od.OrderID AND sh.Status<>N'ยกเลิก'
    GROUP BY b.BookName ORDER BY TotalQty DESC;
  `);
}
async function reportTopCustomer() {
  return query(`
    SELECT TOP 5 c.CustomerName,
      COUNT(DISTINCT o.OrderID) AS OrderCount,
      SUM(od.Quantity * od.UnitPrice) AS TotalSpent
    FROM dbo.Customer c
    JOIN dbo.Orders o ON o.CustomerID = c.CustomerID
    JOIN dbo.Order_Detail od ON od.OrderID = o.OrderID
    JOIN dbo.Payment p ON p.OrderID=o.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
    JOIN dbo.Shipment sh ON sh.OrderID=o.OrderID AND sh.Status<>N'ยกเลิก'
    GROUP BY c.CustomerName ORDER BY TotalSpent DESC;
  `);
}
async function reportFrequentCustomers() {
  return query(`
    SELECT TOP 5 c.CustomerName,
      (SELECT COUNT(*) FROM dbo.Orders o
       JOIN dbo.Payment p ON p.OrderID=o.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
       JOIN dbo.Shipment sh ON sh.OrderID=o.OrderID AND sh.Status<>N'ยกเลิก'
       WHERE o.CustomerID = c.CustomerID) AS OrderCount
    FROM dbo.Customer c
    ORDER BY OrderCount DESC;
  `);
}
async function reportNeverSold() {
  return query(`
    SELECT b.BookName, b.Stock FROM dbo.Book b
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.Order_Detail od
      JOIN dbo.Payment p ON p.OrderID=od.OrderID AND p.PaymentStatus=N'ยืนยันแล้ว'
      JOIN dbo.Shipment sh ON sh.OrderID=od.OrderID AND sh.Status<>N'ยกเลิก'
      WHERE od.ISBN=b.ISBN
    );
  `);
}

// ── API ROUTER ─────────────────────────────────────────────────────
async function handleApi(req, res, url) {
  try {
    const method = req.method;
    const p      = url.pathname;

    // ── AUTH (public) ──
    if (method === "POST" && p === "/api/auth/login") {
      const body = await readBody(req);
      if (!body.username || !body.password)
        return json(res, 400, { error: "กรุณากรอก username และ password" });

      assertLoginNotLocked(body.username); // throw → 400 พร้อมข้อความเวลาที่เหลือ ถ้าโดนล็อกอยู่

      const rows = await query(
        "SELECT * FROM dbo.SystemUser WHERE Username=@u AND IsActive=1",
        { u: { type: sql.NVarChar(60), value: body.username } }
      );
      const user = rows[0];
      if (!user || !verifyPwd(body.password, user.PasswordHash)) {
        recordLoginFailure(body.username);
        return json(res, 401, { error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
      }
      if (!String(user.PasswordHash).startsWith("scrypt$")) {
        await query("UPDATE dbo.SystemUser SET PasswordHash=@h WHERE UserID=@ID", {
          h: { type: sql.VarChar(160), value: hashPwd(body.password) },
          ID: { type: sql.Int, value: user.UserID }
        });
      }
      recordLoginSuccess(body.username);
      const token = createSession(user);
      return json(res, 200, {
        token, userID: user.UserID, username: user.Username,
        fullName: user.FullName, role: user.Role,
        customerID: user.CustomerID || null
      });
    }

    if (method === "POST" && p === "/api/auth/logout") {
      const header = req.headers["authorization"] || "";
      const token  = header.replace("Bearer ", "").trim();
      sessions.delete(token);
      return json(res, 200, { ok: true });
    }

    // ── REGISTER (public) ──
    if (method === "POST" && p === "/api/register") {
      const body = await readBody(req);
      const { customerName, phone, email, address, username, password } = body;
      if (!customerName || !phone || !address || !username || !password)
        return json(res, 400, { error: "กรุณากรอกข้อมูลให้ครบ" });
      if (!isValidPhone(phone))
        return json(res, 400, { error: "เบอร์โทรศัพท์ไม่ถูกต้อง (ต้องขึ้นต้นด้วย 0 และมี 9-10 หลัก)" });
      if (!isValidEmail(email))
        return json(res, 400, { error: "รูปแบบอีเมลไม่ถูกต้อง" });
      if (password.length < 6)
        return json(res, 400, { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });

      const pool = await getPool();
      const tx   = new sql.Transaction(pool);
      await tx.begin();
      try {
        // เช็คอีเมลซ้ำล่วงหน้าก่อน insert (เหมือนที่เช็ค Username ซ้ำด้านล่าง)
        // เพื่อโยน error ข้อความที่อ่านง่าย แทนที่จะปล่อยให้ unique index ของ DB
        // ชนแล้วตกไปอยู่ใน error handler รวมท้ายไฟล์ (จะขึ้นว่า "เชื่อมต่อฐานข้อมูลไม่สำเร็จ" ซึ่งเข้าใจผิดได้)
        if (email) {
          const r0 = new sql.Request(tx);
          const chkEmail = await r0.input("E0", sql.VarChar(120), email)
            .query("SELECT 1 AS x FROM dbo.Customer WHERE Email=@E0");
          if (chkEmail.recordset.length > 0) throw new Error("อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่น");
        }

        const r1 = new sql.Request(tx);
        const custRows = await r1
          .input("CustomerName", sql.NVarChar(100), customerName)
          .input("Phone",        sql.VarChar(20),   phone)
          .input("Email",        sql.VarChar(120),  email || null)
          .input("Address",      sql.NVarChar(300), address)
          .query("INSERT INTO dbo.Customer(CustomerName,Phone,Email,Address) OUTPUT INSERTED.* VALUES(@CustomerName,@Phone,@Email,@Address);");
        const customer = custRows.recordset[0];

        const r2 = new sql.Request(tx);
        const chk = await r2.input("U2", sql.NVarChar(60), username)
          .query("SELECT 1 AS x FROM dbo.SystemUser WHERE Username=@U2");
        if (chk.recordset.length > 0) throw new Error("Username นี้ถูกใช้งานแล้ว");

        const r3 = new sql.Request(tx);
        const userRows = await r3
          .input("Username",     sql.NVarChar(60),  username)
          .input("PasswordHash", sql.VarChar(160),  hashPwd(password))
          .input("FullName",     sql.NVarChar(100), customerName)
          .input("Role",         sql.NVarChar(30),  "ลูกค้า")
          .input("CustomerID",   sql.Int,           customer.CustomerID)
          .query("INSERT INTO dbo.SystemUser(Username,PasswordHash,FullName,Role,CustomerID) OUTPUT INSERTED.* VALUES(@Username,@PasswordHash,@FullName,@Role,@CustomerID);");
        const user = userRows.recordset[0];
        await tx.commit();

        const token = createSession(user);
        return json(res, 201, {
          token, userID: user.UserID, username: user.Username,
          fullName: user.FullName, role: user.Role,
          customerID: customer.CustomerID
        });
      } catch(err) {
        await tx.rollback();
        throw err;
      }
    }

    // ── หน้าร้าน (public) ──
    // เปิดให้ทุกคนดูรายการหนังสือได้โดยไม่ต้องล็อกอิน (ดูสินค้าได้เลย)
    // จะบังคับล็อกอินเฉพาะตอนยืนยันคำสั่งซื้อ (POST /api/orders) ซึ่งยังอยู่หลัง requireAuth ด้านล่าง
    if (method === "GET" && p === "/api/books") return json(res, 200, await getBooks());

    // ── PROTECTED ──
    const sess = requireAuth(req, res);
    if (!sess) return;

    // GET endpoints — จำกัดสิทธิ์ตาม role (Business Rule 19)
    // Admin/พนักงานขาย: เห็นภาพรวมยอดขาย ลูกค้า คำสั่งซื้อ การชำระเงินทั้งหมด
    // พนักงานจัดส่ง: เห็นเฉพาะรายการจัดส่ง
    // ลูกค้า: ใช้ /api/my/orders, /api/my/profile และ /api/books สำหรับหน้าร้านเท่านั้น (ไม่เข้าเส้นทางนี้)
    if (method === "GET" && p === "/api/dashboard") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      return json(res, 200, await getDashboard());
    }
    if (method === "GET" && p === "/api/customers") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      return json(res, 200, await getCustomers());
    }

    // ── รายงาน 5 รายงานหลัก (ใช้แสดงในแท็บ "รายงาน") ──
    if (method === "GET" && p === "/api/reports/customer") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      return json(res, 200, await reportCustomer());
    }
    if (method === "GET" && p === "/api/reports/book") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      return json(res, 200, await reportBook());
    }
    if (method === "GET" && p === "/api/reports/sales") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      return json(res, 200, await reportSales());
    }
    if (method === "GET" && p === "/api/reports/bestseller") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      return json(res, 200, await reportBestSeller());
    }
    if (method === "GET" && p === "/api/reports/topcustomer") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      return json(res, 200, await reportTopCustomer());
    }
    // ── วิดเจ็ตแดชบอร์ดธุรกิจเพิ่มเติม (ใช้ Query 20, 21, 22 จริง ไม่ใช่แค่โชว์ตัวอย่าง) ──
    if (method === "GET" && p === "/api/reports/frequent-customers") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      return json(res, 200, await reportFrequentCustomers());
    }
    if (method === "GET" && p === "/api/reports/never-sold") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      return json(res, 200, await reportNeverSold());
    }
    if (method === "GET" && p === "/api/categories/stats") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      return json(res, 200, await getCategoryStats());
    }

    // ── คลัง SQL Query 22 คำสั่ง (โครงงานระยะที่ 3 ส่วนที่ 1) ──
    // รายการ metadata ทั้งหมด (ไม่รัน query) — ใช้แสดงในแผง "สำหรับผู้พัฒนา/อาจารย์" เท่านั้น
    // usedIn บอกจุดที่คิวรีนี้ถูกใช้งานจริงในเว็บแอป (ไม่ใช่แค่ตัวอย่างในเอกสาร)
    if (method === "GET" && p === "/api/reports/queries") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      return json(res, 200, QUERY_LIBRARY.map(({ id, group, title, tags, usedIn, paramName, paramLabel, paramType, paramDefault }) =>
        ({ id, group, title, tags, usedIn, paramName, paramLabel, paramType, paramDefault })));
    }
    // รัน query หมายเลขที่เลือก พร้อม parameter (ถ้ามี) แล้วคืน SQL + ผลลัพธ์จริงจากฐานข้อมูล
    if (method === "GET" && p.startsWith("/api/reports/query/")) {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      const id = Number(p.split("/").pop());
      const paramValue = url.searchParams.get("v");
      return json(res, 200, await runLibraryQuery(id, paramValue));
    }
    if (method === "GET" && p === "/api/orders") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      return json(res, 200, await getOrders());
    }
    if (method === "GET" && p === "/api/shipments") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย","พนักงานจัดส่ง"])) return;
      return json(res, 200, await getShipments());
    }
    if (method === "GET" && p === "/api/payments") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      return json(res, 200, await getPayments());
    }
    if (method === "GET" && p === "/api/categories") return json(res, 200, await query("SELECT * FROM dbo.Category ORDER BY CategoryName"));
    if (method === "GET" && p === "/api/authors")    return json(res, 200, await query("SELECT * FROM dbo.Author ORDER BY AuthorName"));
    if (method === "GET" && p === "/api/users") {
      if (sess.role !== "Admin") return json(res, 403, { error: "ไม่มีสิทธิ์" });
      return json(res, 200, await getUsers());
    }
    if (method === "GET" && p === "/api/me") return json(res, 200, {
      userID: sess.userID, username: sess.username,
      fullName: sess.fullName, role: sess.role,
      customerID: sess.customerID || null
    });

    // GET MY PROFILE (ดึงข้อมูลลูกค้าจาก CustomerID ที่ผูกไว้จริงตอนสมัคร)
    if (method === "GET" && p === "/api/my/profile") {
      if (!sess.customerID) return json(res, 200, null);
      const myC = await query(
        "SELECT CustomerID, CustomerName, Phone, Email, Address FROM dbo.Customer WHERE CustomerID=@cid",
        { cid: { type: sql.Int, value: sess.customerID } }
      );
      return json(res, 200, myC[0] || null);
    }

    // GET MY ORDERS (ลูกค้า)
    if (method === "GET" && p === "/api/my/orders") {
      if (!sess.customerID) return json(res, 200, []);
      const cid = sess.customerID;
      const rows = await query(`
        SELECT o.OrderID, CONVERT(varchar(10),o.OrderDate,120) AS OrderDate,
          p.PaymentID, p.Amount, p.PaymentMethod, p.PaymentStatus, p.SlipImage,
          s.ShipmentID, s.Status, s.TrackingNo, s.Address, s.CancelNote, s.CancelledAt,
          du.FullName AS AssignedDriverName, s.AcceptedAt, s.PickedUpAt, s.DeliveredAt,
          s.DriverLat, s.DriverLng, s.LastLocationAt, s.ShippingCompany,
          STRING_AGG(CONCAT(b.BookName,' x',od.Quantity),', ') AS Items,
          (SELECT h.HistoryID,h.Status,h.Note,h.CreatedAt,h.ActorName
             FROM dbo.ShipmentHistory h WHERE h.ShipmentID=s.ShipmentID
             ORDER BY h.HistoryID FOR JSON PATH) AS TimelineJson
        FROM dbo.Orders o
        JOIN dbo.Order_Detail od ON od.OrderID=o.OrderID
        JOIN dbo.Book b ON b.ISBN=od.ISBN
        LEFT JOIN dbo.Payment p ON p.OrderID=o.OrderID
        LEFT JOIN dbo.Shipment s ON s.OrderID=o.OrderID
        LEFT JOIN dbo.SystemUser du ON du.UserID=s.AssignedDriverID
        WHERE o.CustomerID=@cid
        GROUP BY o.OrderID,o.OrderDate,p.PaymentID,p.Amount,p.PaymentMethod,p.PaymentStatus,p.SlipImage,
          s.ShipmentID,s.Status,s.TrackingNo,s.Address,s.CancelNote,s.CancelledAt,du.FullName,s.AcceptedAt,s.PickedUpAt,s.DeliveredAt,
          s.DriverLat,s.DriverLng,s.LastLocationAt,s.ShippingCompany
        ORDER BY o.OrderID DESC;
      `, { cid: { type: sql.Int, value: cid } });
      return json(res, 200, rows.map(r => {
        let Timeline=[]; try { Timeline=JSON.parse(r.TimelineJson||'[]'); } catch {}
        return {...r, Timeline, TimelineJson:undefined};
      }));
    }

    // GET RECEIPT (ใบเสร็จรับเงิน) — Admin/พนักงานขาย ดูได้ทุกออเดอร์, ลูกค้าดูได้เฉพาะของตัวเอง
    // ออกใบเสร็จได้เฉพาะรายการที่ "ยืนยันแล้ว" เท่านั้น (ป้องกันออกใบเสร็จก่อนได้รับเงินจริง)
    if (method === "GET" && p.startsWith("/api/orders/") && p.endsWith("/receipt")) {
      const parts = p.split("/"); // ["", "api", "orders", ":id", "receipt"]
      const orderId = Number(parts[3]);
      if (!orderId) throw new Error("OrderID ไม่ถูกต้อง");
      if (!["Admin","พนักงานขาย","ลูกค้า"].includes(sess.role)) return json(res, 403, { error: "ไม่มีสิทธิ์" });

      const head = await query(`
        SELECT o.OrderID, CONVERT(varchar(19),o.OrderDate,120) AS OrderDate, o.CustomerID,
          c.CustomerName, c.Phone, c.Email,
          p.PaymentID, CONVERT(varchar(19),p.PaymentDate,120) AS PaymentDate,
          p.PaymentMethod, p.PaymentStatus, p.Amount,
          s.Address AS ShipAddress, s.Status AS ShipmentStatus
        FROM dbo.Orders o
        JOIN dbo.Customer c ON c.CustomerID=o.CustomerID
        LEFT JOIN dbo.Payment p ON p.OrderID=o.OrderID
        LEFT JOIN dbo.Shipment s ON s.OrderID=o.OrderID
        WHERE o.OrderID=@OID;
      `, { OID: { type: sql.Int, value: orderId } });
      if (!head.length) throw new Error("ไม่พบคำสั่งซื้อนี้");
      const order = head[0];

      // ลูกค้าดูได้เฉพาะออเดอร์ของตัวเองเท่านั้น
      if (sess.role === "ลูกค้า" && order.CustomerID !== sess.customerID)
        return json(res, 403, { error: "ไม่มีสิทธิ์ดูใบเสร็จของคำสั่งซื้อนี้" });

      if (order.PaymentStatus !== "ยืนยันแล้ว")
        throw new Error("ออกใบเสร็จได้เฉพาะรายการที่ยืนยันการชำระเงินแล้วเท่านั้น");
      if (order.ShipmentStatus === "ยกเลิก")
        throw new Error("คำสั่งซื้อนี้ถูกยกเลิกแล้ว ไม่สามารถออกใบเสร็จรับเงินได้");

      const items = await query(`
        SELECT b.BookName, od.ISBN, od.Quantity, od.UnitPrice,
          (od.Quantity * od.UnitPrice) AS Subtotal
        FROM dbo.Order_Detail od
        JOIN dbo.Book b ON b.ISBN=od.ISBN
        WHERE od.OrderID=@OID
        ORDER BY b.BookName;
      `, { OID: { type: sql.Int, value: orderId } });

      return json(res, 200, {
        receiptNo: `RC-${String(order.OrderID).padStart(6,'0')}`,
        order, items
      });
    }

    const body = await readBody(req);

    // POST CUSTOMER (Admin + พนักงานขาย)
    if (method === "POST" && p === "/api/customers") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      if (!body.customerName || !body.phone || !body.address)
        throw new Error("กรุณากรอก ชื่อ, เบอร์โทร, และที่อยู่");
      if (!isValidPhone(body.phone))
        throw new Error("เบอร์โทรศัพท์ไม่ถูกต้อง (ต้องขึ้นต้นด้วย 0 และมี 9-10 หลัก)");
      if (!isValidEmail(body.email))
        throw new Error("รูปแบบอีเมลไม่ถูกต้อง");
      const rows = await query(`
        INSERT INTO dbo.Customer(CustomerName,Phone,Email,Address) OUTPUT INSERTED.*
        VALUES(@CustomerName,@Phone,@Email,@Address);`,
        {
          CustomerName: { type: sql.NVarChar(100), value: body.customerName },
          Phone:        { type: sql.VarChar(20),   value: body.phone        },
          Email:        { type: sql.VarChar(120),  value: body.email||null  },
          Address:      { type: sql.NVarChar(300), value: body.address      }
        });
      return json(res, 201, rows[0]);
    }

    // PUT CUSTOMER (Admin + พนักงานขาย)
    if (method === "PUT" && p.startsWith("/api/customers/")) {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      const id = Number(p.split("/").pop());
      if (!id) throw new Error("CustomerID ไม่ถูกต้อง");
      // เช็คฟิลด์บังคับให้เหมือนตอนเพิ่มลูกค้าใหม่ กันเผลอเซฟค่าว่างทับข้อมูลเดิม
      if (!body.customerName || !body.customerName.trim())
        throw new Error("กรุณากรอกชื่อลูกค้า");
      if (!body.phone || !body.phone.trim())
        throw new Error("กรุณากรอกเบอร์โทรศัพท์");
      if (!isValidPhone(body.phone))
        throw new Error("เบอร์โทรศัพท์ไม่ถูกต้อง (ต้องขึ้นต้นด้วย 0 และมี 9-10 หลัก)");
      if (!isValidEmail(body.email))
        throw new Error("รูปแบบอีเมลไม่ถูกต้อง");
      if (!body.address || !body.address.trim())
        throw new Error("กรุณากรอกที่อยู่");
      await query(`UPDATE dbo.Customer SET CustomerName=@CustomerName,Phone=@Phone,Email=@Email,Address=@Address WHERE CustomerID=@ID;`,
        {
          ID:           { type: sql.Int,           value: id               },
          CustomerName: { type: sql.NVarChar(100), value: body.customerName},
          Phone:        { type: sql.VarChar(20),   value: body.phone       },
          Email:        { type: sql.VarChar(120),  value: body.email||null },
          Address:      { type: sql.NVarChar(300), value: body.address     }
        });
      return json(res, 200, { ok: true });
    }

    // POST BOOK (Admin + พนักงานขาย)
    if (method === "POST" && p === "/api/books") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      if (!body.isbn || !body.bookName || body.price == null)
        throw new Error("กรุณากรอก ISBN, ชื่อหนังสือ, และราคา");
      if (!isValidISBN(body.isbn))
        throw new Error("รูปแบบ ISBN ไม่ถูกต้อง (ต้องเป็นตัวเลข 10-13 หลัก)");
      if (!isNonNegativeNumber(body.price))
        throw new Error("ราคาต้องเป็นตัวเลขและไม่ติดลบ");
      if (body.stock != null && !isNonNegativeInt(body.stock))
        throw new Error("จำนวนคงเหลือต้องเป็นจำนวนเต็มและไม่ติดลบ");
      const pool = await getPool();
      const tx = new sql.Transaction(pool); await tx.begin();
      try {
        const rows = await query(`
          INSERT INTO dbo.Book(ISBN,BookName,Price,Stock) OUTPUT INSERTED.*
          VALUES(@ISBN,@BookName,@Price,@Stock);`,
          {
            ISBN:     { type: sql.VarChar(20),   value: body.isbn              },
            BookName: { type: sql.NVarChar(200), value: body.bookName          },
            Price:    { type: sql.Decimal(10,2), value: Number(body.price)     },
            Stock:    { type: sql.Int,           value: Number(body.stock||0)  }
          }, tx);
        await linkBookTaxonomy(body.isbn, body.categories, body.authors, tx);
        await tx.commit();
        return json(res, 201, rows[0]);
      } catch(err) { try{ await tx.rollback(); }catch{} throw err; }
    }

    // PUT BOOK (update stock/price) (Admin + พนักงานขาย)
    if (method === "PUT" && p.startsWith("/api/books/")) {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย"])) return;
      const isbn = p.split("/").pop();
      if (!body.bookName || !body.bookName.trim())
        throw new Error("กรุณากรอกชื่อหนังสือ");
      if (!isNonNegativeNumber(body.price))
        throw new Error("ราคาต้องเป็นตัวเลขและไม่ติดลบ");
      if (body.stock != null && !isNonNegativeInt(body.stock))
        throw new Error("จำนวนคงเหลือต้องเป็นจำนวนเต็มและไม่ติดลบ");
      const pool = await getPool();
      const tx = new sql.Transaction(pool); await tx.begin();
      try {
        await query(`UPDATE dbo.Book SET BookName=@BookName,Price=@Price,Stock=@Stock WHERE ISBN=@ISBN;`,
          {
            ISBN:     { type: sql.VarChar(20),   value: isbn                  },
            BookName: { type: sql.NVarChar(200), value: body.bookName         },
            Price:    { type: sql.Decimal(10,2), value: Number(body.price)    },
            Stock:    { type: sql.Int,           value: Number(body.stock||0) }
          }, tx);
        if (body.categories != null && body.categories.trim() !== "")
          await linkBookCategories(isbn, body.categories, true, tx);
        if (body.authors != null && body.authors.trim() !== "")
          await linkBookAuthors(isbn, body.authors, true, tx);
        await tx.commit();
        return json(res, 200, { ok: true });
      } catch(err) { try{ await tx.rollback(); }catch{} throw err; }
    }

    // POST ORDER (Admin, พนักงานขาย สั่งซื้อแทนลูกค้าได้ทุกคน / ลูกค้า สั่งซื้อได้เฉพาะของตัวเอง)
    if (method === "POST" && p === "/api/orders") {
      if (!requireRole(sess, res, ["Admin","พนักงานขาย","ลูกค้า"])) return;
      if (sess.role === "ลูกค้า") {
        // บังคับ customerId ให้ตรงกับบัญชีที่ล็อกอินอยู่เสมอ
        // ป้องกันลูกค้าคนหนึ่งยิง API ตรงๆ เพื่อสั่งซื้อในนามลูกค้าคนอื่น
        if (!sess.customerID) throw new Error("ไม่พบข้อมูลลูกค้าของบัญชีนี้");
        body.customerId = sess.customerID;
        delete body.orderDate;
        delete body.shipDate;
      }
      return json(res, 201, await createOrder(body));
    }

    // GET shipment timeline — ลูกค้าเห็นได้เฉพาะออเดอร์ของตัวเอง
    if (method === "GET" && p.startsWith("/api/shipments/") && p.endsWith("/timeline")) {
      const id=Number(p.split("/")[3]); if(!id) throw new Error("ShipmentID ไม่ถูกต้อง");
      if(sess.role==="ลูกค้า"){
        const own=await query(`SELECT s.ShipmentID FROM dbo.Shipment s JOIN dbo.Orders o ON o.OrderID=s.OrderID
          WHERE s.ShipmentID=@ID AND o.CustomerID=@CID`,
          {ID:{type:sql.Int,value:id},CID:{type:sql.Int,value:sess.customerID||0}});
        if(!own.length) return json(res,403,{error:"ไม่มีสิทธิ์ดูรายการนี้"});
      } else if(!["Admin","พนักงานขาย","พนักงานจัดส่ง"].includes(sess.role)) return json(res,403,{error:"ไม่มีสิทธิ์"});
      return json(res,200,await getShipmentTimeline(id));
    }

    // POST accept — atomic กันพนักงาน 2 คนกดรับงานเดียวกันพร้อมกัน
    if (method === "POST" && p.startsWith("/api/shipments/") && p.endsWith("/accept")) {
      if(sess.role!=="พนักงานจัดส่ง") return json(res,403,{error:"เฉพาะพนักงานจัดส่งเท่านั้นที่รับงานได้"});
      const id=Number(p.split("/")[3]); if(!id) throw new Error("ShipmentID ไม่ถูกต้อง");
      const pool=await getPool(),tx=new sql.Transaction(pool); await tx.begin();
      try{
        const cur=(await new sql.Request(tx).input("ID",sql.Int,id)
          .query(`SELECT s.ShipmentID,s.Status,s.AssignedDriverID,p.PaymentMethod,p.PaymentStatus
                  FROM dbo.Shipment s WITH (UPDLOCK,ROWLOCK)
                  JOIN dbo.Payment p WITH (UPDLOCK,ROWLOCK) ON p.OrderID=s.OrderID
                  WHERE s.ShipmentID=@ID`)).recordset[0];
        if(!cur) throw new Error("ไม่พบรายการจัดส่ง");
        if(cur.Status!=="รอจัดส่ง") throw new Error(cur.Status==="กำลังจัดส่ง"?"งานนี้มีพนักงานรับไปแล้ว":"งานนี้ไม่อยู่ในคิวที่รับได้");
        if(cur.PaymentMethod!=="ปลายทาง" && cur.PaymentStatus!=="ยืนยันแล้ว")
          throw new Error("ยังไม่สามารถรับงานได้: คำสั่งซื้อนี้ยังไม่ได้ยืนยันการชำระเงิน");
        if(cur.AssignedDriverID) throw new Error("งานนี้ถูกพนักงานคนอื่นรับไปแล้ว");
        await new sql.Request(tx).input("ID",sql.Int,id).input("DriverID",sql.Int,sess.userID)
          .query(`UPDATE dbo.Shipment SET AssignedDriverID=@DriverID,Status=N'กำลังจัดส่ง',
                  AcceptedAt=SYSDATETIME(),PickedUpAt=SYSDATETIME() WHERE ShipmentID=@ID`);
        await addShipmentHistory(id,"กำลังจัดส่ง",`รับงานโดย ${sess.fullName}`,sess.userID,sess.fullName,tx);
        await tx.commit(); return json(res,200,{ok:true});
      }catch(err){try{await tx.rollback();}catch{} throw err;}
    }

    // PATCH live GPS ของงานที่พนักงานรับไว้
    if (method === "PATCH" && p.startsWith("/api/shipments/") && p.endsWith("/location")) {
      if(sess.role!=="พนักงานจัดส่ง") return json(res,403,{error:"เฉพาะพนักงานจัดส่งเท่านั้น"});
      const id=Number(p.split("/")[3]),lat=Number(body.lat),lng=Number(body.lng);
      if(!id||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180) throw new Error("พิกัดไม่ถูกต้อง");
      const own=await query(`SELECT ShipmentID FROM dbo.Shipment WHERE ShipmentID=@ID AND AssignedDriverID=@D AND Status=N'กำลังจัดส่ง'`,
        {ID:{type:sql.Int,value:id},D:{type:sql.Int,value:sess.userID}});
      if(!own.length) return json(res,403,{error:"งานนี้ไม่ได้อยู่ในความรับผิดชอบของคุณ"});
      await query(`UPDATE dbo.Shipment SET DriverLat=@Lat,DriverLng=@Lng,LastLocationAt=SYSDATETIME() WHERE ShipmentID=@ID`,
        {ID:{type:sql.Int,value:id},Lat:{type:sql.Decimal(10,7),value:lat},Lng:{type:sql.Decimal(10,7),value:lng}});
      return json(res,200,{ok:true});
    }

    // PATCH SHIPMENT STATUS — guarded transitions + driver ownership + history
    if (method === "PATCH" && p.startsWith("/api/shipments/")) {
      if (!requireRole(sess,res,["Admin","พนักงานขาย","พนักงานจัดส่ง"])) return;
      const id=Number(p.split("/").pop()); if(!id) throw new Error("ShipmentID ไม่ถูกต้อง");
      const status=body.status;
      const allowed=["รอจัดส่ง","กำลังจัดส่ง","จัดส่งแล้ว","ยกเลิก"];
      if(!allowed.includes(status)) throw new Error("สถานะจัดส่งไม่ถูกต้อง");
      const pool=await getPool(),tx=new sql.Transaction(pool); await tx.begin();
      try{
        const cur=(await new sql.Request(tx).input("ID",sql.Int,id)
          .query(`SELECT s.ShipmentID,s.Status,s.AssignedDriverID,s.OrderID,p.PaymentMethod,p.PaymentStatus
                  FROM dbo.Shipment s WITH (UPDLOCK,ROWLOCK)
                  LEFT JOIN dbo.Payment p WITH (UPDLOCK,ROWLOCK) ON p.OrderID=s.OrderID
                  WHERE s.ShipmentID=@ID`)).recordset[0];
        if(!cur) throw new Error("ไม่พบรายการจัดส่ง");
        if(sess.role==="พนักงานจัดส่ง" && cur.AssignedDriverID!==sess.userID)
          throw new Error("คุณอัปเดตได้เฉพาะงานที่รับไว้เท่านั้น");
        if(sess.role==="พนักงานจัดส่ง" && status==="รอจัดส่ง") throw new Error("ไม่สามารถย้อนกลับเป็นรอจัดส่งได้");
        const same=status===cur.Status;
        if(status==="ยกเลิก" && cur.PaymentStatus==="ยืนยันแล้ว")
          throw new Error("คำสั่งซื้อนี้ยืนยันการชำระเงินแล้ว จึงยกเลิกตรงๆ ไม่ได้ กรุณาดำเนินการคืนเงินก่อน");
        if(status==="กำลังจัดส่ง" && cur.Status==="รอจัดส่ง")
          throw new Error("กรุณาให้พนักงานจัดส่งกดรับงานจากคิวก่อน ไม่สามารถข้ามขั้นตอนเป็นกำลังจัดส่งได้");
        if(status==="จัดส่งแล้ว" && cur.PaymentMethod!=="ปลายทาง" && cur.PaymentStatus!=="ยืนยันแล้ว")
          throw new Error("ไม่สามารถปิดงานจัดส่งได้ เนื่องจากการชำระเงินยังไม่ได้รับการยืนยัน");
        const forward=(cur.Status==="กำลังจัดส่ง"&&status==="จัดส่งแล้ว");
        const cancel=(sess.role!=="พนักงานจัดส่ง"&&status==="ยกเลิก"&&!["จัดส่งแล้ว","ยกเลิก"].includes(cur.Status));
        if(!same&&!forward&&!cancel) throw new Error(`ไม่สามารถเปลี่ยนจาก "${cur.Status}" เป็น "${status}" ได้`);
        const sets=["Status=@Status","TrackingNo=ISNULL(@TrackingNo,TrackingNo)","ShippingCompany=ISNULL(@ShippingCompany,ShippingCompany)"];
        if(status==="กำลังจัดส่ง") sets.push("PickedUpAt=ISNULL(PickedUpAt,SYSDATETIME())");
        if(status==="จัดส่งแล้ว") sets.push("DeliveredAt=SYSDATETIME()");
        if(status==="ยกเลิก") sets.push("CancelledAt=SYSDATETIME()");
        await new sql.Request(tx).input("ID",sql.Int,id).input("Status",sql.NVarChar(30),status)
          .input("TrackingNo",sql.VarChar(50),body.trackingNo||null)
          .input("ShippingCompany",sql.NVarChar(100),body.shippingCompany||null)
          .query(`UPDATE dbo.Shipment SET ${sets.join(",")} WHERE ShipmentID=@ID`);
        // เก็บเงินปลายทาง: เมื่อพนักงานยืนยันส่งสำเร็จ ถือว่าได้รับเงินจริงแล้ว
        if(status==="จัดส่งแล้ว" && cur.PaymentMethod==="ปลายทาง" && cur.PaymentStatus!=="ยืนยันแล้ว") {
          await new sql.Request(tx).input("OID",sql.Int,cur.OrderID)
            .query(`UPDATE dbo.Payment
                    SET PaymentStatus=N'ยืนยันแล้ว', PaymentDate=COALESCE(PaymentDate,CONVERT(date,GETDATE())), RejectedAt=NULL
                    WHERE OrderID=@OID`);
        }
        if(cancel){
          const details=await new sql.Request(tx).input("OID",sql.Int,cur.OrderID)
            .query("SELECT ISBN,Quantity FROM dbo.Order_Detail WHERE OrderID=@OID");
          for(const d of details.recordset){
            await new sql.Request(tx).input("ISBN",sql.VarChar(20),d.ISBN).input("Qty",sql.Int,d.Quantity)
              .query("UPDATE dbo.Book SET Stock=Stock+@Qty WHERE ISBN=@ISBN");
          }
          await new sql.Request(tx).input("OID",sql.Int,cur.OrderID)
            .query(`UPDATE dbo.Payment SET PaymentStatus=N'รอชำระ',PaymentDate=NULL,SlipImage=NULL,RejectedAt=NULL
                    WHERE OrderID=@OID AND PaymentStatus<>N'ยืนยันแล้ว'`);
        }
        if(!same) await addShipmentHistory(id,status,body.note||`เปลี่ยนสถานะเป็น ${status}`,sess.userID,sess.fullName,tx);
        await tx.commit(); return json(res,200,{ok:true});
      }catch(err){try{await tx.rollback();}catch{} throw err;}
    }

    // PATCH PAYMENT STATUS (Admin/พนักงานขาย ตรวจสอบ/ยืนยัน/ปฏิเสธสลิป)
    // FIX: ดึง id จาก parts[3] และ validate ก่อนใช้
    if (method === "PATCH" && p.startsWith("/api/payments/") && p.endsWith("/status")) {
      if (!["Admin","พนักงานขาย"].includes(sess.role)) return json(res, 403, { error: "ไม่มีสิทธิ์" });
      const parts = p.split("/"); // ["", "api", "payments", ":id", "status"]
      const id = Number(parts[3]);
      if (!id) throw new Error("PaymentID ไม่ถูกต้อง");
      const allowed = ["ยืนยันแล้ว", "ปฏิเสธ", "รอตรวจสอบ", "รอชำระ"];
      if (!allowed.includes(body.status)) throw new Error("สถานะไม่ถูกต้อง");
      const pay = await query(`SELECT p.SlipImage,p.OrderID,p.PaymentMethod,p.PaymentStatus,s.Status AS ShipmentStatus
                               FROM dbo.Payment p LEFT JOIN dbo.Shipment s ON s.OrderID=p.OrderID
                               WHERE p.PaymentID=@ID`,
        { ID: { type: sql.Int, value: id } });
      if (!pay.length) throw new Error("ไม่พบรายการชำระเงิน");
      // การโอนต้องมีสลิปก่อนยืนยัน ส่วนบัตรในเวอร์ชันนี้เป็น flow จำลองจึงให้พนักงานยืนยันจากหน้า Backoffice
      // เงินสด/ปลายทาง/บัตรไม่บังคับไฟล์หลักฐานที่ API นี้
      const NO_PROOF_METHODS = ["เงินสด", "ปลายทาง", "บัตร"];
      const INSTANT_CANCEL_METHODS = ["เงินสด", "ปลายทาง"];
      if (pay[0].ShipmentStatus === "ยกเลิก") throw new Error("คำสั่งซื้อนี้ถูกยกเลิกแล้ว ไม่สามารถเปลี่ยนสถานะการชำระเงินได้");
      if (pay[0].ShipmentStatus === "จัดส่งแล้ว" && body.status !== "ยืนยันแล้ว")
        throw new Error("คำสั่งซื้อนี้จัดส่งสำเร็จแล้ว ไม่สามารถย้อนสถานะการชำระเงินได้");
      if (pay[0].ShipmentStatus === "กำลังจัดส่ง" && pay[0].PaymentStatus === "ยืนยันแล้ว" && body.status !== "ยืนยันแล้ว")
        throw new Error("มีพนักงานรับงานจัดส่งแล้ว ไม่สามารถลดสถานะการชำระเงินที่ยืนยันแล้วได้");
      if (pay[0].ShipmentStatus === "กำลังจัดส่ง" && pay[0].PaymentMethod !== "ปลายทาง" && body.status !== "ยืนยันแล้ว")
        throw new Error("มีพนักงานรับงานจัดส่งแล้ว ไม่สามารถลดสถานะการชำระเงินได้");
      if (body.status === "ยืนยันแล้ว" && !NO_PROOF_METHODS.includes(pay[0].PaymentMethod) && !pay[0].SlipImage)
        throw new Error("ยังไม่มีสลิปแนบมา ไม่สามารถยืนยันการชำระเงินได้");

      const pool2 = await getPool();
      const tx2   = new sql.Transaction(pool2);
      await tx2.begin();
      try {
        // อัปเดต PaymentStatus
        // ตั้ง RejectedAt เมื่อปฏิเสธ (ใช้เป็นจุดเริ่มนับวันสำหรับ auto-cancel)
        //          และล้างทิ้งเมื่อสถานะเปลี่ยนไปเป็นอย่างอื่น (เช่น ลูกค้าแนบสลิปใหม่ → รอตรวจสอบ)
        await new sql.Request(tx2)
          .input("ID",     sql.Int,          id)
          .input("Status", sql.NVarChar(20), body.status)
          .query(`
            UPDATE dbo.Payment
            SET PaymentStatus = @Status,
                PaymentDate = CASE
                  WHEN @Status=N'ยืนยันแล้ว' THEN COALESCE(PaymentDate, CONVERT(date, GETDATE()))
                  WHEN @Status=N'รอชำระ' THEN NULL
                  ELSE PaymentDate END,
                RejectedAt = CASE WHEN @Status = N'ปฏิเสธ' THEN CONVERT(date, GETDATE()) ELSE NULL END
            WHERE PaymentID=@ID;
          `);

        // ── DELIVERY WORKFLOW: ยืนยันเงิน "ไม่" รับงานแทนพนักงานจัดส่ง
        // หลังชำระแล้ว งานยังคง "รอจัดส่ง" จนกว่าพนักงานจะกดรับงานเอง
        if (body.status === "ยืนยันแล้ว") {
          const ready = await new sql.Request(tx2).input("OID",sql.Int,pay[0].OrderID)
            .query(`SELECT ShipmentID,Status FROM dbo.Shipment WITH (UPDLOCK,ROWLOCK) WHERE OrderID=@OID;`);
          if(ready.recordset[0] && ready.recordset[0].Status==="รอจัดส่ง")
            await addShipmentHistory(ready.recordset[0].ShipmentID,"รอจัดส่ง","ยืนยันการชำระเงินแล้ว — รอพนักงานรับงาน",sess.userID,sess.fullName,tx2);
        }

        // ปฏิเสธเงินสด/ปลายทาง → ยกเลิกออเดอร์ทันที ไม่ต้องรอ auto-cancel 3 วัน
        //          เพราะฝั่งลูกค้าไม่มีปุ่มแนบสลิปให้แก้ไขอยู่แล้ว (การปฏิเสธเป็นการตัดสินใจฝ่ายเดียวของพนักงาน)
        //          รอ 3 วันไปก็ไม่มีอะไรเปลี่ยน จึงคืนสต็อกและยกเลิกให้เลยเพื่อไม่ให้ order ค้างเก้อ
        if (body.status === "ปฏิเสธ" && INSTANT_CANCEL_METHODS.includes(pay[0].PaymentMethod)) {
          const ship = await new sql.Request(tx2)
            .input("OID", sql.Int, pay[0].OrderID)
            .query("SELECT Status FROM dbo.Shipment WITH (UPDLOCK,ROWLOCK) WHERE OrderID=@OID");
          if (ship.recordset.length && ship.recordset[0].Status === "รอจัดส่ง") {
            const details = await new sql.Request(tx2)
              .input("OID", sql.Int, pay[0].OrderID)
              .query("SELECT ISBN, Quantity FROM dbo.Order_Detail WHERE OrderID=@OID");
            for (const d of details.recordset) {
              await new sql.Request(tx2)
                .input("ISBN", sql.VarChar(20), d.ISBN)
                .input("Qty",  sql.Int, d.Quantity)
                .query("UPDATE dbo.Book SET Stock=Stock+@Qty WHERE ISBN=@ISBN");
            }
            await new sql.Request(tx2)
              .input("OID", sql.Int, pay[0].OrderID)
              .input("Note", sql.NVarChar(500), "ยกเลิกทันที: ปฏิเสธการรับเงินสด/ปลายทาง")
              .query(`UPDATE dbo.Shipment
                      SET Status=N'ยกเลิก', CancelNote=@Note, CancelledAt=GETDATE()
                      WHERE OrderID=@OID`);
            await addShipmentHistory(ship.recordset[0].ShipmentID,"ยกเลิก","ยกเลิกทันที: ปฏิเสธการรับเงินสด/ปลายทาง",sess.userID,sess.fullName,tx2);
          }
        }

        await tx2.commit();
      } catch(err2) { await tx2.rollback(); throw err2; }
      return json(res, 200, { ok: true });
    }

    // PATCH PAYMENT (upload slip base64 — ลูกค้าแนบสลิปของตัวเอง หรือพนักงานแนบแทนให้)
    // FIX: เพิ่ม !p.endsWith("/status") เพื่อไม่ให้ชนกับ route ด้านบน
    if (method === "PATCH" && p.startsWith("/api/payments/") && !p.endsWith("/status")) {
      const id = Number(p.split("/").pop());
      if (!id) throw new Error("PaymentID ไม่ถูกต้อง");
      if (!body.slip) throw new Error("กรุณาเลือกไฟล์สลิป");
      if (!isValidSlipDataUrl(body.slip)) throw new Error("ไฟล์สลิปต้องเป็นรูป PNG, JPG/JPEG หรือ WEBP เท่านั้น");

      const paymentInfo = await query(`SELECT p.PaymentMethod,p.PaymentStatus,s.Status AS ShipmentStatus
                                       FROM dbo.Payment p LEFT JOIN dbo.Shipment s ON s.OrderID=p.OrderID
                                       WHERE p.PaymentID=@ID`,
        { ID: { type: sql.Int, value: id } });
      if (!paymentInfo.length) throw new Error("ไม่พบรายการชำระเงิน");
      if (paymentInfo[0].PaymentMethod !== "โอน") throw new Error("แนบสลิปได้เฉพาะรายการชำระด้วยการโอนเงิน");
      if (["ยกเลิก","จัดส่งแล้ว"].includes(paymentInfo[0].ShipmentStatus))
        throw new Error("ไม่สามารถแนบสลิปให้คำสั่งซื้อที่ยกเลิกหรือจัดส่งเสร็จแล้วได้");

      // ตรวจสิทธิ์: ลูกค้าแนบสลิปได้แค่ของ order ตัวเองเท่านั้น
      if (sess.role === "ลูกค้า") {
        if (!sess.customerID) throw new Error("ไม่พบข้อมูลลูกค้า");
        const own = await query(
          `SELECT 1 AS x FROM dbo.Payment p JOIN dbo.Orders o ON o.OrderID=p.OrderID
           WHERE p.PaymentID=@ID AND o.CustomerID=@cid`,
          { ID: { type: sql.Int, value: id }, cid: { type: sql.Int, value: sess.customerID } });
        if (!own.length) return json(res, 403, { error: "ไม่มีสิทธิ์แนบสลิปสำหรับคำสั่งซื้อนี้" });
      } else if (!["Admin","พนักงานขาย"].includes(sess.role)) {
        return json(res, 403, { error: "ไม่มีสิทธิ์" });
      }

      // แนบสลิปแล้ว = เข้าสถานะ "รอตรวจสอบ" และบันทึกวันที่แนบสลิปจริง (ไม่ใช่ถือว่าจ่ายแล้วทันที)
      // ล้าง RejectedAt ทิ้ง เพราะลูกค้าดำเนินการแนบสลิปใหม่แล้ว ไม่นับว่า "ค้างหลังโดนปฏิเสธ" อีกต่อไป
      await query(`UPDATE dbo.Payment
                   SET SlipImage=@Slip, PaymentStatus=N'รอตรวจสอบ', PaymentDate=@PaymentDate, RejectedAt=NULL
                   WHERE PaymentID=@ID;`,
        {
          ID:          { type: sql.Int,              value: id        },
          Slip:        { type: sql.NVarChar(sql.MAX), value: body.slip },
          PaymentDate: { type: sql.Date,              value: today()   }
        });
      return json(res, 200, { ok: true });
    }

    // DELETE CUSTOMER (Admin + พนักงานขาย)
    if (method === "DELETE" && p.startsWith("/api/customers/")) {
      if (!["Admin","พนักงานขาย"].includes(sess.role)) return json(res, 403, { error: "ไม่มีสิทธิ์" });
      const id = Number(p.split("/").pop());
      if (!id) throw new Error("CustomerID ไม่ถูกต้อง");
      const hasOrders = await query("SELECT 1 AS x FROM dbo.Orders WHERE CustomerID=@ID", { ID: { type: sql.Int, value: id } });
      if (hasOrders.length) throw new Error("ไม่สามารถลบลูกค้าที่มีคำสั่งซื้ออยู่ในระบบได้");
      await query("DELETE FROM dbo.Customer WHERE CustomerID=@ID", { ID: { type: sql.Int, value: id } });
      return json(res, 200, { ok: true });
    }

    // DELETE BOOK (Admin + พนักงานขาย)
    if (method === "DELETE" && p.startsWith("/api/books/")) {
      if (!["Admin","พนักงานขาย"].includes(sess.role)) return json(res, 403, { error: "ไม่มีสิทธิ์" });
      const isbn = p.split("/").pop();
      if (!isbn) throw new Error("ISBN ไม่ถูกต้อง");
      const hasOrders = await query("SELECT 1 AS x FROM dbo.Order_Detail WHERE ISBN=@ISBN", { ISBN: { type: sql.VarChar(20), value: isbn } });
      if (hasOrders.length) throw new Error("ไม่สามารถลบหนังสือที่มีประวัติคำสั่งซื้ออยู่ในระบบได้");
      await query("DELETE FROM dbo.Book WHERE ISBN=@ISBN", { ISBN: { type: sql.VarChar(20), value: isbn } });
      return json(res, 200, { ok: true });
    }

    // PATCH ORDER CANCEL (ลูกค้ายกเลิกคำสั่งซื้อ — เฉพาะสถานะ รอจัดส่ง)
    if (method === "PATCH" && p.startsWith("/api/orders/") && p.endsWith("/cancel")) {
      const id = Number(p.split("/")[3]);
      // หมายเหตุการยกเลิก (ไม่บังคับ) — จำกัดความยาวกันข้อมูลล้น column NVARCHAR(500)
      const cancelNote = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
      // ตรวจสอบว่า order นี้เป็นของ user คนนี้ (กรณีลูกค้า)
      if (sess.role === "ลูกค้า") {
        if (!sess.customerID) throw new Error("ไม่พบข้อมูลลูกค้า");
        const ord = await query("SELECT CustomerID FROM dbo.Orders WHERE OrderID=@ID",
          { ID: { type: sql.Int, value: id } });
        if (!ord.length || ord[0].CustomerID !== sess.customerID)
          return json(res, 403, { error: "ไม่มีสิทธิ์ยกเลิกคำสั่งซื้อนี้" });
      } else if (!["Admin","พนักงานขาย"].includes(sess.role)) {
        return json(res, 403, { error: "ไม่มีสิทธิ์" });
      }
      const pool = await getPool();
      const tx   = new sql.Transaction(pool);
      await tx.begin();
      try {
        // เช็คสถานะจัดส่ง — ยกเลิกได้แค่ รอจัดส่ง
        // FIX (Isolation): ย้ายเข้ามาอยู่ใน transaction พร้อม UPDLOCK/ROWLOCK
        // เพื่อล็อกแถวไว้ตั้งแต่ตอนอ่าน ป้องกันไม่ให้มีคำขออื่นมาแก้ไข
        // สถานะ Shipment แทรกกลางระหว่างที่เรากำลังเช็คแล้วอัปเดต (race condition)
        const ship = await new sql.Request(tx)
          .input("ID", sql.Int, id)
          .query(`SELECT s.Status,p.PaymentStatus
                  FROM dbo.Shipment s WITH (UPDLOCK,ROWLOCK)
                  LEFT JOIN dbo.Payment p WITH (UPDLOCK,ROWLOCK) ON p.OrderID=s.OrderID
                  WHERE s.OrderID=@ID`);
        if (!ship.recordset.length) throw new Error("ไม่พบรายการจัดส่งของคำสั่งซื้อนี้");
        if (ship.recordset[0].Status !== "รอจัดส่ง")
          throw new Error(`ไม่สามารถยกเลิกได้ เนื่องจากสถานะจัดส่งเป็น "${ship.recordset[0].Status}" แล้ว`);
        if (ship.recordset[0].PaymentStatus === "ยืนยันแล้ว")
          throw new Error("คำสั่งซื้อนี้ยืนยันการชำระเงินแล้ว จึงยกเลิกตรงๆ ไม่ได้ กรุณาติดต่อพนักงานเพื่อดำเนินการคืนเงิน");

        // คืน stock
        const details = await new sql.Request(tx)
          .input("OID", sql.Int, id)
          .query("SELECT ISBN, Quantity FROM dbo.Order_Detail WHERE OrderID=@OID");
        for (const d of details.recordset) {
          await new sql.Request(tx)
            .input("ISBN", sql.VarChar(20), d.ISBN)
            .input("Qty",  sql.Int, d.Quantity)
            .query("UPDATE dbo.Book SET Stock=Stock+@Qty WHERE ISBN=@ISBN");
        }
        // อัปเดตสถานะจัดส่งเป็น ยกเลิก พร้อมบันทึกหมายเหตุ + เวลาที่ยกเลิก
        if (ship.recordset.length) {
          await new sql.Request(tx)
            .input("OID", sql.Int, id)
            .input("Note", sql.NVarChar(500), cancelNote)
            .query(`UPDATE dbo.Shipment
                    SET Status=N'ยกเลิก', CancelNote=@Note, CancelledAt=GETDATE()
                    WHERE OrderID=@OID`);
        }
        // FIX: reset PaymentStatus กลับเป็น "รอชำระ" เมื่อยกเลิก order
        await new sql.Request(tx)
          .input("OID2", sql.Int, id)
          .query(`UPDATE dbo.Payment
                  SET PaymentStatus = N'รอชำระ', PaymentDate = NULL, SlipImage = NULL, RejectedAt = NULL
                  WHERE OrderID = @OID2 AND PaymentStatus NOT IN (N'ยืนยันแล้ว');`);
        await tx.commit();
      } catch(err) { await tx.rollback(); throw err; }
      return json(res, 200, { ok: true });
    }

    // POST TRIGGER AUTO-CANCEL (Admin เท่านั้น) — สั่งรันตรวจสอบ/ยกเลิกออเดอร์ค้างชำระทันที
    if (method === "POST" && p === "/api/orders/auto-cancel-unpaid") {
      if (!requireRole(sess, res, ["Admin"])) return null;
      const result = await autoCancelUnpaidOrders();
      return json(res, 200, { ok: true, ...result });
    }

    // POST USER (Admin only)
    if (method === "POST" && p === "/api/users") {
      if (sess.role !== "Admin") return json(res, 403, { error: "ไม่มีสิทธิ์" });
      if (!body.username || !body.password || !body.fullName || !body.role)
        throw new Error("กรุณากรอกข้อมูลให้ครบ");
      if (body.password.length < 6)
        throw new Error("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
      const ALLOWED_ROLES = ["Admin", "พนักงานขาย", "พนักงานจัดส่ง"];
      if (!ALLOWED_ROLES.includes(body.role))
        throw new Error("บทบาทไม่ถูกต้อง");
      const rows = await query(`
        INSERT INTO dbo.SystemUser(Username,PasswordHash,FullName,Role) OUTPUT INSERTED.*
        VALUES(@Username,@PasswordHash,@FullName,@Role);`,
        {
          Username:     { type: sql.NVarChar(60),  value: body.username         },
          PasswordHash: { type: sql.VarChar(160),  value: hashPwd(body.password)},
          FullName:     { type: sql.NVarChar(100), value: body.fullName         },
          Role:         { type: sql.NVarChar(30),  value: body.role             }
        });
      return json(res, 201, rows[0]);
    }

    // PATCH USER active/role
    if (method === "PATCH" && p.startsWith("/api/users/")) {
      if (sess.role !== "Admin") return json(res, 403, { error: "ไม่มีสิทธิ์" });
      const id = Number(p.split("/").pop());
      if (!id) throw new Error("UserID ไม่ถูกต้อง");

      // กันแก้บัญชีตัวเอง (ปิดใช้งาน/เปลี่ยน role ตัวเอง) — เทียบเท่าการ์ดที่มีอยู่แล้วใน DELETE
      if ((body.isActive !== undefined || body.role) && id === sess.userID) {
        throw new Error("ไม่สามารถปิดใช้งานหรือเปลี่ยนบทบาทบัญชีของตัวเองได้");
      }

      // กันปิดใช้งาน/ลด role ของ Admin ที่ใช้งานอยู่คนสุดท้าย (เผื่อระบบไม่มีใครล็อกอินจัดการต่อได้)
      if (body.isActive !== undefined || body.role) {
        const target = await query("SELECT UserID, IsActive, Role, CustomerID FROM dbo.SystemUser WHERE UserID=@ID",
          { ID: { type: sql.Int, value: id } });
        if (!target.length) throw new Error("ไม่พบผู้ใช้งานนี้");
        if (body.role === "ลูกค้า" && !target[0].CustomerID)
          throw new Error("ไม่สามารถเปลี่ยนบัญชีพนักงานเป็นลูกค้าโดยไม่มี CustomerID กรุณาให้ลูกค้าสมัครสมาชิกผ่านหน้าสมัครสมาชิก");

        const willDeactivate = body.isActive === false;
        const willChangeRoleAwayFromAdmin = body.role !== undefined && body.role !== "Admin";

        if (target[0].Role === "Admin" && target[0].IsActive && (willDeactivate || willChangeRoleAwayFromAdmin)) {
          const activeAdmins = await query(
            "SELECT COUNT(*) AS c FROM dbo.SystemUser WHERE Role=N'Admin' AND IsActive=1");
          if (activeAdmins[0].c <= 1) throw new Error("ต้องมีบัญชี Admin ที่ใช้งานอยู่อย่างน้อย 1 คนในระบบ");
        }
      }

      if (body.isActive !== undefined) {
        await query(`UPDATE dbo.SystemUser SET IsActive=@v WHERE UserID=@ID;`,
          { ID: { type: sql.Int, value: id }, v: { type: sql.Bit, value: body.isActive?1:0 } });
      }
      if (body.role) {
        const ALLOWED_ROLES = ["Admin", "พนักงานขาย", "พนักงานจัดส่ง", "ลูกค้า"];
        if (!ALLOWED_ROLES.includes(body.role)) throw new Error("บทบาทไม่ถูกต้อง");
        await query(`UPDATE dbo.SystemUser SET Role=@Role WHERE UserID=@ID;`,
          { ID: { type: sql.Int, value: id }, Role: { type: sql.NVarChar(30), value: body.role } });
      }
      if (body.password) {
        if (body.password.length < 6) throw new Error("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
        await query(`UPDATE dbo.SystemUser SET PasswordHash=@h WHERE UserID=@ID;`,
          { ID: { type: sql.Int, value: id }, h: { type: sql.VarChar(160), value: hashPwd(body.password) } });
      }

      // เพิกถอน session ที่ user คนนี้ใช้งานอยู่ทันที ถ้ามีการเปลี่ยนสถานะ/สิทธิ์/รหัสผ่าน
      // กันปัญหา token เดิมยังใช้สิทธิ์เก่าต่อได้จนกว่าจะหมดอายุเอง (8 ชม.)
      if (body.isActive !== undefined || body.role || body.password) {
        revokeSessionsForUser(id);
      }

      return json(res, 200, { ok: true });
    }

    // DELETE USER (Admin only) — ลบถาวรได้เฉพาะบัญชีที่ "ปิดใช้งาน" อยู่แล้วเท่านั้น
    // (กันลบพลาดบัญชีที่ยังใช้งานจริง — ต้องกดปิดใช้งานก่อนเสมอ) ใช้ล้างบัญชีทดสอบ/บัญชีเก่าที่ค้างอยู่
    if (method === "DELETE" && p.startsWith("/api/users/")) {
      if (sess.role !== "Admin") return json(res, 403, { error: "ไม่มีสิทธิ์" });
      const id = Number(p.split("/").pop());
      if (!id) throw new Error("UserID ไม่ถูกต้อง");
      if (id === sess.userID) throw new Error("ไม่สามารถลบบัญชีของตัวเองได้");

      const rows = await query("SELECT UserID, IsActive, Role FROM dbo.SystemUser WHERE UserID=@ID",
        { ID: { type: sql.Int, value: id } });
      if (!rows.length) throw new Error("ไม่พบผู้ใช้งานนี้");
      if (rows[0].IsActive) throw new Error("ต้องปิดใช้งานบัญชีนี้ก่อน จึงจะลบถาวรได้");

      // กันลบ Admin คนสุดท้ายที่ยัง IsActive อยู่ (เผื่อระบบไม่มีใครล็อกอินจัดการต่อได้)
      if (rows[0].Role === "Admin") {
        const activeAdmins = await query(
          "SELECT COUNT(*) AS c FROM dbo.SystemUser WHERE Role=N'Admin' AND IsActive=1");
        if (activeAdmins[0].c < 1) throw new Error("ต้องมีบัญชี Admin ที่ใช้งานอยู่อย่างน้อย 1 คนในระบบ");
      }

      await query("DELETE FROM dbo.SystemUser WHERE UserID=@ID", { ID: { type: sql.Int, value: id } });
      return json(res, 200, { ok: true });
    }

    json(res, 404, { error: "ไม่พบ API ที่เรียก" });
  } catch(err) {
    // DB/เครือข่ายล้มเหลว (เช่น ต่อ SQL Server ไม่ได้, timeout) — err มาจาก driver 'mssql'
    // ไม่ควรโชว์ err.message ดิบๆ ให้ผู้ใช้เห็น (มักมีรายละเอียดเซิร์ฟเวอร์/พอร์ต/สแตกภายใน
    // ซึ่งเป็นข้อมูลอ่อนไหวและอ่านไม่รู้เรื่องสำหรับผู้ใช้ทั่วไป) ให้ตอบข้อความที่เข้าใจง่ายแทน
    if (err.statusCode) return json(res, err.statusCode, { error: err.message });
    const transientDbCodes = new Set(["ETIMEOUT","ESOCKET","ECONNCLOSED","ENOTOPEN","ELOGIN"]);
    if (err.name === "ConnectionError" || transientDbCodes.has(err.code)) {
      console.error("❌ DB connection error:", err.name, err.code, err.message);
      return json(res, 503, { error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้งในภายหลัง" });
    }
    if (err.name === "RequestError" || err.name === "TransactionError" || err.code) {
      console.error("❌ DB request error:", err.name, err.code, err.number, err.message);
      const duplicate = err.number === 2601 || err.number === 2627;
      const constraint = duplicate || err.number === 547 || err.number === 515 || err.number === 245 || err.number === 8114;
      return json(res, duplicate ? 409 : (constraint ? 400 : 500), {
        error: duplicate ? "ข้อมูลนี้มีอยู่ในระบบแล้ว กรุณาตรวจสอบค่าที่กรอก" :
               constraint ? "ข้อมูลไม่ผ่านเงื่อนไขของฐานข้อมูล กรุณาตรวจสอบค่าที่กรอก" :
               "เกิดข้อผิดพลาดขณะประมวลผลฐานข้อมูล"
      });
    }
    json(res, 400, { error: err.message });
  }
}

// ── STATIC FILE SERVER ─────────────────────────────────────────────
function serveStatic(req, res, url) {
  const file   = url.pathname === "/" ? "bookstore.html" : decodeURIComponent(url.pathname.slice(1));
  const target = path.resolve(ROOT, file);
  const rel = path.relative(ROOT, target);
  if (rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.writeHead(404); res.end("Not found"); return;
  }
  const ext   = path.extname(target).toLowerCase();
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png":"image/png", ".jpg":"image/jpeg" };
  // [FIX] ปิดการแคชไฟล์หน้าเว็บ/สคริปต์/สไตล์ทั้งหมดของฝั่ง browser โดยเด็ดขาด
  // ระหว่างพัฒนา แก้ไฟล์แล้ว refresh บางทีเบราว์เซอร์ยังใช้ของเก่าที่แคชไว้ ทำให้ดูเหมือนบั๊กเดิมไม่หาย
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache"
  });
  fs.createReadStream(target).pipe(res);
}

// ── MAIN ───────────────────────────────────────────────────────────
(async () => {
  try {
    const wantedPort = Number(process.env.PORT || 3000);
    const PORT = await findPort(wantedPort);
    if (PORT !== wantedPort)
      console.log(`⚠️  Port ${wantedPort} ถูกใช้อยู่ → เปลี่ยนเป็น port ${PORT} อัตโนมัติ`);

    // Init / migrate DB schema (idempotent — ปลอดภัยกับฐานข้อมูลจริงที่มีข้อมูลอยู่แล้ว)
    await ensureUsersTable();
    await ensureSlipColumn();
    await ensureShippingCompanyColumn();
    await ensureEmailNullableUnique();
    await ensurePaymentDateNullable();
    await ensurePaymentStatusColumn();
    await ensureCancelNoteColumn();
    await ensureRejectedAtColumn();
    await ensureDeliveryWorkflow();
    console.log("  ✅ ตรวจสอบ/ปรับโครงสร้างฐานข้อมูลเรียบร้อย");

    // เริ่มระบบยกเลิกออเดอร์ค้างชำระอัตโนมัติ
    startAutoCancelScheduler();
    console.log(`  ⏱️  Auto-cancel: ตรวจสอบทุก ${ORDER_AUTO_CANCEL_CHECK_MINUTES} นาที (ยกเลิกออเดอร์ค้างชำระเกิน ${ORDER_AUTO_CANCEL_DAYS} วัน)`);

    // FIX: เพิ่ม error handler บน server เพื่อจับ EADDRINUSE และ error อื่นๆ ไม่ให้ crash แบบ unhandled
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
      serveStatic(req, res, url);
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`❌ Port ${PORT} ถูกใช้งานอยู่ — ปิด process เก่าก่อนแล้วรันใหม่`);
      } else {
        console.error("❌ Server error:", err.message);
      }
      process.exit(1);
    });

    server.listen(PORT, () => {
      console.log("═".repeat(58));
      console.log("  📚  Bookstore Management System  (Complete Edition)");
      console.log("═".repeat(58));
      console.log(`  URL      : http://localhost:${PORT}`);
      console.log(`  Database : ${dbConfig.server}:${dbConfig.port||"default"}/${dbConfig.database}`);
      console.log(`  User     : ${dbConfig.user}`);
      console.log("  Accounts : ใช้บัญชีเริ่มต้นตาม SQL/ENV และควรเปลี่ยนรหัสผ่านหลังติดตั้ง");
      console.log("═".repeat(58));

      // เปิดหน้าเว็บให้อัตโนมัติ (ปิดได้ด้วย NO_OPEN=1 npm start)
      if (!process.env.NO_OPEN) {
        openBrowser(`http://localhost:${PORT}`);
      }
    });
  } catch(err) {
    console.error("❌ เริ่มต้นระบบล้มเหลว:", err.message);
    process.exit(1);
  }
})();