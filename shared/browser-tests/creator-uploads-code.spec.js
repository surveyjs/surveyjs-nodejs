import { expect, test } from '@playwright/test';
import { sharedJson } from './helpers.js';

const definition = sharedJson('definitions/creator-uploads.json');

for (const width of [1440, 1920]) {
    test(`upload and schema-save server code fit the Code panel at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.route('**/api/forms/support-assets', route => route.fulfill({ json: { definition } }));
        await page.goto('/examples/creator-uploads#code');
        const code = page.locator('#panel-code');
        // The two server regions this example reuses, whatever language the platform shows them in
        await expect(code.locator('[data-code-section] summary')).toContainText(['sjs:store-files.server', 'sjs:creator-load-save.server']);
        await code.locator('[data-definition-code] > summary').click();
        const overflow = await code.locator('pre').evaluateAll(elements => elements.map(element => ({
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
            whiteSpace: getComputedStyle(element.querySelector('code')).whiteSpace,
        })));
        expect(overflow).toHaveLength(4);
        for (const block of overflow) {
            expect(block.scrollWidth).toBeLessThanOrEqual(block.width);
            expect(block.whiteSpace).toBe('pre');
        }
    });
}
