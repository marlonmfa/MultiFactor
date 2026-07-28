const path = require("node:path");
const { test, expect } = require("@playwright/test");

const fixturePath = path.join(__dirname, "..", "fixtures", "message.txt");
const expectedContents = [
  "This message was encrypted in the sender's browser.",
  "Only the recipient with the secret can read it.",
  "",
].join("\n");

test("uploads, shares, decrypts, and downloads a local file", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Choose a file").setInputFiles(fixturePath);
  await expect(page.locator("#file-label")).toContainText("message.txt");

  await page.getByRole("button", { name: "Encrypt & upload" }).click();
  await expect(page.getByRole("status")).toHaveText("Encrypted upload complete.");

  const shareLink = await page.locator("#share-link").inputValue();
  expect(shareLink).toMatch(/^http:\/\/127\.0\.0\.1:3000\/share\/[a-f0-9]{32}#[A-Za-z0-9_-]+$/);

  await page.goto(shareLink);
  await expect(page.getByRole("heading", { name: "Unlock your shared file." })).toBeVisible();
  await expect(page.locator("#secret-input")).not.toHaveValue("");

  await page.getByRole("button", { name: "Decrypt file" }).click();
  await expect(page.getByRole("status")).toHaveText("File decrypted successfully.");
  await expect(page.getByRole("heading", { name: "message.txt" })).toBeVisible();
  await expect(page.locator("#preview")).toHaveText(expectedContents.trim());

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download decrypted file" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("message.txt");
  expect(await download.createReadStream().then(async (stream) => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  })).toBe(expectedContents);
});
