require("dotenv").config();

const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./private_uploads");
const MAX_FILE_SIZE_MB = Math.max(1, Number(process.env.MAX_FILE_SIZE_MB || 1024));

if (ADMIN_KEY.length < 16 || SESSION_SECRET.length < 32) {
  console.error("Startup blocked: set ADMIN_KEY (16+ characters) and SESSION_SECRET (32+ characters) in .env.");
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "fixa.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    uploaded_at TEXT NOT NULL
  )
`);

app.disable("x-powered-by");
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
    }
  }
}));
app.use(express.json({ limit: "32kb" }));
app.use(session({
  name: "fixa.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
  // For production, replace MemoryStore with a persistent shared session store.
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false });
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true) return next();
  return res.status(401).json({ error: "Please sign in to continue." });
}
function cleanName(name) {
  const base = path.basename(String(name || "file").replace(/\\/g, "/"));
  return base.replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 240) || "file";
}
function humanSize(n) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

app.use(express.static(path.join(__dirname, "public"), { index: "index.html", etag: true, maxAge: "1h" }));

app.get("/api/session", (req, res) => res.json({ authenticated: req.session?.authenticated === true }));
app.post("/api/login", loginLimiter, (req, res, next) => {
  const key = typeof req.body?.key === "string" ? req.body.key : "";
  if (!safeEqual(key, ADMIN_KEY)) return res.status(401).json({ error: "Invalid access key." });
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.authenticated = true;
    req.session.save(err2 => {
      if (err2) return next(err2);
      res.json({ ok: true });
    });
  });
});
app.post("/api/logout", requireAuth, (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("fixa.sid", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
    res.json({ ok: true });
  });
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(cleanName(file.originalname)).slice(0, 20)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, _file, cb) => cb(null, true)
});

app.get("/api/files", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT id, original_name, mime_type, size_bytes, uploaded_at FROM files ORDER BY uploaded_at DESC").all();
  res.json({ files: rows.map(f => ({ ...f, size_label: humanSize(f.size_bytes) })) });
});

app.post("/api/files", requireAuth, uploadLimiter, (req, res, next) => {
  upload.single("file")(req, res, err => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: `File is too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.` });
      }
      return res.status(400).json({ error: "Upload failed. Please try again." });
    }
    if (!req.file) return res.status(400).json({ error: "Choose a file to upload." });
    const record = {
      id: crypto.randomUUID(),
      original_name: cleanName(req.file.originalname),
      stored_name: req.file.filename,
      mime_type: req.file.mimetype || "application/octet-stream",
      size_bytes: req.file.size,
      uploaded_at: new Date().toISOString()
    };
    try {
      db.prepare("INSERT INTO files (id, original_name, stored_name, mime_type, size_bytes, uploaded_at) VALUES (@id, @original_name, @stored_name, @mime_type, @size_bytes, @uploaded_at)").run(record);
      res.status(201).json({ ok: true, file: { id: record.id, original_name: record.original_name, mime_type: record.mime_type, size_bytes: record.size_bytes, size_label: humanSize(record.size_bytes), uploaded_at: record.uploaded_at } });
    } catch (e) {
      fs.promises.unlink(path.join(UPLOAD_DIR, req.file.filename)).catch(() => {});
      next(e);
    }
  });
});

app.get("/api/files/:id/download", requireAuth, (req, res, next) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id);
  if (!file) return res.status(404).json({ error: "File not found." });
  const diskPath = path.join(UPLOAD_DIR, path.basename(file.stored_name));
  if (!fs.existsSync(diskPath)) return res.status(404).json({ error: "Stored file is missing from the server." });
  res.download(diskPath, file.original_name, err => { if (err && !res.headersSent) next(err); });
});

app.delete("/api/files/:id", requireAuth, (req, res, next) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id);
  if (!file) return res.status(404).json({ error: "File not found." });
  try {
    db.prepare("DELETE FROM files WHERE id = ?").run(req.params.id);
    fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(file.stored_name))).catch(err => {
      if (err.code !== "ENOENT") console.error("File cleanup failed:", err.message);
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "FIXA" }));
app.use((err, _req, res, _next) => {
  console.error(err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: "A server error occurred. Please try again." });
});

app.listen(PORT, () => console.log(`FIXA is running on port ${PORT}`));
