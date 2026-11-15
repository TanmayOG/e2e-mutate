import { expect, test } from 'e2e';

// Strong: an exact deterministic check of the total.
test('cart total, strong check', async ({ app, screen }) => {
  await app.open('/cart');
  await expect(screen.getByTestId('cart-total')).toHaveText('$42.50');
});

// Weak: a vague judgment of the same screen.
test('cart total, vague check', async ({ app, agent }) => {
  await app.open('/cart');
  await agent.assert('the cart total is correct');
});

// Loose goal: the app has two ways to upgrade (header button, Settings).
test('upgrade to Pro', async ({ app, agent }) => {
  await app.open('/');
  await agent.act('upgrade the workspace to the Pro plan');
  await agent.assert('the workspace is on the Pro plan');
});
