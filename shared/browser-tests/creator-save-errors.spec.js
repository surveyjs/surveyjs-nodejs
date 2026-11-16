import { expect, test } from '@playwright/test';
import { sharedJson } from './helpers.js';

// A denied save shows the server's { error } in Creator's notification bar, after Creator's own
// "not saved" message: the reason is the last thing the author reads.
const definition = sharedJson('definitions/creator-load-save.json');
const denied = "You don't have editor rights: only editors can change forms";
const pages = [
    ['creator-load-save', '**/api/forms/support'],
    ['creator-uploads', '**/api/forms/support-assets'],
    ['ai-translation', '**/api/forms/support-translations'],
    ['edit-together', '**/api/forms/support-team'],
];

for (const [slug, form] of pages) {
    test(`${slug}: a 403 save shows the server's error last`, async ({ page }) => {
        await page.route(form, route => route.request().method() === 'PUT'
            ? route.fulfill({ status: 403, json: { error: denied } })
            : route.fulfill({ json: { definition } }));
        await page.routeWebSocket(/\/ws\/forms\//, socket => socket.send(JSON.stringify({ type: 'init', clientId: 'client-1', seed: definition, log: [] })));
        await page.goto(`/examples/${slug}`);
        if (slug === 'ai-translation') await page.getByRole('tab', { name: 'Designer', exact: true }).click();
        const title = page.getByRole('textbox', { name: 'Survey Title', exact: true });
        await title.fill('Changed title');
        await title.blur();
        if (slug === 'edit-together') await page.getByRole('button', { name: 'Save Survey', exact: true }).click();
        const notifier = page.locator('.svc-notifier');
        await expect(notifier).toHaveText(denied);
        await page.waitForTimeout(500);   // nothing replaces it afterwards
        await expect(notifier).toHaveText(denied);
    });
}
