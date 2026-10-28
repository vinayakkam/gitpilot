import axe from "axe-core";

/** Fails with the rule ids and offending markup when axe finds problems. jsdom has no layout, so contrast isn't checked. */
export async function expectNoAxeViolations(root: Element = document.body) {
  const res = await axe.run(root, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  const found = res.violations.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.html).join("\n  ")}`);
  expect(found).toEqual([]);
}
