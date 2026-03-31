import { test, expect } from "./fixtures.js";

test.describe("Schedule Management — UI", { tag: ["@schedule"] }, () => {
  // Delete all schedules before each test so state from prior tests doesn't bleed in.
  test.beforeEach(async ({ grackle: { client } }) => {
    const list = await client.listSchedules({});
    await Promise.all(list.schedules.map((s) => client.deleteSchedule({ id: s.id })));
  });

  test("schedule management view shows created schedule", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;

    // A schedule requires a persona — create one first
    const persona = await client.createPersona({
      name: "Schedule Watcher",
      systemPrompt: "You watch things.",
      runtime: "stub",
    });

    await client.createSchedule({
      title: "Nightly Review",
      description: "Reviews things at night",
      scheduleExpression: "0 21 * * *",
      personaId: persona.id,
    });

    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await page.getByRole("tab", { name: "Schedules" }).click();

    await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Nightly Review")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("0 21 * * *")).toBeVisible({ timeout: 5_000 });
  });

  test("empty state is shown when no schedules exist", async ({ appPage }) => {
    const page = appPage;

    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await page.getByRole("tab", { name: "Schedules" }).click();

    await expect(page.getByTestId("schedule-empty-state")).toBeVisible({ timeout: 5_000 });
  });

  test("delete schedule removes it from management view", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;

    const persona = await client.createPersona({
      name: "Temp Persona",
      systemPrompt: "Temporary.",
      runtime: "stub",
    });

    await client.createSchedule({
      title: "Soon Deleted Schedule",
      scheduleExpression: "5m",
      personaId: persona.id,
    });

    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await page.getByRole("tab", { name: "Schedules" }).click();
    await expect(page.getByText("Soon Deleted Schedule")).toBeVisible({ timeout: 5_000 });

    // Delete via RPC
    const list = await client.listSchedules({});
    const toDelete = list.schedules.find((s) => s.title === "Soon Deleted Schedule");
    expect(toDelete).toBeDefined();
    await client.deleteSchedule({ id: toDelete!.id });

    await expect(page.getByText("Soon Deleted Schedule")).not.toBeVisible({ timeout: 5_000 });
  });

  test("create, edit, and delete schedule via UI", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;

    // Need a persona to select in the create form
    await client.createPersona({
      name: "UI Test Persona",
      systemPrompt: "For UI testing.",
      runtime: "stub",
    });

    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await page.getByRole("tab", { name: "Schedules" }).click();
    await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible({ timeout: 5_000 });

    // Open the create form
    await page.getByTestId("schedule-new-button").click();
    await page.waitForURL("**/settings/schedules/new", { timeout: 5_000 });
    await expect(page.getByRole("tab", { name: "Schedules", selected: true })).toBeVisible();

    // Fill in the create form
    await page.getByTestId("schedule-detail-title").fill("UI Created Schedule");
    await page.getByTestId("schedule-detail-description").fill("Created from the UI");
    await page.getByTestId("schedule-detail-expression").fill("30m");
    await page.getByTestId("schedule-detail-persona").selectOption({ label: "UI Test Persona" });
    await page.getByTestId("schedule-detail-save").click();

    // Should redirect to the edit page for the new schedule
    await page.waitForURL(/\/settings\/schedules\/[^/]+$/, { timeout: 5_000 });

    // Verify schedule was created in the backend
    let createdSchedule: { id: string; title: string } | undefined;
    await expect.poll(async () => {
      const listResp = await client.listSchedules({});
      createdSchedule = listResp.schedules.find((s) => s.title === "UI Created Schedule");
      return createdSchedule;
    }, { timeout: 5_000 }).toBeDefined();

    await expect(page.getByRole("heading", { name: "Edit Schedule" })).toBeVisible({ timeout: 5_000 });

    // Edit the title via inline editing
    await page.getByTestId("schedule-detail-title-button").click();
    await page.getByTestId("schedule-detail-title-input").fill("UI Updated Schedule");
    await page.getByTestId("schedule-detail-title-input").press("Enter");

    // Go back to list and verify updated title appears
    await page.getByTestId("schedule-detail-cancel").click();
    await expect(page).toHaveURL(/\/settings\/schedules$/, { timeout: 5_000 });

    let updatedSchedule: { id: string; title: string } | undefined;
    await expect.poll(async () => {
      const listResp = await client.listSchedules({});
      updatedSchedule = listResp.schedules.find((s) => s.title === "UI Updated Schedule");
      return updatedSchedule;
    }, { timeout: 5_000 }).toBeDefined();

    await expect(page.getByTestId(`schedule-card-${updatedSchedule!.id}`)).toContainText("UI Updated Schedule", { timeout: 5_000 });

    // Delete via UI
    await page.getByTestId(`schedule-card-${updatedSchedule!.id}`).click();
    await page.waitForURL(`**/settings/schedules/${updatedSchedule!.id}`, { timeout: 5_000 });
    await page.getByTestId("schedule-detail-delete").click();

    const dialog = page.getByRole("dialog", { name: "Delete Schedule?" });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(page).toHaveURL(/\/settings\/schedules$/, { timeout: 5_000 });
    await expect(page.getByTestId(`schedule-card-${updatedSchedule!.id}`)).toHaveCount(0);
  });
});
