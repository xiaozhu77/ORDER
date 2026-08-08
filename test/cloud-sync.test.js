import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAdSummary, sanitizeSummary } from "../src/cloud-sync.js";

test("cloud sync strips order details, landing URLs and raw ad fields", () => {
  const summary = sanitizeSummary({
    generatedAt: "2026-08-05T00:00:00.000Z",
    availableDates: ["2026-08-04"],
    orders: [{ orderNumber: "secret-order", landingUrl: "https://example.com/?ttclid=secret" }],
    groups: [{ utmId: "187", orderCount: 2, totalAmount: 20, latestOrderTime: "2026-08-04 10:00:00" }],
    totals: { orderCount: 2, totalAmount: 20 },
    hourlyBuckets: [{ orderCount: 2, totalAmount: 20 }]
  });
  const ads = sanitizeAdSummary({
    status: "ok",
    rows: [{ campaignId: "187", spend: 4, raw: { cookie: "secret" } }]
  });
  const serialized = JSON.stringify({ summary, ads });

  assert.equal(summary.groups[0].utmId, "187");
  assert.equal(summary.hourlyBuckets[0].hour, 0);
  assert.equal(ads.rows[0].spend, 4);
  assert.doesNotMatch(serialized, /secret-order|ttclid|landingUrl|cookie/);
});
