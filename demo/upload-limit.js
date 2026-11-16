// Demo only: on the hosted demo (DEMO_MODE=true), a file over 5 MB answers 413 with the demo's own message, before
// any other check of the batch, as the reference's middleware does. The routes' upload limit is 5 MB too, so
// multer stops the request at the same point: this error handler (mounted before app.js's final one) only changes
// the answer. Off the demo, /api/files answers 422 and the scan 413, as the contract says.
export function demoUploadLimit(config) {
  return (err, req, res, next) => {
    if (!config.demoMode || err.code !== "LIMIT_FILE_SIZE") return next(err);
    res.status(413).json({ error: "Files over 5 MB are not accepted on the demo" });
  };
}
