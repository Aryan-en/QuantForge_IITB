import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "speed=3") => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?${query}`);
  // The model chip only renders after hydration + the host snapshot, so clicks below are not lost.
  await expect(page.getByRole("button", { name: /Model anthropic/ })).toBeVisible();
  return errors;
};

test("inline edit: diff appears in the editor, per-hunk accept/reject, apply, undo", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "Inline edit" }).click();
  await page.getByRole("button", { name: "Generate edit" }).click();
  const editor = page.getByRole("region", { name: "Editor" });
  await expect(editor.getByRole("button", { name: "Accept all" })).toBeVisible({ timeout: 20_000 });
  await editor.getByRole("button", { name: "Accept", exact: true }).first().click();
  await editor.getByRole("button", { name: "Reject", exact: true }).last().click();
  await editor.getByRole("button", { name: /^Apply 1$/ }).click();
  await expect(editor.getByRole("button", { name: "Undo" })).toBeVisible();
  await editor.getByRole("button", { name: "Undo" }).click();
  await expect(editor.getByRole("button", { name: "Undo" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("agent mode: three files, approval, review gate, undo", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.getByRole("button", { name: "Send (Enter)" }).click();
  await expect(page.getByText("Run command?")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Allow" }).click();
  // When the turn pauses on the review gate, the Review view opens by itself.
  await expect(page.getByRole("tab", { name: /Review/ })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  await expect(page.getByText("3 files")).toBeVisible();
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await page.getByRole("button", { name: /Apply 5 accepted/ }).click();
  await expect(page.getByRole("button", { name: "Undo last batch" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("resilience: offline shows retries then a clear error with workspace unchanged", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Model offline" }).click();
  await page.getByRole("button", { name: "Generate edit" }).click();
  await expect(page.getByText(/Retry \d\/3/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Workspace unchanged")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("combobox", { name: "Task for QuantForge" })).toBeEditable();
});

test("resilience: fallback model takes over automatically", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Fallback", exact: true }).click();
  await page.getByRole("button", { name: "Generate edit" }).click();
  await expect(page.getByText("Switched to fallback model automatically.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("2 hunks to review")).toBeVisible({ timeout: 20_000 });
});

test("cancel leaves nothing running and nothing written", async ({ page }) => {
  await open(page, "speed=2");
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.getByRole("button", { name: "Send (Enter)" }).click();
  await expect(page.getByText("Subagent", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Stop/ }).click();
  await expect(page.getByRole("log").getByText("Cancelled — nothing was written")).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.getByRole("status").filter({ hasText: /Running|Subagent running/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send (Enter)" })).toBeVisible();
});
