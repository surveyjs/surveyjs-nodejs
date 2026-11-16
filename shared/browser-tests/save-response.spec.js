import { expect, test } from '@playwright/test';

const email = 'visitor@example.com';
const message = 'Please tell me more about SurveyJS.';
const saveError = "We couldn't save your message. Please try again.";
const success = 'Your message has been saved.';

async function fillContactForm(page) {
    await page.getByRole('textbox', { name: /Your email/ }).fill(email);
    await page.getByRole('textbox', { name: /How can we help/ }).fill(message);
}

test('requires both answers and waits for the server before showing the saved response ID', async ({ page }) => {
    let finishSave;
    const pending = new Promise((resolve) => { finishSave = resolve; });
    let submissions = 0;
    await page.route('**/api/responses', async (route) => {
        submissions++;
        expect(route.request().postDataJSON()).toEqual({ formId: 'contact', data: { email, message } });
        await pending;
        await route.fulfill({ status: 201, json: { id: 412 } });
    });
    await page.goto('/examples/save-response');
    await expect(page.locator('#component').getByText('Contact us', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.sd-question__erbox')).toHaveCount(2);
    await page.getByRole('textbox', { name: /Your email/ }).fill(email);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.sd-question__erbox')).toHaveCount(1);
    expect(submissions).toBe(0);

    await fillContactForm(page);
    expect(submissions).toBe(0);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sending your message...', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Your email/ })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Start over', exact: true })).toBeDisabled();
    await expect(page.getByText(success, { exact: true })).toBeHidden();
    expect(submissions).toBe(1);

    finishSave();
    await expect(page.getByText(success, { exact: true })).toBeVisible();
    await expect(page.getByText('Response ID: 412', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await expect(page.getByRole('textbox', { name: /Your email/ })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: /How can we help/ })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await expect(page.getByText('Response ID: 412', { exact: true })).toBeHidden();
});

for (const failure of ['server error', 'network error', 'missing response ID']) {
    test(`${failure}: keeps the answers and allows a successful retry`, async ({ page }) => {
        let finishRetry;
        const pendingRetry = new Promise((resolve) => { finishRetry = resolve; });
        let submissions = 0;
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.route('**/api/responses', async (route) => {
            submissions++;
            expect(route.request().postDataJSON()).toEqual({ formId: 'contact', data: { email, message } });
            if (submissions > 1) {
                await pendingRetry;
                return route.fulfill({ status: 201, json: { id: 413 } });
            }
            if (failure === 'network error') return route.abort('connectionfailed');
            if (failure === 'missing response ID') return route.fulfill({ status: 201, json: {} });
            return route.fulfill({ status: 503, json: { error: 'Saving is unavailable' } });
        });
        await page.goto('/examples/save-response');
        await fillContactForm(page);
        await page.getByRole('button', { name: 'Send message', exact: true }).click();

        await expect(page.getByText(saveError, { exact: true })).toBeVisible();
        await expect(page.getByText(success, { exact: true })).toBeHidden();
        await expect(page.getByRole('heading', { name: "Your message hasn't been saved.", exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Start over', exact: true })).toBeEnabled();

        await page.getByRole('button', { name: 'Try again', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Sending your message...', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeHidden();
        await expect(page.getByRole('button', { name: 'Start over', exact: true })).toBeDisabled();
        await expect(page.getByText(success, { exact: true })).toBeHidden();
        finishRetry();
        await expect(page.getByText(success, { exact: true })).toBeVisible();
        await expect(page.getByText('Response ID: 413', { exact: true })).toBeVisible();
        expect(submissions).toBe(2);
        expect(pageErrors).toEqual([]);
    });
}

test('starting over after a failed save clears the error and the previous answers', async ({ page }) => {
    await page.route('**/api/responses', (route) => route.fulfill({ status: 503, json: {} }));
    await page.goto('/examples/save-response');
    await fillContactForm(page);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByText(saveError, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await expect(page.getByText(saveError, { exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeHidden();
    await expect(page.getByRole('textbox', { name: /Your email/ })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: /How can we help/ })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
});
