// shared/ui/page-tabs.js: the side panel (Description, Requests, Data) and the main tabs (Demo,
// Code), the toggle and its badge, the hash, the phone sheet, the counter, the Data dot, the fade on
// the panel's tab row and the bounded read-outs (design 04).
import { expect, test } from '@playwright/test';
import { completeSaveResponse, row } from './helpers.js';

const panelTab = (page, name) => page.locator(`#panel-tab-${name}`);
const mainTab = (page, name) => page.locator(`#tab-${name}`);
const toggle = (page) => page.locator('#panel-toggle');
const badge = (page) => page.locator('#panel-dot');

async function expectMain(page, name) {
    await expect(mainTab(page, name)).toHaveAttribute('aria-selected', 'true');
    for (const other of ['demo', 'code']) await expect(page.locator(`#panel-${other}`)).toBeVisible({ visible: other === name });
}

async function expectPanel(page, name) {
    await expect(page.locator('#side-panel')).toBeVisible({ visible: name !== null });
    await expect(toggle(page)).toHaveAttribute('aria-expanded', String(name !== null));
    if (name === null) return;
    await expect(panelTab(page, name)).toHaveAttribute('aria-selected', 'true');
    for (const other of ['description', 'requests', 'stored']) await expect(page.locator(`#panel-${other}`)).toBeVisible({ visible: other === name });
}

const colours = (locator) => locator.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);

test('1. the default state: open on Description at 1440, closed at 390; the toggle is remembered from 768px', async ({ page }) => {
    await page.goto('/examples/save-response');
    await expectPanel(page, 'description');
    await expectMain(page, 'demo');
    await expect(toggle(page)).toHaveAttribute('aria-label', 'Hide the panel');

    // The panel sits left of the main column, 400px wide, sticky under the header
    const [panel, main, header] = await Promise.all(['#side-panel', 'main', '#page-header'].map((s) => page.locator(s).boundingBox()));
    expect(panel.x).toBe(0);
    expect(panel.width).toBe(400);
    expect(main.x).toBe(400);
    expect(panel.y).toBeCloseTo(header.height, 0);
    expect(panel.y + panel.height).toBeCloseTo(900, 0);

    await toggle(page).click();
    await expectPanel(page, null);
    await expect(toggle(page)).toHaveAttribute('aria-label', 'Show the panel');
    expect((await page.locator('main').boundingBox()).x).toBe(0);
    await page.reload();
    await expectPanel(page, null);   // remembered
    await toggle(page).click();
    await page.reload();
    await expectPanel(page, 'description');

    // Demo/Code never change the panel's tab; the next load of this or another example opens on Description
    await panelTab(page, 'stored').click();
    await mainTab(page, 'code').click();
    await expectPanel(page, 'stored');
    await page.goto('about:blank');
    await page.goto('/examples/save-response');
    await expectPanel(page, 'description');
    await expectMain(page, 'demo');
    await panelTab(page, 'stored').click();
    await page.goto('/examples/validate-response');
    await expectPanel(page, 'description');
    await page.goto('/examples/save-response');
    await panelTab(page, 'stored').click();

    // 900: docked at 320px
    await page.setViewportSize({ width: 900, height: 1000 });
    expect((await page.locator('#side-panel').boundingBox()).width).toBe(320);

    // 390: closed, whatever was stored; across 768 the stored choice is kept
    await page.setViewportSize({ width: 390, height: 844 });
    await expectPanel(page, null);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expectPanel(page, 'stored');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('about:blank');
    await page.goto('/examples/save-response');
    await expectPanel(page, null);
});

