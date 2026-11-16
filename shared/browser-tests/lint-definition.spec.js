import { expect, test } from '@playwright/test';
import { lintSurvey } from 'survey-core/linter';
import { row, sharedJson } from './helpers.js';

const sample = sharedJson('definitions/creator-load-save.json');

test('samples load into Creator without saving, and Save reports errors or accepts warnings', async ({ page }) => {
    let saved = sample;
    const writes = [];
    await page.route('**/api/forms/support-lint', route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { definition: saved } });
        const definition = route.request().postDataJSON();
        writes.push(definition);
        const findings = lintSurvey(definition).findings;
        const errors = findings.filter(finding => finding.severity === 'error');
        const warnings = findings.filter(finding => finding.severity === 'warning');
        if (errors.length) return route.fulfill({ status: 422, json: { errors, warnings } });
        saved = definition;
        return warnings.length ? route.fulfill({ json: { warnings } }) : route.fulfill({ status: 204 });
    });
    await page.goto('/examples/lint-definition');
    await expect(page.locator('[data-show="lint-status"]')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Survey Title', exact: true })).toBeVisible();
    await expect(page.locator('#readouts')).toBeHidden();
    const cases = [
        ['Broken reference', 'reference/unknown', 'error', "{prodcut} = 'Survey Creator'"],
        ['Invalid expression', 'expression/syntax', 'error', '{product} = '],
        ['Unreachable condition', 'expression/contradiction', 'warning', "{urgency} = 'Low' and {urgency} = 'Blocking'"],
    ];
    for (const [caption, rule, severity, expression] of cases) {
        const before = writes.length;
        await page.getByRole('button', { name: caption, exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Survey Title', exact: true })).toHaveText(`${sample.title}: ${caption.toLowerCase()}`);
        await expect(page.getByRole('button', { name: 'Save Survey', exact: true })).toBeEnabled();
        await expect(page.locator('#lint-report')).toHaveAttribute('hidden', '');
        expect(writes).toHaveLength(before);
        await page.getByRole('button', { name: 'Save Survey', exact: true }).click();
        await page.getByRole('tab', { name: /^Requests/ }).click();
        await expect(page.locator('#lint-findings')).toContainText(rule);
        await expect(page.locator('#lint-findings')).toContainText(severity === 'error' ? 'Error' : 'Warning');
        await expect(page.locator('#lint-report')).toBeVisible();
        const cells = page.locator('#lint-findings > tr', { hasText: rule }).first().locator('td');
        await expect(cells).toHaveCount(4);
        await expect(cells.nth(0)).toHaveText(severity === 'error' ? 'Error' : 'Warning');
        await expect(cells.nth(1)).toHaveText(rule);
        expect(writes).toHaveLength(before + 1);
        expect(writes.at(-1).pages[0].elements.find(question => question.name === 'issue').visibleIf).toBe(expression);
        if (severity === 'error') {
            await expect(page.locator('#notes > li').first()).toHaveText('Form schema not saved. Fix the reported errors and retry.');
            expect(saved).toEqual(sample);
            await expect(page.getByRole('button', { name: 'Save Survey', exact: true })).toBeEnabled();
        } else {
            await expect(page.locator('#notes > li').first()).toContainText('Schema saved with 1 warning');
            expect(saved).toEqual(writes.at(-1));
            await expect(page.getByRole('button', { name: 'Save Survey', exact: true })).toBeDisabled();
        }
        const submitted = row(page, 'PUT', '/api/forms/support-lint');
        await submitted.locator('[data-row-toggle]').click();
        await expect(submitted.locator('[data-field="request-body"]')).toContainText(expression);
        await page.locator('#creator').getByText('JSON Editor', { exact: true }).click();
        await expect(page.locator('#creator')).toContainText('Line:');
    }

    // An edit after loading a sample is included in the schema sent by Creator's Save button.
    await page.locator('#creator').getByText('Designer', { exact: true }).click();
    const title = page.getByRole('textbox', { name: 'Survey Title', exact: true });
    await title.fill('Current editor schema');
    await title.blur();
    await page.getByRole('button', { name: 'Save Survey', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save Survey', exact: true })).toBeDisabled();
    expect(saved.title).toBe('Current editor schema');
});

test('load failures are retryable and samples still work with an empty editor', async ({ page }) => {
    let failLoad = true, sent;
    await page.route('**/api/forms/support-lint', route => {
        if (route.request().method() === 'GET') return failLoad
            ? route.fulfill({ status: 503, json: { error: 'Load unavailable' } })
            : route.fulfill({ json: { definition: { title: 'Empty editor', elements: [] } } });
        sent = route.request().postDataJSON();
        return route.fulfill({ status: 422, json: { errors: [{ message: 'Unknown question reference' }] } });
    });
    await page.goto('/examples/lint-definition');
    await expect(page.locator('#creator')).toBeHidden();
    await expect(page.locator('#creator-error')).toHaveText('Load unavailable');
    failLoad = false;
    await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
    await expect(page.locator('#creator-error')).toBeHidden();
    await page.getByRole('button', { name: 'Broken reference', exact: true }).click();
    await page.getByRole('button', { name: 'Save Survey', exact: true }).click();
    await page.getByRole('tab', { name: /^Requests/ }).click();
    await expect(page.locator('#lint-findings')).toContainText('Unknown question reference');
    expect(sent.pages[0].elements.find(question => question.name === 'issue').visibleIf).toBe("{prodcut} = 'Survey Creator'");
});

test('a pending check blocks duplicate actions and network failure keeps edits retryable', async ({ page }) => {
    const pending = Promise.withResolvers();
    let writes = 0, fail = true;
    await page.route('**/api/forms/support-lint', async route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { definition: sample } });
        writes++;
        await pending.promise;
        return fail ? route.abort('connectionfailed') : route.fulfill({ status: 204 });
    });
    await page.goto('/examples/lint-definition');
    const title = page.getByRole('textbox', { name: 'Survey Title', exact: true });
    await title.fill('Keep this edit');
    await title.blur();
    const save = page.getByRole('button', { name: 'Save Survey', exact: true });
    await save.click();
    await expect(page.getByRole('button', { name: 'Unreachable condition', exact: true })).toBeDisabled();
    await expect(page.locator('#creator')).toHaveAttribute('inert', '');
    pending.resolve();
    await page.getByRole('tab', { name: /^Requests/ }).click();
    await expect(page.locator('#notes > li').first()).toContainText("Couldn't save the form schema");
    fail = false;
    await save.click();
    await expect(page.locator('#notes > li').first()).toHaveText('Form schema saved successfully.');
    expect(writes).toBe(2);
});
