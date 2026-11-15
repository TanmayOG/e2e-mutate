import { expect, test } from 'e2e';

// Tightened after the first drill: the order number and the order total were
// hidden and `toHaveText` still passed (a test-id query matches hidden nodes);
// the status said "Pending" and nothing checked it; the checkout total was
// hidden and nothing checked it. Check visibility, and check the status.
test('check out a cart', async ({ app, agent, screen }) => {
  await app.open('/');
  await screen.getByRole('button', { name: 'Add Dune to cart' }).click();
  await expect(screen.getByRole('status')).toHaveText('Added Dune to your cart');
  await app.open('/checkout');
  await expect(screen.getByTestId('checkout-total')).toBeVisible();
  await expect(screen.getByTestId('checkout-total')).toHaveText('$12.50');
  await agent.act('place the order with the saved address');
  await expect(screen.getByTestId('order-number')).toBeVisible();
  await expect(screen.getByTestId('order-number')).toHaveText(/^BK-\d{4}$/);
  await expect(screen.getByTestId('order-total')).toBeVisible();
  await expect(screen.getByTestId('order-total')).toHaveText('$12.50');
  await expect(screen.getByRole('status')).toHaveText('Confirmed');
});
