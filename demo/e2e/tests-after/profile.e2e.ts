import { expect, test } from 'e2e';

// Tightened after the first drill: with PUT /api/profile answering OK but saving
// nothing, "the profile was saved" passed on the success message alone. Reload
// and check the stored value.
test('save a new name on the profile', async ({ app, agent, screen }) => {
  await app.open('/account');
  await agent.act('change my name to Ada King and save the profile');
  await agent.assert('the profile was saved');
  await app.open('/account');
  await expect(screen.getByLabel('Name')).toHaveValue('Ada King');
});
