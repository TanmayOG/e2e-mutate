import { relevantMisses } from './relevance.ts';
import type { Mutant, MutantOutcome, TestVerdict } from './types.ts';

const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const money = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value;
};
const regexSource = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** A name with a live count, such as "Cart (3)", matched by its stable part: `/^Cart/`. */
const nameMatcher = (name: string) => {
  const stable = /^(.*?)\s*\(\d+\)$/.exec(name)?.[1];
  return stable ? `/^${regexSource(stable)}/` : quote(name);
};
const onPage = (page: string | undefined) => (page ? ` on \`${page}\`` : '');

/**
 * What to change so a test catches this bug next time. Suggestions are built
 * from the bug's own values, so each one is concrete: the locator or the
 * exact value to pin, and the page it shows on. An `agent.assert` is only
 * reused when it belongs to a test that healed past the bug: a check from a
 * test that merely passed through the page is about something else. Returns
 * one line per suggestion, Markdown with inline code.
 */
export function suggest(mutant: Mutant, outcome: MutantOutcome, tests: readonly TestVerdict[]): string[] {
  if (outcome !== 'got-through' && outcome !== 'healed-past') return [];
  const lines: string[] = [];
  const healedJudgment = relevantMisses(tests).find((test) => test.outcome === 'healed-past')?.passedJudgments[0];
  const pinTheValue = (value: string) =>
    `Check the exact value${onPage(mutant.page)}: \`await expect(screen.getByText(${quote(value)})).toBeVisible();\`` +
    (healedJudgment ? `, or name it in the check that let it through: \`agent.assert(${quote(`${healedJudgment}, and it shows ${value}`)})\`.` : '.');
  const item = /for "(.*)" instead/.exec(mutant.title)?.[1];

  switch (mutant.type) {
    case 'wrong-number':
    case 'wrong-word':
      lines.push(pinTheValue(mutant.before));
      break;
    case 'missing-element':
      lines.push(
        mutant.element?.testId !== undefined
          ? `Check that it is shown: \`await expect(screen.getByTestId(${quote(mutant.element.testId)})).toBeVisible();\`, or query it with \`{ visible: true }\`. A test-id query matches hidden nodes, and \`toHaveText\` still reads the text of a \`display: none\` element.`
          : `Check the message${onPage(mutant.page)}: \`await expect(screen.getByRole(${quote(mutant.element?.role ?? 'status')})).toHaveText(${quote(mutant.before)});\`.`,
      );
      break;
    case 'dead-control': {
      const role = mutant.element?.role ?? 'button';
      const name = mutant.element?.name ?? '';
      const where = mutant.element?.region ? ` in the ${mutant.element.region}` : '';
      if (outcome === 'healed-past') {
        lines.push(
          `The goal lets the agent take another route when "${name}" breaks. Click it with a locator: \`await screen.getByRole(${quote(role)}, { name: ${nameMatcher(name)} }).click();\``,
          `Or keep it agentic and name the route in the goal: \`agent.act(${quote(`… using the "${name.replace(/\s*\(\d+\)$/, '')}" ${role}${where}`)})\`.`,
        );
      } else {
        lines.push(`A test clicks "${name}", but nothing checks what the click does. Right after it, \`expect\` the change it should make; if the test only exercises the click itself, add this bug to the ignore list.`);
      }
      break;
    }
    case 'swapped-rows': {
      // A table body's rows are `row`s; a list's are `listitem`s. A label the title shortened is matched by its prefix.
      const role = /(?:^|[\s>])tbody(?::nth-of-type\(\d+\))?$/.test(mutant.element?.css ?? '') ? 'row' : 'listitem';
      const order = (mutant.rows ?? mutant.before.split(', then ')).map((label) => quote(label.replace(/…$/, '').trim()));
      lines.push(
        `If the order matters, check it: \`await expect(screen.getByRole(${quote(role)})).toContainText([${order.join(', ')}]);\` (the list form checks the order). If it doesn't, add this bug to the ignore list.`,
      );
      break;
    }
    case 'server-error':
      lines.push(`Nothing checks that \`${mutant.method} ${mutant.path}\` worked. After the action, check its result: reload and \`expect\` the saved value, or assert the success message exactly.`);
      break;
    case 'lost-write':
      lines.push(
        `The app said the save worked, but nothing reached the server. Reload and check the stored value: ${mutant.page && !mutant.page.includes(':') ? `\`await app.open(${quote(mutant.page)});\`` : 'reload the page'}, then \`expect\` the field \`toHaveValue\` the new value. A success message alone can't tell.`,
      );
      break;
    case 'wrong-api-value': {
      const field = String(mutant.jsonPath?.at(-1) ?? '');
      lines.push(`The screen stayed self-consistent with a wrong ${field} (${mutant.before} → ${mutant.after}), so a check that only reads the screen agrees with it.`);
      if (/^(?:qty|quantity)$/i.test(field)) {
        lines.push(
          `Check the quantity exactly: \`agent.assert(${quote(`the cart has exactly ${mutant.before} ${item ? `copy of ${item}` : 'of the item'}`)})\`, or \`expect\` a count that shows it, such as the cart badge.`,
        );
      } else if (mutant.before === 'true' || mutant.before === 'false') {
        // A flag isn't shown as "true": check the text the app shows for it, on that item's row.
        const row = item ? ` on the "${item}" row, for example \`await expect(screen.getByRole('row', { name: /${regexSource(item)}/ })).toContainText(…);\`` : '';
        lines.push(`Check what the app shows when ${field} is ${mutant.before}${row}, with the label the app shows for it.`);
      } else {
        lines.push(pinTheValue(/price|amount|cost/i.test(field) ? money(mutant.before) : mutant.before));
      }
      break;
    }
    case 'missing-api-item': {
      const label = /leaves out "(.*)"$/.exec(mutant.title)?.[1] ?? 'the item';
      lines.push(
        `"${label}" disappeared and every total still added up, so "is the total correct" can't notice. Check it is there: \`await expect(screen.getByRole('row', { name: /${regexSource(label)}/ })).toBeVisible();\`, or check the total against the value you expect.`,
      );
      break;
    }
  }
  return lines;
}
