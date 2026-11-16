import { expect, test } from '@playwright/test';
import { sharedJson } from './helpers.js';

const presets = sharedJson('seed/variable-presets.json').support;
async function selectPreset(page, name) {
    await page.evaluate(() => document.fonts.ready);
    const selector = page.getByRole('button', { name: /^Variable preset:/ });
    await selector.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await selector.click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
}
async function editBasicPlan(page) {
    await page.getByRole('button', { name: 'Manage presets', exact: true }).click();
    await page.locator('.svc-variable-presets').getByRole('button', { name: 'Manage presets', exact: true }).first().click();
    await page.getByRole('combobox', { name: /^Customer plan/ }).press('ArrowDown');
    await page.getByRole('option', { name: 'Premium', exact: true }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
}

test('Basic is selected initially and switching presets changes variables without saving', async ({ page }) => {
    const writes = [];
    await page.route('**/api/variable-presets/support', route => {
        if (route.request().method() === 'PUT') writes.push(route.request().postDataJSON());
        return route.fulfill({ json: presets });
    });
    await page.goto('/examples/variable-presets');
    await expect(page.getByRole('button', { name: /^Variable preset:/ })).toHaveAccessibleName(/Basic/);
    await expect(page.locator('#demo-user')).toHaveCount(0);
    await expect(page.locator('#actions')).toBeHidden();
    await expect(page.getByRole('switch', { name: /Call me back within one hour/ })).toBeHidden();
    await selectPreset(page, 'Premium');
    await expect(page.getByRole('button', { name: /^Variable preset:/ })).toHaveAccessibleName(/Premium/);
    await expect(page.getByRole('switch', { name: /Call me back within one hour/ })).toBeVisible();
    await selectPreset(page, 'Basic');
    await expect(page.getByRole('switch', { name: /Call me back within one hour/ })).toBeHidden();
    expect(writes).toEqual([]);
});

test('edited presets retry after failure, save as a list, and restore the edited variables on reload', async ({ page }) => {
    let saved = structuredClone(presets), fail = true;
    await page.route('**/api/variable-presets/support', route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: saved });
        if (fail) return route.fulfill({ status: 503, json: { error: 'Save unavailable' } });
        saved = route.request().postDataJSON();
        return route.fulfill({ status: 204 });
    });
    await page.goto('/examples/variable-presets');
    await editBasicPlan(page);
    await expect(page.locator('#creator-error')).toContainText('Your preset edits remain in this editor.');
    fail = false;
    await page.getByRole('button', { name: 'Try saving again', exact: true }).click();
    await expect(page.locator('#creator-error')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Try saving again', exact: true })).toBeHidden();
    expect(Array.isArray(saved)).toBe(true);
    expect(saved[0].variables.customerTier).toBe('premium');
    await page.reload();
    await expect(page.getByRole('button', { name: /^Variable preset:/ })).toHaveAccessibleName(/Basic/);
    await expect(page.getByRole('switch', { name: /Call me back within one hour/ })).toBeVisible();
});

test('permission failures are visible and keep the edited scenario in the editor', async ({ page }) => {
    await page.route('**/api/variable-presets/support', route => route.request().method() === 'GET'
        ? route.fulfill({ json: presets })
        : route.fulfill({ status: 403, json: { error: "You don't have editor rights" } }));
    await page.goto('/examples/variable-presets');
    await editBasicPlan(page);
    await expect(page.locator('#creator-error')).toContainText("You don't have editor rights");
    await expect(page.locator('.svc-notifier')).toHaveText("You don't have editor rights");   // the server's reason, not Creator's own message
    await expect(page.getByRole('switch', { name: /Call me back within one hour/ })).toBeVisible();
});

test('legacy stored configurations load while an empty list is a normal initial state', async ({ page }) => {
    let legacy = true;
    await page.route('**/api/variable-presets/support', route => route.fulfill({ json: legacy ? { presets } : [] }));
    await page.goto('/examples/variable-presets');
    await expect(page.getByRole('button', { name: /^Variable preset:/ })).toHaveAccessibleName(/Basic/);
    legacy = false;
    await page.reload();
    await expect(page.locator('#creator')).toBeVisible();
    await expect(page.locator('#creator-error')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Manage presets', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry loading', exact: true })).toBeHidden();
});
