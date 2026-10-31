JavaScript

"use strict";

/* =========================================================
   FF SCAN CENTER
   Frontend: Thai UI
   Customer: Check key -> Confirm activation
   Admin: Login -> Dashboard -> License management
   ========================================================= */

const app = document.getElementById("app");
const SELLER_URL = ""; // ใส่ลิงก์ร้านค้าภายหลัง
const DEVICE_STORAGE_KEY = "ffsc-device-id";

const durations = [
  { value: "3 ชั่วโมง", label: "3 ชั่วโมง" },
  { value: "6 ชั่วโมง", label: "6 ชั่วโมง" },
  { value: "1 วัน", label: "1 วัน" },
  { value: "7 วัน", label: "7 วัน" },
  { value: "30 วัน", label: "30 วัน" },
  { value: "90 วัน", label: "90 วัน" },
  { value: "180 วัน", label: "180 วัน" },
  { value: "Lifetime", label: "ตลอดชีพ" }
];

let currentPage = "home";
let checkedLicense = null;
let adminData = null;
let licenseRows = [];
let auditRows = [];
let searchTimer = null;

/* =========================================================
   UTILITIES
   ========================================================= */

function $(id) {
  return document.getElementById(id);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_STORAGE_KEY);

  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : "ffsc-" + Date.now() + "-" +
        Math.random().toString(36).slice(2);

    localStorage.setItem(DEVICE_STORAGE_KEY, id);
  }

  return id;
}

async function api(url, options = {}) {
  const config = {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  };

  if (options.body !== undefined) {
    config.body = JSON.stringify(options.body);
  }

  let response;

  try {
    response = await fetch(url, config);
  } catch {
    throw new Error("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่");
  }

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `เกิดข้อผิดพลาด (${response.status})`
    );
  }

  return data;
}

function notify(message, type = "info") {
  const old = $("toast");
  if (old) old.remove();

  const toast = document.createElement("div");
  toast.id = "toast";
  toast.className = "ff-toast " + type;
  toast.textContent = message;

  document.body.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 3500);
}

