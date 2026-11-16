import { expect, test } from '@playwright/test';
import { row, slot } from './helpers.js';

const path = '/examples/resume-progress';
const status = page => page.getByRole('status');
const name = page => page.getByRole('textbox', { name: 'Full name', exact: true });
const button = (page, label) => page.getByRole('button', { name: label, exact: true });

async function mockProgress(page, initial = {}) {
    const server = { drafts: new Map(Object.entries(initial)), calls: [], submissions: [], hooks: {} };
    const user = route => /(?:^|;\s*)demo_user=([^;]+)/.exec(route.request().headers().cookie ?? '')?.[1] ?? 'alice';
    await page.route('**/api/progress/onboarding', async route => {
        const method = route.request().method();
        const entry = { method, user: user(route), body: method === 'PUT' ? route.request().postDataJSON() : null };
        server.calls.push(entry);
        const failure = await server.hooks[method]?.(entry);
        if (failure === 'network') return route.abort('connectionfailed');
        if (failure) return route.fulfill({ status: failure, json: { error: 'Unavailable' } });
        if (method === 'GET') {
            const saved = server.drafts.get(entry.user);
            return route.fulfill({ contentType: 'application/json', json: saved ?? null });
        }
        if (method === 'PUT') server.drafts.set(entry.user, entry.body);
        if (method === 'DELETE') server.drafts.delete(entry.user);
        return route.fulfill({ status: 204 });
    });
    await page.route('**/api/responses', async route => {
        const entry = { method: 'POST', user: user(route), body: route.request().postDataJSON() };
        server.calls.push(entry);
        const failure = await server.hooks.POST?.(entry);
        if (failure) return route.fulfill({ status: failure, json: { error: 'Unavailable' } });
        server.submissions.push(entry.body);
        return route.fulfill({ status: 201, json: { id: 900 + server.submissions.length } });
    });
    await page.route('**/demo/stored/resume-progress*', route => route.fulfill({ json: {
        progress: server.drafts.has(user(route)) ? { json: server.drafts.get(user(route)) } : null,
        responses: []
    } }));
    return server;
}

async function finishForm(page) {
    await name(page).fill('Demo respondent');
    await button(page, 'Next').click();
    await button(page, 'Next').click();
    await button(page, 'Finish onboarding').click();
}

test('no saved progress is a successful request and opens a blank form', async ({ page }) => {
    await mockProgress(page);
    await page.goto(path);
    await expect(status(page)).toHaveText('No saved progress');
    await expect(name(page)).toHaveValue('');
    await expect(button(page, 'Retry')).toBeHidden();
    const loaded = row(page, 'GET', '/api/progress/onboarding');
    await expect(loaded).toHaveAttribute('data-state', 'ok');
    await expect(loaded.locator('[data-field="status"]')).toHaveText('200');
    expect(await slot(loaded, 'response-body')).toBe('null');
});

test('a slow restore blocks input and restores legacy page names and field focus', async ({ page }) => {
    const server = await mockProgress(page, { alice: {
        data: { full_name: 'Saved respondent', company: 'Saved workspace' },
        uiState: { currentPageName: 'company', activeElementName: 'website', pages: { company: { shown: true } } }
    } });
    const load = Promise.withResolvers();
    server.hooks.GET = () => load.promise;
    await page.goto(path);
    await expect(status(page)).toHaveText('Loading saved progress...');
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(button(page, 'Reload page')).toBeDisabled();
    load.resolve();
    await expect(page.getByRole('textbox', { name: 'Company name', exact: true })).toHaveValue('Saved workspace');
    await expect(page.getByRole('textbox', { name: 'Website', exact: true })).toBeFocused();
    await expect(status(page)).toHaveText('Your saved progress has been restored');
});

test('a load failure keeps the form blocked until retry restores the draft', async ({ page }) => {
    const server = await mockProgress(page, { alice: { data: { full_name: 'Saved respondent' }, uiState: {} } });
    server.hooks.GET = () => 503;
    await page.goto(path);
    await expect(status(page)).toHaveText("Couldn't load saved progress. Retry to continue.");
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(button(page, 'Start over')).toBeDisabled();
    server.hooks.GET = null;
    await button(page, 'Retry').click();
    await expect(name(page)).toHaveValue('Saved respondent');
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
});

