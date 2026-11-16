import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { sharedJson, sharedPath } from './helpers.js';

const image = {
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: readFileSync(sharedPath('samples/work-order-scan.png')),
};
const creatorDefinition = sharedJson('definitions/creator-load-save.json');
const notes = (page, kind) => page.locator(`#notes > li[data-kind="${kind}"]`);

async function openRequests(page, slug) {
    await page.goto(`/examples/${slug}`);
    await page.locator('#panel-tab-requests').click();
}

async function chooseImage(page, slug) {
    const chooser = page.waitForEvent('filechooser');
    await page.locator(slug === 'store-files'
        ? '#form label[aria-label="Select File"]'
        : '#creator .svc-logo-image-placeholder').click();
    await (await chooser).setFiles(image);
}

async function mockCreator(page) {
    const savedDefinitions = [];
    await page.route('**/api/forms/support-assets', async (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { definition: creatorDefinition } });
        savedDefinitions.push(route.request().postDataJSON());
        return route.fulfill({ status: 204 });
    });
    return savedDefinitions;
}

for (const slug of ['store-files', 'creator-uploads']) {
    test(`${slug}: confirms an upload only after the backend returns file IDs`, async ({ page }) => {
        const pending = Promise.withResolvers();
        let uploadStarted = false;
        const savedDefinitions = slug === 'creator-uploads' ? await mockCreator(page) : [];
        await page.route('**/api/files', async (route) => {
            uploadStarted = true;
            await pending.promise;
            return route.fulfill({ json: ['uploaded-image'] });
        });
        await page.route('**/api/files/uploaded-image', (route) => route.fulfill({ contentType: 'image/png', body: image.buffer }));
        await openRequests(page, slug);
        await chooseImage(page, slug);
        await expect.poll(() => uploadStarted).toBe(true);
        // The previous messages appeared after 500/1500 ms even when the server had not replied.
        await page.waitForTimeout(1700);
        await expect(notes(page, 'ok')).toHaveCount(0);
        pending.resolve();

        if (slug === 'store-files') {
            await expect(notes(page, 'ok').first()).toHaveText(/^Files uploaded\. Storing file IDs reduced the response size from .+ to .+\.$/);
            await expect(page.locator('[data-show="sizes"]')).toContainText('with file IDs;');
        } else {
            await expect(notes(page, 'ok').first()).toHaveText('Logo uploaded.');
            await expect.poll(() => savedDefinitions.some((definition) => definition.logo === '/api/files/uploaded-image')).toBe(true);
        }
    });

    for (const failure of ['server error', 'missing file IDs']) {
        test(`${slug}: ${failure} shows an error and never confirms the upload`, async ({ page }) => {
            const savedDefinitions = slug === 'creator-uploads' ? await mockCreator(page) : [];
            await page.route('**/api/files', (route) => failure === 'server error'
                ? route.fulfill({ status: 503, json: { error: 'Upload unavailable' } })
                : route.fulfill({ json: [] }));
            await openRequests(page, slug);
            await chooseImage(page, slug);
            await expect(notes(page, 'error').first()).toHaveText(slug === 'store-files'
                ? "Couldn't upload files. Please try again."
                : "Couldn't upload the logo. Please try again.");
            await page.waitForTimeout(1700);
            await expect(notes(page, 'ok')).toHaveCount(0);
            expect(savedDefinitions).toEqual([]);
        });
    }
}

