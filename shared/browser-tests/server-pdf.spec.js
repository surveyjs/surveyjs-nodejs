import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const pdf = Buffer.from('%PDF-1.7\nDemo document\n%%EOF');
const firstRow = page => page.locator('[data-claim-row]').first();

test('Open PDF shows a styled loading tab before navigating to the generated document', async ({ page }) => {
    const pending = Promise.withResolvers();
    await page.route('**/api/claims/*/pdf', async route => {
        await pending.promise;
        return route.fulfill({ contentType: 'application/pdf', body: pdf });
    });
    await page.goto('/examples/server-pdf');
    const row = firstRow(page);
    const opened = page.waitForEvent('popup');
    await row.getByRole('button', { name: 'Open PDF', exact: true }).click();
    const popup = await opened;
    await expect(popup).toHaveTitle('Generating PDF · SurveyJS');
    await expect(popup.getByRole('heading', { name: 'Generating the PDF...', exact: true })).toBeVisible();
    const styles = await page.locator('body').evaluate(element => ({
        font: getComputedStyle(element).fontFamily,
        background: getComputedStyle(element).backgroundColor,
    }));
    await expect(popup.locator('body')).toHaveCSS('font-family', styles.font);
    await expect(popup.locator('body')).toHaveCSS('background-color', styles.background);
    pending.resolve();
    await expect(popup).toHaveURL(/^blob:/);
    await expect(page.locator('#pdf-feedback')).toBeHidden();
});

test('generation stays pending and Download PDF saves a named file with the returned bytes', async ({ page }) => {
    const pending = Promise.withResolvers();
    await page.route('**/api/claims/*/pdf', async route => {
        await pending.promise;
        return route.fulfill({ contentType: 'application/pdf', body: pdf });
    });
    await page.goto('/examples/server-pdf');
    const row = firstRow(page);
    await row.getByRole('button', { name: 'Download PDF', exact: true }).click();
    await expect(page.locator('#pdf-feedback')).toHaveText('Generating the PDF...');
    await expect(row.getByRole('button', { name: 'Open PDF', exact: true })).toBeDisabled();
    const downloaded = page.waitForEvent('download');
    pending.resolve();
    const file = await downloaded;
    expect(file.suggestedFilename()).toMatch(/^claim-\d+\.pdf$/);
    expect(readFileSync(await file.path())).toEqual(pdf);
    await expect(page.locator('#pdf-feedback')).toBeHidden();
    await expect(row.getByRole('button', { name: 'Open PDF', exact: true })).toBeEnabled();
});

test('blocked popups reuse the two buttons to open or download the generated PDF', async ({ page }) => {
    await page.addInitScript(() => { window.open = () => null; });
    let requests = 0;
    await page.route('**/api/claims/*/pdf', route => {
        requests++;
        return route.fulfill({ contentType: 'application/pdf', body: pdf });
    });
    await page.goto('/examples/server-pdf');
    const row = firstRow(page);
    await row.getByRole('button', { name: 'Open PDF', exact: true }).click();
    await expect(page.locator('#pdf-feedback')).toHaveText('PDF ready. Select Open PDF again or Download PDF.');
    const opened = page.waitForEvent('popup');
    await row.getByRole('button', { name: 'Open PDF', exact: true }).click();
    await expect(await opened).toHaveURL(/^blob:/);
    const downloaded = page.waitForEvent('download');
    await row.getByRole('button', { name: 'Download PDF', exact: true }).click();
    expect(readFileSync(await (await downloaded).path())).toEqual(pdf);
    expect(requests).toBe(1);
    await expect(row.getByRole('button')).toHaveCount(2);
    await expect(row.locator('[data-pdf-status], [data-pdf-links]')).toHaveCount(0);
});

for (const failure of ['service error', 'network error', 'wrong content type']) {
    test(`${failure} closes the placeholder tab and allows retry`, async ({ page }) => {
        let fail = true;
        await page.route('**/api/claims/*/pdf', route => {
            if (!fail) return route.fulfill({ contentType: 'application/pdf', body: pdf });
            if (failure === 'network error') return route.abort('connectionfailed');
            return failure === 'service error'
                ? route.fulfill({ status: 503, json: { error: 'PDF service unavailable' } })
                : route.fulfill({ contentType: 'text/html', body: 'Service unavailable' });
        });
        await page.goto('/examples/server-pdf');
        const row = firstRow(page);
        const opened = page.waitForEvent('popup');
        await row.getByRole('button', { name: 'Open PDF', exact: true }).click();
        const popup = await opened;
        await expect.poll(() => popup.isClosed()).toBe(true);
        await expect(page.locator('#pdf-feedback')).toContainText(failure === 'service error' ? 'PDF service unavailable' : failure === 'network error' ? "Couldn't generate" : "didn't return a PDF");
        fail = false;
        const downloaded = page.waitForEvent('download');
        await row.getByRole('button', { name: 'Download PDF', exact: true }).click();
        await downloaded;
        await expect(page.locator('#pdf-feedback')).toBeHidden();
    });
}
