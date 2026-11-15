import { test } from 'e2e';

test('cart total adds up', async ({ app, agent }) => {
  await app.open('/');
  await agent.act('add two copies of Dune and one copy of Neuromancer to the cart, then open the cart');
  await agent.assert('the cart total is correct');
});
