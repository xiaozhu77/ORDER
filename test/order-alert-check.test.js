import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkForNewOrders, formatNotificationMessage } from "../src/order-alert-check.js";

async function createSandbox() {
  return fs.mkdtemp(path.join(os.tmpdir(), "order-alert-check-"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildSummary({ storeDate = "2026-07-17", generatedAt = "2026-07-17T09:12:49.386Z", orders = [] } = {}) {
  return {
    generatedAt,
    storeDate,
    selectedDate: storeDate,
    dailySummaries: {
      [storeDate]: {
        orders
      }
    }
  };
}

test("first run initializes state and stays silent", async () => {
  const sandbox = await createSandbox();
  const summaryPath = path.join(sandbox, "summary.json");
  const statePath = path.join(sandbox, "state.json");
  await writeJson(summaryPath, buildSummary({
    orders: [
      { orderNumber: "A001", createdAt: "2026-07-17 00:52:35", amount: 12.51 },
      { orderNumber: "A002", createdAt: "2026-07-17 01:12:02", amount: 35.86 }
    ]
  }));

  const result = await checkForNewOrders({ summaryPath, statePath });

  assert.equal(result.status, "init");
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.deepEqual(state.seenOrderNumbers, ["A001", "A002"]);
});

test("detects new order once and then stays quiet", async () => {
  const sandbox = await createSandbox();
  const summaryPath = path.join(sandbox, "summary.json");
  const statePath = path.join(sandbox, "state.json");

  await writeJson(summaryPath, buildSummary({
    orders: [
      { orderNumber: "A001", createdAt: "2026-07-17 00:52:35", amount: 12.51 }
    ]
  }));
  await checkForNewOrders({ summaryPath, statePath });

  await writeJson(summaryPath, buildSummary({
    generatedAt: "2026-07-17T09:13:49.386Z",
    orders: [
      { orderNumber: "A001", createdAt: "2026-07-17 00:52:35", amount: 12.51 },
      { orderNumber: "A002", createdAt: "2026-07-17 01:12:02", amount: 35.86 }
    ]
  }));

  const notifyResult = await checkForNewOrders({ summaryPath, statePath });
  assert.equal(notifyResult.status, "notify");
  assert.equal(notifyResult.newOrders.length, 1);
  assert.equal(notifyResult.newOrders[0].orderNumber, "A002");
  assert.match(notifyResult.message, /本次新增 1 单/);
  assert.match(notifyResult.message, /A002/);

  const quietResult = await checkForNewOrders({ summaryPath, statePath });
  assert.equal(quietResult.status, "quiet");
});

test("new store date resets seen set and notifies current-day orders", async () => {
  const sandbox = await createSandbox();
  const summaryPath = path.join(sandbox, "summary.json");
  const statePath = path.join(sandbox, "state.json");

  await writeJson(summaryPath, buildSummary({
    storeDate: "2026-07-16",
    generatedAt: "2026-07-16T23:59:30.000Z",
    orders: [
      { orderNumber: "Y001", createdAt: "2026-07-16 23:50:00", amount: 20 }
    ]
  }));
  await checkForNewOrders({ summaryPath, statePath });

  await writeJson(summaryPath, buildSummary({
    storeDate: "2026-07-17",
    generatedAt: "2026-07-17T00:10:00.000Z",
    orders: [
      { orderNumber: "T001", createdAt: "2026-07-17 00:05:00", amount: 15 }
    ]
  }));

  const result = await checkForNewOrders({ summaryPath, statePath });
  assert.equal(result.status, "notify");
  assert.deepEqual(result.newOrders.map((order) => order.orderNumber), ["T001"]);
});

test("invalid json skips without clobbering prior state", async () => {
  const sandbox = await createSandbox();
  const summaryPath = path.join(sandbox, "summary.json");
  const statePath = path.join(sandbox, "state.json");

  await writeJson(summaryPath, buildSummary({
    orders: [
      { orderNumber: "A001", createdAt: "2026-07-17 00:52:35", amount: 12.51 }
    ]
  }));
  await checkForNewOrders({ summaryPath, statePath });
  const before = await fs.readFile(statePath, "utf8");

  await fs.writeFile(summaryPath, "{", "utf8");
  const result = await checkForNewOrders({ summaryPath, statePath });
  const after = await fs.readFile(statePath, "utf8");

  assert.equal(result.status, "skip");
  assert.equal(after, before);
});

test("formats concise notification message", () => {
  const message = formatNotificationMessage({
    storeDate: "2026-07-17",
    generatedAt: "2026-07-17T09:13:49.386Z",
    totalOrdersToday: 2,
    newOrders: [
      { orderNumber: "A001", amount: 12.51 },
      { orderNumber: "A002", amount: 35.86 }
    ]
  });

  assert.match(message, /店铺出单提醒/);
  assert.match(message, /本次新增 2 单/);
  assert.match(message, /£48.37/);
});
