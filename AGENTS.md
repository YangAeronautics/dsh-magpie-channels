# AGENTS.md — dsh-magpie-channels

本文件是这个插件仓库的工作规则。改代码之前先读，尤其是「四条不变量」。

## 1. 这个插件是什么

一个 **DSH（DeepSeek Harness）外部插件**，两个半边：

- **Host 半边**（`index.js` + `host/`）：在 Node 侧读本机 Magpie 网关的模型目录、读 Magpie 本地账本，
  暴露 `GET /api/magpie-channels/report` 与模型可见工具 `magpie_channels`。
- **Client 半边**（`client/`）：注入 `sidebar.panellist` 一个入口，并在 `main` 槽注册同名面板。

只读。不写 Magpie 的文件、不调用厂商额度接口、不持有凭据、不启动子进程。任何 PR 都不能改变这条。

## 2. 四条不变量（改坏了会静默出错）

### 2.1 `amount` 是「已用」，`remaining = limit - amount`

来源：`@magpie-community/opencode-codearts-auth/index.mjs`

```js
2188: const used = Math.max(0, limit - remain)
2191:   used: clamp(limit > 0 ? (used / limit) * 100 : 0),
2192:   display: `${formatCredit(used)} / ${formatCredit(limit)}${expiring > 0 ? ` · ${formatCredit(expiring)} 即将过期` : ""}`,
2193:   amount: used,
2194:   limit,
```

把 `amount` 当剩余读，每个窗口的数都会反过来。`display` 的前两段是积分、第三段是**百分比**，
`N 即将过期` 表示「剩余额度的 N% 将在 `runsOutAt` 前作废」，不是 N 个积分。

### 2.2 工具返回值必须能过 lossless-JSON 快照

`@deepseek-ai/dsh-tools` 在 schema 校验**之前**先跑 `snapshotJsonValue`。任何键的值是 `undefined`、
`-0`、非有限数，或有稀疏数组，整个输出就报 `value is not lossless JSON`——**而且不告诉你是哪个键**。

所以 `host/tool-value.js` 用 `put(obj, key, value)` 逐字段挑选，缺的就不要写这个键。
新增字段一律走 `put`，不要直接赋值。回归测试见 `test/tool.test.js` 里的 `isLosslessJson`。

### 2.3 `client/bundle.js` 是生成物

`client/index.js` 是给人读的 ESM（测试直接 import 它）；`client/bundle.js` 由 `client/build.js`
把 ESM 折成 IIFE 塞进 `client/bundle.template.js`。改动 `client/index.js` 之后必须跑 `npm run build`，
否则浏览器加载的还是旧包。

包内 `require('react')` 只在 factory 闭包里存在，所以源码里要用裸名 `jsx`、`useState`、`useCallback`、`useEffect`；
改成别名（如 `reactCreateElement`）会在浏览器里 `ReferenceError`。

### 2.4 两条数据源互相独立

网络目录与本地账本任缺一条都要能显示：网关连不上时仍列出账本里的渠道并告警；账本没有该渠道时仍列出
网关上的模型并标「无账本」。不要把两者写成「必须先有 A 才能有 B」。

## 3. 测试

```powershell
npm test
```

`node --test` 默认每个文件起子进程，在受限沙箱里会 `spawn EPERM`；脚本固定用
`--experimental-test-isolation=none` 在本进程内跑。改动行为时同一个提交里带上测试：

- 纯函数（`host/ledger.js`、`host/tool-value.js`）测输入→输出的字面量；
- 工具层测 `tool.run()` 的返回值形状与 `lossless` 判定；
- client 测 `client/bundle.js` **真的能加载**：`test/client.test.js` 装一个假的 `__ModuleLoader__`，
  import 生成后的 bundle，用它 `load()` 得到的 factory 构造模块，再断言注册参数与渲染结果。
  （测 `client/index.js` 而不测 bundle，会漏掉生成器改坏的情况。）

预期值必须来自独立事实（字面量、手算样例），不许用与实现相同的算法重算。

## 4. 改完怎么在真机上生效

Harness 不会因为文件改动重新读模块。HMR 已启用时把入口关一次再开一次：

```text
plugin_manager action=set_plugin target=include:magpie-channels enabled=false
plugin_manager action=set_plugin target=include:magpie-channels enabled=true
```

没有 HMR 的 profile 需要重启应用（浏览器半边只在启动时挂载）。

想用**真实的** harness 校验器验工具输出，得用 Electron 当 node 跑，因为 `@deepseek-ai/dsh-*`
只存在于 `app.asar` 内：

```powershell
$env:ELECTRON_RUN_AS_NODE="1"; & "C:\path\to\DeepSeek Harness.exe" -e "<script>"
```

## 5. 提 PR 的约定

- 一个 PR 一个主题；提交用 Conventional Commits（`feat(scope): …`），正文写「为什么 + 怎么验的」。
- 涉及额度语义、工具 schema、交付物的改动，PR 里必须贴测试输出。
- 不要把本机账本（`quotas.json` 等）、账号标识、网关真实地址写进仓库；测试 fixture 用 `user-000000000` 这类占位名。
