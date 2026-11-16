import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const draft = {
    answers: { customer_name: 'Demo customer', site_address: null, resolved: false, notes: 'Check this answer' },
    confidence: [
        { fieldName: 'notes', confidence: 0.55, flagged: true },
        { fieldName: 'site_address', confidence: null, flagged: true },
    ],
    uniqueId: 'WO-456',
};
const extractButton = page => page.getByRole('button', { name: 'Use the sample scan', exact: true });
const saveButton = page => page.getByRole('button', { name: 'Save reviewed response', exact: true });
const reviewed = page => page.getByRole('checkbox', { name: 'I have reviewed these answers', exact: true });
const confirmReview = page => page.locator('#form').getByText('I have reviewed these answers', { exact: true }).click();

test('blank work order download can be retried and preserves the current review draft', async ({ page }) => {
    const pending = Promise.withResolvers();
    const pdf = Buffer.from('%PDF-1.7\nBlank work order\n%%EOF');
    let fail = true, extractions = 0, saves = 0;
    await page.route('**/api/work-orders/blank.pdf', async route => {
        if (fail) {
            await pending.promise;
            return route.fulfill({ status: 503, json: { error: 'PDF service unavailable' } });
        }
        return route.fulfill({ contentType: 'application/pdf', body: pdf });
    });
    await page.route('**/api/work-orders/extract', route => { extractions++; return route.fulfill({ json: draft }); });
    await page.route('**/api/responses', route => { saves++; return route.fulfill({ status: 201, json: { id: 813 } }); });
    await page.goto('/examples/extract-from-paper');
    await page.getByRole('textbox', { name: /^Customer name/ }).fill('Keep this draft');
    await page.getByRole('textbox', { name: /^Customer name/ }).blur();
    await confirmReview(page);
    await page.getByRole('button', { name: 'Download blank work order', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Preparing PDF...', exact: true })).toBeDisabled();
    pending.resolve();
    await expect(page.locator('#work-order-download-error')).toHaveText('PDF service unavailable');
    fail = false;
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download blank work order', exact: true }).click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe('work-order.pdf');
    expect(readFileSync(await file.path())).toEqual(pdf);
    await expect(page.locator('#work-order-download-error')).toBeHidden();
    await expect(page.getByRole('textbox', { name: /^Customer name/ })).toHaveValue('Keep this draft');
    await expect(reviewed(page)).toBeChecked();
    expect(extractions).toBe(0);
    expect(saves).toBe(0);
});

test('uploading a completed work order extracts a draft for review beside the PDF', async ({ page }) => {
    await page.route('**/api/work-orders/extract', route => route.fulfill({ json: draft }));
    await page.goto('/examples/extract-from-paper');
    await page.getByLabel('Upload completed work order', { exact: true }).setInputFiles({
        name: 'completed-work-order.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF'),
    });
    await expect(page.locator('[data-show="extract-status"]')).toHaveText('Draft ready for review');
    await expect(page.locator('#scan-pdf')).toBeVisible();
    await expect(page.locator('[data-show="extract-source"]')).toHaveText('completed-work-order.pdf');
    await expect(page.getByRole('textbox', { name: /^Customer name/ })).toHaveValue('Demo customer');
    await expect(reviewed(page)).not.toBeChecked();
});

test('extraction creates a reviewable draft and saves only after review, preserving false and blank answers', async ({ page }) => {
    let saved, saves = 0;
    await page.route('**/api/work-orders/extract', route => route.fulfill({ json: draft }));
    await page.route('**/api/responses', route => {
        saves++;
        saved = route.request().postDataJSON();
        return route.fulfill({ status: 201, json: { id: 811 } });
    });
    await page.goto('/examples/extract-from-paper');
    await extractButton(page).click();
    await expect(page.locator('[data-show="extract-status"]')).toHaveText('Draft ready for review');
    await expect(page.locator('#scan-image')).toBeVisible();
    await expect(page.locator('#scan-image')).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('[data-show="extract-review-count"]')).toHaveText('1');
    await expect(page.getByText('Review this answer (0% confidence)', { exact: true })).toBeHidden();
    expect(saves).toBe(0);
    await saveButton(page).click();
    await expect(page.getByText('You need to confirm that you have reviewed the answers.', { exact: true })).toBeVisible();
    expect(saves).toBe(0);
    await confirmReview(page);
    await page.getByRole('textbox', { name: /^Customer name/ }).fill('Corrected customer');
    await page.getByRole('textbox', { name: /^Customer name/ }).blur();
    await expect(reviewed(page)).not.toBeChecked();
    await page.getByRole('textbox', { name: /^Notes/ }).fill('');
    await page.getByRole('textbox', { name: /^Notes/ }).blur();
    await confirmReview(page);
    await saveButton(page).click();
    await expect(page.getByText('Response ID: 811', { exact: true })).toBeVisible();
    expect(saved.formId).toBe('work-order');
    expect(saved.data).toMatchObject({ customer_name: 'Corrected customer', site_address: null, notes: null, resolved: false });
    expect(saved.data).not.toHaveProperty('confidence');
    expect(saved.data).not.toHaveProperty('review_confirmation');
    expect(saves).toBe(1);
});

