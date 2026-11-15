import { expect, test } from 'e2e';

// Tightened after the first drill: with the cart API answering qty 2, the agent
// healed past the step and "the cart has the book" still passed. Pin the count.
test('add a book to the cart', async ({ app, agent, screen }) => {
  await app.open('/');
  await agent.act('add Dune to the cart');
  await expect(screen.getByRole('link', { name: 'Cart (1)' })).toBeVisible();
  await agent.assert('the cart has exactly 1 copy of Dune');
});
