// shared/client/host.js: request and response bodies in the requests log (design 02, Change 4).
// Capture is opt-in by the #request-row template, bounded to 64 KB, read through a clone in a
// detached task, and never changes what the caller sends or receives.
import { expect, test } from '@playwright/test';
import { completeSaveResponse, row, slot, spyOnClone, spyOnReaders, startStreamServer } from './helpers.js';

const LIMIT = 64 * 1024;
let stream;

test.beforeAll(async () => {
    stream = await startStreamServer();
});
test.afterAll(async () => {
    await stream.close();
});

/** /stream/… on the app's origin, answered by the streaming server */
async function routeStream(page) {
    await page.route('**/stream/**', (route) => route.continue({ url: stream.url + new URL(route.request().url()).pathname }));
}

test('1. a template without the body slots: the page works as before and nothing is cloned', async ({ page }) => {
    await page.addInitScript(spyOnClone);
    await page.route('**/examples/save-response', async (route) => {
        const response = await route.fetch();
        const html = (await response.text()).replace(/<pre data-field="(request|response)-body"[^>]*><\/pre>/g, '');
        await route.fulfill({ response, body: html });
    });
    await page.goto('/examples/save-response');
    expect(await page.locator('#request-row').evaluate((t) => t.content.querySelectorAll('[data-field$="-body"]').length)).toBe(0);

    await completeSaveResponse(page);
    const posted = row(page, 'POST', '/api/responses');
    await expect(posted).toHaveAttribute('data-state', 'ok');
    await expect(posted.locator('[data-field="method"]')).toHaveText('POST');
    await expect(posted.locator('[data-field="url"]')).toHaveText('/api/responses');
    await expect(posted.locator('[data-field="status"]')).toHaveText('201');
    await expect(posted.locator('[data-field="time"]')).toHaveText(/^\d+ ms$/);
    await expect(page.locator('#notes > li').first()).toHaveText(/^Response #\d+: the server saved the submitted data without changes\.$/);
    await expect(page.locator('#notes > li').first()).toHaveAttribute('data-kind', 'ok');

    // The caller gets the same body as a request from outside the page
    const viaPage = await page.evaluate(() => fetch('/demo/stored/save-response').then((r) => r.text()));
    const direct = await (await page.request.get('/demo/stored/save-response')).text();
    expect(viaPage).toBe(direct);
    expect(await page.evaluate(() => window.__clones)).toEqual([]);
});

test("2. a JSON response: the step script's res.json() gets it unchanged, the slot shows it pretty-printed", async ({ page }) => {
    const raw = '{"definition":{"title":"Marker ✓ naïve — 東京","elements":[{"type":"text","name":"q1","title":"Question one"}]},"variables":{"plan":"basic","amount":1.0},"data":{"q1":"prefilled"}}';
    await page.route('**/api/forms/claim-request*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: raw }));
    await page.goto('/examples/load-definition-variables-data');

    // The step script built the form from the whole body
    await expect(page.locator('#component').getByText('Marker ✓ naïve — 東京')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Question one' })).toHaveValue('prefilled');

    const loaded = row(page, 'GET', '/api/forms/claim-request');
    expect(await slot(loaded, 'request-body')).toBe('(no body)');
    expect(await slot(loaded, 'response-body')).toBe(JSON.stringify(JSON.parse(raw), null, 2));

    // Another caller reads the exact bytes
    expect(await page.evaluate(() => fetch('/api/forms/claim-request?record=').then((r) => r.text()))).toBe(raw);
});

test('3. large text without Content-Length: 64 KB and "… (truncated)", the reader cancelled, the caller reads it all', async ({ page }) => {
    await page.addInitScript(spyOnReaders);
    await routeStream(page);
    await page.goto('/examples/save-response');

    const length = await page.evaluate(async () => {
        window.__readers = [];
        const response = await fetch('/stream/text');
        return (await response.text()).length;
    });
    expect(length).toBe(1 << 20);

    const streamed = row(page, 'GET', '/stream/text');
    expect(await slot(streamed, 'response-body')).toBe(`${'a'.repeat(LIMIT)}\n… (truncated)`);
    // Other readers are the small JSON bodies of the Stored refresh, read to the end
    const readers = (await page.evaluate(() => window.__readers)).filter((reader) => reader.bytes >= LIMIT);
    expect(readers).toHaveLength(1);
    expect(readers[0].cancelled).toBe(true);
    expect(readers[0].bytesBeforeLastRead).toBeLessThan(LIMIT);   // no chunk pulled after the limit
    expect(readers[0].bytes).toBeLessThan(1 << 20);
});

test('4. binary: (application/pdf, size unknown) or (application/pdf, N bytes), never cloned', async ({ page }) => {
    await page.addInitScript(spyOnClone);
    await routeStream(page);
    await page.route('**/api/claims/*/pdf', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.alloc(12345, 37) }));
    await page.goto('/examples/server-pdf');

    const sizes = await page.evaluate(async () => {
        window.__clones = [];
        const unknown = await (await fetch('/stream/claim.pdf')).blob();
        const known = await (await fetch('/api/claims/1/pdf')).blob();
        return [unknown.size, known.size];
    });
    expect(sizes).toEqual([1 << 20, 12345]);
    expect(await slot(row(page, 'GET', '/stream/claim.pdf'), 'response-body')).toBe('(application/pdf, size unknown)');
    expect(await slot(row(page, 'GET', '/api/claims/1/pdf'), 'response-body')).toBe('(application/pdf, 12345 bytes)');
    expect((await page.evaluate(() => window.__clones)).filter((path) => /[./]pdf$/.test(path))).toEqual([]);
});

test('5. when capture fails, the request still resolves and the slot says (body unavailable)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
        window.__unhandled = [];
        addEventListener('unhandledrejection', (e) => window.__unhandled.push(String(e.reason)));
        ReadableStream.prototype.getReader = () => {
            throw new Error('getReader is broken');
        };
    });
    await page.goto('/examples/save-response');

    await completeSaveResponse(page);
    const posted = row(page, 'POST', '/api/responses');
    await expect(posted).toHaveAttribute('data-state', 'ok');
    await expect(posted.locator('[data-field="status"]')).toHaveText('201');
    expect(await slot(posted, 'response-body')).toBe('(body unavailable)');

    // The caller's promise resolves with the whole body
    const stored = await page.evaluate(() => fetch('/demo/stored/save-response').then((r) => r.json()));
    expect(stored).toHaveProperty('responses');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__unhandled)).toEqual([]);
    expect(errors).toEqual([]);
});

