import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { sharedJson } from './helpers.js';

const definition = sharedJson('definitions/creator-load-save.json');
const init = (log = [], clientId = 'client-1') => ({ type: 'init', clientId, seed: definition, log });
const title = page => page.getByRole('textbox', { name: 'Survey Title', exact: true });

test('connection failure blocks the editor and reconnect loads the shared form', async ({ page }) => {
    let connections = 0;
    await page.routeWebSocket(/\/ws\/forms\/support-team/, socket => {
        if (++connections === 1) socket.close({ code: 1013 });
        else socket.send(JSON.stringify(init()));
    });
    await page.goto('/examples/edit-together');
    await expect(page.locator('#creator')).toBeHidden();
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(title(page)).toHaveText(definition.title);
    await expect(page.locator('#creator-error')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeHidden();
});

test('edits reach another author and a late joiner, and a failed save can be retried', async ({ context }) => {
    const sockets = [], log = [];
    let failSave = true, saved;
    await context.route('**/api/forms/support-team', route => {
        if (failSave) return route.fulfill({ status: 503, json: { error: 'Save unavailable. Please try again.' } });
        saved = route.request().postDataJSON();
        return route.fulfill({ status: 204 });
    });
    await context.routeWebSocket(/\/ws\/forms\/support-team/, socket => {
        socket.send(JSON.stringify(init(log, `client-${sockets.length + 1}`)));
        sockets.push(socket);
        socket.onMessage(raw => {
            const message = JSON.parse(raw);
            if (message.type === 'append') {
                log.push(message.payload);
                for (const peer of sockets) if (peer !== socket) peer.send(JSON.stringify({ type: 'record', payload: message.payload }));
            }
        });
    });
    const first = await context.newPage(), second = await context.newPage();
    await first.goto('/examples/edit-together');
    await second.goto('/examples/edit-together');
    await expect(title(second)).toHaveText(definition.title);
    await title(first).fill('Shared support form');
    await title(first).blur();
    await expect(title(second)).toHaveText('Shared support form');
    const third = await context.newPage();
    await third.goto('/examples/edit-together');
    await expect(title(third)).toHaveText('Shared support form');
    await third.getByRole('button', { name: 'Save Survey', exact: true }).click();
    await expect(third.locator('#creator-error')).toHaveText('Save unavailable. Please try again.');
    failSave = false;
    await third.getByRole('button', { name: 'Try saving again', exact: true }).click();
    await expect(third.locator('#creator-error')).toBeHidden();
    await expect(third.getByRole('button', { name: 'Save Survey', exact: true })).toBeDisabled();
    expect(saved.title).toBe('Shared support form');
});

test('disconnect preserves a downloadable copy and reconnect replaces the frozen editor', async ({ page }) => {
    let socket;
    await page.routeWebSocket(/\/ws\/forms\/support-team/, current => {
        socket = current;
        socket.send(JSON.stringify(init()));
    });
    await page.goto('/examples/edit-together');
    await title(page).fill('Keep these local edits');
    await title(page).blur();
    socket.close({ code: 1013 });
    await expect(page.locator('#creator')).toHaveAttribute('inert', '');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download local copy', exact: true }).click();
    const file = await downloaded;
    expect(JSON.parse(readFileSync(await file.path(), 'utf8')).title).toBe('Keep these local edits');
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(title(page)).toHaveText(definition.title);
    await expect(page.locator('#creator')).not.toHaveAttribute('inert');
});

test('selected forms have separate shared edits, invite links, saves, and stored data', async ({ context }) => {
    const contact = sharedJson('definitions/save-response.json');
    const saved = { 'support-team': definition, 'contact-team': contact };
    const rooms = new Map(), writes = [];
    await context.route('**/api/forms/*', route => {
        const id = route.request().url().split('/').pop();
        saved[id] = route.request().postDataJSON();
        writes.push(id);
        return route.fulfill({ status: 204 });
    });
    await context.route('**/demo/stored/edit-together*', route => {
        const id = new URL(route.request().url()).searchParams.get('key') ?? 'support-team';
        return route.fulfill({ json: { forms: { key: id, json: saved[id] } } });
    });
    await context.routeWebSocket(/\/ws\/forms\//, socket => {
        const id = new URL(socket.url()).pathname.split('/').pop();
        if (!rooms.has(id)) rooms.set(id, { sockets: new Set(), log: [] });
        const room = rooms.get(id);
        socket.send(JSON.stringify({ ...init(room.log, `client-${room.sockets.size + 1}`), seed: saved[id] }));
        room.sockets.add(socket);
        socket.onClose(() => room.sockets.delete(socket));
        socket.onMessage(raw => {
            const message = JSON.parse(raw);
            if (message.type !== 'append') return;
            room.log.push(message.payload);
            for (const peer of room.sockets) if (peer !== socket) peer.send(JSON.stringify({ type: 'record', payload: message.payload }));
        });
    });
    const first = await context.newPage(), support = await context.newPage();
    await first.goto('/examples/edit-together');
    await support.goto('/examples/edit-together');
    await first.getByRole('combobox', { name: 'Form', exact: true }).selectOption('contact-team');
    await expect(title(first)).toHaveText(contact.title);
    await expect(first.locator('#invite-link, [data-copy-invite], [data-show="connection-status"], [data-show="schema-status"]')).toHaveCount(0);
    const opened = first.waitForEvent('popup');
    await first.getByRole('link', { name: 'Open a second window' }).click();
    const peer = await opened;
    await expect(peer).toHaveURL(/form=contact-team/);
    await expect(title(peer)).toHaveText(contact.title);
    await title(first).fill('Contact form edited together');
    await title(first).blur();
    await expect(title(peer)).toHaveText('Contact form edited together');
    await expect(title(support)).toHaveText(definition.title);
    await peer.getByRole('button', { name: 'Save Survey', exact: true }).click();
    await expect.poll(() => writes).toEqual(['contact-team']);
    await peer.locator('#panel-tab-stored').click();
    await expect(peer.locator('#stored')).toContainText('contact-team');
    await expect(peer.locator('#stored')).toContainText('Contact form edited together');
});

