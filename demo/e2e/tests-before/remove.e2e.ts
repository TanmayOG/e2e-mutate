import { expect, test } from 'e2e';

test('remove a book from the cart', async ({ app, agent, screen }) => {
  await app.open('/');
  await screen.getByRole('button', { name: 'Add Dune to cart' }).click();
  await expect(screen.getByRole('status')).toHaveText('Added Dune to your cart');
  await screen.getByRole('button', { name: 'Add Neuromancer to cart' }).click();
  await expect(screen.getByRole('status')).toHaveText('Added Neuromancer to your cart');
  await app.open('/cart');
  await agent.act('remove Dune from the cart');
  await expect(screen.getByRole('row', { name: /Neuromancer/ })).toBeVisible();
  await expect(screen.getByRole('row', { name: /Dune/ })).toHaveCount(0);
});
