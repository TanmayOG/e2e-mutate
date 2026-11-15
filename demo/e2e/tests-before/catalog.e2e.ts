import { expect, test } from 'e2e';

test('catalog shows each book with its price', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByRole('row', { name: /Dune/ })).toContainText('$12.50');
  await expect(screen.getByRole('row', { name: /Neuromancer/ })).toContainText('$17.50');
  await expect(screen.getByRole('row', { name: /Hyperion/ })).toContainText('$14.00');
  await expect(screen.getByRole('row', { name: /Solaris/ })).toContainText('Out of stock');
});
