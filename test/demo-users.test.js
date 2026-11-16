// The demo users: each page signs in as a user it offers, the API reads the cookie as it is, and the hooks in
// auth.js give Bob's 403 and the signed-out 401s.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startApp } from "./helpers.js";

let app;
before(async () => (app = await startApp()));
after(() => app.stop());

const config = (html) => JSON.parse(/window\.SURVEYJS_PAGE = (.*?);<\/script>/.exec(html)[1]);
const demoUserCookie = (r) => r.headers.getSetCookie().find((line) => line.startsWith("demo_user="));

test("a page that offers the cookie's user keeps it; any other page signs in as its default and resets the cookie", async () => {
  const kept = await app.request("GET", "/examples/resume-progress", { user: "bob" });
  assert.equal(config(kept.text).demoUser, "bob");
  assert.equal(demoUserCookie(kept), undefined);

  const reset = await app.request("GET", "/examples/save-response", { user: "bob" });
  assert.equal(config(reset.text).demoUser, "alice");
  const cookie = demoUserCookie(reset);
  assert.match(cookie, /^demo_user=alice;/);
  assert.match(cookie, /SameSite=Lax/i);
  assert.doesNotMatch(cookie, /HttpOnly/i);   // host.js writes it back on focus

  const signedOut = await app.request("GET", "/examples/creator-load-save", { user: "none" });
  assert.equal(config(signedOut.text).demoUser, "alice");
  assert.equal((await app.request("GET", "/claim", { user: "bob" })).text.includes('"plan":"basic"'), true);
});

test("the switch appears only where the user changes the result, with the reference's labels", async () => {
  for (const [slug, labels] of [
    ["load-definition-variables-data", ["Alice (premium)", "Bob (basic)"]],
    ["resume-progress", ["Alice", "Bob"]],
    ["creator-load-save", ["Alice (can save schemas)", "Bob (cannot save schemas)"]],
  ]) {
    const html = (await app.request("GET", `/examples/${slug}`)).text;
    assert.match(html, /id="demo-user"/, slug);
    for (const label of labels) assert.ok(html.includes(`>${label}</option>`), `${slug}: ${label}`);
  }
  for (const slug of ["save-response", "store-files", "dashboard", "variable-presets", "fill-together"]) {
    assert.doesNotMatch((await app.request("GET", `/examples/${slug}`)).text, /id="demo-user"/, slug);
  }
});

test("Bob's saves answer 403 with the edit-forms message; signed out too", async () => {
  const message = "You don't have editor rights: only editors can change forms";
  for (const user of ["bob", null, "none"]) {
    for (const path of ["/api/forms/support", "/api/variable-presets/support"]) {
      const r = await app.request("PUT", path, { json: [], user });
      assert.deepEqual([r.status, r.data], [403, { error: message }], `${path} as ${user}`);
    }
  }
});

test("progress is per user and answers 401 signed out", async () => {
  for (const [method, message] of [["GET", "Sign in to load progress"], ["PUT", "Sign in to save progress"], ["DELETE", "Sign in to clear progress"]]) {
    const r = await app.request(method, "/api/progress/onboarding", { user: null, json: method === "PUT" ? {} : undefined });
    assert.deepEqual([r.status, r.data], [401, { error: message }]);
  }
  await app.request("PUT", "/api/progress/demo-users", { json: { data: { who: "alice" } } });
  assert.equal((await app.request("GET", "/api/progress/demo-users", { user: "bob" })).text, "null");
  assert.equal(app.db().prepare("SELECT COUNT(*) AS n FROM progress WHERE key = '1:demo-users'").get().n, 1);
});

test("an unknown cookie value is signed out on the API", async () => {
  assert.equal((await app.request("GET", "/api/progress/onboarding", { user: "mallory" })).status, 401);
});