test('2. the hash: each name selects its tab and set; choosing a tab replaces it', async ({ page }) => {
    for (const [hash, main, panel] of [['', 'demo', 'description'], ['#demo', 'demo', 'description'], ['#code', 'code', 'description'],
        ['#description', 'demo', 'description'], ['#requests', 'demo', 'requests'], ['#stored', 'demo', 'stored']]) {
        await page.goto('about:blank');
        await page.goto(`/examples/save-response${hash}`);
        await expectMain(page, main);
        await expectPanel(page, panel);
    }

    // A panel tab's hash opens a closed panel
    await toggle(page).click();
    await page.goto('about:blank');
    await page.goto('/examples/save-response#requests');
    await expectPanel(page, 'requests');
    await page.evaluate(() => localStorage.clear());   // the hash opened it for this load only: closed is still stored

    await page.goto('about:blank');
    await page.goto('/examples/save-response');
    const entries = await page.evaluate(() => history.length);
    await panelTab(page, 'requests').click();
    await expect(page).toHaveURL(/\/examples\/save-response#requests$/);
    await mainTab(page, 'code').click();
    await expect(page).toHaveURL(/#code$/);
    await expectPanel(page, 'requests');   // independent
    await mainTab(page, 'demo').click();
    await expect(page).toHaveURL(/\/examples\/save-response$/);
    await panelTab(page, 'stored').click();
    await toggle(page).click();   // closing drops a panel tab's hash
    await expect(page).toHaveURL(/\/examples\/save-response$/);
    expect(await page.evaluate(() => history.length)).toBe(entries);

    // A hashchange (a link, back and forward) switches the tab
    await page.evaluate(() => {
        location.hash = '#code';
    });
    await expectMain(page, 'code');
    await page.evaluate(() => {
        location.hash = '#requests';
    });
    await expectPanel(page, 'requests');
    await page.goBack();
    await expectMain(page, 'code');
    await page.goForward();
    await expectPanel(page, 'requests');

    // Keyboard: arrows, Home and End move within each set, and only the selected tab is in the tab order
    await panelTab(page, 'requests').focus();
    await page.keyboard.press('ArrowRight');
    await expect(panelTab(page, 'stored')).toBeFocused();
    await expectPanel(page, 'stored');
    await page.keyboard.press('ArrowRight');   // wraps around
    await expectPanel(page, 'description');
    await page.keyboard.press('End');
    await expectPanel(page, 'stored');
    await expect(panelTab(page, 'description')).toHaveAttribute('tabindex', '-1');
    await mainTab(page, 'code').focus();
    await page.keyboard.press('Home');
    await expectMain(page, 'demo');
    await expectPanel(page, 'stored');
});

test('3. the phone sheet: full screen, no page scroll, Escape and × close it and return focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/examples/async-functions');
    await expectPanel(page, null);
    expect((await page.locator('main').boundingBox()).width).toBe(390);

    await toggle(page).click();
    await expectPanel(page, 'description');
    expect(await page.locator('#side-panel').boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });   // over the header too
    await expect(page.locator('html')).toHaveCSS('overflow-y', 'hidden');
    await expect(page.locator('#panel-close')).toBeVisible();
    expect((await page.locator('#panel-close').boundingBox()).y + 32).toBeLessThanOrEqual(40);
    await expect(page.locator('#side-panel :focus')).toHaveCount(1);
    expect(await page.locator('main').evaluate((el) => el.inert)).toBe(true);

    await page.keyboard.press('Escape');
    await expectPanel(page, null);
    await expect(toggle(page)).toBeFocused();
    await expect(page.locator('html')).not.toHaveCSS('overflow-y', 'hidden');

    await toggle(page).click();
    await panelTab(page, 'requests').click();
    await expect(page).toHaveURL(/#requests$/);
    await page.locator('#panel-close').click();
    await expectPanel(page, null);
    await expect(toggle(page)).toBeFocused();
    await expect(page).not.toHaveURL(/#requests$/);

    // A panel tab's hash opens the sheet; nothing else does
    await page.goto('about:blank');
    await page.goto('/examples/async-functions#stored');
    await expectPanel(page, 'stored');

    // Wider than 768, the closed sheet is the docked panel again, open
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1024, height: 768 });
    await expectPanel(page, 'stored');
    await expect(page.locator('#panel-close')).toBeHidden();
    await expect(page.locator('html')).not.toHaveCSS('overflow-y', 'hidden');
});

test('4. the badge: while closed, on a request and on a Data change; it clears once both tabs were shown', async ({ page }) => {
    await page.goto('/examples/save-response');
    await expect(badge(page)).toBeHidden();

    // The badge is the Figma's: 6×6 at 36,0 of the 42×42 button
    const box = await toggle(page).boundingBox();
    expect([box.width, box.height]).toEqual([42, 42]);

    // Open on Description: a request and a Data change don't show the badge, but the counter and the dot do
    await completeSaveResponse(page);
    await expect(row(page, 'POST', '/api/responses')).toHaveAttribute('data-state', 'ok');
    await expect(page.locator('#stored-dot')).toBeVisible();
    await expect(page.locator('#requests-count')).toBeVisible();
    await expect(badge(page)).toBeHidden();

    // Closed: the badge shows both
    await toggle(page).click();
    await expect(badge(page)).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-label', 'Show the panel, new requests and stored data changed');
    const dot = await badge(page).boundingBox();
    const button = await toggle(page).boundingBox();
    expect([dot.x - button.x, dot.y - button.y, dot.width, dot.height]).toEqual([36, 0, 6, 6]);
    await expect(badge(page)).toHaveCSS('background-color', 'rgb(25, 179, 148)');

    // Requests seen: its counter clears, the Data change still counts
    await toggle(page).click();
    await expect(badge(page)).toBeHidden();
    await panelTab(page, 'requests').click();
    await expect(page.locator('#requests-count')).toBeHidden();
    await expect(page.locator('#stored-dot')).toBeVisible();
    await toggle(page).click();
    await expect(badge(page)).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-label', 'Show the panel, stored data changed');

    // Data seen too: nothing is left
    await toggle(page).click();
    await panelTab(page, 'stored').click();
    await expect(page.locator('#stored-dot')).toBeHidden();
    await toggle(page).click();
    await expect(badge(page)).toBeHidden();
    await expect(toggle(page)).toHaveAttribute('aria-label', 'Show the panel');

    // A request while closed: the badge, then it clears on Requests
    await page.getByRole('button', { name: 'Start over' }).click();
    await completeSaveResponse(page, 'bob@example.com');
    await expect(badge(page)).toBeVisible();
    // Data refreshes after the request: wait for it, or it can land after the panel closes again
    await expect(toggle(page)).toHaveAttribute('aria-label', 'Show the panel, new requests and stored data changed');
    await toggle(page).click();
    await panelTab(page, 'requests').click();
    await panelTab(page, 'stored').click();
    await toggle(page).click();
    await expect(badge(page)).toBeHidden();
});

