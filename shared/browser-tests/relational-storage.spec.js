import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
    test(`code sections start open and JSON definitions start collapsed at ${width}px`, async ({ page, context }) => {
        await context.route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: 'Source file' }));
        await page.setViewportSize({ width, height: 950 });
        await page.goto('/examples/relational-storage#code');
        const codeSections = page.locator('#panel-code [data-code-section]');
        await expect(codeSections).toHaveCount(3);
        await expect(codeSections.nth(1).locator('pre')).toContainText('async function saveClaim(data, definitionVersion)');
        await expect(codeSections.nth(1).locator('pre')).not.toContainText('onComplete');
        for (const section of await codeSections.all()) {
            await expect(section).toHaveAttribute('open');
            await expect(section.locator('pre')).toBeVisible();
        }
        await codeSections.nth(0).locator('summary').click();
        await expect(codeSections.nth(0).locator('pre')).toBeHidden();
        await expect(codeSections.nth(1).locator('pre')).toBeVisible();
        await codeSections.nth(0).locator('summary').press('Enter');
        await expect(codeSections.nth(0).locator('pre')).toBeVisible();
        const opened = page.waitForEvent('popup');
        await codeSections.nth(0).getByRole('link', { name: 'View on GitHub', exact: true }).click();
        const popup = await opened;
        await popup.close();
        await expect(codeSections.nth(0)).toHaveAttribute('open');
        const definitions = page.locator('#panel-code [data-definition-code]');
        await expect(definitions).toHaveCount(2);
        for (const definition of await definitions.all()) {
            await expect(definition).not.toHaveAttribute('open');
            await expect(definition.locator('pre')).toBeHidden();
        }
        await expect(definitions.nth(0).getByRole('link', { name: 'View on GitHub', exact: true })).toHaveAttribute('href', /\/shared\/definitions\/relational-storage\.v1\.json$/);
        await expect(definitions.nth(1).getByRole('link', { name: 'View on GitHub', exact: true })).toHaveAttribute('href', /\/shared\/definitions\/relational-storage\.v2\.json$/);
        const definitionOpened = page.waitForEvent('popup');
        await definitions.nth(0).getByRole('link', { name: 'View on GitHub', exact: true }).click();
        const definitionPopup = await definitionOpened;
        await definitionPopup.close();
        await expect(definitions.nth(0)).not.toHaveAttribute('open');
        await definitions.nth(0).locator('summary').click();
        await expect(definitions.nth(0).locator('code.language-json')).toContainText('"name": "q_email"');
        await expect(definitions.nth(0).locator('pre')).toBeVisible();
        await expect(definitions.nth(1).locator('pre')).toBeHidden();
        await definitions.nth(1).locator('summary').press('Enter');
        await expect(definitions.nth(1).locator('code.language-json')).toContainText('"name": "contact_email"');
        await expect(definitions.nth(1).locator('pre')).toBeVisible();
        await definitions.nth(0).locator('summary').click();
        await expect(definitions.nth(0).locator('pre')).toBeHidden();
        await expect(definitions.nth(1).locator('pre')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

for (const version of ['v1', 'v2']) {
    test(`${version} maps renamed questions to stable keys and confirms only the returned record`, async ({ page }) => {
        let submitted;
        await page.route('**/api/claims', route => {
            submitted = route.request().postDataJSON();
            return route.fulfill({ status: 201, json: { id: 901 } });
        });
        await page.route('**/demo/stored/relational-storage*', route => route.fulfill({ json: {
            claims: [{ response_id: 3, customer_email: 'old@example.com', amount: 999 }, ...(submitted ? [{ response_id: 901, ...submitted.data }] : [])],
            responses: [{ id: 3, definition_version: 'v1' }, ...(submitted ? [{ id: 901, definition_version: version, data: submitted.data }] : [])],
        } }));
        await page.goto(`/examples/relational-storage?version=${version}`);
        const mapping = page.locator('#mapping-rows');
        await expect(mapping).toContainText(version === 'v1' ? 'q_email' : 'contact_email');
        await expect(mapping).toContainText(version === 'v1' ? 'q_amount' : 'claimed_total');
        await expect(mapping).toContainText('claims.customer_email');
        await page.locator('#form input[type="email"]').fill('visitor@example.com');
        await page.locator('#form input[type="number"]').fill('120.5');
        await page.getByRole('button', { name: 'Submit claim', exact: true }).click();
        await expect(page.getByText('Response ID: 901', { exact: true })).toBeVisible();
        await expect(page.locator('[data-show="mapping-status"]')).toContainText('visitor@example.com');
        await expect(page.locator('[data-show="mapping-status"]')).not.toContainText('old@example.com');
        expect(submitted).toEqual({ definitionVersion: version, data: { customer_email: 'visitor@example.com', amount: 120.5 } });
    });
}

test('a failed claim save does not confirm an older record and can be retried', async ({ page }) => {
    let fail = true;
    await page.route('**/api/claims', route => fail
        ? route.fulfill({ status: 503, json: { error: 'Unavailable' } })
        : route.fulfill({ status: 201, json: { id: 902 } }));
    await page.route('**/demo/stored/relational-storage*', route => route.fulfill({ json: {
        claims: [{ response_id: 3, customer_email: 'old@example.com', amount: 999 }],
        responses: [{ id: 3, definition_version: 'v1' }],
    } }));
    await page.goto('/examples/relational-storage');
    await page.locator('#form input[type="email"]').fill('visitor@example.com');
    await page.getByRole('button', { name: 'Submit claim', exact: true }).click();
    await expect(page.getByRole('heading', { name: "Your claim hasn't been saved." })).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.locator('#notes > li[data-kind="ok"]')).toHaveCount(0);
    await expect(page.locator('[data-show="mapping-status"]')).toBeEmpty();
    fail = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('Response ID: 902', { exact: true })).toBeVisible();
    await expect(page.locator('[data-show="mapping-status"]')).toBeEmpty();
});
