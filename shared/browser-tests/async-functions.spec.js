import { expect, test } from '@playwright/test';

async function enter(page, name, value) {
    const input = page.getByRole('textbox', { name: new RegExp(`^${name}`) });
    await input.fill(value);
    await input.blur();
}

test('async lookups show pending states, share shipping requests, and wait before completion', async ({ page }) => {
    const pending = Promise.withResolvers();
    let shippingRequests = 0;
    await page.route('**/api/customers/exists?*', async route => { await pending.promise; return route.fulfill({ json: { exists: false } }); });
    await page.route('**/api/shipping?*', async route => { shippingRequests++; await pending.promise; return route.fulfill({ json: { price: 4.9 } }); });
    await page.goto('/examples/async-functions');
    await expect(page.getByText('€0.00', { exact: true })).toBeHidden();
    await enter(page, 'Email', 'new@example.com');
    await enter(page, 'Postcode', '10115');
    await expect(page.locator('[data-show="email-status"]')).toHaveText('Checking email...');
    await expect(page.locator('[data-show="postcode-status"]')).toHaveText('Calculating shipping...');
    pending.resolve();
    await expect(page.locator('[data-show="email-status"]')).toHaveText('This email is available.');
    await expect(page.getByText('€4.90', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Check details', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your details passed validation.' })).toBeVisible();
    expect(shippingRequests).toBe(1);
});

test('failed lookups block completion and retry the same inputs without caching the failure', async ({ page }) => {
    let fail = true;
    let shippingRequests = 0;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/customers/exists?*', route => fail ? route.abort('connectionfailed') : route.fulfill({ json: { exists: false } }));
    await page.route('**/api/shipping?*', route => {
        shippingRequests++;
        return fail ? route.fulfill({ status: 503, json: { error: 'Unavailable' } }) : route.fulfill({ json: { price: 4.9 } });
    });
    await page.goto('/examples/async-functions');
    await enter(page, 'Email', 'new@example.com');
    await enter(page, 'Postcode', '10115');
    await expect(page.locator('[data-show="email-status"]')).toHaveText("Couldn't check email availability. Please retry.");
    await expect(page.locator('[data-show="postcode-status"]')).toHaveText("Couldn't calculate shipping. Please retry.");
    await expect(page.getByText('€0.00', { exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Check details', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your details passed validation.' })).toBeHidden();
    fail = false;
    await page.getByRole('button', { name: 'Retry checks', exact: true }).click();
    await expect(page.locator('[data-show="email-status"]')).toHaveText('This email is available.');
    await expect(page.getByText('€4.90', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry checks', exact: true })).toBeHidden();
    expect(shippingRequests).toBeGreaterThan(1);
    expect(errors).toEqual([]);
});

test('registered email and unsupported delivery are validation results without a retry action', async ({ page }) => {
    await page.route('**/api/customers/exists?*', route => route.fulfill({ json: { exists: true } }));
    await page.route('**/api/shipping?*', route => route.fulfill({ json: { price: null } }));
    await page.goto('/examples/async-functions');
    await enter(page, 'Email', 'taken@example.com');
    await enter(page, 'Postcode', '99999');
    await expect(page.locator('[data-show="email-status"]')).toHaveText('This email is already registered.');
    await expect(page.locator('[data-show="postcode-status"]')).toHaveText("We don't deliver to this postcode.");
    await expect(page.getByRole('button', { name: 'Retry checks', exact: true })).toBeHidden();
    await expect(page.getByText('€0.00', { exact: true })).toBeHidden();
});

test('reset ignores a shipping request that finishes after the form has been cleared', async ({ page }) => {
    const pending = Promise.withResolvers();
    await page.route('**/api/shipping?*', async route => { await pending.promise; return route.fulfill({ json: { price: 4.9 } }); });
    await page.goto('/examples/async-functions');
    await enter(page, 'Postcode', '10115');
    await expect(page.locator('[data-show="postcode-status"]')).toHaveText('Calculating shipping...');
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    pending.resolve();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-show="postcode-status"]')).toHaveText('Enter a postcode.');
    await expect(page.getByText('€4.90', { exact: true })).toBeHidden();
    await expect(page.getByRole('textbox', { name: /^Postcode/ })).toBeEmpty();
});
