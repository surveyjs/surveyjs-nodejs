// Demo only: a demo_user cookie picks Alice (premium, editor), Bob (basic, viewer) or Signed out ("none").
// Real apps set req.user in their session or token middleware here (express-session, Passport, a JWT check);
// the examples only read req.user and call the hooks in auth.js.
//
// Pages that show user context or authorization offer a switch (PAGES). Every other page signs in as Alice,
// so a choice made on one page never breaks another.
import { db } from "../db.js";
import { parseCookies } from "./cookies.js";

export const USERS = ["alice", "bob"];

export const LABELS = { alice: "Alice (premium, editor)", bob: "Bob (basic, viewer)", none: "Signed out" };

/** Example slug => the users its switch offers. The first is the default. */
export const PAGES = {
  "load-definition-variables-data": ["alice", "bob"],   // compare premium and basic customer variables
  "resume-progress": ["alice", "bob"],                  // keep an independent draft for each respondent
  "creator-load-save": ["alice", "bob"],                // Bob's saves answer 403 (can(user, "edit-forms"))
};

/** The users an example page offers; one means no switch. */
export const forPage = (slug) => PAGES[slug] ?? ["alice"];

/** The user with this key from the request's database (the sandbox's in demo mode), or null. The relays pass their database. */
export function findUser(req, key) {
  if (!USERS.includes(key)) return null;
  const row = db(req).prepare("SELECT id, key, name, email, plan, is_editor FROM users WHERE key = ?").get(key);
  return row ? { id: row.id, key: row.key, name: row.name, email: row.email, plan: row.plan, isEditor: row.is_editor === 1 } : null;
}

/** Middleware: req.user from the cookie, or null when it is absent, unknown or "none" (signed out). */
export function demoUsers(req, res, next) {
  req.user = findUser(req, parseCookies(req.headers.cookie).demo_user);
  next();
}

/** On an example page: keep the cookie's user if the page offers it, otherwise sign in as the page's default. */
export function signInForPage(slug, req, res) {
  const users = forPage(slug);
  if (!users.includes(req.user?.key)) {
    // host.js reads this cookie and writes it back when the tab gets focus, so it isn't httpOnly
    res.cookie("demo_user", users[0], { maxAge: 365 * 24 * 3600 * 1000, sameSite: "lax", path: "/", secure: req.secure, httpOnly: false });
    req.user = findUser(req, users[0]);
  }
}

/** The current demo user's key: alice, bob or none. */
export const userKey = (req) => req.user?.key ?? "none";