test('a new blank form has its own persistent form ID and invitation', async ({ page }) => {
    const saved = { 'support-team': definition };
    await page.route('**/api/forms/*', route => {
        saved[route.request().url().split('/').pop()] = route.request().postDataJSON();
        return route.fulfill({ status: 204 });
    });
    await page.routeWebSocket(/\/ws\/forms\//, socket => {
        const id = new URL(socket.url()).pathname.split('/').pop();
        socket.send(JSON.stringify({ ...init(), seed: saved[id] ?? {} }));
    });
    await page.goto('/examples/edit-together');
    await page.getByRole('combobox', { name: 'Form', exact: true }).selectOption('');
    await expect(page).toHaveURL(/form=team-[a-f0-9-]+/);
    const id = new URL(page.url()).searchParams.get('form');
    await page.getByRole('button', { name: 'Single-Line Input', exact: true }).click();
    await title(page).fill('New shared form');
    await title(page).blur();
    await page.getByRole('button', { name: 'Save Survey', exact: true }).click();
    await expect.poll(() => saved[id]?.title).toBe('New shared form');
    await expect(page.getByRole('link', { name: 'Open a second window' })).toHaveAttribute('href', new RegExp(`form=${id}`));
    await page.reload();
    await expect(title(page)).toHaveText('New shared form');
    await expect(page.getByRole('combobox', { name: 'Form', exact: true })).toHaveValue(id);
    await page.getByRole('combobox', { name: 'Form', exact: true }).selectOption('');
    await expect.poll(() => new URL(page.url()).searchParams.get('form')).not.toBe(id);
});

test('Version History lists each change of the room once, for the author, a peer and a late joiner', async ({ context }) => {
    const sockets = [], log = [];
    await context.routeWebSocket(/\/ws\/forms\/support-team/, socket => {
        socket.send(JSON.stringify(init(log, `client-${sockets.length + 1}`)));
        sockets.push(socket);
        socket.onMessage(raw => {
            const message = JSON.parse(raw);
            if (message.type !== 'append') return;
            log.push(message.payload);
            for (const peer of sockets) if (peer !== socket) peer.send(JSON.stringify({ type: 'record', payload: message.payload }));
        });
    });
    const author = await context.newPage(), peer = await context.newPage();
    await author.goto('/examples/edit-together');
    await peer.goto('/examples/edit-together');
    await expect(title(peer)).toHaveText(definition.title);
    for (const value of ['One', 'Two']) {
        await title(author).fill(value);
        await title(author).blur();
        await expect(title(peer)).toHaveText(value);
    }
    expect(log.length).toBeGreaterThan(1);   // the second edit changes the first one's record
    const late = await context.newPage();
    await late.goto('/examples/edit-together');
    await expect(title(late)).toHaveText('Two');
    for (const page of [author, peer, late]) {
        await page.getByRole('button', { name: 'Collaboration' }).first().click();
        await page.getByText('Show Version History', { exact: true }).locator('visible=true').first().click();
        const changes = page.locator('.svc-version-history__row--change');
        await expect(changes).toHaveCount(1);
        await expect(changes).toContainText('Title of the survey changed to "Two"');
    }
});
