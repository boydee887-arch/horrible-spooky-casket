const app = document.getElementById("app");

const durations = [
  "3 ชั่วโมง", "6 ชั่วโมง", "1 วัน", "7 วัน",
  "30 วัน", "90 วัน", "180 วัน", "Lifetime"
];

// ใส่ลิงก์ร้านค้าภายหลัง
const SELLER_URL = "";

// สถานะการสแกนของหน้า Customer
let selectedScanFile = null;
let scanTimerId = null;
let scanCycleId = null;
let scanStartedAt = null;
let scanStoppedAt = null;
let scanBusy = false;
let scanLog = [];

const checks = [
  ["สถานะ Root", "เบราว์เซอร์ทั่วไปไม่สามารถอ่านสถานะ Root ของ Android ได้", "ไม่สามารถตรวจได้"],
  ["สถานะ VPN", "ไม่สามารถอ่านสถานะ VPN ระดับระบบจากหน้าเว็บได้", "ไม่สามารถตรวจได้"],
  ["สถานะ Shizuku", "ไม่สามารถตรวจบริการ Shizuku ในระบบได้", "ไม่สามารถตรวจได้"],
  ["แอปที่ติดตั้ง", "เว็บไม่สามารถดึงรายชื่อแอปทั้งหมดที่ติดตั้งได้", "ไม่สามารถตรวจได้"],
  ["สิทธิ์ของแอป", "เว็บไม่สามารถอ่านสิทธิ์ของแอปอื่นได้", "ไม่สามารถตรวจได้"],
  ["ไฟล์ที่ดาวน์โหลด", "ตรวจได้เฉพาะไฟล์ที่ผู้ใช้เลือกให้เว็บอ่าน", "ยังไม่มีข้อมูล"],
  ["ตรวจสอบ APK", "อ่านไฟล์และคำนวณ SHA-256 ได้ แต่ไม่ใช่การวิเคราะห์มัลแวร์เต็มรูปแบบ", "ยังไม่มีข้อมูล"],
  ["ตรวจสอบ ZIP", "อ่านไฟล์และคำนวณ SHA-256 ได้ แต่ไม่รับประกันการตรวจทุกเนื้อหา", "ยังไม่มีข้อมูล"],
  ["ไฟล์ที่เกี่ยวข้องกับ Free Fire", "ไม่สามารถสแกนพื้นที่ส่วนตัวของเกมหรือโฟลเดอร์ระบบได้", "ไม่สามารถตรวจได้"],
  ["ความปลอดภัยอุปกรณ์", "ตรวจสอบได้เฉพาะข้อมูลที่เบราว์เซอร์อนุญาต", "ยังไม่มีข้อมูล"]
];

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

async function api(url, opts = {}) {
  const r = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {})
    },
    ...opts
  });
  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok) throw Error(d.error || "เกิดข้อผิดพลาดในการเชื่อมต่อ");
  return d;
}

function showError(e) {
  return `<div class="notice error">${esc(e.message)}</div>`;
}

function goSeller() {
  if (!SELLER_URL) {
    alert("ลิงก์ร้านค้ายังไม่ได้ตั้งค่า กรุณาติดต่อผู้ขาย");
    return;
  }
  window.open(SELLER_URL, "_blank", "noopener,noreferrer");
}

