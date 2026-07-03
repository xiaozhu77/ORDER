# 本地订单 UTM ID 统计看板

这个项目会在本地 Windows 电脑上自动打开店铺后台，登录后进入订单列表页，定时抓取当天订单，并按落地页 URL 中的 `utm_id` 汇总订单数据。

## 快速启动

在项目目录运行：

```powershell
npm.cmd install
npx.cmd playwright install chromium
npm.cmd start
```

看板地址：

```text
http://127.0.0.1:8787
```

注意：Windows PowerShell 里直接运行 `npm install` 或 `npx playwright ...` 可能会被执行策略拦截。请使用 `npm.cmd` 和 `npx.cmd`。

## 配置文件

真实配置在 `config.json`。这个文件包含后台账号密码，已被 `.gitignore` 忽略，不建议提交。

核心配置：

```json
{
  "scraper": {
    "enabled": true,
    "headless": false,
    "intervalSeconds": 20,
    "backend": {
      "loginUrl": "后台登录地址",
      "ordersUrl": "订单列表地址",
      "username": "后台账号",
      "password": "后台密码"
    }
  }
}
```

`headless: false` 表示运行时会打开一个浏览器窗口，方便观察登录和抓取过程。

## 当前后台选择器

当前已按你的店铺后台配置：

- 登录页账号输入框：`input[type="email"]`
- 登录页密码输入框：`input[type="password"]`
- 登录按钮：`button:has-text("登录")`
- 订单行：`.el-table__body-wrapper tbody tr`
- 订单号：第 2 列
- 下单时间：第 3 列
- 付款状态：第 4 列
- 总金额：第 6 列
- 落地页 URL：第 7 列弹层里的完整 URL

如果后台表格改版，只需要调整 `config.json` 里的 `selectors`。

## 统计规则

程序会从落地页 URL 中提取 query 参数 `utm_id`。

例如：

```text
https://kenchels.com/products?utm_id=1869507736397281
```

提取结果：

```text
1869507736397281
```

规则：

- 只统计当天订单。
- 以订单号去重，避免重复刷新造成重复累计。
- 按 `utm_id` 汇总订单数、金额合计、最新订单时间、状态分布。
- 没有落地页 URL 或没有 `utm_id` 的订单仍计入总订单。

未识别订单会进入：

- `未识别-无落地页URL`
- `未识别-无utm_id`
- `未识别-URL解析失败`

## 数据文件

运行后会生成：

```text
data/orders.json
public/data/summary.json
data/auth-state.json
```

说明：

- `data/orders.json`：抓到的订单原始数据。
- `public/data/summary.json`：看板使用的汇总数据。
- `data/auth-state.json`：浏览器登录态。

## 常用命令

运行测试：

```powershell
npm.cmd test
```

启动程序：

```powershell
npm.cmd start
```

只启动看板，不启动抓取器：

```powershell
npm.cmd run dashboard
```

## 已验证

已用当前后台验证：

- 登录页能自动填写账号密码并登录。
- 订单页能读取订单列表。
- 当前页面可抓取 50 行订单。
- 当天汇总识别到 24 单，总金额 610.68。
- 能按 `utm_id` 分组，并统计未识别订单。