test('reload waits for a slow save before fetching the latest answers', async ({ page }) => {
    const server = await mockProgress(page);
    const save = Promise.withResolvers();
    server.hooks.PUT = () => save.promise;
    await page.goto(path);
    await name(page).fill('Latest answers');
    await button(page, 'Reload page').click();
    await expect(status(page)).toHaveText('Saving progress...');
    await expect(button(page, 'Reload page')).toBeDisabled();
    expect(server.calls.filter(call => call.method === 'GET')).toHaveLength(1);
    save.resolve();
    await expect.poll(() => server.calls.filter(call => call.method === 'GET').length).toBe(2);
    await expect(name(page)).toHaveValue('Latest answers');
});

test('saves are serialized and the latest pending answers follow the in-flight save', async ({ page }) => {
    const server = await mockProgress(page);
    const first = Promise.withResolvers();
    server.hooks.PUT = ({ body }) => body.data.full_name === 'First answers' ? first.promise : undefined;
    await page.goto(path);
    await name(page).fill('First answers');
    await expect.poll(() => server.calls.some(call => call.method === 'PUT' && call.body.data.full_name === 'First answers')).toBe(true);
    await name(page).fill('Latest answers');
    await page.waitForTimeout(950);
    expect(server.calls.some(call => call.method === 'PUT' && call.body.data.full_name === 'Latest answers')).toBe(false);
    first.resolve();
    await expect.poll(() => server.drafts.get('alice')?.data.full_name).toBe('Latest answers');
    await expect(status(page)).toHaveText(/^Progress saved at /);
});

test('a failed reload save keeps the form open and retries before navigating', async ({ page }) => {
    const server = await mockProgress(page);
    server.hooks.PUT = () => 503;
    await page.goto(path);
    await name(page).fill('Keep these answers');
    await button(page, 'Reload page').click();
    await expect(status(page)).toHaveText("Couldn't finish saving. Retry before reloading.");
    await expect(name(page)).toHaveValue('Keep these answers');
    expect(server.calls.filter(call => call.method === 'GET')).toHaveLength(1);
    server.hooks.PUT = null;
    await button(page, 'Retry').click();
    await expect.poll(() => server.calls.filter(call => call.method === 'GET').length).toBe(2);
    await expect(name(page)).toHaveValue('Keep these answers');
});

test('focus-only changes and the current page survive a reload', async ({ page }) => {
    const server = await mockProgress(page);
    await page.goto(path);
    await name(page).fill('Demo respondent');
    await expect.poll(() => server.drafts.get('alice')?.data.full_name).toBe('Demo respondent');
    await page.getByRole('textbox', { name: 'Job title', exact: true }).focus();
    await button(page, 'Reload page').click();
    await expect(page.getByRole('textbox', { name: 'Job title', exact: true })).toBeFocused();
    await button(page, 'Next').click();
    await page.getByRole('textbox', { name: 'Company name', exact: true }).fill('Demo workspace');
    await page.getByRole('textbox', { name: 'Website', exact: true }).focus();
    await button(page, 'Reload page').click();
    await expect(page.getByRole('textbox', { name: 'Company name', exact: true })).toHaveValue('Demo workspace');
    await expect(page.getByRole('textbox', { name: 'Website', exact: true })).toBeFocused();
    expect(server.drafts.get('alice').uiState.currentPageName).toBe('company-details');
});

for (const failure of [503, 'network']) {
    test(`a ${failure} save failure retains the latest snapshot for retry`, async ({ page }) => {
        const server = await mockProgress(page);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        server.hooks.PUT = () => failure;
        await page.goto(path);
        await name(page).fill('Answers to retry');
        await expect(status(page)).toHaveText("Couldn't save progress. Retry to save your latest changes.");
        server.hooks.PUT = null;
        await button(page, 'Retry').click();
        await expect.poll(() => server.drafts.get('alice')?.data.full_name).toBe('Answers to retry');
        await expect(status(page)).toHaveText(/^Progress saved at /);
        await expect(name(page)).toHaveValue('Answers to retry');
        expect(errors).toEqual([]);
    });
}

