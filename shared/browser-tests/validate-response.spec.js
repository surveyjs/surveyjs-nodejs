import { expect, test } from '@playwright/test';

test('sample answers submit once and show success only after a returned response ID', async ({ page }) => {
    const pending = Promise.withResolvers();
    let payload;
    await page.route('**/api/responses', async route => {
        payload = route.request().postDataJSON();
        await pending.promise;
        return route.fulfill({ status: 201, json: { id: 711 } });
    });
    await page.goto('/examples/validate-response');
    await page.getByRole('button', { name: 'Use sample answers', exact: true }).click();
    await page.getByRole('button', { name: 'Submit claim', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start over', exact: true })).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Your claim has been saved.', exact: true })).toBeHidden();
    pending.resolve();
    await expect(page.getByText('Response ID: 711', { exact: true })).toBeVisible();
    expect(payload.formId).toBe('claim');
    expect(payload.data.customer_email).toBe('ann@example.com');
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await expect(page.getByRole('textbox', { name: /Email/ })).toBeEmpty();
    await expect(page.getByRole('button', { name: 'Submit claim', exact: true })).toBeVisible();
});

test('tampered payloads and field errors appear in Requests and a generic bad request is not called a validation rejection', async ({ page }) => {
    let generic = false;
    await page.route('**/api/responses', route => generic
        ? route.fulfill({ status: 400, json: { error: 'Invalid request envelope' } })
        : route.fulfill({ status: 400, json: { errors: [{ type: 'invalidChoiceValue', path: 'incident' }] } }));
    await page.goto('/examples/validate-response');
    await page.getByRole('button', { name: 'Unknown choice', exact: true }).click();
    await page.getByRole('tab', { name: /^Requests/ }).click();
    await expect(page.locator('#notes > li').first()).toHaveText('Invalid response rejected as expected. No data was saved.');
    const request = page.locator('#requests > li').filter({ hasText: '/api/responses' });
    await request.locator('[data-row-toggle]').click();
    await expect(request.locator('[data-field="request-body"]')).toContainText('"incident": "meteor"');
    await expect(request.locator('[data-field="response-body"]')).toContainText('invalidChoiceValue');
    generic = true;
    await page.getByRole('button', { name: 'Unknown choice', exact: true }).click();
    await expect(page.locator('#notes > li').first()).toHaveText('Invalid request envelope');
    await expect(page.locator('#notes > li').first()).toHaveAttribute('data-kind', 'error');
});

test('failed validation and missing IDs keep the submission retryable', async ({ page }) => {
    let attempt = 0;
    await page.route('**/api/responses', route => {
        attempt++;
        if (attempt === 1) return route.fulfill({ status: 503, json: { error: 'Validation unavailable. Please try again.' } });
        return route.fulfill({ status: 201, json: attempt === 2 ? {} : { id: 712 } });
    });
    await page.goto('/examples/validate-response');
    await page.getByRole('button', { name: 'Use sample answers', exact: true }).click();
    await page.getByRole('button', { name: 'Submit claim', exact: true }).click();
    await expect(page.getByRole('heading', { name: "Your claim hasn't been saved.", exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.locator('#form')).toContainText("didn't confirm a saved response");
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('Response ID: 712', { exact: true })).toBeVisible();
    expect(attempt).toBe(3);
});
