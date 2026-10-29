# dsh-magpie-channels

在 DeepSeek Harness 左侧栏加一个「Magpie 渠道」入口，一屏看清本机 Magpie 网关**每个渠道**（zcode、workbuddy、deepseek、qoder-cn、qwenwork、trae-cn、codearts、minimax-code）当前**能用的 LLM 模型**和**还剩多少额度**，用来决定这一轮该走哪个渠道的模型。

只读：不写 Magpie 的任何文件，不调用任何厂商额度接口，不持有凭据，不启动子进程。

## 它从哪里取数

| 数据 | 来源 |
| --- | --- |
| 渠道 → 模型清单 | Magpie 网关 `GET {gatewayUrl}/v1/models`，按返回行的 `owned_by` 归到渠道 |
| 余额 / 额度窗口 / 重置时间 | Magpie 本地账本 `<ledgerDir>/quotas.json`（每次请求后由 Magpie 回写） |
| 每日消耗 | `<ledgerDir>/credits-daily.json` |
| 渠道显示名 | `<ledgerDir>/providers.json`（缺省用内置名） |

两条来源互相独立，缺一条也能显示：网关连不上时仍然列出账本里的渠道与额度并给出告警条；账本里没有该渠道时仍然列出它在网关上的模型，并标注「无账本」。

## 表面

- **左侧栏图标**：`sidebar.panellist` 里 id 为 `magpie-channels` 的入口，点击后切到同名的 `main` 面板。
- **面板**：卡片式列出每个渠道——模型数、是否已登录、余额、每个额度窗口的「剩余 / 总额 + 用量条 + 重置时间 + 即将过期」、每日消耗；右上角「刷新」强制重取网关目录。
- **模型工具 `magpie_channels`**：同一份数据在对话里可用，参数 `channel?`（只看某个渠道）、`modelsOnly?`（只要模型清单）。

## 配置

`cordis.patch.yml` 里的行配置：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `gatewayUrl` | `http://127.0.0.1:3425` | Magpie 网关地址 |
| `ledgerDir` | `$MAGPIE_HOME` 或 `~/.config/magpie` | 账本目录 |

## 安装 / 卸载

```text
plugin_manager action=install_bundle target=<this directory>
plugin_manager action=remove_bundle target=dsh-magpie-channels
```

安装后会写进 profile 的 `package.json`（`link:` 依赖）与 `cordis.patch.yml`。没有 HMR 的 profile 需要重启 Harness 才会挂上浏览器半边。

## 测试

```powershell
node --experimental-test-isolation=none --test test/ledger.test.js test/catalog.test.js test/tool.test.js test/host.test.js test/client.test.js
```

（`node --test` 默认每个文件起子进程，在受限沙箱里会 `spawn EPERM`，所以用 `--experimental-test-isolation=none` 在本进程内跑。）

## 额度字段怎么读

以下语义**以 Magpie 自己的源码为准**，来源：
`~/.config/magpie/plugins/node_modules/@magpie-community/opencode-codearts-auth/index.mjs`

```js
2188: const used = Math.max(0, limit - remain)
2191:   used: clamp(limit > 0 ? (used / limit) * 100 : 0),
2192:   display: `${formatCredit(used)} / ${formatCredit(limit)}${expiring > 0 ? ` · ${formatCredit(expiring)} 即将过期` : ""}`,
2193:   amount: used,
2194:   limit,
```

由此得出三条，**改代码前先看**：

- **`amount` 是「已用量」**（源码第 2188/2193 行的 `amount: used`，`used = limit - remain`）。
  所以**剩余 = `limit - amount`**，不是 `amount`。把 `amount` 当成剩余会把每个窗口都读反：
  minimax 的 `amount: 3423.05, limit: 5024` 是「已用 3423.05、剩 1600.95（68.1%）」，不是「剩 3423.05」。
  **`used` 就是 `amount / limit * 100`**，两者同源；`amount` 缺失时才用 `used` 兜底。
- **`display` 是 `已用 / 总量 · N 即将过期`**，三段单位不同：前两段是积分，第三段是**百分比**。
  所以不能用一条 `(\d+)/(\d+)` 正则把整串当积分解析；`· N 即将过期` 要单独取（`parseExpiringPercent`）。
- **`N 即将过期` 是「剩余额度的 N% 将在 `runsOutAt` 前过期」**，取整后显示。
  证据：codearts 总积分 `(6600-190.75)/6600 = 97.11%` 与赠送积分包 `(6100-190.75)/6100 = 96.87%`
  两个不同总额的池子**都印 97**——只有「剩余比例四舍五入」能同时解释两条；若当作「97 个积分」则是无法解释的巧合。

没有 `amount` 的窗口（qoder 的 `"300 / 300 credits"`）用 `display` 的前一半作为**已用量**。
`expiringPercent` 在账本没印 `· N 即将过期` 时保持 `undefined`（未知），**不要写成 0 或 false**。

## 已知限制

- 额度数字只和 Magpie 最近一次回写一样新；面板上的「读取于」就是账本的 `readAt`。
- 渠道 id 以网关的 `owned_by` 与账本 `quotas.json` 的键为准，两边对不上时会出现「有模型无账本」或「有账本无模型」，面板会分别标注。
- `balance` 是厂商原样字符串（`"¥891.45"`、`"1600.95 credits"`、`"2100 credits (daily 100 · long-term 2000)"`），多段余额会压成主余额并保留长周期那一项。

## 改完代码怎么生效

Harness 不会因为文件改动重新读模块（`dsh-app-boot` 明确「publication does not unload modules or clear Node caches」）。HMR 已启用时，把入口关一次再开一次即可重新加载，不用重启应用：

```text
plugin_manager action=set_plugin target=include:magpie-channels enabled=false
plugin_manager action=set_plugin target=include:magpie-channels enabled=true
```

工具返回的值必须先过 `@deepseek-ai/dsh-util-values` 的快照检查：**任何键的值为 `undefined` 都会让整个输出报 `value is not lossless JSON`**（`-0`、非有限数、稀疏数组同理）。所以 `host/tool-value.js` 只挑选字段、把缺省字段直接省掉。要拿真实校验器验，用 Electron 当 node 跑：

```powershell
$env:ELECTRON_RUN_AS_NODE="1"; & "E:\DeepSeek Harness\DeepSeek Harness.exe" -e "<script>"
```

否则 `@deepseek-ai/dsh-*` 在普通 node 里解析不到（它们在 app.asar 内）。

## 许可

MIT。
