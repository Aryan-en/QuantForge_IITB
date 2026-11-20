import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.slice(0, 4).map((n) => n.target.join(" ") + " [" + (n.any[0]?.message ?? n.failureSummary ?? "").slice(0, 110) + "]").join(" | ")}`);
}

for (const theme of ["dark", "light"] as const) {
  test(`no serious/critical axe violations: agent run, review, context (${theme})`, async ({ page }) => {
    await page.goto(`/?speed=4&theme=${theme === "light" ? "light" : "dark"}&w=720`);
    await expect(page.getByRole("button", { name: /Model anthropic/ })).toBeVisible();
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    await page.getByRole("button", { name: "Send (Enter)" }).click();
    await expect(page.getByText("Run command?")).toBeVisible({ timeout: 30_000 });
    expect(await serious(page)).toEqual([]);
    await page.getByRole("button", { name: "Allow" }).click();
    await expect(page.getByText("Review gate — submit_changes")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: /Review/ }).click();
    expect(await serious(page)).toEqual([]);
    await page.getByRole("tab", { name: /Context/ }).click();
    expect(await serious(page)).toEqual([]);
    await page.getByRole("tab", { name: "Timeline" }).click();
    expect(await serious(page)).toEqual([]);
  });
}
