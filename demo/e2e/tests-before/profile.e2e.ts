import { test } from 'e2e';

test('save a new name on the profile', async ({ app, agent }) => {
  await app.open('/account');
  await agent.act('change my name to Ada King and save the profile');
  await agent.assert('the profile was saved');
});
