import { expect, test } from 'e2e';

test('check out a cart', async ({ app, agent, screen }) => {
  await app.open('/');
  await screen.getByRole('button', { name: 'Add Dune to cart' }).click();
  await expect(screen.getByRole('status')).toHaveText('Added Dune to your cart');
  await app.open('/checkout');
  await agent.act('place the order with the saved address');
  await expect(screen.getByTestId('order-number')).toHaveText(/^BK-\d{4}$/);
  await expect(screen.getByTestId('order-total')).toHaveText('$12.50');
});
