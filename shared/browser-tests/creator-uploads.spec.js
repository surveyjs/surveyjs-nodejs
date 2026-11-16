import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { backToEditor, sharedJson, sharedPath } from './helpers.js';

const definition = sharedJson('definitions/creator-uploads.json');
const image = { name: 'logo.png', mimeType: 'image/png', buffer: readFileSync(sharedPath('samples/work-order-scan.png')) };
async function mockStoredForms(target, getDefinition) {
    await target.route('**/demo/stored/creator-uploads*', route => route.fulfill({
        json: { forms: { key: 'support-assets', json: getDefinition() }, files: [] },
    }));
}
async function logo(page) {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#creator .svc-logo-image-placeholder').click();
    await (await chooser).setFiles(image);
}
async function questionImage(page, file) {
    const question = page.locator('#creator .svc-question__content--image');
    await question.click();
    const chooser = page.waitForEvent('filechooser');
    await question.locator('.svc-image-question-controls button').click();
    await (await chooser).setFiles(file);
}

test('failed saves retain the upload and Data shows the image URL after retry', async ({ page }) => {
    let saved = definition, failSave = true, uploads = 0;
    await mockStoredForms(page, () => saved);
    await page.route('**/api/forms/support-assets', route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { definition: saved } });
        if (failSave) return route.fulfill({ status: 503, json: { error: 'Save unavailable' } });
        saved = route.request().postDataJSON();
        return route.fulfill({ status: 204 });
    });
    await page.route('**/api/files', route => { uploads++; return route.fulfill({ json: ['image-1'] }); });
    await page.route('**/api/files/image-1', route => route.fulfill({ contentType: 'image/png', body: image.buffer }));
    await page.goto('/examples/creator-uploads');
    await logo(page);
    await expect(page.locator('#creator img[src="/api/files/image-1"]')).toBeVisible();
    await expect(page.locator('#creator-error')).toContainText('Your schema changes remain in the editor. Uploaded files are retained.');
    failSave = false;
    await page.getByRole('button', { name: 'Try saving again', exact: true }).click();
    await expect.poll(() => saved.logo).toBe('/api/files/image-1');
    await expect(page.locator('#creator-error')).toBeHidden();
    expect(uploads).toBe(1);
    await page.reload();
    await expect(page.locator('#creator img[src="/api/files/image-1"]')).toBeVisible();
    await page.locator('#panel-tab-stored').click();
    await expect(page.locator('#stored')).toContainText('"logo": "/api/files/image-1"');
    await page.getByRole('button', { name: 'Restore sample', exact: true }).click();
    await expect.poll(() => saved.logo).toBeUndefined();
    await expect(page.locator('#creator-error')).toBeHidden();
    expect(saved.elements ?? saved.pages?.[0]?.elements).toEqual(definition.elements);
    await expect(page.locator('#stored')).not.toContainText('/api/files/image-1');
    await page.reload();
    await expect(page.locator('#creator .svc-logo-image-placeholder')).toBeVisible();
    await expect(page.locator('#creator img[src="/shared/samples/support-help.svg"]')).toBeVisible();
    expect(uploads).toBe(1);
});

test('restoring the sample disables duplicate actions and can be retried after a failed save', async ({ page }) => {
    const pending = Promise.withResolvers();
    let saved = { title: 'Changed form', logo: '/shared/samples/support-help.svg', elements: [{ type: 'text', name: 'changed' }] };
    let failSave = true, writes = 0;
    await page.route('**/api/forms/support-assets', async route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { definition: saved } });
        writes++;
        if (failSave) {
            await pending.promise;
            return route.fulfill({ status: 503, json: { error: 'Save unavailable.' } });
        }
        saved = route.request().postDataJSON();
        return route.fulfill({ status: 204 });
    });
    await page.goto('/examples/creator-uploads');
    await page.getByRole('button', { name: 'Restore sample', exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    await expect(page.getByRole('button', { name: 'Restore sample', exact: true })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Open saved form', exact: true })).toHaveAttribute('aria-disabled', 'true');
    pending.resolve();
    await expect(page.locator('#creator-error')).toContainText('Save unavailable.');
    await expect(page.getByRole('textbox', { name: 'Survey Title', exact: true })).toHaveText(definition.title);
    expect(saved.title).toBe('Changed form');
    failSave = false;
    await page.getByRole('button', { name: 'Try saving again', exact: true }).click();
    await expect.poll(() => saved.title).toBe(definition.title);
    await expect(page.locator('#creator-error')).toBeHidden();
    expect(saved.description).toBe(definition.description);
    expect(saved.logo).toBeUndefined();
    expect(saved.elements ?? saved.pages?.[0]?.elements).toEqual(definition.elements);
    expect(writes).toBe(2);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Survey Title', exact: true })).toHaveText(definition.title);
});

test('a question image persists as a URL and appears in the saved form preview', async ({ context, page }) => {
    let saved = definition;
    await mockStoredForms(context, () => saved);
    await context.route('**/api/forms/support-assets', route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { definition: saved } });
        saved = route.request().postDataJSON();
        return route.fulfill({ status: 204 });
    });
    await context.route('**/api/files', route => route.fulfill({ json: ['question-image'] }));
    await context.route('**/api/files/question-image', route => route.fulfill({ contentType: 'image/png', body: image.buffer }));
    await page.goto('/examples/creator-uploads');
    await questionImage(page, image);
    await expect.poll(() => JSON.stringify(saved)).toContain('/api/files/question-image');
    await page.locator('#panel-tab-stored').click();
    await expect(page.locator('#stored')).toContainText('"imageLink": "/api/files/question-image"');
    const opened = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'Open saved form', exact: true }).click();
    const popup = await opened;
    await expect(popup.getByRole('img', { name: 'Support resources', exact: true })).toHaveAttribute('src', '/api/files/question-image');
    await backToEditor(popup);
    await expect(page.locator('#creator')).toBeVisible();
    expect(context.pages()).toEqual([page]);
});

test('unsupported image files are rejected before any upload or schema save', async ({ page }) => {
    const writes = [];
    await page.route('**/api/forms/support-assets', route => route.fulfill({ json: { definition } }));
    page.on('request', request => { if (['POST', 'PUT'].includes(request.method())) writes.push(request.url()); });
    await page.goto('/examples/creator-uploads');
    await questionImage(page, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Unsupported') });
    await expect(page.locator('#creator-error')).toHaveText('Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.');
    expect(writes).toEqual([]);
});

test('load errors provide retry without a permanent status header', async ({ page }) => {
    let fail = true;
    await page.route('**/api/forms/support-assets', route => fail
        ? route.fulfill({ status: 503, json: { error: 'Load unavailable.' } })
        : route.fulfill({ json: { definition } }));
    await page.goto('/examples/creator-uploads');
    await expect(page.locator('#creator-error')).toHaveText('Load unavailable.');
    await expect(page.locator('#creator')).toBeHidden();
    fail = false;
    await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
    await expect(page.locator('#creator')).toBeVisible();
    await expect(page.locator('#creator-error')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Retry loading', exact: true })).toBeHidden();
});