test('failed or malformed extraction retains the previous draft and document', async ({ page }) => {
    let verdict = 'success';
    await page.route('**/api/work-orders/extract', route => {
        if (verdict === 'success') return route.fulfill({ json: draft });
        if (verdict === 'malformed') return route.fulfill({ json: { answers: ['invalid'], confidence: [] } });
        return route.fulfill({ status: 502, json: { error: 'Extraction failed' } });
    });
    await page.goto('/examples/extract-from-paper');
    await extractButton(page).click();
    await expect(page.getByRole('textbox', { name: /^Customer name/ })).toHaveValue('Demo customer');
    const original = await page.locator('#scan-image').getAttribute('src');
    for (verdict of ['failure', 'malformed']) {
        await extractButton(page).click();
        await expect(page.locator('[data-show="extract-status"]')).toHaveText(verdict === 'failure' ? 'Extraction failed' : "The extraction result couldn't be read. Try again or enter the answers directly in the form.");
        await expect(page.getByRole('textbox', { name: /^Customer name/ })).toHaveValue('Demo customer');
        await expect(page.locator('#scan-image')).toHaveAttribute('src', original);
        await expect(page.locator('#extract-details')).toBeVisible();
    }
});

test('Start over cancels an in-flight extraction and ignores its late answer', async ({ page }) => {
    const pending = Promise.withResolvers();
    let started = false;
    await page.route('**/api/work-orders/extract', async route => {
        started = true;
        await pending.promise;
        return route.fulfill({ json: draft }).catch(() => {});
    });
    await page.goto('/examples/extract-from-paper');
    await extractButton(page).click();
    await expect.poll(() => started).toBe(true);
    await expect(extractButton(page)).toBeDisabled();
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    pending.resolve();
    await expect(page.locator('[data-show="extract-status"]')).toBeHidden();
    await expect(page.locator('#scan-preview')).toBeHidden();
    await expect(page.getByRole('textbox', { name: /^Customer name/ })).toHaveValue('');
    await expect(extractButton(page)).toBeEnabled();
});

test('unsupported and oversized files fail before extraction and sample-load failure is recoverable', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/work-orders/extract', route => { calls++; return route.fulfill({ json: draft }); });
    await page.route('**/shared/samples/work-order-scan.png', route => route.fulfill({ status: 404 }));
    await page.goto('/examples/extract-from-paper');
    await page.locator('#own-scan').setInputFiles({ name: 'scan.txt', mimeType: 'text/plain', buffer: Buffer.from('text') });
    await expect(page.locator('[data-show="extract-status"]')).toHaveText('Choose a PDF, PNG, JPEG, WebP, or GIF document.');
    await page.locator('#own-scan').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
    await expect(page.locator('[data-show="extract-status"]')).toHaveText('Choose a document of 5 MB or less.');
    await extractButton(page).click();
    await expect(page.locator('[data-show="extract-status"]')).toHaveText("Couldn't load the sample scan. Please try again.");
    expect(calls).toBe(0);
});

test('users can type directly after extraction fails and retry saving without another extraction', async ({ page }) => {
    let attempts = 0, extractions = 0;
    await page.route('**/api/work-orders/extract', route => { extractions++; return route.fulfill({ status: 503, json: { error: 'Extraction unavailable' } }); });
    await page.route('**/api/responses', route => ++attempts === 1
        ? route.fulfill({ status: 503, json: { error: 'Save unavailable. Please try again.' } })
        : route.fulfill({ status: 201, json: { id: 812 } }));
    await page.goto('/examples/extract-from-paper');
    await page.locator('#own-scan').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF') });
    await expect(page.locator('[data-show="extract-status"]')).toHaveText('Extraction unavailable');
    await expect(page.locator('#scan-pdf')).toBeVisible();
    await expect(page.locator('#scan-image')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Enter manually', exact: true })).toHaveCount(0);
    await page.getByRole('textbox', { name: /^Customer name/ }).fill('Manual customer');
    await page.getByRole('textbox', { name: /^Customer name/ }).blur();
    await confirmReview(page);
    await saveButton(page).click();
    await expect(page.getByRole('heading', { name: "The reviewed response hasn't been saved.", exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('Response ID: 812', { exact: true })).toBeVisible();
    expect(extractions).toBe(1);
    expect(attempts).toBe(2);
});