test('extraction shows a reviewable draft with separate document details and resets them', async ({ page }) => {
    let failExtraction = false;
    await page.route('**/api/work-orders/extract', (route) => failExtraction
        ? route.fulfill({ status: 502, json: { error: 'Extraction failed' } })
        : route.fulfill({ json: {
            answers: { customer_name: 'Demo customer', notes: 'Check the filter' },
            confidence: [{ fieldName: 'notes', confidence: 0.55, flagged: true }],
            uniqueId: 'WO-123',
        } }));
    await openRequests(page, 'extract-from-paper');
    await expect(page.locator('#extract-details')).toBeHidden();
    await page.getByRole('button', { name: 'Use the sample scan', exact: true }).click();
    await expect(page.locator('[data-show="extract-status"]')).toHaveText('Draft ready for review');
    await expect(page.locator('#extract-details')).toBeVisible();
    await expect(page.locator('[data-show="extract-source"]')).toHaveText('work-order-scan.png');
    await expect(page.locator('[data-show="extract-id"]')).toHaveText('WO-123');
    await expect(page.locator('[data-show="extract-review-count"]')).toHaveText('1');
    await expect(page.getByText('Review this answer (55% confidence)', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Customer name/ })).toHaveValue('Demo customer');

    failExtraction = true;
    await page.getByRole('button', { name: 'Use the sample scan', exact: true }).click();
    await expect(page.locator('[data-show="extract-status"]')).toHaveText('Extraction failed');
    await expect(notes(page, 'ok')).toHaveCount(1);
    await expect(page.getByText('Review this answer (55% confidence)', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await expect(page.locator('[data-show="extract-status"]')).toBeHidden();
    await expect(page.locator('#extract-details')).toBeHidden();
    await expect(page.locator('[data-show="extract-id"]')).toBeEmpty();
    await expect(page.getByText('Review this answer (55% confidence)', { exact: true })).toBeHidden();
});

test('progress remains pending until a successful save and reports a failed save', async ({ page }) => {
    const pending = Promise.withResolvers();
    let saves = 0;
    await page.route('**/api/progress/onboarding', async (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', json: null });
        saves++;
        if (saves > 1) return route.fulfill({ status: 503, json: { error: 'Save unavailable' } });
        await pending.promise;
        return route.fulfill({ status: 204 });
    });
    await openRequests(page, 'resume-progress');
    await page.getByRole('textbox', { name: /Full name/ }).fill('Demo visitor');
    await expect.poll(() => saves).toBe(1);
    await expect(page.locator('[data-show="saved"]')).toHaveText('Saving progress...');
    pending.resolve();
    await expect(page.locator('[data-show="saved"]')).toHaveText(/^Progress saved at /);
    await page.getByRole('textbox', { name: /Full name/ }).fill('Updated visitor');
    await expect(page.locator('[data-show="saved"]')).toHaveText("Couldn't save progress. Retry to save your latest changes.");
});

test('tampered response messages distinguish expected rejection from unexpected acceptance', async ({ page }) => {
    let rejectResponse = true;
    await page.route('**/api/responses', (route) => rejectResponse
        ? route.fulfill({ status: 400, json: { errors: [{ type: 'invalid-type', path: 'amount' }] } })
        : route.fulfill({ status: 201, json: { id: 321 } }));
    await openRequests(page, 'validate-response');
    await page.getByRole('button', { name: 'Wrong type', exact: true }).click();
    await expect(notes(page, 'ok').first()).toHaveText('Invalid response rejected as expected. No data was saved.');
    rejectResponse = false;
    await page.getByRole('button', { name: 'Wrong type', exact: true }).click();
    await expect(notes(page, 'error').first()).toHaveText('Invalid response was accepted and saved as #321.');
    await page.unroute('**/api/responses');
    await page.route('**/api/responses', (route) => route.abort('connectionfailed'));
    await page.getByRole('button', { name: 'Wrong type', exact: true }).click();
    await expect(notes(page, 'error').first()).toHaveText("Couldn't validate the response. Please try again.");
});

test('schema messages confirm accepted saves and give a next step for validation or network failures', async ({ page }) => {
    let verdict = 'saved';
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/api/forms/support-lint', (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { definition: creatorDefinition } });
        if (verdict === 'saved') return route.fulfill({ status: 204 });
        if (verdict === 'invalid') return route.fulfill({ status: 422, json: { errors: [{ message: 'Unknown question reference' }] } });
        return route.abort('connectionfailed');
    });
    await openRequests(page, 'lint-definition');
    await page.getByRole('button', { name: 'Unreachable condition', exact: true }).click();
    await page.getByRole('button', { name: 'Save Survey', exact: true }).click();
    await expect(notes(page, 'ok').first()).toHaveText('Form schema saved successfully.');
    verdict = 'invalid';
    await page.getByRole('button', { name: 'Broken reference', exact: true }).click();
    await page.getByRole('button', { name: 'Save Survey', exact: true }).click();
    await expect(notes(page, 'error').first()).toHaveText('Form schema not saved. Fix the reported errors and retry.');
    verdict = 'network';
    await page.getByRole('button', { name: 'Unreachable condition', exact: true }).click();
    await page.getByRole('button', { name: 'Save Survey', exact: true }).click();
    await expect(notes(page, 'error')).toHaveCount(2);
    await expect(notes(page, 'ok')).toHaveCount(1);
    expect(pageErrors).toEqual([]);
});

test('response confirmation uses the record accepted by the backend and excludes form variables', async ({ page }) => {
    let stored = [];
    await page.route('**/demo/stored/load-definition-variables-data*', (route) => route.fulfill({ json: { responses: stored } }));
    await page.route('**/api/responses', (route) => {
        const { data } = route.request().postDataJSON();
        for (const key of ['user', 'plan', 'variables']) expect(data).not.toHaveProperty(key);
        stored = [{ id: 501, data }];
        return route.fulfill({ status: 201, json: { id: 501 } });
    });
    await openRequests(page, 'load-definition-variables-data');
    await page.getByRole('textbox', { name: /^Email/ }).fill('visitor@example.com');
    await page.getByRole('button', { name: 'Submit claim', exact: true }).click();
    await expect(notes(page, 'ok').first()).toHaveText('Response #501 saved. Only submitted answers were stored; form variables were excluded.');
});
