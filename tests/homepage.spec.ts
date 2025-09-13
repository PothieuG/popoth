import { test, expect } from '@playwright/test';

/**
 * Tests for the homepage functionality
 * Verifies that the main page loads correctly and displays expected content
 */
test.describe('Homepage', () => {
  test('should load and display the main heading', async ({ page }) => {
    await page.goto('/');
    
    // Verify page title
    await expect(page).toHaveTitle(/Popoth App/);
    
    // Verify main heading is visible
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Verify page loads correctly on mobile
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
  });
});