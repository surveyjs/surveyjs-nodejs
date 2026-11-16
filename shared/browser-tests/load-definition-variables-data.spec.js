import { expect, test } from '@playwright/test';

const path = '/examples/load-definition-variables-data';
const priority = page => page.getByRole('switch', { name: 'Would you like priority handling?' });
const email = page => page.getByRole('textbox', { name: /^Email/ });

test('the API loads customer variables and switches the premium-only question', async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('#component')).toContainText('Insurance claim for Alice Martin (premium plan)');
    await expect(priority(page)).toBeVisible();
    await expect(page.locator('#component')).toContainText('Available with your premium plan.');
    await expect(page.locator('#component')).not.toContainText('visibleIf');
    const aliceRecords = await page.locator('#record option').allTextContents();
    expect(aliceRecords.length).toBeGreaterThan(1);
    expect(aliceRecords.slice(1).every(label => label.includes('alice@example.com'))).toBe(true);

    await page.getByRole('combobox', { name: 'Customer', exact: true }).selectOption('bob');
    await expect(page.locator('#component')).toContainText('Insurance claim for Bob Fischer (basic plan)');
    await expect(priority(page)).toBeHidden();
    const bobRecords = await page.locator('#record option').allTextContents();
    expect(bobRecords.length).toBeGreaterThan(1);
    expect(bobRecords.slice(1).every(label => label.includes('bob@example.com'))).toBe(true);
});

test('changing customers clears the selected response and its answers', async ({ page }) => {
    await page.goto(path);
    const record = await page.locator('#record option').nth(1).getAttribute('value');
    await page.getByRole('combobox', { name: 'Saved response', exact: true }).selectOption(record);
    await expect(email(page)).toHaveValue('alice@example.com');

    await page.getByRole('combobox', { name: 'Customer', exact: true }).selectOption('bob');
    await expect(page.locator('#component')).toContainText('Bob Fischer');
    await expect(email(page)).toHaveValue('');
    await expect(page.locator('#record')).toHaveValue('');
    expect(new URL(page.url()).searchParams.has('record')).toBe(false);
});

test('starting over clears prefilled and edited answers while keeping the customer variables', async ({ page }) => {
    await page.goto(path);
    const record = await page.locator('#record option').nth(1).getAttribute('value');
    await page.getByRole('combobox', { name: 'Saved response', exact: true }).selectOption(record);
    await expect(email(page)).toHaveValue('alice@example.com');
    await page.getByRole('textbox', { name: 'Details', exact: true }).fill('Changed details.');

    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await expect(email(page)).toHaveValue('');
    await expect(page.getByRole('spinbutton', { name: 'Amount claimed', exact: true })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: 'Details', exact: true })).toHaveValue('');
    await expect(page.locator('#record')).toHaveValue('');
    await expect(priority(page)).toBeVisible();
    await expect(page.locator('#component')).toContainText('Alice Martin (premium plan)');
    expect(new URL(page.url()).searchParams.has('record')).toBe(false);
});

test('the embedded schema renders without a schema API request and follows the customer selection', async ({ page }) => {
    const schemaRequests = [];
    page.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/api/forms/')) schemaRequests.push(request.url());
    });
    await page.goto('/claim');
    await expect(page.locator('#component')).toContainText('Insurance claim for Alice Martin (premium plan)');
    await expect(page.getByRole('button', { name: 'Submit claim', exact: true })).toBeVisible();
    await expect(page.locator('#record')).toHaveCount(0);
    await expect(priority(page)).toBeVisible();

    await page.getByRole('combobox', { name: 'Customer', exact: true }).selectOption('bob');
    await expect(page.locator('#component')).toContainText('Insurance claim for Bob Fischer (basic plan)');
    await expect(priority(page)).toBeHidden();
    expect(schemaRequests).toHaveLength(0);
    await page.getByRole('link', { name: 'Load from the API', exact: true }).click();
    await expect(page.locator('#component')).toContainText('Bob Fischer (basic plan)');
    expect(schemaRequests).toHaveLength(1);
});

test('a failed submission retains the answers for retry and reset is disabled while saving', async ({ page }) => {
    let attempts = 0;
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    await page.route('**/api/responses', async route => {
        attempts++;
        expect(route.request().postDataJSON()).toEqual({ formId: 'claim', data: { customer_email: 'alice@example.com' } });
        if (attempts === 1) return route.fulfill({ status: 503, json: {} });
        await pending;
        return route.fulfill({ status: 201, json: { id: 700 } });
    });
    await page.goto(path);
    await email(page).fill('alice@example.com');
    await page.getByRole('button', { name: 'Submit claim', exact: true }).click();
    await expect(page.getByText("Couldn't save the response. Please try again.", { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: "Your claim hasn't been submitted.", exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Submitting your claim...', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start over', exact: true })).toBeDisabled();
    await expect(page.getByText('Response ID: 700', { exact: true })).toBeHidden();
    finish();
    await expect(page.getByText('Response ID: 700', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await expect(email(page)).toHaveValue('');
    expect(attempts).toBe(2);
});
