import { expect, test } from '@playwright/test';
import { sharedJson } from './helpers.js';

const definition = sharedJson('definitions/fill-together.json');
const init = (overrides = {}) => ({ type: 'init', clientId: 'client-1', name: 'Dispatcher', colorIndex: 1, seed: definition, values: {}, peers: [], sessionId: 'session-1', responseId: null, ...overrides });

test('failed initial connection shows reconnect and blocks editing until the shared answers arrive', async ({ page }) => {
    let connections = 0;
    await page.routeWebSocket(/\/ws\/rooms\//, socket => {
        connections++;
        if (connections === 1) socket.close({ code: 1013 });
        else socket.send(JSON.stringify(init({ values: { customer: 'Shared customer' } })));
    });
    await page.goto('/examples/fill-together?record=new');
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
    await expect(page.locator('#form')).toBeHidden();
    await expect(page.locator('#record')).toBeDisabled();
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(page.getByRole('textbox', { name: /^Customer/ })).toHaveValue('Shared customer');
    await expect(page.locator('#record')).toBeEnabled();
    await expect(page.locator('[data-show="connection-status"]')).toContainText('Connected as Dispatcher');
    await expect(page.locator('a[data-invite-link]')).toHaveAttribute('href', /role=technician/);
    await expect(page.locator('#actions').getByRole('combobox')).toHaveCount(2);
    await expect(page.locator('#actions').getByRole('link')).toHaveCount(1);
    await expect(page.locator('#actions').locator('input, button')).toHaveCount(0);
});

test('Record can start fresh sessions repeatedly while keeping the selected role and partner link', async ({ page }) => {
    await page.routeWebSocket(/\/ws\/rooms\//, socket => socket.send(JSON.stringify(init())));
    await page.goto('/examples/fill-together?record=new&role=technician');
    const record = page.getByRole('combobox', { name: 'Record', exact: true });
    await expect(record).toBeEnabled();
    await record.selectOption('');
    await page.waitForURL(url => /^new-/.test(url.searchParams.get('record')));
    const firstRoom = new URL(page.url()).searchParams.get('record');
    await expect(page.getByRole('combobox', { name: 'Role', exact: true })).toHaveValue('technician');
    await expect(record).toBeEnabled();
    const partner = new URL(await page.getByRole('link', { name: 'Open a second window', exact: true }).getAttribute('href'));
    expect(partner.searchParams.get('record')).toBe(firstRoom);
    expect(partner.searchParams.get('role')).toBe('dispatcher');
    await record.selectOption('');
    await page.waitForURL(url => url.searchParams.get('record') !== firstRoom);
    await expect(record).toBeEnabled();
    expect(new URL(page.url()).searchParams.get('record')).toMatch(/^new-/);
    expect(new URL(page.url()).searchParams.get('role')).toBe('technician');
});

test('two participants share answers and see the same completed response, including a late joiner', async ({ context }) => {
    const sockets = [];
    let values = {}, savedId = null, completions = 0;
    await context.routeWebSocket(/\/ws\/rooms\//, socket => {
        const clientId = `client-${sockets.length + 1}`;
        sockets.push(socket);
        socket.send(JSON.stringify(init({ clientId, values, responseId: savedId })));
        socket.onMessage(raw => {
            const message = JSON.parse(raw);
            if (message.type === 'value') {
                values[message.key] = message.value;
                for (const peer of sockets) if (peer !== socket) peer.send(JSON.stringify({ ...message, from: clientId }));
            }
            if (message.type === 'complete') {
                completions++;
                savedId ??= 901;
                values = message.data;
                for (const peer of sockets) peer.send(JSON.stringify({ type: 'completed', id: savedId, data: values }));
            }
        });
    });
    const dispatcher = await context.newPage();
    const technician = await context.newPage();
    await dispatcher.goto('/examples/fill-together?record=new');
    await technician.goto(await dispatcher.locator('a[data-invite-link]').getAttribute('href'));
    await dispatcher.getByRole('textbox', { name: /^Customer/ }).fill('Acme');
    await dispatcher.getByRole('textbox', { name: /^Customer/ }).blur();
    await expect(technician.getByRole('textbox', { name: /^Customer/ })).toHaveValue('Acme');
    await technician.getByRole('textbox', { name: /What did you find/ }).fill('Replace the filter');
    await technician.getByRole('textbox', { name: /What did you find/ }).blur();
    await expect(dispatcher.getByRole('textbox', { name: /What did you find/ })).toHaveValue('Replace the filter');
    await technician.getByRole('button', { name: 'Finish job sheet', exact: true }).click();
    for (const participant of [dispatcher, technician]) await expect(participant.getByText('Response ID: 901', { exact: true })).toBeVisible();
    expect(completions).toBe(1);
    const third = await context.newPage();
    await third.goto('/examples/fill-together?record=new');
    await expect(third.getByText('Response ID: 901', { exact: true })).toBeVisible();
    expect(completions).toBe(1);
});

test('save errors offer retry and reconnect restores a local draft into a replacement empty session', async ({ page }) => {
    let socket, connections = 0, completions = 0;
    await page.routeWebSocket(/\/ws\/rooms\//, current => {
        socket = current;
        connections++;
        socket.send(JSON.stringify(init({ sessionId: `session-${connections}` })));
        socket.onMessage(raw => {
            const message = JSON.parse(raw);
            if (message.type !== 'complete') return;
            completions++;
            socket.send(JSON.stringify(completions === 1
                ? { type: 'save-error', error: "Couldn't save the job sheet. Please try again." }
                : { type: 'completed', id: 902, data: message.data }));
        });
    });
    await page.goto('/examples/fill-together?record=new');
    await page.getByRole('textbox', { name: /^Customer/ }).fill('Keep this draft');
    await page.getByRole('textbox', { name: /^Customer/ }).blur();
    socket.close({ code: 1013 });
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
    await expect(page.locator('#form')).toHaveAttribute('inert', '');
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(page.getByRole('textbox', { name: /^Customer/ })).toHaveValue('Keep this draft');
    await page.getByRole('button', { name: 'Finish job sheet', exact: true }).click();
    await expect(page.getByRole('heading', { name: "The job sheet hasn't been saved." })).toBeVisible();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('Response ID: 902', { exact: true })).toBeVisible();
});