// หน้าแรก
function home() {
  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">ระบบตรวจสอบความปลอดภัย</div>
      <h1>FF SCAN CENTER</h1>
      <p>ระบบตรวจสอบไฟล์และข้อมูลความปลอดภัยเบื้องต้นของ Android</p>
    </section>

    <section class="card access-card"
      style="border:2px solid #e98ab9;background:#fff0f7;color:#743653">
      <div>
        <div class="iconbox" style="background:#f8d5e7;color:#b63d78">🛡️</div>
        <h2 style="color:#a83d75">สำหรับผู้ใช้งาน</h2>
        <p style="color:#8d6479">กรอก License Key เพื่อเปิดใช้งานระบบตรวจสอบ</p>
        <form id="activateForm">
          <label class="field">
            <span style="color:#874a69">รหัส License Key</span>
            <input id="licenseKey" placeholder="กรอกรหัสคีย์ของคุณ"
              autocapitalize="characters" required>
          </label>
          <button class="btn full" style="background:#d94f91;color:white">
            เข้าใช้งาน
          </button>
        </form>
        <div id="customerMsg"></div>
        <button class="btn full secondary"
          style="margin-top:10px;background:#fff;color:#a83d75;border:1px solid #e9a9c9"
          onclick="goSeller()">🛍️ ซื้อคีย์กับผู้ขาย</button>
      </div>
    </section>
    <div class="notice">
      การตรวจสอบทำงานภายใต้ข้อจำกัดของ Chrome และ Android Browser
      ไฟล์ที่เลือกจะถูกอ่านภายในอุปกรณ์และไม่ถูกส่งขึ้นเซิร์ฟเวอร์
      ระบบไม่สามารถรับรองความปลอดภัยได้ 100%
    </div>

    <section class="card"
      style="margin-top:32px;background:#eeeeF1;border:1px solid #d4d4d9;color:#62626a">
      <div class="row between">
        <div>
          <h2 style="color:#666">ผู้ดูแลระบบ</h2>
          <p style="color:#888;font-size:12px">สำหรับเจ้าของระบบเท่านั้น</p>
        </div>
        <button class="btn small" style="background:#d8d8dd;color:#555"
          onclick="adminLogin()">เข้าสู่ระบบ</button>
      </div>
    </section>
  `;

  document.getElementById("activateForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const deviceId = getDeviceId();
      await api("/api/customer/activate", {
        method: "POST",
        body: JSON.stringify({
          key: document.getElementById("licenseKey").value,
          deviceId
        })
      });
      scanner();
    } catch (err) {
      document.getElementById("customerMsg").innerHTML = showError(err);
    }
  };
}

// ระบบผู้ดูแล
function adminLogin() {
  app.innerHTML = `
    <section class="card formcard">
      <button class="back" onclick="home()">← กลับหน้าหลัก</button>
      <h2 style="margin-top:22px">เข้าสู่ระบบผู้ดูแล</h2>
      <p class="muted">สำหรับเจ้าของ FF SCAN CENTER เท่านั้น</p>
      <form id="loginForm">
        <label class="field">
          <span>รหัสผ่านผู้ดูแลระบบ</span>
          <input id="adminPass" type="password" autocomplete="current-password" required>
        </label>
        <button class="btn full">เข้าสู่ระบบ</button>
      </form>
      <div id="msg"></div>
    </section>
  `;

  document.getElementById("loginForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const d = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({
          password: document.getElementById("adminPass").value
        })
      });
      d.mustChange ? changePassword(true) : adminDashboard();
    } catch (err) {
      document.getElementById("msg").innerHTML = showError(err);
    }
  };
}

function changePassword(force = false) {
  app.innerHTML = `
    <section class="card formcard">
      <h2>เปลี่ยนรหัสผ่านผู้ดูแล</h2>
      <p class="muted">
        ${force ? "เพื่อความปลอดภัย กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน" : "กำหนดรหัสผ่านใหม่"}
      </p>
      <form id="changeForm">
        <label class="field">
          <span>รหัสผ่านปัจจุบัน</span>
          <input id="oldPass" type="password" required>
        </label>
        <label class="field">
          <span>รหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร)</span>
          <input id="newPass" type="password" minlength="12" required>
        </label>
        <button class="btn full">บันทึกรหัสผ่านใหม่</button>
      </form>
      <div id="msg"></div>
    </section>
  `;

  document.getElementById("changeForm").onsubmit = async e => {
    e.preventDefault();
    try {
      await api("/api/admin/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: document.getElementById("oldPass").value,
          newPassword: document.getElementById("newPass").value
        })
      });
      adminDashboard();
    } catch (err) {
      document.getElementById("msg").innerHTML = showError(err);
    }
  };
}

async function adminDashboard() {
  try {
    const [me, data, audit] = await Promise.all([
      api("/api/admin/me"),
      api("/api/admin/licenses"),
      api("/api/admin/audit")
    ]);
    if (me.mustChange) return changePassword(true);
    renderAdmin(data.licenses, audit.events);
  } catch (e) {
    adminLogin();
  }
}
   function renderAdmin(licenses, events) {
  app.innerHTML = `
    <div class="dashboard-head">
      <div>
        <div class="eyebrow">พื้นที่ผู้ดูแลระบบ</div>
        <h1>จัดการระบบ</h1>
        <div class="muted">จัดการรหัสใช้งานและประวัติ</div>
      </div>
      <button class="btn secondary small" onclick="adminLogout()">ออกจากระบบ</button>
    </div>

    <div class="stats">
      <div class="stat"><strong>${licenses.length}</strong><span>คีย์ทั้งหมด</span></div>
      <div class="stat">
        <strong>${licenses.filter(x => x.status === "ACTIVE").length}</strong>
        <span>กำลังใช้งาน</span>
      </div>
      <div class="stat">
        <strong>${licenses.filter(x => x.status === "SUSPENDED").length}</strong>
        <span>ถูกระงับ</span>
      </div>
    </div>

    <section class="card">
      <h2>สร้างรหัส License</h2>
      <div class="row">
        <label class="field" style="flex:1;margin:0">
          <span>ระยะเวลาใช้งาน</span>
          <select id="duration">${durations.map(x => `<option>${x}</option>`).join("")}</select>
        </label>
        <button class="btn" onclick="createLicense()">สร้างคีย์</button>
      </div>
      <div id="createdKey"></div>
    </section>

    <section class="card" style="margin-top:16px">
      <div class="row between">
        <h2>จัดการ License</h2>
        <button class="btn secondary small" onclick="changePassword()">เปลี่ยนรหัสผ่าน</button>
      </div>
      <label class="field">
        <span>ค้นหาด้วยท้ายคีย์หรือ ID</span>
        <input id="searchKey" placeholder="พิมพ์คำค้นหา..." oninput="searchLicenses()">
      </label>
      <div class="tablewrap">
        <table>
          <thead><tr>
            <th>รหัส / คีย์</th><th>ระยะเวลา</th><th>หมดอายุ</th>
            <th>สถานะ</th><th>อุปกรณ์</th><th>จัดการ</th>
          </tr></thead>
          <tbody id="licenseRows">${licenseRows(licenses)}</tbody>
        </table>
      </div>
    </section>

    <section class="card" style="margin-top:16px">
      <h2>ประวัติการใช้งาน</h2>
      <div class="tablewrap">
        <table>
          <thead><tr><th>เหตุการณ์</th><th>License</th><th>รายละเอียด</th><th>เวลา</th></tr></thead>
          <tbody>
            ${events.map(x => `
              <tr>
                <td>${esc(x.action)}</td>
                <td>${esc(x.key_hint || x.license_id || "—")}</td>
                <td>${esc(x.detail || "—")}</td>
                <td>${fmt(x.created_at)}</td>
              </tr>
            `).join("") || "<tr><td colspan='4'>ยังไม่มีประวัติ</td></tr>"}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function fmt(v) {
  return v ? new Date(v).toLocaleString("th-TH") : "ตลอดชีพ";
}

