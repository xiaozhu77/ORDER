import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  captureAdsPowerAdData,
  extractAdAccountId,
  isTargetCampaignPage,
  isTikTokAdAccountPage,
  normalizeAmount,
  normalizeCampaignRow,
  normalizePercent,
  sumSpend,
  updateCampaignPageDateUrl
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

test("uses table slot row id when campaign_id column is absent", () => {
  const row = normalizeCampaignRow({
    __rowId: "1871602568741314",
    campaign_name: "女8-I-7.24",
    campaign_status: "投放中",
    stat_cost: "0.00 USD"
  });

  assert.equal(row.campaignId, "1871602568741314");
  assert.equal(row.campaignName, "女8-I-7.24");
});

test("matches the configured TikTok ad account page", () => {
  const resepedUrl = "https://ads.tiktok.com/i18n/manage/campaign?aadvid=7618477796998119432&navigate_from=creation";
  const otherUrl = "https://ads.tiktok.com/i18n/manage/campaign?aadvid=7646310799505506311&navigate_from=creation";

  assert.equal(extractAdAccountId(resepedUrl), "7618477796998119432");
  assert.equal(isTargetCampaignPage(resepedUrl, "7618477796998119432"), true);
  assert.equal(isTargetCampaignPage(otherUrl, "7618477796998119432"), false);
});

test("matches non-campaign TikTok Ads pages for the configured account", () => {
  const creativeUrl = "https://ads.tiktok.com/i18n/manage/creative?aadvid=7618477796998119432&st=2026-07-27&et=2026-07-27";

  assert.equal(isTargetCampaignPage(creativeUrl, "7618477796998119432"), false);
  assert.equal(isTikTokAdAccountPage(creativeUrl, "7618477796998119432"), true);
});

test("updates TikTok campaign page date parameters", () => {
  const original = "https://ads.tiktok.com/i18n/manage/campaign?aadvid=7618477796998119432&relative_time=today&st=2026-07-24&et=2026-07-24";
  const updated = new URL(updateCampaignPageDateUrl(original, "2026-07-25"));

  assert.equal(updated.searchParams.get("aadvid"), "7618477796998119432");
  assert.equal(updated.searchParams.get("relative_time"), "custom");
  assert.equal(updated.searchParams.get("st"), "2026-07-25");
  assert.equal(updated.searchParams.get("et"), "2026-07-25");
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

test("keeps previous successful output when ad capture is unavailable", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ad-monitor-"));
  const outputPath = path.join(tempDir, "ad-summary.json");
  const previous = {
    status: "ok",
    storeDate: "2026-07-23",
    totalSpend: 12.34,
    rows: [{ campaignId: "1870943504828513", spend: 12.34 }]
  };

  await fs.writeFile(outputPath, JSON.stringify(previous, null, 2), "utf8");
  const result = await captureAdsPowerAdData({
    logDirPath: path.join(tempDir, "missing-log-dir"),
    outputPath,
    storeDate: "2026-07-23"
  });
  const persisted = JSON.parse(await fs.readFile(outputPath, "utf8"));

  assert.equal(result.status, "skip");
  assert.deepEqual(persisted, previous);
});
