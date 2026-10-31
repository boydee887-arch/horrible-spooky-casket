
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
const IS_PRODUCTION = process.env.NODE_ENV === "production";

fs.mkdirSync(DATA_DIR, { recursive: true });

if (IS_PRODUCTION && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production");
}

const db = new Database(path.join(DATA_DIR, "ffscan.sqlite"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

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

// เพิ่ม activated_at โดยไม่ลบข้อมูลเดิม
const columns = db.prepare(
  "PRAGMA table_info(licenses)"
).all();

if (!columns.some(column => column.name === "activated_at")) {
  db.exec(
    "ALTER TABLE licenses ADD COLUMN activated_at TEXT"
  );
}

const now = () => new Date().toISOString();

const hash = value =>
  crypto.createHash("sha256")
    .update(String(value))
    .digest("hex");

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

// รักษาข้อมูลคีย์เก่าที่มีวันหมดอายุอยู่แล้ว
// ไม่คำนวณวันหมดอายุใหม่ให้คีย์เก่า
db.prepare(`
  UPDATE licenses
  SET activated_at = created_at
  WHERE activated_at IS NULL
    AND expires_at IS NOT NULL
`).run();

db.prepare(`
  UPDATE licenses
  SET activated_at = created_at
  WHERE activated_at IS NULL
    AND duration = 'Lifetime'
    AND device_hash IS NOT NULL
`).run();

const adminExists = db.prepare(
  "SELECT id FROM admins WHERE id = 1"
).get();

if (!adminExists) {
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;

  if (!initialPassword || initialPassword.length < 8) {
    throw new Error(
      "Set ADMIN_INITIAL_PASSWORD in Render environment"
    );
  }

  db.prepare(`
    INSERT INTO admins (id, password_hash, must_change)
    VALUES (1, ?, 1)
  `).run(bcrypt.hashSync(initialPassword, 12));
}

function audit(action, licenseId = null, hint = null, detail = "") {
  db.prepare(`
    INSERT INTO audit
      (action, license_id, key_hint, detail, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(action, licenseId, hint, detail, now());
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => {
      if (error) return reject(error);
      resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save(error => {
      if (error) return reject(error);
      resolve();
    });
  });
}

function licenseExpired(license) {
  if (!license.expires_at) return false;

  const expiry = Date.parse(license.expires_at);

  return Number.isFinite(expiry) && Date.now() >= expiry;
}

function licenseView(row) {
  return {
    id: row.id,
    hint: row.hint,
    duration: row.duration,
    expiresAt: row.expires_at,
    activatedAt: row.activated_at || null,
    status: licenseExpired(row) && row.status === "ACTIVE"
      ? "EXPIRED"
      : row.status,
    deviceBound: Boolean(row.device_hash)
  };
}

// -------------------------
// MIDDLEWARE
// -------------------------

app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(express.json({
  limit: "20kb"
}));

app.use(session({
  name: "ffsc.sid",
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: DATA_DIR
  }),
  secret: process.env.SESSION_SECRET ||
    crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
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
    return res.status(401).json({
      error: "กรุณาเข้าสู่ระบบ Admin"
    });
  }

  next();
}

function requireCustomer(req, res, next) {
  const licenseId = req.session.customerLicenseId;
  const sessionDeviceHash = req.session.customerDeviceHash;

  if (!licenseId || !sessionDeviceHash) {
    return res.status(401).json({
      error: "กรุณาเปิดใช้งาน License"
    });
  }

  const license = db.prepare(
    "SELECT * FROM licenses WHERE id = ?"
  ).get(licenseId);

  if (!license || license.status !== "ACTIVE") {
    return res.status(403).json({
      error: "License นี้ไม่สามารถใช้งานได้"
    });
  }

  if (licenseExpired(license)) {
    return res.status(403).json({
      error: "License หมดอายุแล้ว"
    });
  }

  if (
    !license.device_hash ||
    license.device_hash !== sessionDeviceHash
  ) {
    return res.status(403).json({
      error: "อุปกรณ์ไม่ตรงกับ License กรุณาเปิดใช้งานใหม่"
    });
  }

  req.license = license;
  next();
}

// -------------------------
// ADMIN
// -------------------------

app.post(
  "/api/admin/login",
  loginLimiter,
  async (req, res, next) => {
    try {
      const password = String(req.body.password || "");

      const admin = db.prepare(
        "SELECT * FROM admins WHERE id = 1"
      ).get();

      if (
        !admin ||
        !bcrypt.compareSync(password, admin.password_hash)
      ) {
        return res.status(401).json({
          error: "รหัสผ่านไม่ถูกต้อง"
        });
      }

      await regenerateSession(req);

      req.session.admin = true;
      req.session.mustChange = Boolean(admin.must_change);

      await saveSession(req);

      audit(
        "ADMIN_LOGIN",
        null,
        null,
        "เข้าสู่ระบบ Admin"
      );

      res.json({
        ok: true,
        mustChange: Boolean(admin.must_change)
      });
    } catch (error) {
      next(error);
    }
  }
);

app.get("/api/admin/me", requireAdmin, (req, res) => {
  const admin = db.prepare(
    "SELECT must_change FROM admins WHERE id = 1"
  ).get();

  if (!admin) {
    return res.status(500).json({
      error: "ไม่พบข้อมูล Admin"
    });
  }

  res.json({
    ok: true,
    mustChange: Boolean(admin.must_change)
  });
});

app.post(
  "/api/admin/change-password",
  requireAdmin,
  (req, res) => {
    const currentPassword = String(
      req.body.currentPassword || ""
    );

    const newPassword = String(
      req.body.newPassword || ""
    );

    if (newPassword.length < 12 || newPassword.length > 128) {
      return res.status(400).json({
        error: "รหัสผ่านใหม่ต้องมี 12–128 ตัวอักษร"
      });
    }

    const admin = db.prepare(
      "SELECT * FROM admins WHERE id = 1"
    ).get();

    if (
      !admin ||
      !bcrypt.compareSync(currentPassword, admin.password_hash)
    ) {
      return res.status(401).json({
        error: "รหัสผ่านปัจจุบันไม่ถูกต้อง"
      });
    }

    db.prepare(`
      UPDATE admins
      SET password_hash = ?, must_change = 0
      WHERE id = 1
    `).run(bcrypt.hashSync(newPassword, 12));

    req.session.mustChange = false;

    audit(
      "ADMIN_PASSWORD_CHANGED",
      null,
      null,
      "เปลี่ยนรหัสผ่าน Admin"
    );

    res.json({ ok: true });
  }
);

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({
        error: "ออกจากระบบไม่สำเร็จ"
      });
    }

    res.clearCookie("ffsc.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PRODUCTION
    });

    res.json({ ok: true });
  });
});

// -------------------------
// LICENSE MANAGEMENT
// -------------------------

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

  res.json({
    licenses: rows.map(licenseView)
  });
});

app.post("/api/admin/licenses", requireAdmin, (req, res) => {
  const duration = String(req.body.duration || "");

  if (!Object.prototype.hasOwnProperty.call(durations, duration)) {
    return res.status(400).json({
      error: "ระยะเวลา License ไม่ถูกต้อง"
    });
  }

  const key = "FFSC-" +
    crypto.randomBytes(3).toString("hex").toUpperCase() + "-" +
    crypto.randomBytes(3).toString("hex").toUpperCase() + "-" +
    crypto.randomBytes(3).toString("hex").toUpperCase();

  const hint = key.slice(-6);

  // ยังไม่กำหนด expires_at จนกว่าจะยืนยันเปิดใช้งาน
  const result = db.prepare(`
    INSERT INTO licenses
      (key_hash, hint, duration, expires_at, status, created_at)
    VALUES (?, ?, ?, NULL, 'ACTIVE', ?)
  `).run(hash(key), hint, duration, now());

  audit(
    "LICENSE_CREATED",
    result.lastInsertRowid,
    hint,
    duration
  );

  res.json({
    ok: true,
    key
  });
});

app.post(
  "/api/admin/licenses/:id/status",
  requireAdmin,
  (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body.status || "");

    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !["ACTIVE", "SUSPENDED"].includes(status)
    ) {
      return res.status(400).json({
        error: "ข้อมูลไม่ถูกต้อง"
      });
    }

    const license = db.prepare(
      "SELECT * FROM licenses WHERE id = ?"
    ).get(id);

    if (!license) {
      return res.status(404).json({
        error: "ไม่พบ License"
      });
    }

    db.prepare(
      "UPDATE licenses SET status = ? WHERE id = ?"
    ).run(status, id);

    audit(
      "LICENSE_STATUS_CHANGED",
      id,
      license.hint,
      status
    );

    res.json({ ok: true });
  }
);

app.post(
  "/api/admin/licenses/:id/reset-device",
  requireAdmin,
  (req, res) => {
    const id = Number(req.params.id);
    const password = String(req.body.password || "");

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        error: "รหัส License ไม่ถูกต้อง"
      });
    }

    const admin = db.prepare(
      "SELECT * FROM admins WHERE id = 1"
    ).get();

    if (
      !admin ||
      !bcrypt.compareSync(password, admin.password_hash)
    ) {
      return res.status(401).json({
        error: "รหัสผ่าน Admin ไม่ถูกต้อง"
      });
    }

    const license = db.prepare(
      "SELECT * FROM licenses WHERE id = ?"
    ).get(id);

    if (!license) {
      return res.status(404).json({
        error: "ไม่พบ License"
      });
    }

    db.prepare(
      "UPDATE licenses SET device_hash = NULL WHERE id = ?"
    ).run(id);

    audit(
      "DEVICE_RESET",
      id,
      license.hint,
      "รีเซ็ตการผูกอุปกรณ์"
    );

    res.json({ ok: true });
  }
);

app.get("/api/admin/audit", requireAdmin, (req, res) => {
  const events = db.prepare(`
    SELECT action, license_id, key_hint, detail, created_at
    FROM audit
    ORDER BY id DESC
    LIMIT 200
  `).all();

  res.json({ events });
});

// -------------------------
// CUSTOMER: CHECK KEY
// ตรวจสอบคีย์โดยไม่เริ่มนับเวลา
// -------------------------

app.post(
  "/api/customer/check-key",
  activateLimiter,
  (req, res) => {
    const key = String(req.body.key || "")
      .trim()
      .toUpperCase();

    if (!key || key.length > 100) {
      return res.status(400).json({
        error: "กรุณากรอก License Key ให้ถูกต้อง"
      });
    }

    const license = db.prepare(
      "SELECT * FROM licenses WHERE key_hash = ?"
    ).get(hash(key));

    if (!license) {
      return res.status(404).json({
        error: "ไม่พบ License Key นี้"
      });
    }

    if (license.status !== "ACTIVE") {
      return res.status(403).json({
        error: "License นี้ถูกระงับการใช้งาน"
      });
    }

    if (licenseExpired(license)) {
      return res.status(403).json({
        error: "License หมดอายุแล้ว"
      });
    }

    res.json({
      ok: true,
      duration: license.duration,
      activated: Boolean(
        license.activated_at || license.expires_at
      ),
      expiresAt: license.expires_at
    });
  }
);

// -------------------------
// CUSTOMER: CONFIRM ACTIVATION
// เริ่มนับเวลาเมื่อเรียก API นี้เท่านั้น
// -------------------------

app.post(
  "/api/customer/activate",
  activateLimiter,
  async (req, res, next) => {
    try {
      const key = String(req.body.key || "")
        .trim()
        .toUpperCase();

      const deviceId = String(req.body.deviceId || "");

      if (
        !key ||
        key.length > 100 ||
        !deviceId ||
        deviceId.length > 200
      ) {
        return res.status(400).json({
          error: "กรุณากรอก License Key ให้ถูกต้อง"
        });
      }

      const deviceHash = hash(deviceId);

      const result = db.transaction(() => {
        const license = db.prepare(
          "SELECT * FROM licenses WHERE key_hash = ?"
        ).get(hash(key));

        if (!license) {
          return {
            error: "ไม่พบ License Key นี้",
            status: 404
          };
        }

        if (license.status !== "ACTIVE") {
          return {
            error: "License นี้ถูกระงับการใช้งาน",
            status: 403
          };
        }

        if (licenseExpired(license)) {
          return {
            error: "License หมดอายุแล้ว",
            status: 403
          };
        }

        if (
          license.device_hash &&
          license.device_hash !== deviceHash
        ) {
          return {
            error: "License นี้ผูกกับอุปกรณ์อื่นแล้ว กรุณาติดต่อ Admin",
            status: 403
          };
        }

        let activatedAt = license.activated_at;
        let expiresAt = license.expires_at;

        // เริ่มนับเวลาเฉพาะครั้งแรกที่ยืนยันเปิดใช้งาน
        if (!activatedAt && !expiresAt) {
          activatedAt = now();

          const durationMs = durations[license.duration];

          expiresAt = durationMs === null
            ? null
            : new Date(
                Date.parse(activatedAt) + durationMs
              ).toISOString();

          db.prepare(`
            UPDATE licenses
            SET activated_at = ?,
                expires_at = ?,
                device_hash = ?
            WHERE id = ?
          `).run(
            activatedAt,
            expiresAt,
            deviceHash,
            license.id
          );
        } else if (!license.device_hash) {
          // คีย์เก่าที่เคยเริ่มนับแล้ว รักษาวันหมดอายุเดิม
          db.prepare(`
            UPDATE licenses
            SET device_hash = ?
            WHERE id = ?
          `).run(deviceHash, license.id);
        }

        return {
          licenseId: license.id,
          deviceHash,
          hint: license.hint
        };
      })();

      if (result.error) {
        return res.status(result.status).json({
          error: result.error
        });
      }

      await regenerateSession(req);

      req.session.customerLicenseId = result.licenseId;
      req.session.customerDeviceHash = result.deviceHash;

      await saveSession(req);

      audit(
        "CUSTOMER_ACTIVATED",
        result.licenseId,
        result.hint,
        "ยืนยันเปิดใช้งาน License"
      );

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

// -------------------------
// CUSTOMER SESSION
// -------------------------

app.get(
  "/api/customer/session",
  requireCustomer,
  (req, res) => {
    res.json({
      ok: true,
      duration: req.license.duration,
      expiresAt: req.license.expires_at,
      activatedAt: req.license.activated_at || null
    });
  }
);

app.post("/api/customer/logout", (req, res) => {
  delete req.session.customerLicenseId;
  delete req.session.customerDeviceHash;

  req.session.save(error => {
    if (error) {
      return res.status(500).json({
        error: "ออกจากระบบไม่สำเร็จ"
      });
    }

    res.json({ ok: true });
  });
});

// -------------------------
// STATIC FILES
// -------------------------

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/app.js", (req, res) => {
  res.sendFile(path.join(__dirname, "app.js"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// -------------------------
// ERROR HANDLER
// -------------------------

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`FF SCAN CENTER running on port ${PORT}`);
});


app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// -------------------------
// ERROR HANDLER
// -------------------------

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์"
  });
});


                              
