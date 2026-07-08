import assert from "node:assert/strict";
import test from "node:test";
import { buildStoreDashboardSummary, buildSummary } from "../src/aggregate.js";
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
      amount: "£100.50",
      status: "已付款",
      landingUrl: "https://shop.example/landing?utm_id=1869507736397281"
    },
    {
      orderNumber: "A001",
      createdAt: "2026-07-02 10:00:00",
      amount: "£100.50",
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

test("builds store-time last 60 minute window and full-day hourly buckets", () => {
  const summary = buildStoreDashboardSummary([
    {
      orderNumber: "A001",
      createdAt: "2026-07-05 09:05:00",
      amount: "10",
      status: "已付款",
      landingUrl: "https://shop.example/landing?utm_id=one"
    },
    {
      orderNumber: "A002",
      createdAt: "2026-07-05 09:55:00",
      amount: "20",
      status: "已付款",
      landingUrl: "https://shop.example/landing?utm_id=one"
    },
    {
      orderNumber: "A003",
      createdAt: "2026-07-05 10:05:00",
      amount: "30",
      status: "已付款",
      landingUrl: "https://shop.example/landing?utm_id=two"
    },
    {
      orderNumber: "A004",
      createdAt: "2026-07-04 23:50:00",
      amount: "40",
      status: "已付款",
      landingUrl: "https://shop.example/landing?utm_id=one"
    }
  ], {
    storeDate: "2026-07-05",
    yesterdayDate: "2026-07-04",
    timeZone: "Asia/Shanghai",
    now: new Date("2026-07-05T10:05:00+08:00")
  });

  assert.equal(summary.last60Minutes.label, "店铺时间");
  assert.equal(summary.last60Minutes.orderCount, 3);
  assert.equal(summary.last60Minutes.startAt, "2026-07-05 09:05:00");
  assert.equal(summary.last60Minutes.endAt, "2026-07-05 10:05:00");
  assert.equal(summary.last60Minutes.byUtmId.one.orderCount, 2);
  assert.deepEqual(summary.hourlyBuckets.filter((bucket) => bucket.orderCount > 0).map((bucket) => [bucket.label, bucket.orderCount]), [
    ["09:00-09:59", 2],
    ["10:00-10:59", 1]
  ]);
  assert.equal(summary.hourlyBuckets.length, 24);
  assert.equal(summary.continuingGroups[0].utmId, "one");
  assert.equal(summary.continuingGroups[0].todayOrderCount, 2);
  assert.equal(summary.continuingGroups[0].yesterdayOrderCount, 1);
});

test("uses store createdAt for realtime store-time last 60 minutes", () => {
  const summary = buildStoreDashboardSummary([
    {
      orderNumber: "KENCHELS260706055002910",
      createdAt: "2026-07-05 13:53:19",
      amount: "30",
      status: "已付款",
      landingUrl: "https://shop.example/landing?utm_id=recent"
    },
    {
      orderNumber: "KENCHELS260706040002910",
      createdAt: "2026-07-05 12:00:00",
      amount: "20",
      status: "已付款",
      landingUrl: "https://shop.example/landing?utm_id=old"
    }
  ], {
    storeDate: "2026-07-05",
    yesterdayDate: "2026-07-04",
    timeZone: "Asia/Shanghai",
    now: new Date("2026-07-05T13:55:00+08:00")
  });

  assert.equal(summary.last60Minutes.orderCount, 1);
  assert.equal(summary.last60Minutes.byUtmId.recent.orderCount, 1);
  assert.equal(summary.last60Minutes.byUtmId.old, undefined);
});

test("builds seven store-date summaries and keeps historical realtime empty", () => {
  const summary = buildStoreDashboardSummary([
    {
      orderNumber: "T1",
      createdAt: "2026-07-06 00:10:00",
      amount: "10",
      status: "已付款",
      landingUrl: "https://shop.example/landing?utm_id=today"
    },
    {
      orderNumber: "Y1",
      createdAt: "2026-07-05 23:50:00",
      amount: "20",
      status: "已付款",
      landingUrl: "https://shop.example/landing?utm_id=yesterday"
    },
    {
      orderNumber: "O1",
      createdAt: "2026-06-29 12:00:00",
      amount: "999",
      status: "已付款",
      landingUrl: "https://shop.example/landing?utm_id=outside"
    }
  ], {
    storeDate: "2026-07-06",
    yesterdayDate: "2026-07-05",
    timeZone: "Asia/Shanghai",
    now: new Date("2026-07-06T00:20:00+08:00"),
    days: 7
  });

  assert.deepEqual(summary.availableDates, [
    "2026-07-06",
    "2026-07-05",
    "2026-07-04",
    "2026-07-03",
    "2026-07-02",
    "2026-07-01",
    "2026-06-30"
  ]);
  assert.equal(summary.dailySummaries["2026-07-06"].totals.orderCount, 1);
  assert.equal(summary.dailySummaries["2026-07-05"].totals.orderCount, 1);
  assert.equal(summary.dailySummaries["2026-06-30"].totals.orderCount, 0);
  assert.equal(summary.dailySummaries["2026-07-05"].last60Minutes.orderCount, 0);
  assert.equal(summary.dailySummaries["2026-07-06"].last60Minutes.orderCount, 1);
});
