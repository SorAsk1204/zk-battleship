# DECISIONS.md — 实现决策记录

> 按 Design.md §0.5:不影响核心玩法/安全的歧义,选保守方案记录于此。

## 2026-06-12 规划期裁决(随计划批准生效)

> 来源:`docs/plans/2026-06-12-zk-battleship-m0-m4.md` §0 关键裁决。

| # | 裁决 | 理由/依据 |
|---|---|---|
| D1 | snarkjs 全仓**精确锁 0.7.6**(无 ^) | zkey/verifier 可复现性依赖版本钉死;npm latest 实查 |
| D2 | JS 真理源(boardLogic/encoding/salt/proof 格式化)放 `packages/circuits/lib`,包名 `@zk-battleship/circuits`,双入口:`"."` 浏览器安全(纯逻辑+poseidon-lite)、`"./node"` Node 专用(snarkjs fullProve + artifactPaths) | §9.1 要求三方共用;与电路是孪生语义;不新增包、不偏离 §3 结构。web/e2e/fixture 一律 workspace 引用,**禁止自己拼承诺输入数组** |
| D3 | pi_b limb 交换**不手写**:解析 `groth16.exportSolidityCallData` 输出得 {a,b,c};唯一实现在 circuits `lib/proof.ts`,web/e2e re-export | snarkjs 官方输出不易写反;经典坑,只许一份实现 |
| D4 | forge fixture 方案 = **Node 生成 `ProofFixtures.sol`**(Solidity 源,.gitignore,mtime 缓存跳过重建);不用 vm.parseJson(uint256 超 JSON 安全整数 + key 字母序坑)、不用 FFI(Windows 历史真坑,后续任何"现场生成证明"回退提议都应否决) | 评审裁决方案 C 胜 |
| D5 | `artifacts/`(wasm+zkey+vkey+manifest,估 <25MB)**提交 git**,与 verifier.sol 同 commit 原子更新;`build/`、`ptau/`、`web/public/zk/`、`ProofFixtures.sol`、`deployment.json` 进 .gitignore | verifier 与 zkey 必须配套;clone 即用,免 72MB ptau 下载。zkey 实测 >50MB 则降级为只提交 verifier+manifest 哈希 |
| D6 | setup 用 `zKey.newZKey` 直出 final zkey,**不做 contribute**;其确定性在 M0 用双次 setup 比对 sha256 实证,不成立则切 D5 降级方案 | 开发期安全性损失(delta 已知)按 §5.5 写入 README;评审指出此为承重假设必须实证 |
| D7 | ptau 只用 `https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_{N}.ptau`(旧 hermez S3 已 403 死链,**不写 fallback**);脚本读 r1cs 约束数自动选 power(pot16=72MB 上限 64k 约束,超则 pot17=144MB),流式写盘缓存 | HEAD 实测;board 预估 17–18k 约束,pot16 够 |
| D8 | wagmi 锁 **v2**(^2.19.5)而非 latest v3:mock connector / useSwitchAccount 用法成熟、社区经验全在 v2;React 锁 18.3.1(§2 锁定) | §2 只锁 "viem + wagmi" 未锁大版本,工程保守选择 |
| D9 | 合约新增 `getGame(uint256) returns (Game memory)` 显式 view | **Solidity public mapping 自动 getter 不返回 struct 内数组**(hits/shotMap 拿不到),前端/e2e 都依赖;新增只读函数不违反 §6.3 接口锁定 |
| D10 | `deployment.json` 放 `web/public/`,运行时 fetch(缺失时给"请先跑 pnpm demo"人话错误);schema `{chainId, battleship, boardVerifier, shotVerifier, deployBlock}` | 静态 import 在文件缺失时 vite 直接崩,fetch 可优雅降级 |
| D11 | gameId 从 1 起(games[0].phase==None 表"不存在");shotMap 在 **respond 成功时**置位(phase 机制保证期间不可能再 attack,且让不变量"置位数==ShotResolved 数"字面成立) | 评审通过 |
| D12 | 错误码全集:`BAD_PHASE / SELF_JOIN / NOT_TURN / OOB / REPEAT / NOT_DEFENDER / BAD_RESULT / PROOF_MISMATCH / BAD_PROOF / NOT_TIMEOUT / NOT_CLAIMANT / NOT_CREATOR / JOIN_WINDOW`(§10 锁定的 OOB/REPEAT/SELF_JOIN/PROOF_MISMATCH 不可改) | |
| D13 | Tailwind v4 `@theme` 承载 §7.2 七色 token,且 `--color-*: initial` 清空默认调色板——写 `bg-red-500` 直接编译不出,颜色纪律由工具链强制 | |
| D14 | demo 双账户 = wagmi `mock` connector ×2 + `useSwitchAccount`(Anvil 对内置账户 unlocked 自动签名,前端不持私钥);开关 `VITE_DEMO=1` 由 demo.ts 经 execa env 注入 | 兜底:自定义 ~50 行 localAccountConnector(viem 本地签名),切换成本 <1 天 |

**砍掉的过度设计**(评审裁决,不做):proof-free invariant fuzzing suite(回放式属性检查已满足 §9.2,fuzzing 降为可选 stretch);`forge snapshot --tolerance` 门禁(proof 字节随机、calldata gas 必抖,只记录不做 CI 比对);manifest 漂移自动检测(简化为纪律:换 zkey 必须同 commit 重交 verifier+artifacts);布阵全键盘操作(超出 §7.7 底线,标 stretch);npm-run-all2(不需要)。

## Windows 专项纪律(全仓约定)

1. 仓库路径不得含空格(circom_tester 内部 exec 不加引号);测试启动代码断言 + README 写明
2. spawn 范式:exe(circom/anvil/forge)用 execFile/execa 数组传参;`pnpm` 必须 `{shell:true}` 或 `pnpm.cmd`(Node 20+ EINVAL 限制)
3. 进程树清理一律 **tree-kill**(taskkill /T 语义;execa cleanup 只杀直接子进程,cmd.exe → pnpm → node → vite 多级树会残留占端口)
4. RPC 一律 `127.0.0.1` 不用 `localhost`(Node 17+ 可能解析 ::1,anvil 显式 `--host 127.0.0.1`)
5. 全部脚本 tsx,零 bash;snarkjs 脚本结尾 process.exit / mocha --exit

## 执行期决策

> 格式约定:每条决策一个小节,标题为 `### YYYY-MM-DD Task X.Y — 标题`,正文写清结论与依据,按时间顺序追加。

### 2026-06-12 Task 0.1 — pnpm 11 配置位置

pnpm 11 起 .npmrc 仅承载 auth/registry;node-linker 等全部配置改在 pnpm-workspace.yaml(camelCase)。本仓已迁移并删除 .npmrc。后续 Task 0.2 首次 install 若因 v11 默认 strictDepBuilds 卡原生包构建脚本(circomlibjs→blake-hash、esbuild 等),按提示在 pnpm-workspace.yaml 的 allowBuilds 清单中显式放行并在此追记。

追记(同日):该拦截在本任务即触发——pnpm 11 的 `run` 会先自动校验并安装依赖,根包新增 tsx 后首次 `pnpm run test:all` 即报 `ERR_PNPM_IGNORED_BUILDS: esbuild`。已在 allowBuilds 放行 `esbuild: true`;circomlibjs→blake-hash 等留待 Task 0.2 实际引入时按同法处理。
