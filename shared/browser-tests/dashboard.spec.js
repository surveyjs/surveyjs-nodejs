import { expect, test } from '@playwright/test';
import { sharedJson } from './helpers.js';

const definition = sharedJson('definitions/dashboard.json');
const response = { satisfaction: 4, recommend: 9, channel: 'Search', features: ['Forms'], improve: 'More examples' };

function submitted(daysAgo) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    date.setHours(12, 0, 0, 0);
    return { data: response, createdAt: date.toISOString() };
}
test.beforeEach(async ({ page }) => {
    await page.route('**/api/forms/feedback', route => route.fulfill({ json: { definition } }));
});

test('built-in date filters update counts without another request and recover from an empty range', async ({ page }) => {
    const requests = [];
    await page.route('**/api/responses?*', route => {
        const query = new URL(route.request().url()).searchParams;
        requests.push(query);
        return route.fulfill({ json: [submitted(3), submitted(20), submitted(60)] });
    });
    await page.goto('/examples/dashboard');
    const count = page.locator('#dashboard .sa-count_text');
    await expect(count).toHaveText('2 response(s)');
    await expect(page.locator('#dashboard')).toBeVisible();
    await expect(page.locator('#dashboard canvas').first()).toBeVisible();
    await expect(page.locator('#period, #from, #to')).toHaveCount(0);
    expect(requests[0].get('includeCreatedAt')).toBe('1');

    await page.getByRole('button', { name: 'Selected: Last 30 days', exact: true }).click();
    await page.getByRole('option', { name: 'Last 7 days', exact: true }).click();
    await expect(count).toHaveText('1 response(s)');

    await page.getByLabel('End date', { exact: true }).fill('2999-01-31');
    await page.getByLabel('Start date', { exact: true }).fill('2999-01-01');
    await expect(count).toHaveText('0 response(s)');
    await expect(page.locator('#dashboard')).toBeVisible();
    await page.locator('.sa-date-range_dropdown [role="button"]').click();
    await page.getByRole('option', { name: 'Last 30 days', exact: true }).click();
    await expect(count).toHaveText('2 response(s)');
    expect(requests).toHaveLength(1);

    const fonts = await page.evaluate(async () => {
        const loaded = await document.fonts.load('400 16px Lato');
        return {
            family: getComputedStyle(document.querySelector('.sa-count_text')).fontFamily,
            loaded: loaded.length > 0 && loaded.every(font => font.status === 'loaded'),
        };
    });
    expect(fonts.family).toContain('Lato');
    expect(fonts.loaded).toBe(true);
});

test('a failed lookup offers retry without an unhandled error', async ({ page }) => {
    let fail = true;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/responses?*', route => fail
        ? route.fulfill({ status: 503, json: { error: 'Unavailable' } })
        : route.fulfill({ json: [submitted(3)] }));
    await page.goto('/examples/dashboard');
    await expect(page.locator('[data-show="dashboard-status"]')).toHaveText("Couldn't load the responses. Please try again.");
    fail = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.locator('#dashboard .sa-count_text')).toHaveText('1 response(s)');
    await expect(page.locator('#dashboard-notice')).toBeHidden();
    await expect(page.locator('#dashboard canvas').first()).toBeVisible();
    await expect(page.locator('#dashboard .sa-date-range')).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('an empty dataset keeps the built-in date panel available', async ({ page }) => {
    await page.route('**/api/responses?*', route => route.fulfill({ json: [] }));
    await page.goto('/examples/dashboard');
    await expect(page.locator('#dashboard .sa-count_text')).toHaveText('0 response(s)');
    await expect(page.getByLabel('Start date', { exact: true })).toBeVisible();
    await expect(page.getByLabel('End date', { exact: true })).toBeVisible();
    await expect(page.locator('#dashboard-notice')).toBeHidden();
});