function licenseRows(rows) {
  return rows.map(x => `
    <tr>
      <td>#${x.id}<br><small>••••${esc(x.hint)}</small></td>
      <td>${esc(x.duration)}</td>
      <td>${fmt(x.expiresAt)}</td>
      <td>
        <span class="pill ${
          x.status === "ACTIVE" ? "" :
          x.status === "SUSPENDED" ? "off" : "warn"
        }">
          ${
            x.status === "ACTIVE" ? "ใช้งานได้" :
            x.status === "SUSPENDED" ? "ระงับ" : esc(x.status)
          }
        </span>
      </td>
      <td>${x.deviceBound ? "ผูกแล้ว" : "ยังไม่ผูก"}</td>
      <td>
        <div class="row">
          <button class="btn secondary small"
            onclick="toggleLicense(${x.id},'${x.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED"}')">
            ${x.status === "SUSPENDED" ? "เปิดใช้" : "ระงับ"}
          </button>
          <button class="btn secondary small" onclick="resetDevice(${x.id})">รีเซ็ตอุปกรณ์</button>
        </div>
      </td>
    </tr>
  `).join("") || "<tr><td colspan='6'>ไม่พบ License</td></tr>";
}

async function createLicense() {
  try {
    const d = await api("/api/admin/licenses", {
      method: "POST",
      body: JSON.stringify({
        duration: document.getElementById("duration").value
      })
    });

    const [data, audit] = await Promise.all([
      api("/api/admin/licenses"),
      api("/api/admin/audit")
    ]);

    renderAdmin(data.licenses, audit.events);

    document.getElementById("createdKey").innerHTML = `
      <div class="notice success">
        สร้างคีย์สำเร็จ — จะแสดงครั้งนี้เท่านั้น กรุณาคัดลอกเก็บไว้<br>
        <b>${esc(d.key)}</b><br>
        <button class="btn secondary small" onclick="copyText('${esc(d.key)}')">คัดลอกคีย์</button>
      </div>
    `;
  } catch (e) {
    alert(e.message);
  }
}