test('respondent switching saves first and restores an independent draft for each user', async ({ page }) => {
    const server = await mockProgress(page);
    const save = Promise.withResolvers();
    server.hooks.PUT = () => save.promise;
    await page.goto(path);
    await name(page).fill('Alice draft');
    await page.getByRole('combobox', { name: 'Respondent', exact: true }).selectOption('bob');
    await expect.poll(() => server.calls.some(call => call.method === 'PUT')).toBe(true);
    expect((await page.context().cookies()).find(cookie => cookie.name === 'demo_user').value).toBe('alice');
    server.hooks.PUT = null;
    save.resolve();
    await expect(page.getByRole('combobox', { name: 'Respondent', exact: true })).toHaveValue('bob');
    await expect(name(page)).toHaveValue('');
    await name(page).fill('Bob draft');
    await expect.poll(() => server.drafts.get('bob')?.data.full_name).toBe('Bob draft');
    await page.getByRole('combobox', { name: 'Respondent', exact: true }).selectOption('alice');
    await expect(name(page)).toHaveValue('Alice draft');
    expect(server.drafts.get('bob').data.full_name).toBe('Bob draft');
});

test('start over waits for an in-flight save before deleting the draft', async ({ page }) => {
    const server = await mockProgress(page);
    const save = Promise.withResolvers();
    server.hooks.PUT = () => save.promise;
    await page.goto(path);
    await name(page).fill('Draft to discard');
    await expect.poll(() => server.calls.some(call => call.method === 'PUT')).toBe(true);
    await button(page, 'Start over').click();
    expect(server.calls.some(call => call.method === 'DELETE')).toBe(false);
    save.resolve();
    await expect(status(page)).toHaveText('No saved progress');
    await expect(name(page)).toHaveValue('');
    expect(server.drafts.has('alice')).toBe(false);
    await page.reload();
    await expect(name(page)).toHaveValue('');
    await expect(status(page)).toHaveText('No saved progress');
});

test('a save failure prevents switching away from the current respondent', async ({ page }) => {
    const server = await mockProgress(page);
    server.hooks.PUT = () => 503;
    await page.goto(path);
    await name(page).fill('Alice unsaved draft');
    await page.getByRole('combobox', { name: 'Respondent', exact: true }).selectOption('bob');
    await expect(status(page)).toHaveText("Couldn't save progress. Retry to save your latest changes.");
    await expect(page.getByRole('combobox', { name: 'Respondent', exact: true })).toHaveValue('alice');
    expect((await page.context().cookies()).find(cookie => cookie.name === 'demo_user').value).toBe('alice');
    await expect(name(page)).toHaveValue('Alice unsaved draft');
    expect(server.drafts.has('bob')).toBe(false);
});

test('a failed reset preserves the answers until the user retries', async ({ page }) => {
    const server = await mockProgress(page, { alice: { data: { full_name: 'Keep my answers' }, uiState: {} } });
    server.hooks.DELETE = () => 503;
    await page.goto(path);
    await expect(name(page)).toHaveValue('Keep my answers');
    await button(page, 'Start over').click();
    await expect(status(page)).toHaveText("Couldn't clear saved progress. Your answers are still available. Retry to start over.");
    await expect(name(page)).toHaveValue('Keep my answers');
    server.hooks.DELETE = null;
    await button(page, 'Retry').click();
    await expect(name(page)).toHaveValue('');
    expect(server.drafts.has('alice')).toBe(false);
});

test('completion submits answers and clears the draft only after a successful submission', async ({ page }) => {
    const server = await mockProgress(page);
    server.hooks.POST = () => 503;
    await page.goto(path);
    await finishForm(page);
    await expect(page.getByRole('heading', { name: "Your onboarding hasn't been submitted.", exact: true })).toBeVisible();
    expect(server.calls.some(call => call.method === 'DELETE')).toBe(false);
    expect(server.drafts.get('alice').data.full_name).toBe('Demo respondent');
    server.hooks.POST = null;
    await button(page, 'Try again').click();
    await expect(status(page)).toHaveText('Onboarding submitted. Saved draft cleared.');
    expect(server.submissions).toEqual([{ formId: 'onboarding', data: { full_name: 'Demo respondent' } }]);
    expect(server.drafts.has('alice')).toBe(false);
    await page.reload();
    await expect(name(page)).toHaveValue('');
});

test('retrying draft cleanup does not submit the completed response twice', async ({ page }) => {
    const server = await mockProgress(page);
    server.hooks.DELETE = () => 503;
    await page.goto(path);
    await finishForm(page);
    await expect(status(page)).toHaveText("Onboarding was submitted, but the saved draft couldn't be cleared. Please try again.");
    await expect(page.getByText('Response ID: 901', { exact: true })).toBeVisible();
    expect(server.drafts.has('alice')).toBe(true);
    server.hooks.DELETE = null;
    await button(page, 'Try again').click();
    await expect(status(page)).toHaveText('Onboarding submitted. Saved draft cleared.');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.drafts.has('alice')).toBe(false);
});
