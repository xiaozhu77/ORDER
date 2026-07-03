import assert from "node:assert/strict";
import test from "node:test";
import { buildSummary } from "../src/aggregate.js";
import { extractUtmId, UNKNOWN_NO_URL, UNKNOWN_NO_UTM } from "../src/utm.js";

test("extracts utm_id from landing URL", () => {
  const result = extractUtmId("https://shop.example/landing?utm_id=1869507736397281&x=1");
  assert.equal(result.utmId, "1869507736397281");
  assert.equal(result.recognized, true);
});

test("classifies missing URL and missing utm_id", () => {
  assert.equal(extractUtmId("").utmId, UNKNOWN_NO_URL);
  assert.equal(extractUtmId("https://shop.example/landing?x=1").utmId, UNKNOWN_NO_UTM);
});

test("deduplicates orders and groups by utm_id for target date", () => {
  const summary = buildSummary([
    {
      orderNumber: "A001",
      createdAt: "2026-07-02 10:00:00",
      amount: "¥100.50",
      status: "已付款",
      landingUrl: "https://shop.example/landing?utm_id=1869507736397281"
    },
    {
      orderNumber: "A001",
      createdAt: "2026-07-02 10:00:00",
      amount: "¥100.50",
      status: "已付款",
      landingUrl: "https://shop.example/landing?utm_id=1869507736397281"
    },
    {
      orderNumber: "A002",
      createdAt: "2026-07-02 11:00:00",
      amount: "50",
      status: "已取消",
      landingUrl: ""
    },
    {
      orderNumber: "OLD",
      createdAt: "2026-07-01 23:00:00",
      amount: "999",
      status: "已付款",
      landingUrl: "https://shop.example/landing?utm_id=old"
    }
  ], {
    targetDate: new Date("2026-07-02T12:00:00+08:00"),
    timeZone: "Asia/Shanghai"
  });

  assert.equal(summary.totals.orderCount, 2);
  assert.equal(summary.totals.totalAmount, 150.5);
  assert.equal(summary.totals.recognizedOrders, 1);
  assert.equal(summary.totals.unrecognizedOrders, 1);
  assert.equal(summary.groups[0].utmId, "1869507736397281");
  assert.equal(summary.groups[0].orderCount, 1);
});
