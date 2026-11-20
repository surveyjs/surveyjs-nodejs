# SurveyJS + Node.js: the backend integration examples on Express

This is the Node.js code behind [Integrate SurveyJS with Express](https://surveyjs.io/documentation/backend-integration-nodejs-express), as an Express 5 application you can run example by example. Each example of that page has a page here that runs the real SurveyJS component against these routes, with a short "Try this" list, a live request log, a "What the server stored" panel and the code that just ran. SurveyJS has no backend of its own, so treat these as starting points for your own app.

- Live catalog: [surveyjs-nodejs.demos.surveyjs.io](https://surveyjs-nodejs.demos.surveyjs.io)
- SurveyJS demos: [app.demos.surveyjs.io](https://app.demos.surveyjs.io)
- Backend integration examples on the SurveyJS website: [surveyjs.io/backend-integration/examples](https://surveyjs.io/backend-integration/examples)
- The same examples for other platforms: [PHP (Laravel)](https://github.com/surveyjs/surveyjs-php-laravel), [ASP.NET Core](https://github.com/surveyjs/surveyjs-aspnet-core), [Python (FastAPI)](https://github.com/surveyjs/surveyjs-python-fastapi), [Next.js](https://github.com/surveyjs/surveyjs-nextjs), [Java (Spring Boot)](https://github.com/surveyjs/surveyjs-java-spring-boot)

## Run it

You need Node.js 24 or later, and nothing else: no Docker, no database server, no other service (see [Prerequisites](#prerequisites)).

```bash
git clone https://github.com/surveyjs/surveyjs-nodejs-express.git
cd surveyjs-nodejs-express
npm ci            # or npm install
npm run setup     # creates .env for your private keys (from .env.example), storage/ and the SQLite database with the demo data
npm start         # http://127.0.0.1:8000
```

`npm start` also creates and seeds a missing database itself, so `npm run setup` only makes the first run explicit. While you work on the code, run `npm run dev` instead: Node's `--watch` restarts the app when a file changes.

- **Fill Forms Together** and **Edit Forms Together** use WebSocket relays that run inside the app, on its port (`/ws/rooms/<id>` and `/ws/forms/<id>`). There is nothing else to start.
- **Run Server-Side Workflows** (validate, lint, PDF, extract) run inside the app too, with the SurveyJS libraries (see [Server-side workflows in process](#server-side-workflows-in-process)). Set `VALIDATE_RESPONSES=true` and `LINT_DEFINITIONS=true` in `settings.env` to switch Validate Responses and Lint JSON Schemas on, and an AI provider for Extract Responses from Documents (its key goes in `.env`).
- The tests: `npm test` (`node --test`, a few seconds, no browser and no network), `npm run contract` (the shared contract test against a fresh database; `npm run contract -- --smoke` for the smoke test) and `npm run test:browser` (the shared Playwright specs; run `npx playwright install chromium` once).

`npm start` checks that nothing answers on the port first, then prints the folder it serves and its `<branch>@<commit>`:

```text
Serving C:\src\surveyjs-nodejs\ (master@4a96b83) on http://127.0.0.1:8000
```

### Prerequisites

- Node.js 24 or later (26 LTS recommended). `npm ci` on Node 22 or older stops with npm's own `EBADENGINE` error naming the version (`engines` in `package.json`, `engine-strict` in `.npmrc`), and `node server.js` says which version to install.
- `sharp`, which the extractor uses to find a document's QR code, installs a prebuilt binary: no build tools are needed. `.npmrc` sets `ignore-scripts=true`, so no package runs an install script.

On Windows:

- Install Node.js 26 LTS from [nodejs.org](https://nodejs.org) or with `winget install OpenJS.NodeJS.LTS`.
- After installing, restart your editor, not only its terminal: VS Code's terminals inherit VS Code's environment. To refresh the current PowerShell terminal instead:

  ```powershell
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  node --version
  ```

- npm runs scripts in `cmd`, so `VAR=value npm start` doesn't work there. Set a variable for one run like this, or put it in `settings.env`:

  ```powershell
  $env:APP_PORT=8001; npm start
  ```

  ```bash
  APP_PORT=8001 npm start
  ```

On Windows, a second server can bind a port another server already listens on (one on `0.0.0.0`, one on `127.0.0.1`) while the first keeps answering. So `npm start` and `npm run dev` connect to the port first and stop with "Port 8000 is already in use. Another copy of this app (another checkout or branch?) may be running. Stop it, or set APP_PORT." The contract test's AI stub uses a free port of its own (`AI_STUB_PORT`, default 3020, when you start it by hand).

### Stop everything

`Ctrl+C` in the terminal: the app closes the relays, the connections and the database, and the port is free at once. To find a server left running in another terminal or checkout:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object OwningProcess
Stop-Process -Id <OwningProcess>
```

```bash
lsof -i :8000
kill <PID>
```

With Docker, `docker compose down`.

### Run a branch or a PR

- Check the branch out in its own folder, with `git worktree add ../surveyjs-nodejs-pr <branch>` (for a pull request, `git fetch origin pull/<number>/head:pr-<number>` first) or a second clone, and run `npm ci` there. `node_modules/`, `.env` and `storage/` belong to each checkout.
- Run one checkout on the default port at a time: stop the other one first, or start the second with `APP_PORT=8001` (PowerShell: `$env:APP_PORT=8001; npm start`).
- The page says which checkout answered: "Running `<branch>@<commit>`" under the catalog's footer buttons and at the end of every example's Description panel.

## Docker

```bash
docker compose up --build    # http://127.0.0.1:8000
```

The image (`Dockerfile`) is `node:26-slim` with `npm ci --omit=dev`, runs as the image's `node` user with `NODE_ENV=production`, and starts with `node server.js` (not `npm start`, which doesn't pass `SIGTERM` on). It creates and seeds the database on its first start. Its one volume, `/app/storage`, holds the database, the uploads, the visitor sandboxes and the relay snapshots. Logs go to stdout and stderr (`docker compose logs`). One process handles every visitor: extraction and translation wait on the network without blocking anyone, and linting, validation and PDFs take a few milliseconds each (measured: 15–55 ms for a claim PDF, under 6 ms to lint the largest seeded form).

### Behind a proxy

The app trusts `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` from any proxy (`app.set("trust proxy", true)` in `app.js`), so behind a TLS proxy its absolute URLs and the relays' `wss://` URLs use the scheme the visitor sees, and `Secure` cookies work. In your own production, narrow it to the proxy's address (`app.set("trust proxy", "loopback")`, or a subnet) and don't publish the app's port. The relays are on the app's own host and port, so the proxy needs no extra route, only WebSocket upgrades passed through. For Traefik, next to your entry point and TLS labels:

```yaml
services:
  app:
    labels:
      - traefik.http.routers.surveyjs.rule=Host(`example.com`)
      - traefik.http.services.surveyjs.loadbalancer.server.port=8000
```

Traefik passes WebSocket upgrades on by default. `RELAY_URL` and `EDIT_RELAY_URL` are only needed when `/ws/` is served from another origin.

## Configuration

Two files hold the settings. `settings.env` is committed and holds every setting except the private keys. `.env` is git-ignored and holds only the private keys: `SURVEYJS_LICENSE_KEY`, `AI_API_KEY`, `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` (`npm run setup` copies `.env.example` to it). `npm start` loads both with Node's own `--env-file` (no `dotenv`): variables set in the environment win, then `.env`, then `settings.env`. The Docker image loads `settings.env` the same way, and `docker compose` passes `.env` in. `config.js` reads every setting once, and no other file reads `process.env`. Switches accept `1`, `true`, `on` or `yes`.

| Variable | Default | What it does |
|---|---|---|
| `APP_PORT` | `8000` | Where the app listens. Wins over `PORT`. |
| `PORT` | unset | Set by Azure App Service and Heroku; used when `APP_PORT` isn't. |
| `APP_HOST` | `127.0.0.1` (`0.0.0.0` when `PORT` is set) | The address the app binds. |
| `NODE_ENV` | `development` | `production` caches templates and hides stack traces. |
| `DATA_DIR` | `storage` | The database, uploads, sandboxes and relay snapshots. |
| `SURVEYJS_LICENSE_KEY` | empty | Calls `setLicenseKey()` on every page and, at startup, on the server, so it covers server PDFs too. Without it, the commercial components show a licence banner. |
| `VALIDATE_RESPONSES` | `false` | Validate Responses: `routes/validate-response.js` replaces `routes/save-response.js`. |
| `LINT_DEFINITIONS` | `false` | Lint JSON Schemas: `routes/lint-definition.js` replaces the PUT in `routes/creator-load-save.js`. |
| `SURVEYJS_AI_PROVIDER`, `SURVEYJS_AI_MODEL`, `SURVEYJS_OLLAMA_BASE_URL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | empty | Extract Responses from Documents: the extractor's provider (`openai`, `anthropic` or `ollama`), chosen as SurveyJS Server chooses it. Without `SURVEYJS_AI_PROVIDER`, the provider whose key is set. |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | OpenAI, empty, `gpt-4o-mini` | Translate with AI: any OpenAI-compatible `/chat/completions` endpoint. Without a key, `/api/translate` answers `501`. |
| `RELAY_URL`, `EDIT_RELAY_URL` | empty | The relays' origin when a proxy serves `/ws/` elsewhere, for example `wss://example.com`. Empty: the page's own origin. |
| `DEMO_MODE` | `false` | The hosted demo's visitor sandboxes (below). |
| `SURVEYJS_BUILD` | from git | The `<branch>@<commit>` the pages show as "Running …". Hosted demos set it at deploy. |
| `SURVEYJS_DOCS`, `SURVEYJS_GITHUB` | the Node.js docs page, this repository | Where the pages link. |

There is no `SURVEYJS_SERVICE_URL`: Run Server-Side Workflows don't call a service here. The in-process code is in `routes/validate-response.js`, `lint-definition.js`, `server-pdf.js` and `extract-from-paper.js`, with `integration/surveyjs.js` and `integration/ai-provider.js`.

## The examples

<!-- steps:start (generated by `npm run readme` from surveyjs-integration.json) -->
| Example | Run | Server | Client | Page | Licence |
|---|---|---|---|---|---|
| [Save Responses](https://surveyjs.io/documentation/backend-integration-nodejs-express#save-responses) | [/examples/save-response](https://surveyjs-nodejs.demos.surveyjs.io/examples/save-response) | [`routes/save-response.js`](routes/save-response.js) | [`shared/client/save-response.js`](shared/client/save-response.js) | [`views/examples/save-response.njk`](views/examples/save-response.njk) | MIT |
| [Load JSON Schemas, Variables, and Answers](https://surveyjs.io/documentation/backend-integration-nodejs-express#load-json-schemas-variables-and-answers) | [/examples/load-definition-variables-data](https://surveyjs-nodejs.demos.surveyjs.io/examples/load-definition-variables-data) | [`routes/load-definition-variables-data.js`](routes/load-definition-variables-data.js) | [`shared/client/load-definition-variables-data.js`](shared/client/load-definition-variables-data.js) | [`views/examples/load-definition-variables-data.njk`](views/examples/load-definition-variables-data.njk) | MIT |
| [Resume Progress](https://surveyjs.io/documentation/backend-integration-nodejs-express#resume-progress) | [/examples/resume-progress](https://surveyjs-nodejs.demos.surveyjs.io/examples/resume-progress) | [`routes/resume-progress.js`](routes/resume-progress.js) | [`shared/client/resume-progress.js`](shared/client/resume-progress.js) | [`views/examples/resume-progress.njk`](views/examples/resume-progress.njk) | MIT |
| [Store Files Separately](https://surveyjs.io/documentation/backend-integration-nodejs-express#store-files-separately) | [/examples/store-files](https://surveyjs-nodejs.demos.surveyjs.io/examples/store-files) | [`routes/store-files.js`](routes/store-files.js) | [`shared/client/store-files.js`](shared/client/store-files.js) | [`views/examples/store-files.njk`](views/examples/store-files.njk) | MIT |
| [Load Choices from Web](https://surveyjs.io/documentation/backend-integration-nodejs-express#load-choices-from-web) | [/examples/choices-from-web](https://surveyjs-nodejs.demos.surveyjs.io/examples/choices-from-web) | [`routes/choices-from-web.js`](routes/choices-from-web.js) | [`shared/client/choices-from-web.js`](shared/client/choices-from-web.js) | [`views/examples/choices-from-web.njk`](views/examples/choices-from-web.njk) | MIT |
| [Async Calculations and Validation](https://surveyjs.io/documentation/backend-integration-nodejs-express#async-calculations-and-validation) | [/examples/async-functions](https://surveyjs-nodejs.demos.surveyjs.io/examples/async-functions) | [`routes/async-functions.js`](routes/async-functions.js) | [`shared/client/async-functions.js`](shared/client/async-functions.js) | [`views/examples/async-functions.njk`](views/examples/async-functions.njk) | MIT |
| [Use Relational Storage](https://surveyjs.io/documentation/backend-integration-nodejs-express#use-relational-storage) | [/examples/relational-storage](https://surveyjs-nodejs.demos.surveyjs.io/examples/relational-storage) | [`routes/relational-storage.js`](routes/relational-storage.js) | [`shared/client/relational-storage.js`](shared/client/relational-storage.js) | [`views/examples/relational-storage.njk`](views/examples/relational-storage.njk) | MIT |
| [Fill Forms Together](https://surveyjs.io/documentation/backend-integration-nodejs-express#fill-forms-together) | [/examples/fill-together](https://surveyjs-nodejs.demos.surveyjs.io/examples/fill-together) | [`relay/fill-relay.js`](relay/fill-relay.js) | [`shared/client/fill-together.js`](shared/client/fill-together.js) | [`views/examples/fill-together.njk`](views/examples/fill-together.njk) | MIT |
| [Analyze Results with Dashboard](https://surveyjs.io/documentation/backend-integration-nodejs-express#analyze-results-with-dashboard) | [/examples/dashboard](https://surveyjs-nodejs.demos.surveyjs.io/examples/dashboard) | [`routes/dashboard.js`](routes/dashboard.js) | [`shared/client/dashboard.js`](shared/client/dashboard.js) | [`views/examples/dashboard.njk`](views/examples/dashboard.njk) | Commercial client |
| [Load and Save Form JSON Schemas](https://surveyjs.io/documentation/backend-integration-nodejs-express#load-and-save-form-json-schemas) | [/examples/creator-load-save](https://surveyjs-nodejs.demos.surveyjs.io/examples/creator-load-save) | [`routes/creator-load-save.js`](routes/creator-load-save.js) | [`shared/client/creator-load-save.js`](shared/client/creator-load-save.js) | [`views/examples/creator-load-save.njk`](views/examples/creator-load-save.njk) | Commercial client |
| [Upload Files](https://surveyjs.io/documentation/backend-integration-nodejs-express#upload-files) | [/examples/creator-uploads](https://surveyjs-nodejs.demos.surveyjs.io/examples/creator-uploads) | [`routes/store-files.js`](routes/store-files.js) | [`shared/client/creator-uploads.js`](shared/client/creator-uploads.js) | [`views/examples/creator-uploads.njk`](views/examples/creator-uploads.njk) | Commercial client |
| [Translate with AI](https://surveyjs.io/documentation/backend-integration-nodejs-express#translate-with-ai) | [/examples/ai-translation](https://surveyjs-nodejs.demos.surveyjs.io/examples/ai-translation) | [`routes/ai-translation.js`](routes/ai-translation.js) | [`shared/client/ai-translation.js`](shared/client/ai-translation.js) | [`views/examples/ai-translation.njk`](views/examples/ai-translation.njk) | Commercial client, needs an AI provider |
| [Variable Presets](https://surveyjs.io/documentation/backend-integration-nodejs-express#variable-presets) | [/examples/variable-presets](https://surveyjs-nodejs.demos.surveyjs.io/examples/variable-presets) | [`routes/variable-presets.js`](routes/variable-presets.js) | [`shared/client/variable-presets.js`](shared/client/variable-presets.js) | [`views/examples/variable-presets.njk`](views/examples/variable-presets.njk) | Commercial client |
| [Edit Forms Together](https://surveyjs.io/documentation/backend-integration-nodejs-express#edit-forms-together) | [/examples/edit-together](https://surveyjs-nodejs.demos.surveyjs.io/examples/edit-together) | [`relay/edit-relay.js`](relay/edit-relay.js) | [`shared/client/edit-together.js`](shared/client/edit-together.js) | [`views/examples/edit-together.njk`](views/examples/edit-together.njk) | Commercial client |
| [Validate Responses](https://surveyjs.io/documentation/backend-integration-nodejs-express#validate-responses) | [/examples/validate-response](https://surveyjs-nodejs.demos.surveyjs.io/examples/validate-response) | [`routes/validate-response.js`](routes/validate-response.js) | [`shared/client/validate-response.js`](shared/client/validate-response.js) | [`views/examples/validate-response.njk`](views/examples/validate-response.njk) | MIT |
| [Lint JSON Schemas](https://surveyjs.io/documentation/backend-integration-nodejs-express#lint-json-schemas) | [/examples/lint-definition](https://surveyjs-nodejs.demos.surveyjs.io/examples/lint-definition) | [`routes/lint-definition.js`](routes/lint-definition.js) | [`shared/client/lint-definition.js`](shared/client/lint-definition.js) | [`views/examples/lint-definition.njk`](views/examples/lint-definition.njk) | MIT |
| [Generate PDFs](https://surveyjs.io/documentation/backend-integration-nodejs-express#generate-pdfs) | [/examples/server-pdf](https://surveyjs-nodejs.demos.surveyjs.io/examples/server-pdf) | [`routes/server-pdf.js`](routes/server-pdf.js) | [`shared/client/server-pdf.js`](shared/client/server-pdf.js) | [`views/examples/server-pdf.njk`](views/examples/server-pdf.njk) | Commercial |
| [Extract Responses from Documents](https://surveyjs.io/documentation/backend-integration-nodejs-express#extract-responses-from-documents) | [/examples/extract-from-paper](https://surveyjs-nodejs.demos.surveyjs.io/examples/extract-from-paper) | [`routes/extract-from-paper.js`](routes/extract-from-paper.js) | [`shared/client/extract-from-paper.js`](shared/client/extract-from-paper.js) | [`views/examples/extract-from-paper.njk`](views/examples/extract-from-paper.njk) | MIT, needs an AI provider |
<!-- steps:end -->

## Where each example lives

Each example is two or three files you can read on their own. The full explanation is in [the docs](https://surveyjs.io/documentation/backend-integration-nodejs-express).

- `routes/<slug>.js`: the example's routes, the server code the docs show, as `export default function (app) { app.post(…) }`. `app.js` mounts them in the docs' order, and picks `validate-response.js` or `save-response.js`, and `lint-definition.js` or `creator-load-save.js`, by the switches.
- `shared/client/<slug>.js`: the example's client code, a plain ES module, the same file on every platform.
- `views/examples/<slug>.njk`: the example's page: its description, the "Try this" list and the component.
- `relay/fill-relay.js` and `relay/edit-relay.js`: the relays of Fill Forms Together and Edit Forms Together, with their rooms in `relay/fill-room.js` and `relay/edit-room.js`. `relay/index.js` attaches them to the app's HTTP server.
- `integration/`: small helpers some routes call, so the code the docs show stays about SurveyJS. They aren't demo code:
  - `stored-json.js` (`save-response`, `relational-storage`, `validate-response`, the fill relay): inserts a response as one JSON document, with an ISO 8601 UTC `created_at`.
  - `surveyjs.js` and `ai-provider.js` (Run Server-Side Workflows): the linter options, the response errors, the PDF call, the extraction timeout and provider, and the logging.
  - `ai-translation.js` (Translate with AI): the call to your OpenAI-compatible provider.
  - `http.js`, `cache.js`, `file-type.js`: errors with a status, fetch with a timeout, the countries cache, and file types by their first bytes.
- `db.js` (`db(req)`, SQLite through `node:sqlite`) and `auth.js` (`can()`, `canReadFile()`).

To copy an example, copy its route file and the helpers it imports. The code the docs show is cut from these files between `// #region sjs:<slug>.server` (or `.client`) and `// #endregion`. `surveyjs-integration.json` lists every example's files and regions; `npm run check` verifies them, and `npm run contract` runs the shared contract test (`shared/contract-tests/run.mjs`) against a fresh database. Any of `better-sqlite3`, Prisma or Knex works just as well as `node:sqlite`; the examples use plain SQL so that a response stays visibly one JSON document.

### Shared files

`shared/` holds what every platform repository uses byte for byte: the client modules, the form definitions, samples and seed data, the page UI (`shared/ui/`), and the contract, smoke and browser tests. It is a copy of [`surveyjs-php-laravel`](https://github.com/surveyjs/surveyjs-php-laravel)'s `shared/` at the commit in `shared/UPSTREAM`; `npm run check` compares it with `shared/SHA256SUMS`. Don't edit it here: send a fix to that repository, then copy `shared/` again.

### Editing example descriptions

The text in an example's Description panel is the `description` block of `views/examples/<slug>.njk`. It can hold several paragraphs, links and other markup:

```njk
{% block description %}
    <p>Your custom description.</p>
    <p>More details with <strong>formatting</strong>.</p>
{% endblock %}
```

The "Try this" list is the `try` block; the layout is `views/layouts/example.njk`. The catalog cards use `need` from `surveyjs-integration.json` for their "Use when" text.

### Storing JSON exactly as it arrives

A response, a definition, saved progress and variable presets are each one JSON document, stored as text and returned as stored.

- `express.json({ limit: "12mb", strict: false })` in `app.js` parses every body. The limit is above the 100 KB default because a Creator definition with images is bigger. `strict: false` hands any JSON value to the handler, so a top-level `null` or string gets the handler's own `400`, not a parse error. A body that isn't JSON leaves `req.body` undefined, which every handler treats as a wrong envelope.
- The handlers store `JSON.stringify(req.body…)` and nothing else. They never copy the parsed document (spread, `Object.assign`, `structuredClone`): `JSON.parse` creates a `"__proto__"` key as an ordinary property, and a copy would turn it into the copy's prototype.
- `JSON.parse` keeps `{}`, `[{}]`, `null`, `""`, whitespace inside strings and non-ASCII text. `1.0` becomes `1`, because JavaScript has one number type; that only matters if you compare stored JSON as text.
- `created_at` is ISO 8601 UTC without milliseconds (`2026-11-15T12:00:00Z`), so the dashboard's date filters are string comparisons; `integration/stored-json.js` formats it.

## Server-side workflows in process

SurveyJS Server ([surveyjs/surveyjs-server](https://github.com/surveyjs/surveyjs-server)) is itself an Express 5 app. Here the same libraries run in the app, following its source at `db1ac24`, so these routes accept and reject what the service does:

- `routes/validate-response.js`: `lintSurvey()` from `survey-core/linter` on the stored definition, then `new Model(definition)`, `setData(data, {})` and `validate()` from `survey-core`.
- `routes/lint-definition.js`: `lintSurvey()` with the service's rule overrides.
- `routes/server-pdf.js` and the blank work order in `routes/extract-from-paper.js`: `new SurveyPDF(definition)` from `survey-pdf` (in `integration/surveyjs.js`).
- `routes/extract-from-paper.js`: `createExtractor()` and `extractFromImage()` from `ai-form-response-extractor`, with the provider from `integration/ai-provider.js`.

A failure in the libraries is this app's own error (`500`); `502` and `504` are kept for the AI provider. `SURVEYJS_LICENSE_KEY` covers server PDFs here, because `server.js` calls `setLicenseKey()` at startup. When your backend isn't Node.js, run the same code as a separate service: SurveyJS Server, which the [PHP](https://github.com/surveyjs/surveyjs-php-laravel) and [ASP.NET Core](https://github.com/surveyjs/surveyjs-aspnet-core) examples call over HTTP.

## How data works in the demo

Locally, everyone shares one SQLite database, `storage/database.sqlite` (delete `storage/` to start over).

On the hosted demo (`DEMO_MODE=true`), each visitor gets a private copy of the seeded database and uploads folder, chosen by a `demo_sid` cookie, and kept until it has been unused for 24 hours (an hourly timer in `server.js`). The "Open a second window" link in Fill Forms Together and Edit Forms Together carries that id (`?join=`), so whoever opens it works in the same copy and the same relay rooms. The demo also caps uploads at 5 MB and the AI examples at 20 calls per visitor per day, counted in this process: with several processes, keep the counts in a shared store. None of this is in the example code.

## Front end

- The pages are [Nunjucks](https://mozilla.github.io/nunjucks/) templates (`views/`), autoescaped. Nunjucks has layouts and blocks (`{% extends %}`, `{% block %}`) that map one to one onto the Blade views of the reference repository, so each page diffs against its PHP source in template syntax only, with the Tailwind class strings unchanged; EJS, the most common Express engine, has no layouts or blocks, and Pug would rewrite every element. Its syntax is also the Jinja syntax of the Flask port. (LiquidJS has the same layout and block model, if you prefer a maintained alternative.) Inline JSON goes through one `script_json` filter (`app.js`), which escapes `<`, `>`, `&`, U+2028 and U+2029, so a `</script>` in a definition can't end the script.
- The site stylesheet is Tailwind CSS v4 without Preflight: `styles/site.css` imports `tailwindcss/theme.css` (static), `tailwindcss/utilities.css` and `shared/ui/theme.css`. `npm run css` builds it into `public/css/site.css` with `@tailwindcss/cli`. The output is committed, so `npm start` never builds CSS; CI rebuilds it and fails on a difference.
- The client code is the shared ES modules in `shared/client/` and `shared/ui/`, loaded unchanged with `<script type="module">` and an import map (`demo/import-map.js`). The SurveyJS packages come from this app's own `node_modules` (`/vendor/<package>@<version>/`, pinned to `shared/surveyjs-version.json`), and the others (`chart.js`, `lodash-es`, highlight.js) from unpkg at pinned versions. There is no bundler.
- The forms use the SurveyJS Tailwind adapter (`survey-core/themes/adapters/tailwind4.css`). No page calls `applyTheme()`: its inline styles would override the adapter.

## Not on Express?

The routes only use the request, the database and the response, so they port in a few lines. Save Responses in Fastify 5, whose JSON parser also keeps `{}`:

```js
fastify.post("/api/responses", async (request, reply) => {
  const { formId, data } = request.body ?? {};
  if (formId == null || data == null) return reply.code(400).send({ error: "Expected { formId, data }" });

  const { lastInsertRowid } = db.prepare("INSERT INTO responses (form_id, data, created_at) VALUES (?, ?, ?)")
    .run(formId, JSON.stringify(data), new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  return reply.code(201).send({ id: Number(lastInsertRowid) });
});
```

The same goes for the middleware this demo leaves out: `helmet`, `cors`, `morgan`, `compression`, `express-rate-limit`, `cookie-parser` or `express-session` are each a reasonable choice in a real app. They aren't here so that every line you read is about SurveyJS.

## Disclaimer

These examples must not be used as a real service as they are. They don't cover authentication, authorization, user management, access levels and other security aspects of a real survey service. The places where real checks go are marked:

- `can(user, "edit-forms")` and `canReadFile(user, file)` in `auth.js`: who may save definitions and presets, and who may read an uploaded file.
- `demo/users.js`: the demo-user switch stands in for your session or token middleware (`express-session`, Passport, a JWT check). The relays check the same cookie in `relay/index.js`.

When you copy an example into your app, leave out the demo-only code: the `demo/` folder (and its lines in `app.js`, `server.js` and `relay/index.js`), `pages.js`, `views/`, `shared/ui/` (the page frame, its tabs and highlighting, the fonts and site images) and `shared/client/host.js` (its `mountSurvey()` is one line: `renderSurvey(survey, element)` from `survey-js-ui`), and `relay/room-key.js`'s sandbox keys.

## Licence

The code in this repository is available under the [MIT licence](LICENSE).

The examples use SurveyJS Form Library, which is MIT-licensed as well. The examples marked "Commercial" in the Licence column above also use SurveyJS Survey Creator, Dashboard or PDF Generator, which are commercial products. You can integrate them and evaluate their functionality without a licence. Production use requires a developer licence for each developer who works with the SurveyJS APIs or implements the integration. See the [SurveyJS Licensing FAQ](https://surveyjs.io/faq#licensing) and the [End-User License Agreement](https://surveyjs.io/Developer-License-Agreement.pdf).
