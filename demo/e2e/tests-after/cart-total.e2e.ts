import { expect, test } from 'e2e';

// Tightened after the first drill:
// - with the "Cart" link dead, the agent found another way to the cart, so open it with a locator;
// - with a consistent but wrong price ($14.50 for Dune), "the cart total is correct" agreed with
//   the screen, so pin the prices and the total.
test('cart total adds up', async ({ app, agent, screen }) => {
  await app.open('/');
  await agent.act('add two copies of Dune and one copy of Neuromancer to the cart');
  await screen.getByRole('link', { name: /^Cart/ }).click();
  await expect(screen.getByRole('row', { name: /Dune/ })).toContainText('$12.50');
  await expect(screen.getByRole('row', { name: /Neuromancer/ })).toContainText('$17.50');
  await expect(screen.getByTestId('cart-total')).toBeVisible();
  await expect(screen.getByTestId('cart-total')).toHaveText('$42.50');
  await agent.assert('the cart total is correct');
});
