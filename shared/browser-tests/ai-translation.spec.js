import { expect, test } from '@playwright/test';
import { sharedJson } from './helpers.js';

const definition = sharedJson('definitions/ai-translation.json');

async function openFrenchTranslation(page) {
    const row = page.getByRole('row').filter({ hasText: 'Français' })
        .filter({ has: page.getByRole('button', { name: 'Auto-translate All', exact: true }) });
    if (!await row.isVisible()) await page.getByRole('button', { name: 'Languages', exact: true }).click();
    await row.getByRole('button', { name: 'Auto-translate All', exact: true }).click();
    return page.locator('.st-translation-dialog');
}

// Below 1200px Creator shows the panel as a flyout and closes it itself when #creator resizes (an error line above it
// appears or goes away), so the panel can close between isVisible() and click(): retry until it is hidden
async function hideLanguages(page) {
    const hide = page.getByRole('button', { name: 'Hide Panel', exact: true });
    await expect(async () => {
        if (await hide.isVisible()) await hide.click({ timeout: 1000 });
        await expect(hide).toBeHidden({ timeout: 1000 });
    }).toPass();
}

async function expectFrenchTranslation(dialog) {
    const description = dialog.getByRole('textbox', { name: 'row Survey description, column Français', exact: true });
    await expect.poll(() => description.evaluate(element => element.value ?? element.textContent)).toMatch(/^FR /);
}

async function previewLanguage(page, language) {
    await hideLanguages(page);
    await page.getByRole('tab', { name: 'Preview', exact: true }).click();
    await page.locator('#creator').getByRole('button', { name: /^(English|Français)$/ }).click();
    await page.getByRole('menuitemradio', { name: language, exact: true }).click();
}

test('Apply triggers auto-save after review, and failed saves can be retried without losing translations', async ({ page }) => {
    let saved = definition, writes = 0, failSave = true;
    const requests = [];
    await page.route('**/api/forms/support-translations', route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { definition: saved } });
        writes++;
        if (failSave) return route.fulfill({ status: 503, json: { error: 'Save unavailable' } });
        saved = route.request().postDataJSON();
        return route.fulfill({ status: 204 });
    });
    await page.route('**/api/translate', route => {
        const request = route.request().postDataJSON(); requests.push(request);
        return route.fulfill({ json: request.strings.map(text => `FR ${text}`) });
    });
    await page.goto('/examples/ai-translation');
    const dialog = await openFrenchTranslation(page);
    await dialog.getByRole('button', { name: 'Auto-translate All', exact: true }).click();
    await expectFrenchTranslation(dialog);
    expect(writes).toBe(0);
    expect(requests[0].to).toBe('fr');
    expect(requests[0].strings).not.toContain('Workshop registration');
    const name = dialog.getByRole('textbox', { name: 'row Question title, column Français', exact: true }).first();
    await name.fill('Reviewed full name');
    await name.blur();
    expect(writes).toBe(0);
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#creator-error')).toContainText('Your translations remain in the editor.');
    expect(writes).toBe(1);
    failSave = false;
    await hideLanguages(page);
    await page.getByRole('button', { name: 'Save Survey', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save Survey', exact: true })).toBeDisabled();
    await expect(page.locator('#creator-error')).toBeHidden();
    expect(writes).toBe(2);
    const questions = saved.elements ?? saved.pages[0].elements;
    expect(questions.find(question => question.name === 'session').choices.map(choice => choice.value)).toEqual(['morning', 'afternoon']);
    expect(saved.title.fr).toBe("Inscription à l'atelier");
    expect(questions.find(question => question.name === 'full_name').title.fr).toBe('Reviewed full name');
    await previewLanguage(page, 'Français');
    await expect(page.getByRole('textbox', { name: /^Reviewed full name/ })).toBeVisible();
    await page.reload();
    await previewLanguage(page, 'Français');
    await expect(page.getByRole('textbox', { name: /^Reviewed full name/ })).toBeVisible();
    await previewLanguage(page, 'English');
    await expect(page.getByRole('textbox', { name: /^Full name/ })).toBeVisible();
});

