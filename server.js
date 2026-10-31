const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

fs.mkdirSync(DATA_DIR, { recursive: true });

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production");
}

const db = new Database(path.join(DATA_DIR, "ffscan.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  password_hash TEXT NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL,
  duration TEXT NOT NULL,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  device_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  license_id INTEGER,
  key_hint TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
`);

const now = () => new Date().toISOString();
const hash = value =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

const durations = {
  "3 ชั่วโมง": 3 * 60 * 60 * 1000,
  "6 ชั่วโมง": 6 * 60 * 60 * 1000,
  "1 วัน": 24 * 60 * 60 * 1000,
  "7 วัน": 7 * 24 * 60 * 60 * 1000,
  "30 วัน": 30 * 24 * 60 * 60 * 1000,
  "90 วัน": 90 * 24 * 60 * 60 * 1000,
  "180 วัน": 180 * 24 * 60 * 60 * 1000,
  "Lifetime": null
};

const adminExists = db.prepare(
  "SELECT id FROM admins WHERE id = 1"
).get();

if (!adminExists) {
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;

  if (!initialPassword || initialPassword.length < 8) {
    throw new Error("Set ADMIN_INITIAL_PASSWORD in Render environment");
  }

  db.prepare(`
    INSERT INTO admins (id, password_hash, must_change)
    VALUES (1, ?, 1)
  `).run(bcrypt.hashSync(initialPassword, 12));
}

function audit(action, licenseId = null, hint = null, detail = "") {
  db.prepare(`
    INSERT INTO audit (action, license_id, key_hint, detail, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(action, licenseId, hint, detail, now());
}

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));

app.use(session({
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: DATA_DIR
  }),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

const activateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ Admin" });
  }
  next();
}

function requireCustomer(req, res, next) {
  if (!req.session.customerLicenseId) {
    return res.status(401).json({ error: "กรุณาเปิดใช้งาน License" });
  }

  const license = db.prepare(
    "SELECT * FROM licenses WHERE id = ?"
  ).get(req.session.customerLicenseId);

  if (!license || license.status !== "ACTIVE") {
    return res.status(403).json({ error: "License นี้ไม่สามารถใช้งานได้" });
  }

  if (license.expires_at && Date.now() >= Date.parse(license.expires_at)) {
    return res.status(403).json({ error: "License หมดอายุแล้ว" });
  }

  req.license = license;
  next();
}

function licenseExpired(license) {
  return license.expires_at && Date.now() >= Date.parse(license.expires_at);
}

function licenseView(row) {
  return {
    id: row.id,
    hint: row.hint,
    duration: row.duration,
    expiresAt: row.expires_at,
    status: licenseExpired(row) && row.status === "ACTIVE"
      ? "EXPIRED"
      : row.status,
    deviceBound: Boolean(row.device_hash)
  };
}

app.post("/api/admin/login", loginLimiter, (req, res) => {
  const password = String(req.body.password || "");
  const admin = db.prepare(
    "SELECT * FROM admins WHERE id = 1"
  ).get();

  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });
  }

  req.session.admin = true;
  req.session.mustChange = Boolean(admin.must_change);

  audit("ADMIN_LOGIN", null, null, "เข้าสู่ระบบ Admin");

  res.json({ ok: true, mustChange: Boolean(admin.must_change) });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  const admin = db.prepare(
    "SELECT must_change FROM admins WHERE id = 1"
  ).get();

  res.json({ ok: true, mustChange: Boolean(admin.must_change) });
});