function setLoading(button, loading, text = "กำลังดำเนินการ...") {
  if (!button) return;

  if (loading) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }

    button.disabled = true;
    button.textContent = text;
  } else {
    button.disabled = false;

    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function durationLabel(value) {
  const found = durations.find(item => item.value === value);

  if (found) return found.label;

  return value || "ไม่ระบุ";
}

function expiryLabel(row) {
  if (!row) return "—";

  if (row.expiresAt) {
    return formatDate(row.expiresAt);
  }

  if (row.activatedAt) {
    return row.duration === "Lifetime"
      ? "ตลอดชีพ"
      : "ไม่พบวันหมดอายุ";
  }

  return row.duration === "Lifetime"
    ? "ยังไม่เปิดใช้งาน"
    : "ยังไม่เริ่มนับเวลา";
}

function statusLabel(status) {
  const labels = {
    ACTIVE: "ปกติ",
    SUSPENDED: "ระงับ",
    EXPIRED: "หมดอายุ"
  };

  return labels[status] || status || "ไม่ทราบสถานะ";
}

function statusClass(status) {
  if (status === "ACTIVE") return "success";
  if (status === "SUSPENDED") return "danger";
  return "muted";
}

function showError(error, fallback) {
  notify(error?.message || fallback, "error");
}

/* =========================================================
   STYLES
   ========================================================= */

function addStyles() {
  if ($("ffsc-styles")) return;

  const style = document.createElement("style");
  style.id = "ffsc-styles";

  style.textContent = `
    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: #fff7fb;
      color: #29232a;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    }

    button, input, select { font: inherit; }

    button:focus-visible,
    input:focus-visible,
    select:focus-visible {
      outline: 3px solid #e83c9140;
      outline-offset: 2px;
    }

    .ff-wrap {
      width: min(960px, 100%);
      margin: 0 auto;
      padding: 18px 14px 45px;
    }

    .ff-header {
      text-align: center;
      padding: 22px 12px;
    }

    .ff-logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 62px;
      height: 62px;
      border-radius: 20px;
      background: linear-gradient(135deg, #ff75b5, #e83c91);
      color: white;
      font-size: 27px;
      font-weight: 900;
      box-shadow: 0 8px 24px #e83c9130;
    }

    .ff-header h1 {
      margin: 12px 0 5px;
      font-size: clamp(24px, 5vw, 32px);
      color: #d92f83;
    }

    .ff-header p {
      color: #806b78;
      margin: 0;
      font-size: 14px;
    }

    .ff-card {
      background: white;
      border: 1px solid #f4d9e7;
      border-radius: 20px;
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: 0 8px 28px #8f41600b;
    }

    .ff-customer {
      border: 2px solid #f3a6cb;
      box-shadow: 0 12px 32px #df4e9217;
    }

    .ff-customer-title {
      color: #d92f83;
      font-size: 21px;
      font-weight: 800;
      margin: 0 0 6px;
    }

    .ff-subtitle {
      color: #806b78;
      font-size: 13px;
      margin: 0 0 18px;
      line-height: 1.6;
    }

    .ff-label {
      display: block;
      font-size: 14px;
      font-weight: 700;
      margin: 13px 0 7px;
    }

    .ff-input, .ff-select {
      width: 100%;
      border: 1px solid #e5d5de;
      border-radius: 12px;
      background: #fff;
      padding: 13px 14px;
      outline: none;
      min-height: 48px;
      color: #29232a;
    }

    .ff-input:focus, .ff-select:focus {
      border-color: #e83c91;
      box-shadow: 0 0 0 3px #e83c9118;
    }

    .ff-btn {
      display: inline-flex;
      justify-content: center;
      align-items: center;
      gap: 7px;
      border: 0;
      border-radius: 12px;
      padding: 12px 16px;
      min-height: 46px;
      font-weight: 750;
      cursor: pointer;
      text-decoration: none;
      transition: .15s;
    }

    .ff-btn:disabled {
      opacity: .55;
      cursor: not-allowed;
    }

    .ff-btn-primary {
      color: white;
      background: linear-gradient(135deg, #f36eaa, #d92f83);
    }

    .ff-btn-primary:active {
      transform: scale(.98);
    }

    .ff-btn-secondary {
      background: #fff0f7;
      color: #c72b78;
      border: 1px solid #f4c4dc;
    }

    .ff-btn-neutral {
      background: #f0eef0;
      color: #514951;
    }

    .ff-btn-danger {
      background: #fff0f0;
      color: #c43d3d;
    }

    .ff-btn-block { width: 100%; }

    .ff-button-row {
      display: flex;
      flex-wrap: wrap;
      gap: 9px;
      margin-top: 14px;
    }

    .ff-button-row > * { flex: 1; }

    .ff-notice {
      padding: 12px 14px;
      border-radius: 12px;
      background: #fff5fa;
      border: 1px solid #f4d5e5;
      color: #78556a;
      font-size: 13px;
      line-height: 1.65;
      margin-top: 14px;
    }

    .ff-notice.warning {
      background: #fff9e9;
      border-color: #f3e0a8;
      color: #795b16;
    }

    .ff-notice.success {
      background: #effaf3;
      border-color: #ccebd6;
      color: #28623b;
    }

    .ff-divider {
      height: 1px;
      background: #eee8ec;
      margin: 20px 0;
    }

    .ff-admin {
      border: 1px solid #e7e3e7;
      background: #faf9fa;
      box-shadow: none;
    }

    .ff-admin h2 {
      color: #625a63;
      font-size: 17px;
      margin: 0 0 6px;
    }

    .ff-small {
      color: #857b85;
      font-size: 12px;
      line-height: 1.6;
    }

    .ff-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .ff-section-title {
      font-size: 18px;
      font-weight: 800;
      margin: 0 0 14px;
    }

    .ff-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
      gap: 10px;
    }

    .ff-stat {
      border-radius: 13px;
      background: #faf5f8;
      padding: 13px;
      border: 1px solid #f0e5eb;
    }

    .ff-stat strong {
      display: block;
      font-size: 21px;
      margin-top: 5px;
    }

    .ff-table-wrap {
      width: 100%;
      overflow-x: auto;
    }

    .ff-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      min-width: 650px;
    }

    .ff-table th, .ff-table td {
      padding: 11px 9px;
      border-bottom: 1px solid #eee8ec;
      text-align: left;
      vertical-align: middle;
    }

    .ff-table th {
      color: #796d77;
      background: #faf7f9;
    }

    .ff-badge {
      display: inline-block;
      padding: 4px 9px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 800;
      background: #f0eef0;
      color: #625a63;
    }

    .ff-badge.success {
      background: #e8f8ed;
      color: #24723e;
    }

    .ff-badge.danger {
      background: #ffeded;
      color: #bd3434;
    }

    .ff-badge.muted {
      background: #f0eef0;
      color: #625a63;
    }

    .ff-key {
      overflow-wrap: anywhere;
      font-weight: 800;
      letter-spacing: .5px;
      color: #c52b79;
      font-size: 18px;
    }

    .ff-toast {
      position: fixed;
      z-index: 9999;
      left: 50%;
      bottom: 22px;
      transform: translateX(-50%);
      width: max-content;
      max-width: calc(100% - 28px);
      padding: 12px 17px;
      border-radius: 12px;
      color: white;
      background: #514751;
      box-shadow: 0 8px 25px #0002;
      font-size: 14px;
    }

    .ff-toast.success { background: #267b48; }
    .ff-toast.error { background: #b83d48; }

    .ff-check-item {
      display: flex;
      gap: 10px;
      padding: 12px 0;
      border-bottom: 1px solid #f0e9ed;
      font-size: 14px;
      line-height: 1.6;
    }

    .ff-check-icon {
      color: #d92f83;
      font-weight: 900;
    }

    .ff-footer {
      text-align: center;
      color: #a0929c;
      font-size: 11px;
      padding: 12px;
    }

    .ff-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .ff-actions .ff-btn {
      min-height: 36px;
      padding: 7px 10px;
      font-size: 12px;
    }

    .ff-empty {
      text-align: center;
      color: #958995;
      padding: 22px 10px;
      font-size: 13px;
    }

    @media (max-width: 520px) {
      .ff-card {
        padding: 16px;
        border-radius: 16px;
      }

      .ff-button-row {
        flex-direction: column;
      }

      .ff-button-row > * {
        width: 100%;
      }
    }
  `;

  document.head.appendChild(style);
}

function render(content) {
  app.innerHTML = `
    <main class="ff-wrap">
      <header class="ff-header">
        <div class="ff-logo">FF</div>
        <h1>FF SCAN CENTER</h1>
        <p>ระบบตรวจสอบและจัดการสิทธิ์การใช้งาน</p>
      </header>

      ${content}

      <footer class="ff-footer">FF SCAN CENTER</footer>
    </main>
  `;
}

/* =========================================================
   HOME
   ========================================================= */

function home() {
  currentPage = "home";
  checkedLicense = null;

  render(`
    <section class="ff-card ff-customer">
      <h2 class="ff-customer-title">สำหรับลูกค้า</h2>

      <p class="ff-subtitle">
        กรอก License Key เพื่อตรวจสอบสิทธิ์ก่อนเปิดใช้งาน
      </p>

      <label class="ff-label" for="customer-key">
        License Key
      </label>

      <input
        id="customer-key"
        class="ff-input"
        type="text"
        placeholder="กรอกคีย์ของคุณ"
        autocomplete="off"
        autocapitalize="characters"
      >

      <div class="ff-button-row">
        <button
          class="ff-btn ff-btn-primary ff-btn-block"
          id="check-key-btn"
        >
          ตรวจสอบคีย์
        </button>
      </div>

      <div class="ff-button-row">
        <button
          class="ff-btn ff-btn-secondary ff-btn-block"
          id="seller-btn"
        >
          ซื้อคีย์กับผู้ขาย
        </button>
      </div>

      <div class="ff-notice">
        <strong>หมายเหตุ:</strong>
        การตรวจสอบคีย์ยังไม่เริ่มนับเวลา
        ระบบจะเริ่มนับเวลาเมื่อคุณกดยืนยันเปิดใช้งานเท่านั้น
      </div>
    </section>

    <section class="ff-card ff-admin">
      <h2>ผู้ดูแลระบบ</h2>
      <p class="ff-small">
        ส่วนจัดการระบบสำหรับผู้ดูแลเท่านั้น
      </p>

      <button
        class="ff-btn ff-btn-neutral"
        id="admin-login-open"
      >
        เข้าสู่ระบบผู้ดูแล
      </button>
    </section>
  `);

  $("check-key-btn").onclick = checkCustomerKey;

  $("customer-key").addEventListener("keydown", event => {
    if (event.key === "Enter") checkCustomerKey();
  });

  $("seller-btn").onclick = () => {
    if (SELLER_URL) {
      window.open(SELLER_URL, "_blank", "noopener,noreferrer");
    } else {
      notify("ยังไม่ได้ตั้งค่าลิงก์ผู้ขาย", "info");
    }
  };

  $("admin-login-open").onclick = adminLoginPage;
}

/* =========================================================
   CUSTOMER: CHECK KEY
   ========================================================= */

async function checkCustomerKey() {
  const input = $("customer-key");
  const button = $("check-key-btn");
  const key = normalizeKey(input?.value);

  if (!key) {
    notify("กรุณากรอก License Key", "error");
    input?.focus();
    return;
  }

  setLoading(button, true, "กำลังตรวจสอบ...");

  try {
    const result = await api("/api/customer/check-key", {
      method: "POST",
      body: {
        key,
        deviceId: getDeviceId()
      }
    });

    checkedLicense = {
      key,
      duration: result.duration,
      expiresAt: result.expiresAt || null,
      activatedAt: result.activatedAt || null,
      activated: Boolean(
        result.activated ||
        result.activatedAt ||
        result.expiresAt
      )
    };

    customerConfirmPage(result);
  } catch (error) {
    showError(error, "ตรวจสอบคีย์ไม่สำเร็จ");
    setLoading(button, false);
  }
}

/* =========================================================
   CUSTOMER: CONFIRM PAGE
   ========================================================= */

function customerConfirmPage(result) {
  currentPage = "customer-confirm";

  const activated = Boolean(
    result.activated ||
    result.activatedAt ||
    result.expiresAt
  );

  const expiryText = result.expiresAt
    ? formatDate(result.expiresAt)
    : (
        result.duration === "Lifetime"
          ? "ตลอดชีพ"
          : "ยังไม่เริ่มนับเวลา"
      );

  render(`
    <section class="ff-card ff-customer">
      <h2 class="ff-customer-title">
        ตรวจสอบคีย์สำเร็จ
      </h2>

      <p class="ff-subtitle">
        กรุณาตรวจสอบรายละเอียดก่อนดำเนินการต่อ
      </p>

      <div class="ff-notice success">
        ระบบตรวจพบ License Key และสามารถอ่านข้อมูลสิทธิ์ได้
      </div>

      <div class="ff-divider"></div>

      <div class="ff-row">
        <span class="ff-small">ระยะเวลาคีย์</span>
        <strong>${escapeHTML(durationLabel(result.duration))}</strong>
      </div>

      <div class="ff-divider"></div>

      <div class="ff-row">
        <span class="ff-small">วันหมดอายุ</span>
        <strong>${escapeHTML(expiryText)}</strong>
      </div>

      <div class="ff-divider"></div>

      ${
        activated
          ? `
            <div class="ff-notice warning">
              <strong>คีย์นี้เคยเปิดใช้งานแล้ว</strong><br>
              การเปิดใช้งานซ้ำจะไม่เริ่มนับเวลาใหม่
              และระบบจะยึดวันหมดอายุเดิม
            </div>
          `
          : `
            <div class="ff-notice">
              <strong>คีย์นี้ยังไม่เริ่มนับเวลา</strong><br>
              เวลาจะเริ่มนับเมื่อคุณกดปุ่มยืนยันเปิดใช้งานด้านล่าง
              การตรวจสอบในขั้นตอนนี้ไม่ได้เริ่มนับเวลา
            </div>
          `
      }

      <div class="ff-button-row">
        <button
          class="ff-btn ff-btn-primary ff-btn-block"
          id="confirm-activate-btn"
        >
          ยืนยันเปิดใช้งาน
        </button>

        <button
          class="ff-btn ff-btn-neutral ff-btn-block"
          id="cancel-activate-btn"
        >
          ยกเลิก
        </button>
      </div>
    </section>
  `);

  $("confirm-activate-btn").onclick = confirmCustomerActivation;
  $("cancel-activate-btn").onclick = home;
}

/* =========================================================
   CUSTOMER: ACTIVATE
   ========================================================= */

async function confirmCustomerActivation() {
  if (!checkedLicense?.key) {
    notify("ไม่พบข้อมูลคีย์ กรุณาตรวจสอบใหม่", "error");
    home();
    return;
  }

  const button = $("confirm-activate-btn");

  setLoading(button, true, "กำลังเปิดใช้งาน...");

  try {
    await api("/api/customer/activate", {
      method: "POST",
      body: {
        key: checkedLicense.key,
        deviceId: getDeviceId()
      }
    });

    checkedLicense = null;

    notify("เปิดใช้งานสำเร็จ", "success");

    await scannerPage();
  } catch (error) {
    showError(error, "เปิดใช้งานไม่สำเร็จ");
    setLoading(button, false);
  }
}

/* =========================================================
   CUSTOMER: SCANNER
   ========================================================= */

async function scannerPage() {
  currentPage = "scanner";

  let session;

  try {
    session = await api("/api/customer/session");
  } catch {
    home();
    notify("กรุณาตรวจสอบและเปิดใช้งานคีย์ก่อน", "error");
    return;
  }

  render(`
    <section class="ff-card ff-customer">
      <div class="ff-row">
        <h2 class="ff-customer-title">ศูนย์ตรวจสอบ</h2>
        <span class="ff-badge success">เข้าสู่ระบบแล้ว</span>
      </div>

      <p class="ff-subtitle">
        ตรวจสอบข้อมูลที่คุณเลือกและแสดงผลเบื้องต้นบนอุปกรณ์นี้
      </p>

      <div class="ff-grid">
        <div class="ff-stat">
          <span class="ff-small">ระยะเวลาคีย์</span>
          <strong>${escapeHTML(durationLabel(session.duration))}</strong>
        </div>

        <div class="ff-stat">
          <span class="ff-small">วันหมดอายุ</span>
          <strong style="font-size:14px">
            ${
              escapeHTML(
                session.expiresAt
                  ? formatDate(session.expiresAt)
                  : "ตลอดชีพ"
              )
            }
          </strong>
        </div>
      </div>

      <div class="ff-divider"></div>

      <h3 class="ff-section-title">รายการตรวจสอบ</h3>

      <div class="ff-check-item">
        <span class="ff-check-icon">✓</span>
        <span>ตรวจสอบไฟล์ที่ผู้ใช้เลือกและคำนวณค่า SHA-256</span>
      </div>

      <div class="ff-check-item">
        <span class="ff-check-icon">✓</span>
        <span>แสดงข้อมูลพื้นฐานของไฟล์ที่เลือก</span>
      </div>

      <div class="ff-check-item">
        <span class="ff-check-icon">✓</span>
        <span>แสดงข้อควรระวังเกี่ยวกับความปลอดภัยของอุปกรณ์</span>
      </div>

      <div class="ff-notice w
arning">
        <strong>ข้อจำกัดที่ควรทราบ</strong><br>
        เว็บนี้ไม่สามารถตรวจ Root, VPN, Shizuku,
        แอปที่ติดตั้งทั้งหมด, สิทธิ์ของแอปอื่น
        หรือไฟล์ส่วนตัวภายในเกมได้โดยตรง
        และการคำนวณ SHA-256 ไม่ใช่การตรวจจับมัลแวร์
      </div>

      <div class="ff-button-row">
        <button
          class="ff-btn ff-btn-primary ff-btn-block"
          id="select-file-btn"
        >
          เลือกไฟล์เพื่อตรวจสอบ
        </button>

        <button
          class="ff-btn ff-btn-secondary ff-btn-block"
          id="run-info-btn"
        >
          ดูรายการตรวจสอบ
        </button>
      </div>

      <input type="file" id="file-input" hidden>

      <div id="file-result"></div>
      <div id="scan-result"></div>

      <div class="ff-divider"></div>

      <button
        class="ff-btn ff-btn-neutral ff-btn-block"
        id="customer-logout-btn"
      >
        ออกจากระบบลูกค้า
      </button>
    </section>
  `);

  $("select-file-btn").onclick = () => $("file-input").click();
  $("file-input").onchange = handleFile;
  $("run-info-btn").onclick = showCheck;
  $("customer-logout-btn").onclick = customerLogout;
}

/* =========================================================
   FILE CHECK
   ========================================================= */

async function handleFile(event) {
  const file = event.target.files?.[0];
  const resultBox = $("file-result");

  if (!file || !resultBox) return;

  resultBox.innerHTML = `
    <div class="ff-notice">กำลังอ่านข้อมูลไฟล์...</div>
  `;

  try {
    if (!crypto.subtle) {
      throw new Error("เบราว์เซอร์นี้ไม่รองรับการคำนวณ SHA-256");
    }

    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);

    const hash = Array.from(new Uint8Array(digest))
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");

    resultBox.innerHTML = `
      <div class="ff-card" style="margin-top:16px">
        <h3 class="ff-section-title">ผลการอ่านไฟล์</h3>

        <div class="ff-small">ชื่อไฟล์</div>
        <strong>${escapeHTML(file.name)}</strong>

        <div class="ff-divider"></div>

        <div class="ff-small">ขนาดไฟล์</div>
        <strong>${escapeHTML(formatBytes(file.size))}</strong>

        <div class="ff-divider"></div>

        <div class="ff-small">ประเภทไฟล์</div>
        <strong>${escapeHTML(file.type || "ไม่ระบุ")}</strong>

        <div class="ff-divider"></div>

        <div class="ff-small">SHA-256</div>
        <div class="ff-key">${escapeHTML(hash)}</div>

        <div class="ff-notice warning">
          ค่า SHA-256 ใช้ระบุความแตกต่างของข้อมูลไฟล์
          ไม่ได้ยืนยันว่าไฟล์ปลอดภัยหรือปราศจากมัลแวร์
        </div>

        <button
          class="ff-btn ff-btn-secondary ff-btn-block"
          id="copy-hash-btn"
          style="margin-top:12px"
        >
          คัดลอก SHA-256
        </button>
      </div>
    `;

    $("copy-hash-btn").onclick = async () => {
      try {
        await navigator.clipboard.writeText(hash);
        notify("คัดลอก SHA-256 แล้ว", "success");
      } catch {
        notify("ไม่สามารถคัดลอกได้", "error");
      }
    };
  } catch (error) {
    resultBox.innerHTML = `
      <div class="ff-notice warning">
        ${escapeHTML(error.message || "ไม่สามารถอ่านไฟล์ได้")}
      </div>
    `;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "ไม่ทราบขนาด";

  if (bytes < 1024) return bytes + " B";

  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(2) + " KB";
  }

  if (bytes < 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function showCheck() {
  const box = $("scan-result");
  if (!box) return;

  box.innerHTML = `
    <div class="ff-card" style="margin-top:16px">
      <h3 class="ff-section-title">รายการตรวจสอบของระบบ</h3>

      <div class="ff-check-item">
        <span class="ff-check-icon">✓</span>
        <span>การเชื่อมต่อหน้าเว็บกับระบบเซิร์ฟเวอร์</span>
      </div>

      <div class="ff-check-item">
        <span class="ff-check-icon">✓</span>
        <span>การตรวจสอบสิทธิ์ License Key</span>
      </div>

      <div class="ff-check-item">
        <span class="ff-check-icon">✓</span>
        <span>การอ่านไฟล์ที่ผู้ใช้เลือก</span>
      </div>

      <div class="ff-check-item">
        <span class="ff-check-icon">✓</span>
        <span>การคำนวณค่า SHA-256</span>
      </div>

      <div class="ff-notice">
        รายการนี้เป็นการแสดงความสามารถของหน้าเว็บ
        ไม่ใช่ผลการตรวจความปลอดภัยทั้งหมดของโทรศัพท์
      </div>
    </div>
  `;

  box.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}

async function customerLogout() {
  try {
    await api("/api/customer/logout", {
      method: "POST"
    });
  } catch (error) {
    showError(error, "ออกจากระบบไม่สำเร็จ");
    return;
  }

  checkedLicense = null;
  home();
  notify("ออกจากระบบลูกค้าแล้ว", "success");
}

/* =========================================================
   ADMIN LOGIN
   ========================================================= */

function adminLoginPage() {
  currentPage = "admin-login";

  render(`
    <section class="ff-card ff-admin">
      <h2>เข้าสู่ระบบผู้ดูแล</h2>
      <p class="ff-small">
        กรุณากรอกรหัสผ่านผู้ดูแลระบบ
      </p>

      <label class="ff-label" for="admin-password">
        รหัสผ่าน
      </label>

      <input
        id="admin-password"
        class="ff-input"
        type="password"
        autocomplete="current-password"
        placeholder="กรอกรหัสผ่านผู้ดูแล"
      >

      <div class="ff-button-row">
        <button
          class="ff-btn ff-btn-neutral ff-btn-block"
          id="admin-login-btn"
        >
          เข้าสู่ระบบ
        </button>

        <button
          class="ff-btn ff-btn-secondary ff-btn-block"
          id="admin-login-back"
        >
          กลับหน้าหลัก
        </button>
      </div>
    </section>
  `);

  $("admin-login-btn").onclick = adminLogin;

  $("admin-password").addEventListener("keydown", event => {
    if (event.key === "Enter") adminLogin();
  });

  $("admin-login-back").onclick = home;
}

async function adminLogin() {
  const passwordInput = $("admin-password");
  const button = $("admin-login-btn");
  const password = passwordInput?.value || "";

  if (!password) {
    notify("กรุณากรอกรหัสผ่าน", "error");
    passwordInput?.focus();
    return;
  }

  setLoading(button, true, "กำลังเข้าสู่ระบบ...");

  try {
    await api("/api/admin/login", {
      method: "POST",
      body: { password }
    });

    passwordInput.value = "";
    notify("เข้าสู่ระบบสำเร็จ", "success");

    await adminDashboard();
  } catch (error) {
    showError(error, "เข้าสู่ระบบไม่สำเร็จ");
    setLoading(button, false);
  }
}

/* =========================================================
   ADMIN DASHBOARD
   ========================================================= */

async function adminDashboard() {
  currentPage = "admin";

  try {
    adminData = await api("/api/admin/me");
  } catch {
    adminData = null;
    adminLoginPage();
    notify("กรุณาเข้าสู่ระบบผู้ดูแล", "error");
    return;
  }

  render(`
    <section class="ff-card ff-admin">
      <div class="ff-row">
        <div>
          <h2>แผงควบคุมผู้ดูแล</h2>
          <p class="ff-small">
            จัดการ License Key และตรวจสอบประวัติการใช้งาน
          </p>
        </div>

        <button
          class="ff-btn ff-btn-neutral"
          id="admin-logout-btn"
        >
          ออกจากระบบ
        </button>
      </div>

      <div id="admin-warning"></div>

      <div class="ff-divider"></div>

      <h3 class="ff-section-title">สร้าง License Key</h3>

      <label class="ff-label" for="create-duration">
        เลือกระยะเวลา
      </label>

      <select class="ff-select" id="create-duration">
        ${durations.map(item => `
          <option value="${escapeHTML(item.value)}">
            ${escapeHTML(item.label)}
          </option>
        `).join("")}
      </select>

      <button
        class="ff-btn ff-btn-primary ff-btn-block"
        id="create-license-btn"
        style="margin-top:12px"
      >
        สร้าง License Key
      </button>

      <div id="created-key-box"></div>

      <div class="ff-divider"></div>

      <h3 class="ff-section-title">เปลี่ยนรหัสผ่านผู้ดูแล</h3>

      <label class="ff-label" for="current-password">
        รหัสผ่านปัจจุบัน
      </label>

      <input
        class="ff-input"
        id="current-password"
        type="password"
        autocomplete="current-password"
        placeholder="กรอกรหัสผ่านปัจจุบัน"
      >

      <label class="ff-label" for="new-password">
        รหัสผ่านใหม่
      </label>

      <input
        class="ff-input"
        id="new-password"
        type="password"
        autocomplete="new-password"
        placeholder="อย่างน้อย 12 ตัวอักษร"
      >

      <label class="ff-label" for="confirm-password">
        ยืนยันรหัสผ่านใหม่
      </label>

      <input
        class="ff-input"
        id="confirm-password"
        type="password"
        autocomplete="new-password"
        placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
      >

      <button
        class="ff-btn ff-btn-neutral ff-btn-block"
        id="change-password-btn"
        style="margin-top:12px"
      >
        เปลี่ยนรหัสผ่าน
      </button>

      <div class="ff-divider"></div>

      <div class="ff-row">
        <h3 class="ff-section-title" style="margin:0">
          รายการ License
        </h3>

        <button
          class="ff-btn ff-btn-secondary"
          id="refresh-licenses-btn"
        >
          รีเฟรช
        </button>
      </div>

      <label class="ff-label" for="license-search">
        ค้นหา License
      </label>

      <input
        class="ff-input"
        id="license-search"
        placeholder="ค้นหาด้วย ID หรือรหัสท้ายคีย์"
      >

      <div id="license-list" style="margin-top:14px">
        <div class="ff-empty">กำลังโหลดข้อมูล...</div>
      </div>

      <div class="ff-divider"></div>

      <div class="ff-row">
        <h3 class="ff-section-title" style="margin:0">
          ประวัติการใช้งาน
        </h3>

        <button
          class="ff-btn ff-btn-secondary"
          id="refresh-audit-btn"
        >
          รีเฟรชประวัติ
        </button>
      </div>

      <div id="audit-list" style="margin-top:14px">
        <div class="ff-empty">กำลังโหลดข้อมูล...</div>
      </div>
    </section>
  `);

  $("admin-logout-btn").onclick = adminLogout;
  $("create-license-btn").onclick = createLicense;
  $("change-password-btn").onclick = changeAdminPassword;
  $("refresh-licenses-btn").onclick = loadLicenses;
  $("refresh-audit-btn").onclick = loadAudit;

  $("license-search").addEventListener("input", () => {
    clearTimeout(searchTimer);

    searchTimer = setTimeout(() => {
      loadLicenses($("license-search")?.value || "");
    }, 350);
  });

  await Promise.all([
    loadLicenses(),
    loadAudit()
  ]);
}

/* =========================================================
   ADMIN: CREATE LICENSE
   ========================================================= */

async function createLicense() {
  const button = $("create-license-btn");
  const duration = $("create-duration")?.value;

  if (!durations.some(item => item.value === duration)) {
    notify("กรุณาเลือกระยะเวลา License", "error");
    return;
  }

  setLoading(button, true, "กำลังสร้างคีย์...");

  try {
    const result = await api("/api/admin/licenses", {
      method: "POST",
      body: { duration }
    });

    if (!result.key) {
      throw new Error("เซิร์ฟเวอร์ไม่ได้ส่ง License Key กลับมา");
    }

    $("created-key-box").innerHTML = `
      <div class="ff-notice success">
        <strong>สร้าง License Key สำเร็จ</strong>

        <div class="ff-key" id="new-license-key" style="margin-top:10px">
          ${escapeHTML(result.key)}
        </div>

        <div class="ff-small" style="margin-top:8px">
          คีย์นี้ยังไม่เริ่มนับเวลา
          เวลาจะเริ่มเมื่อผู้ซื้อกดยืนยันเปิดใช้งาน
        </div>

        <button
          class="ff-btn ff-btn-secondary ff-btn-block"
          id="copy-new-license-btn"
          style="margin-top:12px"
        >
          คัดลอก License Key
        </button>
      </div>
    `;

    $("copy-new-license-btn").onclick = async () => {
      try {
        await navigator.clipboard.writeText(result.key);
        notify("คัดลอก License Key แล้ว", "success");
      } catch {
        notify("คัดลอกไม่สำเร็จ กรุณาคัดลอกด้วยตนเอง", "error");
      }
    };

    notify("สร้าง License Key สำเร็จ", "success");

    await loadLicenses();
    await loadAudit();
  } catch (error) {
    showError(error, "สร้าง License Key ไม่สำเร็จ");
  } finally {
    setLoading(button, false);
  }
}

/* =========================================================
   ADMIN: CHANGE PASSWORD
   ========================================================= */

async function changeAdminPassword() {
  const button = $("change-password-btn");

  const currentPassword = $("current-password")?.value || "";
  const newPassword = $("new-password")?.value || "";
  const confirmPassword = $("confirm-password")?.value || "";

  if (!currentPassword || !newPassword || !confirmPassword) {
    notify("กรุณากรอกข้อมูลรหัสผ่านให้ครบ", "error");
    return;
  }

  if (newPassword.length < 12) {
    notify("รหัสผ่านใหม่ต้องมีอย่างน้อย 12 ตัวอักษร", "error");
    return;
  }

  if (newPassword.length > 128) {
    notify("รหัสผ่านใหม่ยาวเกิน 128 ตัวอักษร", "error");
    return;
  }

  if (newPassword !== confirmPassword) {
    notify("รหัสผ่านใหม่และการยืนยันไม่ตรงกัน", "error");
    return;
  }

  if (currentPassword === newPassword) {
    notify("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม", "error");
    return;
  }

  setLoading(button, true, "กำลังเปลี่ยนรหัสผ่าน...");

  try {
    await api("/api/admin/change-password", {
      method: "POST",
      body: {
        currentPassword,
        newPassword
      }
    });

    $("current-password").value = "";
    $("new-password").value = "";
    $("confirm-password").value = "";

    notify("เปลี่ยนรหัสผ่านสำเร็จ", "success");
  } catch (error) {
    showError(error, "เปลี่ยนรหัสผ่านไม่สำเร็จ");
  } finally {
    setLoading(button, false);
  }
}

/* =========================================================
   ADMIN: LOAD LICENSES
   ========================================================= */

async function loadLicenses(query = "") {
  const box = $("license-list");
  if (!box) return;

  box.innerHTML = `
    <div class="ff-empty">กำลังโหลดข้อมูล...</div>
  `;

  try {
    const result = await api(
      "/api/admin/licenses?q=" + encodeURIComponent(query)
    );

    licenseRows = Array.isArray(result.licenses)
      ? result.licenses
      : [];

    renderLicenseList();
  } catch (error) {
    box.innerHTML = `
      <div class="ff-notice warning">
        ${escapeHTML(error.message || "โหลดรายการ License ไม่สำเร็จ")}
      </div>
    `;
  }
}

function renderLicenseList() {
  const box = $("license-list");
  if (!box) return;

  if (!licenseRows.length) {
    box.innerHTML = `
      <div class="ff-empty">ไม่พบ License Key</div>
    `;
    return;
  }

  box.innerHTML = `
    <div class="ff-table-wrap">
      <table class="ff-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>คีย์</th>
            <th>ระยะเวลา</th>
            <th>สถานะ</th>
            <th>วันหมดอายุ</th>
            <th>จัดการ</th>
          </tr>
        </thead>

        <tbody>
          ${licenseRows.map(row => {
            const isActive = row.status === "ACTIVE";

            return `
              <tr>
                <td>${escapeHTML(row.id)}</td>

                <td>
                  <strong>${escapeHTML(row.hint || "—")}</strong>
                </td>

                <td>
                  ${escapeHTML(durationLabel(row.duration))}
                </td>

                <td>
                  <span class="ff-badge ${statusClass(row.status)}">
                    ${escapeHTML(statusLabel(row.status))}
                  </span>
                </td>

                <td>
                  ${escapeHTML(expiryLabel(row))}
                </td>

                <td>
                  <div class="ff-actions">
                    <button
                      class="ff-btn ${isActive ? "ff-btn-danger" : "ff-btn-secondary"}"
                      data-action="status"
                      data-id="${escapeHTML(row.id)}"
                      data-status="${isActive ? "SUSPENDED" : "ACTIVE"}"
                    >
                      ${isActive ? "ระงับ" : "เปิดใช้"}
                    </button>

                    <button
                      class="ff-btn ff-btn-neutral"
                      data-action="reset"
                      data-id="${escapeHTML(row.id)}"
                    >
                      รีเซ็ตอุปกรณ์
                    </button>
                  </div>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;

  box.querySelectorAll("[data-action='status']").forEach(button => {
    button.onclick = () => {
      changeLicenseStatus(
        button.dataset.id,
        button.dataset.status
      );
    };
  });

  box.querySelectorAll("[data-action='reset']").forEach(button => {
    button.onclick = () => {
      resetLicenseDevice(button.dataset.id);
    };
  });
}

/* =========================================================
   ADMIN: CHANGE LICENSE STATUS
   ========================================================= */

async function changeLicenseStatus(id, status) {
  const action = status === "SUSPENDED"
    ? "ระงับ"
    : "เปิดใช้งาน";

  if (!confirm(`ยืนยัน${action} License ID ${id} หรือไม่?`)) {
    return;
  }

  try {
    await api(
      `/api/admin/licenses/${encodeURIComponent(id)}/status`,
      {
        method: "POST",
        body: { status }
      }
    );

    notify(`${action} License สำเร็จ`, "success");

    await loadLicenses($("license-search")?.value || "");
    await loadAudit();
  } catch (error) {
    showError(error, `${action} License ไม่สำเร็จ`);
  }
}

/* =========================================================
   ADMIN: RESET DEVICE
   ========================================================= */

async function resetLicenseDevice(id) {
  const password = prompt(
    "กรุณากรอกรหัสผ่านผู้ดูแลเพื่อยืนยันการรีเซ็ตอุปกรณ์"
  );

  if (password === null) return;

  if (!password) {
    notify("กรุณากรอกรหัสผ่านผู้ดูแล", "error");
    return;
  }

  if (!confirm(
    `ยืนยันรีเซ็ตอุปกรณ์ของ License ID ${id} หรือไม่?`
  )) {
    return;
  }

  try {
    await api(
      `/api/admin/licenses/${encodeURIComponent(id)}/reset-device`,
      {
        method: "POST",
        body: { password }
      }
    );

    notify("รีเซ็ตอุปกรณ์สำเร็จ", "success");

    await loadLicenses($("license-search")?.value || "");
    await loadAudit();
  } catch (error) {
    showError(error, "รีเซ็ตอุปกรณ์ไม่สำเร็จ");
  }
}

/* =========================================================
   ADMIN: AUDIT HISTORY
   ========================================================= */

async function loadAudit() {
  const box = $("audit-list");
  if (!box) return;

  box.innerHTML = `
    <div class="ff-empty">กำลังโหลดประวัติ...</div>
  `;

  try {
    const result = await api("/api/admin/audit");

    auditRows = Array.isArray(result.events)
      ? result.events
      : [];

    renderAuditList();
  } catch (error) {
    box.innerHTML = `
      <div class="ff-notice warning">
        ${escapeHTML(error.message || "โหลดประวัติไม่สำเร็จ")}
      </div>
    `;
  }renderAuditList() {
  const box = $("audit-list");
  if (!box) return;

  if (!auditRows.length) {
    box.innerHTML = `
      <div class="ff-empty">ยังไม่มีประวัติการใช้งาน</div>
    `;
    return;
  }

  box.innerHTML = `
    <div class="ff-table-wrap">
}

function 
      <table class="ff-table">
        <thead>
          <tr>
            <th>เวลา</th>
            <th>รายการ</th>
            <th>License</th>
            <th>รายละเอียด</th>
          </tr>
        </thead>

        <tbody>
          ${auditRows.map(row => `
            <tr>
              <td>
                ${escapeHTML(formatDate(row.created_at || row.createdAt))}
              </td>

              <td>
                ${escapeHTML(row.action || "—")}
              </td>

              <td>
                ${escapeHTML(row.key_hint || row.keyHint || "—")}
              </td>

              <td>
                ${escapeHTML(row.detail || "—")}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

/* =========================================================
   ADMIN: LOGOUT
   ========================================================= */

async function adminLogout() {
  try {
    await api("/api/admin/logout", {
      method: "POST"
    });

    adminData = null;
    licenseRows = [];
    auditRows = [];

    home();
    notify("ออกจากระบบผู้ดูแลแล้ว", "success");
  } catch (error) {
    showError(error, "ออกจากระบบไม่สำเร็จ");
  }
}

/* =========================================================
   INITIALIZE
   ========================================================= */

async function init() {
  if (!app) {
    console.error("ไม่พบ element #app");
    return;
  }

  addStyles();

  try {
    const session = await api("/api/customer/session");

    if (session?.ok) {
      await scannerPage();
      return;
    }
  } catch {
    // ไม่มี Customer session ให้กลับหน้าหลัก
  }

  home();
}

init();
   