test('5. the counter counts the unseen requests, green while they succeed and red after a failure; Requests clears it', async ({ page }) => {
    await page.goto('/examples/validate-response');
    const counter = page.locator('#requests-count');
    await expect(counter).toBeHidden();

    await page.route('**/api/responses', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: '{"id":1}' }));
    await page.getByRole('button', { name: 'Wrong type' }).click();
    await expect(counter).toHaveText('1');
    await expect(counter).toHaveAttribute('data-kind', 'ok');
    expect(await colours(counter)).toEqual(['rgb(221, 244, 239)', 'rgb(25, 179, 148)']);   // sjs-15, sjs
    const pill = await counter.boundingBox();
    expect(pill.height).toBe(20);
    expect(pill.width).toBeGreaterThanOrEqual(20);
    const label = await page.locator('#panel-tab-requests').evaluate((tab) => {
        const range = document.createRange();
        range.selectNodeContents([...tab.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()));
        return range.getBoundingClientRect().right;
    });
    expect(pill.x - label).toBeCloseTo(8, 0);   // 8px after the label

    await page.unroute('**/api/responses');
    await page.route('**/api/responses', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: '{"errors":[]}' }));
    await page.getByRole('button', { name: 'Wrong type' }).click();
    await expect(counter).toHaveText('2');
    await expect(counter).toHaveAttribute('data-kind', 'error');
    expect(await colours(counter)).toEqual(['rgb(251, 218, 226)', 'rgb(229, 10, 62)']);   // sjs-red-15, sjs-red

    // Seen: cleared, and a request while Requests shows doesn't count
    await panelTab(page, 'requests').click();
    await expect(counter).toBeHidden();
    await page.getByRole('button', { name: 'Wrong type' }).click();
    await expect(page.locator('#requests > li:not([hidden])')).toHaveCount(3);
    await expect(counter).toBeHidden();

    // Unseen again from the next one, green while the unseen ones succeed
    await page.unroute('**/api/responses');
    await page.route('**/api/responses', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: '{"id":2}' }));
    await panelTab(page, 'description').click();
    await page.getByRole('button', { name: 'Wrong type' }).click();
    await expect(counter).toHaveText('1');
    await expect(counter).toHaveAttribute('data-kind', 'ok');
});