test('6. XHR: choicesByUrl logs its body, a blob response shows (blob, size unknown), the caller is unchanged', async ({ page }) => {
    await page.goto('/examples/choices-from-web');

    const countries = row(page, 'GET', '/api/countries');
    await expect(countries).toHaveAttribute('data-state', 'ok');
    const direct = await (await page.request.get('/api/countries')).text();
    expect(await slot(countries, 'request-body')).toBe('(no body)');
    expect(await slot(countries, 'response-body')).toBe(JSON.stringify(JSON.parse(direct), null, 2));

    const viaBlob = await page.evaluate(() => new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/countries?as=blob');
        xhr.responseType = 'blob';
        xhr.onload = async () => resolve({ isBlob: xhr.response instanceof Blob, text: await xhr.response.text() });
        xhr.send();
    }));
    expect(viaBlob.isBlob).toBe(true);
    expect(viaBlob.text).toBe(direct);
    expect(await slot(row(page, 'GET', '/api/countries?as=blob'), 'response-body')).toBe('(blob, size unknown)');
});

test('7. No requests reflects the visible rows when demo requests are filtered or cleared', async ({ page }) => {
    await page.route('**/api/request-log-check', (route) => route.fulfill({ json: { ok: true } }));
    await page.goto('/examples/save-response');
    await page.getByRole('tab', { name: 'Requests', exact: true }).click();
    const empty = page.locator('#requests-empty');
    const showDemo = page.getByRole('checkbox', { name: 'Show demo requests', exact: true });
    const demoRows = page.locator('#requests > li[data-demo="true"]');
    const refreshDemo = () => page.evaluate(() => fetch('/demo/stored/save-response').then((response) => response.json()));

    // The initial stored-data request is logged but excluded by the filter.
    await expect(demoRows).not.toHaveCount(0);
    await expect(showDemo).not.toBeChecked();
    await expect(empty).toBeVisible();
    await showDemo.check();
    await expect(demoRows.first()).toBeVisible();
    await expect(empty).toBeHidden();
    await showDemo.uncheck();
    await expect(demoRows.first()).toBeHidden();
    await expect(empty).toBeVisible();

    // A real request stays visible with either filter setting.
    await page.evaluate(() => fetch('/api/request-log-check').then((response) => response.json()));
    await expect(row(page, 'GET', '/api/request-log-check')).toBeVisible();
    await expect(empty).toBeHidden();
    await showDemo.check();
    await showDemo.uncheck();
    await expect(empty).toBeHidden();

    // Clearing and subsequent demo requests obey the current filter setting.
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(empty).toBeVisible();
    await refreshDemo();
    await expect(demoRows.first()).toBeHidden();
    await expect(empty).toBeVisible();
    await showDemo.check();
    await expect(empty).toBeHidden();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(empty).toBeVisible();
    await refreshDemo();
    await expect(demoRows.first()).toBeVisible();
    await expect(empty).toBeHidden();
    await showDemo.uncheck();
    await expect(empty).toBeVisible();
});
