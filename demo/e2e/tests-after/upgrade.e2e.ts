import { test } from 'e2e';

test('upgrade to the Pro plan', async ({ app, agent }) => {
  await app.open('/account');
  await agent.act('upgrade to the Pro plan');
  await agent.assert('the plan is Pro');
});
