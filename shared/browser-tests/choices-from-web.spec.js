import { expect, test } from '@playwright/test';

test('changing region reloads offices and completion saves the API values for inspection in Data', async ({ page }) => {
    const pending = Promise.withResolvers();
    let requestedAmericas = false;
    const authHeaders = [];
    const posts = [];
    let submitted, saved = [];
    await page.route('**/api/offices?*', async route => {
        authHeaders.push(route.request().headers().authorization);
        const americas = new URL(route.request().url()).searchParams.get('region') === 'americas';
        if (americas) { requestedAmericas = true; await pending.promise; }
        return route.fulfill({ json: americas ? [{ id: 'aus', name: 'Austin' }] : [{ id: 'ber', name: 'Berlin' }] });
    });
    await page.route('**/api/countries', route => route.fulfill({ json: [{ code: 'DE', name: 'Germany' }] }));
    await page.route('**/demo/stored/choices-from-web*', route => route.fulfill({ json: { responses: saved, offices: [] } }));
    await page.route('**/api/responses', route => {
        submitted = route.request().postDataJSON();
        saved = [{ id: 813, form_id: submitted.formId, data: submitted.data }];
        return route.fulfill({ status: 201, json: { id: 813 } });
    });
    page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
    await page.goto('/examples/choices-from-web');
    await page.locator('#tab-code').click();
    const definition = page.locator('#panel-code [data-definition-code]');
    await expect(definition).not.toHaveAttribute('open');
    await expect(definition.locator('pre')).toBeHidden();
    await definition.locator('summary').click();
    await expect(definition.locator('code.language-json')).toBeVisible();
    await expect(definition.locator('code.language-json')).toContainText('/api/offices?region={region}');
    await expect(definition.locator('code.language-json')).toContainText('/api/countries');
    await definition.locator('summary').press('Enter');
    await expect(definition).not.toHaveAttribute('open');
    await expect(page.locator('#panel-code')).not.toContainText('onComplete');
    await page.locator('#tab-demo').click();
    const office = page.getByRole('combobox', { name: /^Office/ });
    await office.press('ArrowDown');
    await page.getByRole('option', { name: 'Berlin', exact: true }).click();
    await expect(office).toHaveValue('Berlin');
    await page.getByRole('radio', { name: 'Americas', exact: true }).press('Space');
    await expect.poll(() => requestedAmericas).toBe(true);
    await expect(office).toHaveValue('');
    pending.resolve();
    await office.press('ArrowDown');
    await page.getByRole('option', { name: 'Austin', exact: true }).click();
    await page.getByRole('combobox', { name: /^Your country/ }).press('ArrowDown');
    await page.getByRole('option', { name: 'Germany', exact: true }).click();
    await expect(office.locator('..').getByText('Austin', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: /^Your country/ })).toHaveValue('Germany');
    await expect(page.getByRole('button', { name: 'Review selection', exact: true })).toHaveCount(0);
    await expect(page.locator('#choice-summary')).toHaveCount(0);
    expect(authHeaders).toEqual(['Bearer demo-token', 'Bearer demo-token']);
    expect(posts).toEqual([]);
    await page.getByRole('button', { name: 'Complete', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your response has been saved.', exact: true })).toBeVisible();
    await expect(page.getByText('Response ID: 813', { exact: true })).toBeVisible();
    expect(submitted).toEqual({ formId: 'visit', data: { region: 'americas', office: 'aus', country: 'DE' } });
    expect(posts).toHaveLength(1);
    await page.locator('#panel-tab-stored').click();
    await expect(page.locator('#stored')).toContainText('"office": "aus"');
    await expect(page.locator('#stored')).toContainText('"country": "DE"');
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Europe', exact: true })).toBeChecked();
    await expect(page.getByRole('combobox', { name: /^Office/ })).toHaveValue('');
});

for (const failure of ['server error', 'network error', 'missing response ID']) {
    test(`${failure} keeps the answers and allows a successful retry`, async ({ page }) => {
        let attempts = 0;
        const pending = Promise.withResolvers();
        await page.route('**/api/offices?*', route => route.fulfill({ json: [{ id: 'ber', name: 'Berlin' }] }));
        await page.route('**/api/countries', route => route.fulfill({ json: [{ code: 'DE', name: 'Germany' }] }));
        await page.route('**/api/responses', async route => {
            attempts++;
            expect(route.request().postDataJSON()).toEqual({ formId: 'visit', data: { region: 'europe', office: 'ber', country: 'DE' } });
            if (attempts > 1) {
                await pending.promise;
                return route.fulfill({ status: 201, json: { id: 814 } });
            }
            if (failure === 'network error') return route.abort('connectionfailed');
            return failure === 'server error'
                ? route.fulfill({ status: 503, json: { error: 'Save unavailable' } })
                : route.fulfill({ status: 201, json: {} });
        });
        await page.goto('/examples/choices-from-web');
        await page.getByRole('combobox', { name: /^Office/ }).press('ArrowDown');
        await page.getByRole('option', { name: 'Berlin', exact: true }).click();
        await page.getByRole('combobox', { name: /^Your country/ }).press('ArrowDown');
        await page.getByRole('option', { name: 'Germany', exact: true }).click();
        await page.getByRole('button', { name: 'Complete', exact: true }).click();
        await expect(page.getByRole('heading', { name: "Your response hasn't been saved.", exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Try again', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Start over', exact: true })).toBeDisabled();
        pending.resolve();
        await expect(page.getByText('Response ID: 814', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Start over', exact: true })).toBeEnabled();
        expect(attempts).toBe(2);
    });
}