app.post("/api/admin/change-password", requireAdmin, (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");

  if (newPassword.length < 12) {
    return res.status(400).json({
      error: "รหัสผ่านใหม่ต้องมีอย่างน้อย 12 ตัวอักษร"
    });
  }

  const admin = db.prepare(
    "SELECT * FROM admins WHERE id = 1"
  ).get();

  if (!bcrypt.compareSync(currentPassword, admin.password_hash)) {
    return res.status(401).json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
  }

  db.prepare(`
    UPDATE admins
    SET password_hash = ?, must_change = 0
    WHERE id = 1
  `).run(bcrypt.hashSync(newPassword, 12));

  req.session.mustChange = false;
  audit("ADMIN_PASSWORD_CHANGED", null, null, "เปลี่ยนรหัสผ่าน Admin");

  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

app.get("/api/admin/licenses", requireAdmin, (req, res) => {
  const q = String(req.query.q || "").trim();
  let rows;

  if (q) {
    rows = db.prepare(`
      SELECT * FROM licenses
      WHERE CAST(id AS TEXT) = ?
         OR hint LIKE ?
      ORDER BY id DESC
    `).all(q, `%${q}%`);
  } else {
    rows = db.prepare(
      "SELECT * FROM licenses ORDER BY id DESC"
    ).all();
  }

  res.json({ licenses: rows.map(licenseView) });
});

app.post("/api/admin/licenses", requireAdmin, (req, res) => {
  const duration = String(req.body.duration || "");

  if (!Object.prototype.hasOwnProperty.call(durations, duration)) {
    return res.status(400).json({ error: "ระยะเวลา License ไม่ถูกต้อง" });
  }

  const key = "FFSC-" +
    crypto.randomBytes(3).toString("hex").toUpperCase() + "-" +
    crypto.randomBytes(3).toString("hex").toUpperCase() + "-" +
    crypto.randomBytes(3).toString("hex").toUpperCase();

  const expiresAt = durations[duration] === null
    ? null
    : new Date(Date.now() + durations[duration]).toISOString();

  const hint = key.slice(-6);

  const result = db.prepare(`
    INSERT INTO licenses
      (key_hash, hint, duration, expires_at, status, created_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', ?)
  `).run(hash(key), hint, duration, expiresAt, now());

  audit("LICENSE_CREATED", result.lastInsertRowid, hint, duration);

  res.json({ ok: true, key });
});

app.post("/api/admin/licenses/:id/status", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || "");

  if (!Number.isInteger(id) || !["ACTIVE", "SUSPENDED"].includes(status)) {
    return res.status(400).json({ error: "ข้อมูลไม่ถูกต้อง" });
  }

  const license = db.prepare(
    "SELECT * FROM licenses WHERE id = ?"
  ).get(id);

  if (!license) {
    return res.status(404).json({ error: "ไม่พบ License" });
  }

  db.prepare(
    "UPDATE licenses SET status = ? WHERE id = ?"
  ).run(status, id);

  audit("LICENSE_STATUS_CHANGED", id, license.hint, status);
  res.json({ ok: true });
});

app.post("/api/admin/licenses/:id/reset-device", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const password = String(req.body.password || "");

  const admin = db.prepare(
    "SELECT * FROM admins WHERE id = 1"
  ).get();

  if (!bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: "รหัสผ่าน Admin ไม่ถูกต้อง" });
  }

  const license = db.prepare(
    "SELECT * FROM licenses WHERE id = ?"
  ).get(id);

  if (!license) {
    return res.status(404).json({ error: "ไม่พบ License" });
  }

  db.prepare(
    "UPDATE licenses SET device_hash = NULL WHERE id = ?"
  ).run(id);

  audit("DEVICE_RESET", id, license.hint, "รีเซ็ตการผูกอุปกรณ์");
  res.json({ ok: true });
});

app.get("/api/admin/audit", requireAdmin, (req, res) => {
  const events = db.prepare(`
    SELECT action, license_id, key_hint, detail, created_at
    FROM audit
    ORDER BY id DESC
    LIMIT 200
  `).all();

  res.json({ events });
});

app.post("/api/customer/activate", activateLimiter, (req, res) => {
  const key = String(req.body.key || "").trim().toUpperCase();
  const deviceId = String(req.body.deviceId || "");

  if (!key || key.length > 100 || !deviceId || deviceId.length > 200) {
    return res.status(400).json({ error: "กรุณากรอก License Key ให้ถูกต้อง" });
  }

  const license = db.prepare(
    "SELECT * FROM licenses WHERE key_hash = ?"
  ).get(hash(key));

  if (!license) {
    return res.status(404).json({ error: "ไม่พบ License Key นี้" });
  }

  if (license.status !== "ACTIVE") {
    return res.status(403).json({ error: "License นี้ถูกระงับการใช้งาน" });
  }

  if (licenseExpired(license)) {
    return res.status(403).json({ error: "License หมดอายุแล้ว" });
  }

  const deviceHash = hash(deviceId);

  if (license.device_hash && license.device_hash !== deviceHash) {
    return res.status(403).json({
      error: "License นี้ผูกกับอุปกรณ์อื่นแล้ว กรุณาติดต่อ Admin"
    });
  }

  if (!license.device_hash) {
    db.prepare(
      "UPDATE licenses SET device_hash = ? WHERE id = ?"
    ).run(deviceHash, license.id);

    audit("DEVICE_BOUND", license.id, license.hint, "ผูกอุปกรณ์ครั้งแรก");
  }

  req.session.customerLicenseId = license.id;
  audit("CUSTOMER_ACTIVATED", license.id, license.hint, "เปิดใช้งาน License");

  res.json({ ok: true });
});

app.get("/api/customer/session", requireCustomer, (req, res) => {
  res.json({
    ok: true,
    duration: req.license.duration,
    expiresAt: req.license.expires_at
  });
});

app.post("/api/customer/logout", (req, res) => {
  delete req.session.customerLicenseId;
  res.json({ ok: true });
});

app.use(express.static(__dirname));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`FF SCAN CENTER running on port ${PORT}`);
});
