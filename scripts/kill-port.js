// scripts/kill-port.js
// ปิด process ที่กำลังใช้ port อยู่ (default 3000) ก่อนสตาร์ทเซิร์ฟเวอร์
// ใช้ได้ทั้ง Windows (netstat + taskkill) และ Mac/Linux (lsof + kill)
const { execSync } = require("child_process");

const port = Number(process.argv[2] || process.env.PORT || 3000);

function killWindows(port) {
  let out;
  try {
    out = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
  } catch (e) {
    return; // ไม่มีอะไรใช้ port นี้อยู่
  }
  const pids = new Set();
  out.split("\n").forEach(line => {
    const parts = line.trim().split(/\s+/);
    // รูปแบบ: TCP  0.0.0.0:3000  0.0.0.0:0  LISTENING  1234
    const localAddr = parts[1];
    const pid = parts[parts.length - 1];
    if (localAddr && localAddr.endsWith(`:${port}`) && pid && pid !== "0") {
      pids.add(pid);
    }
  });
  pids.forEach(pid => {
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
      console.log(`✅ ปิด process PID ${pid} ที่ใช้ port ${port} แล้ว`);
    } catch (e) {
      // อาจปิดไปแล้วหรือไม่มีสิทธิ์ ข้ามไป
    }
  });
}

function killUnix(port) {
  let out;
  try {
    out = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch (e) {
    return; // ไม่มีอะไรใช้ port นี้อยู่
  }
  if (!out) return;
  out.split("\n").forEach(pid => {
    pid = pid.trim();
    if (!pid) return;
    try {
      execSync(`kill -9 ${pid}`, { stdio: "ignore" });
      console.log(`✅ ปิด process PID ${pid} ที่ใช้ port ${port} แล้ว`);
    } catch (e) {
      // ข้ามไป
    }
  });
}

try {
  if (process.platform === "win32") {
    killWindows(port);
  } else {
    killUnix(port);
  }
} catch (e) {
  // ไม่ให้ error ตรงนี้ทำให้ npm start ล้มเหลว
  console.log(`ℹ️  ไม่สามารถตรวจสอบ port ${port} ได้ (${e.message}) — ข้ามไปสตาร์ทเซิร์ฟเวอร์ต่อ`);
}