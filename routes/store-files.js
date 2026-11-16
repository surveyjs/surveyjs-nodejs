// POST /api/files, GET /api/files/:id
import multer from "multer";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { canReadFile } from "../auth.js";
import { db, filesDir } from "../db.js";
import { detectType } from "../integration/file-type.js";
import { httpError } from "../integration/http.js";

const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];

// In memory, so the whole batch is checked before a byte is written. File names arrive as UTF-8 (busboy assumes latin1).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, defParamCharset: "utf8" });

/** multer's errors, in the contract's words. On the demo, demo/upload-limit.js answers the 5 MB case itself. */
function uploadErrors(err, req, res, next) {
  if (err.code === "LIMIT_FILE_SIZE") return next(httpError(422, "Each file must be 5 MB or less", { code: err.code }));
  if (err.code === "LIMIT_UNEXPECTED_FILE") return next(httpError(422, 'Upload the files in a field named "files[]"'));
  next(err);
}

export default function storeFiles(app) {
  // #region sjs:store-files.server
  // POST /api/files — store uploads, return their ids in the same order
  // Field "files[]", the name on every platform: PHP keeps only the last of several fields named "files"
  app.post("/api/files", upload.array("files[]"), (req, res) => {
    const files = req.files ?? [];
    if (files.length === 0) throw httpError(422, 'Upload one or more files in a field named "files[]"');
    const types = files.map((file) => detectType(file.buffer));   // by the bytes, never the client's Content-Type
    const refused = files.find((file, i) => !TYPES.includes(types[i]));
    if (refused) throw httpError(422, `${refused.originalname} is not a PNG, JPEG, WebP, GIF or PDF file`);

    const ids = files.map((file, i) => {
      const id = randomUUID();   // stored by id, never by the client's file name
      writeFileSync(join(filesDir(req), id), file.buffer);
      db(req).prepare("INSERT INTO files (id, name, type) VALUES (?, ?, ?)").run(id, file.originalname, types[i]);
      return id;
    });
    res.json(ids);
  }, uploadErrors);
  // #endregion

  // #region sjs:store-files.download
  // GET /api/files/:id — the content, for private files only; check access first
  app.get("/api/files/:id", (req, res) => {
    const file = db(req).prepare("SELECT id, name, type FROM files WHERE id = ?").get(req.params.id);
    if (!file || !canReadFile(req.user, file)) throw httpError(404, "Not found");   // 404, not 403: don't confirm the file exists

    // nosniff and sandbox: an uploaded HTML or SVG never runs as this site
    res.set({ "Content-Type": file.type, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" });
    res.sendFile(file.id, { root: filesDir(req), dotfiles: "deny" });
  });
  // #endregion
}