test('6. at 900 the tabs have no icons and fit; cut, the panel tabs scroll and fade; both tab rows are one height', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1000 });
    await page.goto('/examples/async-functions');
    const tablist = page.locator('#panel-tabs');
    await page.evaluate(() => document.fonts.ready);

    await expect(page.locator('#panel-tabs svg, #page-tabs svg')).toHaveCount(0);
    await expect(tablist).not.toHaveAttribute('data-fade-end');
    await expect(tablist).not.toHaveAttribute('data-fade-start');
    const thumb = page.locator('#panel-tabs-thumb');
    await expect(thumb).toBeHidden();

    // Narrower than its tabs, the row is cut
    await page.locator('#side-panel').evaluate((el) => { el.style.width = '240px'; });
    await expect(tablist).toHaveAttribute('data-fade-end', '');
    await expect(tablist).not.toHaveAttribute('data-fade-start');
    // The thumb shows in the 8px under the tabs, 4px in from the row's left; the native scrollbar takes no room
    await expect(thumb).toBeVisible();
    const rowBox = () => tablist.locator('xpath=..').boundingBox();
    const [row, thumbAtStart, tabAtStart] = await Promise.all([rowBox(), thumb.boundingBox(), panelTab(page, 'description').boundingBox()]);
    expect(thumbAtStart.x - row.x).toBe(4);
    expect(thumbAtStart.y).toBe(tabAtStart.y + tabAtStart.height);
    expect(row.y + row.height - 1 - (thumbAtStart.y + thumbAtStart.height)).toBe(0);   // 1: the row's bottom border
    expect(thumbAtStart.width).toBeLessThan(row.width - 8);
    expect(await tablist.evaluate((el) => el.offsetHeight - el.clientHeight)).toBe(0);
    const mask = () => tablist.evaluate((el) => getComputedStyle(el).maskImage);
    expect(await mask()).toBe('linear-gradient(270deg, rgba(0, 0, 0, 0), rgb(0, 0, 0) 16px)');   // to left
    expect(await tablist.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).flexWrap)).toBe('nowrap');
    // At rest the first tab is at the row's side padding, with no fade on its side
    expect((await panelTab(page, 'description').boundingBox()).x).toBe(20);

    await tablist.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(tablist).toHaveAttribute('data-fade-start', '');
    await expect(tablist).not.toHaveAttribute('data-fade-end');
    expect(await mask()).toBe('linear-gradient(90deg, rgba(0, 0, 0, 0), rgb(0, 0, 0) 16px)');   // to right
    // Scrolled to the end, the thumb ends 4px in from the row's right
    const [rowAtEnd, thumbAtEnd] = await Promise.all([rowBox(), thumb.boundingBox()]);
    expect(rowAtEnd.x + rowAtEnd.width - (thumbAtEnd.x + thumbAtEnd.width)).toBeCloseTo(4, 0);

    // Dragging the thumb back to the left scrolls the row to its start
    await page.mouse.move(thumbAtEnd.x + thumbAtEnd.width / 2, thumbAtEnd.y + thumbAtEnd.height / 2);
    await page.mouse.down();
    await page.mouse.move(rowAtEnd.x, thumbAtEnd.y + thumbAtEnd.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(tablist).not.toHaveAttribute('data-fade-start');
    expect((await thumb.boundingBox()).x - rowAtEnd.x).toBe(4);

    await tablist.evaluate((el) => el.scrollTo({ left: 8 }));
    await expect(tablist).toHaveAttribute('data-fade-end', '');
    await expect(tablist).toHaveAttribute('data-fade-start', '');
    expect(await mask()).toBe('linear-gradient(90deg, rgba(0, 0, 0, 0), rgb(0, 0, 0) 16px, rgb(0, 0, 0) calc(100% - 16px), rgba(0, 0, 0, 0))');

    // The fade is on the tablist only: its wrapper's border stays solid
    const wrapper = tablist.locator('xpath=..');
    expect(await wrapper.evaluate((el) => [getComputedStyle(el).maskImage, getComputedStyle(el).borderBottomWidth, getComputedStyle(el).borderBottomStyle])).toEqual(['none', '1px', 'solid']);

    // Choosing a cut tab scrolls it fully into view
    await tablist.evaluate((el) => el.scrollTo({ left: 0 }));
    await panelTab(page, 'stored').click({ position: { x: 4, y: 20 } });
    const [list, stored] = await Promise.all([tablist.boundingBox(), panelTab(page, 'stored').boundingBox()]);
    expect(stored.x + stored.width).toBeLessThanOrEqual(list.x + list.width);

    // The two tab rows are the same height; the 42px toggle is 8px clear of its row
    const [panelRow, mainRow, button] = await Promise.all([wrapper.boundingBox(), page.locator('#main-tabs').boundingBox(), toggle(page).boundingBox()]);
    expect(panelRow.height).toBe(mainRow.height);
    expect(panelRow.y).toBe(mainRow.y);
    expect(button.y - mainRow.y).toBeGreaterThanOrEqual(8);
    expect(mainRow.y + mainRow.height - 1 - (button.y + button.height)).toBeGreaterThanOrEqual(8);   // 1: the row's bottom border
});

test('7. async-functions at 768 with the panel open: no horizontal page scroll', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/examples/async-functions');
    await expectPanel(page, 'description');
    for (const name of ['description', 'requests', 'stored']) {
        await panelTab(page, name).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
    }
    await mainTab(page, 'code').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
});

for (const [width, height] of [[1440, 900], [390, 844]]) {
    test(`8. after 50 notes, the panel's tabs and the first request row stay on screen (${width}×${height})`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.route('**/api/responses', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: '{"errors":[{"type":"unknown-choice","path":"incident"}]}' }));
        await page.goto('/examples/validate-response');

        const button = page.getByRole('button', { name: 'Unknown choice' });
        for (let i = 0; i < 50; i++) await button.click();
        await expect(page.locator('#notes > li')).toHaveCount(50);

        if (width < 768) await toggle(page).click();
        await panelTab(page, 'requests').click();
        await expect(row(page, 'POST', '/api/responses')).toBeVisible();
        for (const locator of [page.locator('#panel-tabs'), page.locator('#requests > li:not([hidden])').first()]) {
            const box = await locator.boundingBox();
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.y + box.height).toBeLessThanOrEqual(height);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
}
