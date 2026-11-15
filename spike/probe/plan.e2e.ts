import { expect, test } from 'e2e';

// Model-free probes that the plan mutants really break what they target.
test('header Upgrade switches the plan', async ({ app, screen }) => {
  await app.open('/');
  await screen.getByRole('button', { name: 'Upgrade' }).click();
  await expect(screen.getByRole('status')).toHaveText('Current plan: Pro');
});

test('Settings switch changes the plan', async ({ app, screen }) => {
  await app.open('/settings');
  await screen.getByRole('button', { name: 'Switch to Pro' }).click();
  await expect(screen.getByRole('status')).toHaveText('Current plan: Pro');
});
