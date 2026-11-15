import { test } from 'e2e';

test('add a book to the cart', async ({ app, agent }) => {
  await app.open('/');
  await agent.act('add Dune to the cart');
  await agent.assert('the cart has the book');
});
