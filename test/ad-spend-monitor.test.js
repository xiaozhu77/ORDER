import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAmount,
  normalizeCampaignRow,
  normalizePercent,
  sumSpend
} from "../src/ad-spend-monitor.js";

test("normalizes visible campaign row fields", () => {
  const row = normalizeCampaignRow({
    campaign_id: "1870943504828513",
    campaign_name: "MP test",
    campaign_status: "投放中1",
    stat_cost: "$8.20",
    cpc: "$0.31",
    ctr: "1.25%",
    budget: "$50.00",
    time_attr_add_billing_count: "4",
    time_attr_convert_cnt: "2",
    time_attr_shopping_roas: "2.4",
    time_attr_conversion_cost: "$4.10"
  });

  assert.equal(row.campaignId, "1870943504828513");
  assert.equal(row.campaignName, "MP test");
  assert.equal(row.status, "投放中");
  assert.equal(row.spend, 8.2);
  assert.equal(row.cpc, 0.31);
  assert.equal(row.ctr, 1.25);
  assert.equal(row.budget, 50);
  assert.equal(row.addBilling, 4);
  assert.equal(row.conversions, 2);
  assert.equal(row.roas, 2.4);
  assert.equal(row.conversionCost, 4.1);
  assert.equal(row.raw.stat_cost, "$8.20");
});

test("sums campaign spend", () => {
  const total = sumSpend([
    { spend: 8.2 },
    { spend: "$9.10" },
    { spend: "" }
  ]);

  assert.equal(total, 17.3);
});

test("normalizes money and percent text", () => {
  assert.equal(normalizeAmount("$1,234.56"), 1234.56);
  assert.equal(normalizeAmount("-"), 0);
  assert.equal(normalizePercent("3.45%"), 3.45);
  assert.equal(normalizePercent(""), 0);
});
