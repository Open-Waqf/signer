import {expect, test} from '@playwright/test';
import {getHexToRgb} from '../src/lib/pdf/audit-page-service';

test('audit-page-service hex color conversion', async () => {
    const rgb = getHexToRgb()('#336699');
    expect(rgb.red).toBeCloseTo(0.2, 5);
    expect(rgb.green).toBeCloseTo(0.4, 5);
    expect(rgb.blue).toBeCloseTo(0.6, 5);
});

