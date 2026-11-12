import { expect, test } from '@playwright/test';

const apps = [
  { title: 'React', port: 5173 },
  { title: 'Next.js', port: 3000 },
  { title: 'Vue', port: 5174 },
  { title: 'Nuxt', port: 3001 },
];

for (const app of apps) {
  test(`${app.title} starts, renders, and handles an interaction`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(`http://127.0.0.1:${app.port}`);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: `DevAnalyst ${app.title} playground`, exact: true }),
    ).toBeVisible();
    const counter = page.getByRole('button', { name: 'Count: 0', exact: true });
    await expect(counter).toBeEnabled();
    await counter.click();
    await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
