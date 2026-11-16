// The Form Library pages wear the SurveyJS Tailwind adapter (survey-core/themes/adapters/tailwind4.css)
// with the demo's colours from app.css's @theme static (design 03, Verify 2 to 4 and 6, on save-response).
// A Tailwind or survey-core upgrade that drops a variable makes the adapter fall back to its
// literals silently; these tests fail instead.
import { expect, test } from '@playwright/test';

const SJS_GREEN = 'rgb(25, 179, 148)';   // --color-sjs, #19b394

/** Computed custom properties: on :root (the Tailwind side) and on the survey root (the adapter side). */
function readVariables(page, names, selector) {
    return page.evaluate(([names, selector]) => {
        const style = getComputedStyle(selector ? document.querySelector(selector) : document.documentElement);
        return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]));
    }, [names, selector]);
}

/** The computed colour of a throwaway element coloured with a CSS value, inside the survey root. */
function resolveColor(page, value) {
    return page.evaluate((value) => {
        const probe = document.createElement('span');
        probe.style.color = value;
        document.querySelector('.sd-root-modern').append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    }, value);
}

test.beforeEach(async ({ page }) => {
    await page.goto('/examples/save-response');
    await expect(page.locator('.sd-root-modern')).toBeVisible();
});

test('2. brand and font: the demo green, Lato at 14px in gray-800', async ({ page }) => {
    expect(await readVariables(page, ['--sjs2-color-project-brand-600', '--sjs2-color-project-brand-700'], '.sd-root-modern')).toEqual({
        '--sjs2-color-project-brand-600': '#19b394',
        '--sjs2-color-project-brand-700': '#12957a',
    });

    const email = page.getByRole('textbox', { name: /Your email/ });
    await email.focus();
    await expect(email.locator('xpath=ancestor::*[contains(@class, "sd-formbox")][1]')).toHaveCSS('box-shadow', new RegExp(`${SJS_GREEN.replace(/[()]/g, '\\$&')} 0px 0px 0px 2px inset`));
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toHaveCSS('background-color', SJS_GREEN);

    const gray800 = await resolveColor(page, 'var(--color-gray-800)');
    for (const text of [page.locator('.sd-question__title').first(), email]) {
        await expect(text).toHaveCSS('font-family', /^Lato,/);
        await expect(text).toHaveCSS('font-size', '14px');
        await expect(text).toHaveCSS('color', gray800);
    }
});

test('3. no literal fallback: the Tailwind variables exist and the adapter resolves to them', async ({ page }) => {
    const tailwind = await readVariables(page, [
        '--spacing', '--font-sans', '--text-xs', '--text-sm', '--text-base', '--radius-sm', '--radius-md', '--radius-lg',
        '--color-white', '--color-gray-200', '--color-gray-300', '--color-gray-500', '--color-gray-800', '--color-sjs-red',
        '--color-sjs', '--color-primary', '--color-primary-hover', '--color-foreground', '--color-destructive',
    ]);
    for (const [name, value] of Object.entries(tailwind)) {
        expect(value, `${name} on :root`).not.toBe('');
    }

    const adapter = await readVariables(page, [
        '--sjstw-primary', '--sjstw-foreground', '--sjstw-muted-foreground', '--sjstw-input-border', '--sjstw-border',
        '--sjstw-surface', '--sjstw-primary-foreground', '--sjstw-destructive', '--sjstw-ring', '--sjstw-space',
    ], '.sd-root-modern');
    expect(adapter).toEqual({
        '--sjstw-primary': tailwind['--color-sjs'],
        '--sjstw-foreground': tailwind['--color-gray-800'],
        '--sjstw-muted-foreground': tailwind['--color-gray-500'],
        '--sjstw-input-border': tailwind['--color-gray-300'],
        '--sjstw-border': tailwind['--color-gray-200'],
        '--sjstw-surface': tailwind['--color-white'],
        '--sjstw-primary-foreground': tailwind['--color-white'],
        '--sjstw-destructive': tailwind['--color-sjs-red'],
        '--sjstw-ring': adapter['--sjstw-primary'],
        '--sjstw-space': tailwind['--spacing'],
    });
});

for (const width of [1440, 390]) {
    test(`4. frames and edges at ${width}: no survey background, frameless questions, one left edge`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const survey = page.locator('.sd-root-modern');
        await expect(survey).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        expect(await survey.evaluate((el) => getComputedStyle(el, '::before').backgroundColor)).toBe('rgba(0, 0, 0, 0)');

        const question = page.locator('.sd-question--with-frame').first();
        await expect(question).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(question).toHaveCSS('border-top-width', '0px');
        await expect(question).toHaveCSS('box-shadow', /^(none|rgba\(0, 0, 0, 0\) .*)$/);

        const edges = await page.evaluate(() => {
            // The card's padding edge: #form pads the form inside #component's 1px border
            const form = document.querySelector('#form');
            const titleText = document.createRange();
            titleText.selectNodeContents(document.querySelector('.sd-question__title'));
            return {
                cardPadding: form.getBoundingClientRect().left + parseFloat(getComputedStyle(form).paddingLeft),
                body: document.querySelector('.sd-body').getBoundingClientRect().left,
                question: titleText.getBoundingClientRect().left,
                button: document.querySelector('.sd-body__navigation .sd-navigation__complete-btn').getBoundingClientRect().left,
            };
        });
        // Under 720px the form fills the card; wider, survey-core centres its 720px column (widthMode "auto")
        const edge = width === 390 ? edges.cardPadding : edges.body;
        expect(edges.question).toBeCloseTo(edge, 0);
        expect(edges.button).toBeCloseTo(edge, 0);
        if (width === 390) expect(edges.body).toBeCloseTo(edges.cardPadding, 0);
    });
}

test('6. a required-field error is the design red; its text stays the body colour', async ({ page }) => {
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const message = page.locator('.sd-question__erbox').first();
    await expect(message).toBeVisible();

    const { '--sjs2-palette-red-600': red600 } = await readVariables(page, ['--sjs2-palette-red-600'], '.sd-root-modern');
    const { '--color-sjs-red': designRed } = await readVariables(page, ['--color-sjs-red']);
    expect(red600).toBe(designRed);

    // The invalid field's ring and the message's tint come from the design red (--color-destructive)
    const red = await resolveColor(page, 'var(--color-sjs-red)');
    const email = page.getByRole('textbox', { name: /Your email/ });
    await expect(email.locator('xpath=ancestor::*[contains(@class, "sd-formbox")][1]')).toHaveCSS('box-shadow', new RegExp(`^${red.replace(/[().]/g, '\\$&')} `));
    await expect(message).toHaveCSS('background-color', await resolveColor(page, 'rgb(from var(--color-sjs-red) r g b / 0.1)'));

    // survey-core 3.2.3 colours the message text with fg-basic-primary and only its icon with
    // fg-alert-primary (red-700): the adapter's darker shade of the design red, not stock #C30935
    await expect(message).toHaveCSS('color', await resolveColor(page, 'var(--color-gray-800)'));
    const alert = await resolveColor(page, 'var(--sjs2-color-fg-alert-primary)');
    expect(alert).toBe(await resolveColor(page, 'hsl(from var(--color-sjs-red) h s calc(l * 0.85))'));
    expect(alert).not.toBe(await resolveColor(page, '#C30935'));
});