for (const failure of ['network', 'malformed result']) {
    test(`${failure} finishes translation safely and the same language can be retried`, async ({ page }) => {
        let fail = true;
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/forms/support-translations', route => route.fulfill({ json: { definition } }));
        await page.route('**/api/translate', route => fail
            ? failure === 'network' ? route.abort('connectionfailed') : route.fulfill({ json: [123] })
            : route.fulfill({ json: route.request().postDataJSON().strings.map(text => `FR ${text}`) }));
        await page.goto('/examples/ai-translation');
        const dialog = await openFrenchTranslation(page);
        await dialog.getByRole('button', { name: 'Auto-translate All', exact: true }).click();
        await expect(page.locator('#creator-error')).toContainText('Existing translations are kept.');
        await expect(dialog.getByRole('button', { name: 'Auto-translate All', exact: true })).toBeEnabled();
        fail = false;
        await dialog.getByRole('button', { name: 'Auto-translate All', exact: true }).click();
        await expectFrenchTranslation(dialog);
        await expect(page.locator('#creator-error')).toBeHidden();
        await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
        await expect(dialog).toBeHidden();
        await previewLanguage(page, 'Français');
        await expect(page.locator('#creator .sd-title').first()).toContainText(definition.title.fr);
        expect(errors).toEqual([]);
    });
}

test('load failures show an error and retry without a permanent status header', async ({ page }) => {
    let fail = true;
    await page.route('**/api/forms/support-translations', route => fail
        ? route.fulfill({ status: 503, json: { error: 'Load unavailable.' } })
        : route.fulfill({ json: { definition } }));
    await page.goto('/examples/ai-translation');
    await expect(page.locator('#creator')).toBeHidden();
    await expect(page.locator('#creator-error')).toHaveText('Load unavailable.');
    fail = false;
    await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Translations', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#creator')).toBeVisible();
    await expect(page.locator('#creator-error')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Retry loading', exact: true })).toBeHidden();
});

test('users can add and translate another language with Logic hidden', async ({ page }) => {
    let saved = definition;
    const requests = [];
    await page.route('**/api/forms/support-translations', route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { definition: saved } });
        saved = route.request().postDataJSON();
        return route.fulfill({ status: 204 });
    });
    await page.route('**/api/translate', route => {
        const request = route.request().postDataJSON();
        requests.push(request);
        return route.fulfill({ json: request.strings.map(text => `IT ${text}`) });
    });
    const languageRow = name => page.getByRole('row').filter({ hasText: name })
        .filter({ has: page.getByRole('button', { name: 'Auto-translate All', exact: true }) });
    await page.goto('/examples/ai-translation');
    await page.getByRole('button', { name: 'Languages', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Logic', exact: true })).toHaveCount(0);
    await expect(languageRow('Deutsch')).toHaveCount(0);
    await expect(languageRow('Español')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add Language', exact: true }).click();
    await page.getByRole('menuitem', { name: /Italian/i }).click();
    await languageRow(/Italian/i).getByRole('button', { name: 'Auto-translate All', exact: true }).click();
    const dialog = page.locator('.st-translation-dialog');
    await dialog.getByRole('button', { name: 'Auto-translate All', exact: true }).click();
    const description = dialog.getByRole('textbox', { name: /row Survey description, column .*Italian/i });
    await expect.poll(() => description.evaluate(element => element.value ?? element.textContent)).toMatch(/^IT /);
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toBeHidden();
    await hideLanguages(page);
    await expect.poll(() => saved.description?.it).toMatch(/^IT /);
    await expect(page.getByRole('button', { name: 'Save Survey', exact: true })).toBeDisabled();
    expect(requests[0].to).toBe('it');
    expect(requests).toHaveLength(1);
    await page.getByRole('tab', { name: 'Preview', exact: true }).click();
    await page.getByRole('tab', { name: 'Translations', exact: true }).click();
    await page.getByRole('button', { name: 'Languages', exact: true }).click();
    await expect(languageRow(/Italian/i)).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Languages', exact: true }).click();
    await expect(languageRow(/Italian/i)).toBeVisible();
});
