import { expect, test } from 'e2e';

// Tightened after the first drill: it let Solaris's price ($11.25 → $21.25) and
// "In stock" flipping to "Out of stock" through. Every row now pins both.
test('catalog shows each book with its price', async ({ app, screen }) => {
  await app.open('/');
  const row = (title: RegExp) => screen.getByRole('row', { name: title });
  await expect(row(/Dune/)).toContainText('$12.50');
  await expect(row(/Dune/)).toContainText('In stock');
  await expect(row(/Neuromancer/)).toContainText('$17.50');
  await expect(row(/Neuromancer/)).toContainText('In stock');
  await expect(row(/Hyperion/)).toContainText('$14.00');
  await expect(row(/Hyperion/)).toContainText('In stock');
  await expect(row(/Solaris/)).toContainText('$11.25');
  await expect(row(/Solaris/)).toContainText('Out of stock');
});
