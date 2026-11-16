// Demo only: on the hosted demo (DEMO_MODE=true), /api/translate and /api/work-orders/extract allow 20 calls per
// visitor (demo_sid) per UTC day. The counts live in this process: with several processes, keep them in a shared
// store (Redis, a table) instead.
const LIMIT = 20;
const calls = new Map();   // "<demo_sid>:<YYYY-MM-DD>" => count

export function demoAiLimit(config) {
  return (req, res, next) => {
    if (!config.demoMode || req.method !== "POST") return next();
    const key = `${req.sandbox.id}:${new Date().toISOString().slice(0, 10)}`;
    const count = calls.get(key) ?? 0;
    if (count >= LIMIT) return res.status(429).json({ error: "The demo allows 20 AI calls per visitor per day" });
    calls.set(key, count + 1);
    if (calls.size > 10_000) calls.delete(calls.keys().next().value);   // forget the oldest visitors first
    next();
  };
}