async function searchLicenses() {
  try {
    const d = await api(
      "/api/admin/licenses?q=" +
      encodeURIComponent(document.getElementById("searchKey").value)
    );
    document.getElementById("licenseRows").innerHTML = licenseRows(d.licenses);
  } catch (e) {}
}

async function toggleLicense(id, status) {
  try {
    await api(`/api/admin/licenses/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status })
    });
    adminDashboard();
  } catch (e) {
    alert(e.message);
  }
}

async function resetDevice(id) {
  const password = prompt("กรอกรหัสผ่านผู้ดูแลปัจจุบันเพื่อยืนยัน");
  if (!password) return;

  try {
    await api(`/api/admin/licenses/${id}/reset-device`, {
      method: "POST",
      body: JSON.stringify({ password })
    });
    alert("รีเซ็ตการผูกอุปกรณ์แล้ว");
    adminDashboard();
  } catch (e) {
    alert(e.message);
  }
}

async function adminLogout() {
  try {
    await api("/api/admin/logout", { method: "POST" });
  } finally {
    home();
  }
}

// ลูกค้าและเครื่องสแกน
function getDeviceId() {
  let id = localStorage.getItem("ffsc-device-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("ffsc-device-id", id);
  }
  return id;
}

async function scanner() {
  try {
    const session = await api("/api/customer/session");
    renderScanner(session);
  } catch (e) {
    home();
  }
}

function renderScanner(session) {
  stopScanTimers();
  selectedScanFile = null;
  scanStartedAt = null;
  scanStoppedAt = null;
  scanBusy = false;
  scanLog = [];

  app.innerHTML = `
    <div class="dashboard-head">
      <div>
        <div class="eyebrow">พื้นที่ผู้ใช้งาน</div>
        <h1>ภาพรวมความปลอดภัย</h1>
        <div class="muted">License: ${esc(session.duration)} • หมดอายุ: ${fmt(session.expiresAt)}</div>
      </div>
      <button class="btn secondary small" onclick="customerLogout()">ออกจากระบบ</button>
    </div>

    <section class="card" style="border:2px solid #e98ab9;background:#fff7fb">
      <div class="eyebrow">CONTINUOUS FILE CHECK</div>
      <h2>ตรวจสอบไฟล์ต่อเนื่อง</h2>
      <p class="muted">ระบบจะอ่านไฟล์ที่คุณเลือกซ้ำทุก 5 วินาที จนกดหยุด</p>
      <div class="stats" style="margin:14px 0">
        <div class="stat"><span>เวลาเริ่ม</span><strong id="scanStartTime" style="font-size:16px">—</strong></div>
        <div class="stat"><span>เวลาที่สแกน</span><strong id="scanElapsed" style="font-size:22px">00:00:00</strong></div>
        <div class="stat"><span>เวลาหยุด</span><strong id="scanStopTime" style="font-size:16px">—</strong></div>
      </div>
      <div class="row" style="gap:10px;margin-top:14px">
        <button id="scanStartBtn" class="btn scan-button" onclick="startScan()" style="flex:1">▶ เริ่มสแกน</button>
        <button id="scanStopBtn" class="btn secondary" onclick="stopScan()" style="flex:1" disabled>■ หยุดสแกน</button>
      </div>
      <div id="scanStatus" class="notice" style="margin-top:12px">ยังไม่ได้เริ่มสแกน</div>
      <div id="scanResult" style="margin-top:12px">
        <span class="pill" style="background:#e7f8ed;color:#18743b">ไม่พบไฟล์</span>
      </div>
      <div id="scanSummary" class="muted" style="margin-top:10px">ระยะเวลารวมจะแสดงเมื่อหยุดสแกน</div>
    </section>

    <section class="card">
      <h2>เลือกไฟล์เพื่อตรวจสอบ</h2>
      <p class="muted">เลือกไฟล์จากอุปกรณ์เพื่อคำนวณ SHA-256 ภายในเบราว์เซอร์ ไฟล์ไม่ถูกอัปโหลด</p>
      <input id="fileInput" type="file" class="hidden" accept="*/*">
      <button id="chooseFileBtn" class="btn secondary" onclick="document.getElementById('fileInput').click()">เลือกไฟล์</button>
      <div id="fileInfo" class="filemeta detail">ยังไม่ได้เลือกไฟล์</div>
    </section>

    <section class="card">
      <div class="row between"><h2>ผลการตรวจแบบ Real-time</h2><span class="muted">บันทึกล่าสุดก่อน</span></div>
      <div id="scanLog" class="muted">ยังไม่มีรายการตรวจสอบ</div>
    </section>
    <div class="row between"><h2>รายการตรวจสอบอุปกรณ์</h2><span class="muted">10 รายการ</span></div>
    <div class="checks">
      ${checks.map((c, i) => `
        <button class="check unknown" onclick="showCheck(${i})">
          <strong>${esc(c[0])}</strong><span>${esc(c[2])}</span>
        </button>
      `).join("")}
    </div>
    <div class="notice">ข้อจำกัด: เว็บไม่สามารถสแกนไฟล์ทั้งหมดใน Android หรือเฝ้าดูการเปลี่ยนแปลงของไฟล์ต้นฉบับได้ การตรวจซ้ำนี้อ่านข้อมูลจากไฟล์ชุดเดิมที่เลือกไว้ในรอบนั้น และ SHA-256 ไม่ใช่ผลยืนยันว่าปลอดภัยหรือเป็นมัลแวร์</div>
    <div id="modalRoot"></div>
  `;

  document.getElementById("fileInput").addEventListener("change", handleFile);
}

function formatClock(date) {
  return date.toLocaleTimeString("th-TH", { hour12: false });
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const sec = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

function stopScanTimers() {
  if (scanTimerId) clearInterval(scanTimerId);
  if (scanCycleId) clearInterval(scanCycleId);
  scanTimerId = null;
  scanCycleId = null;
}

function addScanLog(message, kind = "info") {
  const time = formatClock(new Date());
  scanLog.unshift({ time, message, kind });
  scanLog = scanLog.slice(0, 30);
  const box = document.getElementById("scanLog");
  if (!box) return;
  box.innerHTML = scanLog.map(item => `
    <div style="padding:9px 0;border-bottom:1px solid #eee">
      <small>${esc(item.time)}</small> — ${esc(item.message)}
    </div>
  `).join("");
}

async function inspectSelectedFile() {
  if (!selectedScanFile || scanBusy) return;
  scanBusy = true;
  const result = document.getElementById("scanResult");
  const status = document.getElementById("scanStatus");
  try {
    if (!crypto.subtle) throw Error("เบราว์เซอร์ไม่รองรับ Web Crypto API หรือไม่ได้ใช้งานผ่าน HTTPS");
    const buffer = await selectedScanFile.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
    if (result) result.innerHTML = `<span class="pill" style="background:#fff0f0;color:#b42335">พบไฟล์</span><div class="muted" style="margin-top:8px">${esc(selectedScanFile.name)} • SHA-256: <code>${hash}</code></div>`;
    if (status) status.textContent = "กำลังตรวจไฟล์ที่เลือกซ้ำทุก 5 วินาที";
    addScanLog(`พบไฟล์ที่เลือก: ${selectedScanFile.name} — คำนวณ SHA-256 แล้ว`, "found");
  } catch (err) {
    if (result) result.innerHTML = `<span class="pill off">ตรวจไฟล์ไม่สำเร็จ</span>`;
    if (status) status.textContent = err.message;
    addScanLog(`เกิดข้อผิดพลาด: ${err.message}`, "error");
  } finally {
    scanBusy = false;
  }
}

async function startScan() {
  if (scanTimerId || scanCycleId) return;
  if (!selectedScanFile) {
    alert("กรุณาเลือกไฟล์ก่อนเริ่มสแกน");
    return;
  }

  scanStartedAt = new Date();
  scanStoppedAt = null;
  scanLog = [];
  document.getElementById("scanStartTime").textContent = formatClock(scanStartedAt);
  document.getElementById("scanStopTime").textContent = "—";
  document.getElementById("scanElapsed").textContent = "00:00:00";
  document.getElementById("scanSummary").textContent = "กำลังสแกน...";
  document.getElementById("scanStartBtn").disabled = true;
  document.getElementById("scanStopBtn").disabled = false;
  document.getElementById("chooseFileBtn").disabled = true;
  document.getElementById("scanStatus").textContent = "เริ่มสแกนแล้ว";
  addScanLog("เริ่มการตรวจสอบ", "info");

  await inspectSelectedFile();
  scanTimerId = setInterval(() => {
    const elapsed = Date.now() - scanStartedAt.getTime();
    const timer = document.getElementById("scanElapsed");
    if (timer) timer.textContent = formatElapsed(elapsed);
  }, 1000);
  scanCycleId = setInterval(inspectSelectedFile, 5000);
}

function stopScan() {
  if (!scanStartedAt || (!scanTimerId && !scanCycleId)) return;
  scanStoppedAt = new Date();
  stopScanTimers();
  document.getElementById("scanElapsed").textContent = formatElapsed(scanStoppedAt - scanStartedAt);
  document.getElementById("scanStopTime").textContent = formatClock(scanStoppedAt);
  document.getElementById("scanSummary").textContent = `เริ่ม ${formatClock(scanStartedAt)} • หยุด ${formatClock(scanStoppedAt)} • รวม ${formatElapsed(scanStoppedAt - scanStartedAt)}`;
  document.getElementById("scanStatus").textContent = "หยุดการสแกนแล้ว";
  document.getElementById("scanStartBtn").disabled = false;
  document.getElementById("scanStopBtn").disabled = true;
  document.getElementById("chooseFileBtn").disabled = false;
  addScanLog("หยุดการตรวจสอบ", "info");
}

function showCheck(i) {
  const c = checks[i];

  document.getElementById("modalRoot").innerHTML = `
    <div class="modal" onclick="if(event.target===this)this.innerHTML=''">
      <section class="card">
        <div class="row between">
          <h2>${esc(c[0])}</h2>
          <button class="back"
            onclick="document.getElementById('modalRoot').innerHTML=''">ปิด ✕</button>
        </div>
        <span class="pill warn">${esc(c[2])}</span>
        <h3 style="font-size:13px;margin-top:20px">ตรวจสอบอะไร</h3>
        <p class="muted">${esc(c[1])}</p>
        <h3 style="font-size:13px">ผลการตรวจ</h3>
        <p class="muted">
          ${c[2] === "ไม่สามารถตรวจได้"
            ? "เบราว์เซอร์ไม่มีความสามารถที่จำเป็นสำหรับการตรวจรายการนี้"
            : "ยังไม่มีข้อมูลเพียงพอที่จะสรุปผลการตรวจ"}
        </p>
        <h3 style="font-size:13px">ข้อจำกัด</h3>
        <p class="muted">
          การตรวจผ่านเว็บมีขอบเขตจำกัด
          ไม่สามารถแทนที่แอปตรวจสอบความปลอดภัยที่ทำงานบน Android โดยตรงได้
        </p>
      </section>
    </div>
  `;
}

async function handleFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  selectedScanFile = f;
  const out = document.getElementById("fileInfo");
  out.textContent = "กำลังอ่านไฟล์และคำนวณ SHA-256...";

  try {
    if (!crypto.subtle) throw Error("เบราว์เซอร์ไม่รองรับ Web Crypto API หรือไม่ได้ใช้งานผ่าน HTTPS");
    const digest = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
    const hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
    out.innerHTML = `<div class="notice success"><b>เลือกไฟล์สำเร็จ</b><br>ชื่อไฟล์: ${esc(f.name)}<br>ขนาด: ${esc(formatBytes(f.size))}<br>ประเภท: ${esc(f.type || "ไม่ระบุประเภท")}<br>SHA-256:<br><code>${hash}</code><br><small>คำนวณในอุปกรณ์ ไม่ได้อัปโหลดไฟล์</small></div>`;
    const result = document.getElementById("scanResult");
    if (result) result.innerHTML = `<span class="pill" style="background:#fff0f0;color:#b42335">พบไฟล์</span><div class="muted" style="margin-top:8px">${esc(f.name)}</div>`;
  } catch (err) {
    out.innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
  }
}

function formatBytes(n) {
  if (n === 0) return "0 Bytes";
  const u = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return (n / Math.pow(1024, i)).toFixed(2) + " " + u[i];
}

async function customerLogout() {
  try {
    await api("/api/customer/logout", { method: "POST" });
  } finally {
    home();
  }
}

function copyText(s) {
  if (!navigator.clipboard) {
    alert("เบราว์เซอร์ไม่รองรับการคัดลอกอัตโนมัติ");
    return;
  }
  navigator.clipboard.writeText(s)
    .then(() => alert("คัดลอกแล้ว"))
    .catch(() => alert("ไม่สามารถคัดลอกได้"));
}

// เริ่มต้นระบบ
(async () => {
  try {
    const a = await api("/api/admin/me");
    if (a.mustChange) return changePassword(true);
    return adminDashboard();
  } catch {}

  try {
    await api("/api/customer/session");
    return scanner();
  } catch {}

  home();
})();
