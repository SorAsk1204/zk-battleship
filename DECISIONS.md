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

### 2026-06-12 Task 0.2 — blake-hash 拒绝构建而非放行;circomlibjs 互证保留

引入 circomlibjs(devDep,仅作 Poseidon 三方互证)后 `pnpm install` 如预期报 `ERR_PNPM_IGNORED_BUILDS: blake-hash@2.0.0`(node-gyp 原生包)。**未放行,而是在 allowBuilds 显式置 `blake-hash: false`(拒绝构建)**:circomlibjs 的 Poseidon 走 wasm 实现,实测不依赖 blake-hash 原生绑定(`buildPoseidon()` 加载与计算均正常,互证测试绿);拒绝构建可免去对本机 MSVC 工具链的依赖,可复现性更好。与 Task 0.1 预判的"按同法放行"不同,特此记录。若后续(M1 电路测试)有代码路径真正触达 blake-hash,再改 `true` 并验证本机能编译。

### 2026-06-12 Task 0.2 — D2 的"双入口"实际落地为三入口(新增 `./proof`)

D2 裁决写的是双入口(`"."` 浏览器安全 + `"./node"` Node 专用),实际落地为**三入口**,新增 `./proof` 承载 `formatProofCalldata`。理由:该函数依赖 snarkjs(`groth16.exportSolidityCallData`),而 snarkjs 不能进 `.`(会被拖进浏览器主线程 bundle,违反 D2 的浏览器安全纪律);同时 D3 要求 formatProofCalldata 全仓唯一实现且被 web/e2e re-export——web 端必须能引到它,故不能塞进 `./node`(那会连带 fullProve/artifactPaths 的 Node 依赖),只能独立成 `./proof` 入口。

### 2026-06-12 Task 0.3 — D6 确定性已实证(smoke,snarkjs 0.7.6)

对 smoke 电路(240 约束,pot12)同一 r1cs + 同一 ptau 连续两次 `zKey.newZKey`(无 contribute),两份 zkey 的 sha256 完全一致(`2d5501fe02637669db492032b31366b9250466ba0e194b68d9af9bda79bf3e9d`)。D6 的确定性假设成立,D5「artifacts/ 提交 git」策略维持。实证入口固化为 `scripts/setup.ts <name> --verify-determinism`,M1 真电路(board/shot)setup 时应重跑复核。顺带实测:circom 2.1.9 重编译同一源文件产出的 r1cs 也逐字节一致(setup 的 r1cs-hash 幂等跳过被触发)。

### 2026-06-12 Task 0.3 — ptau power 选择公式按 snarkjs 真实要求修正

计划写的公式 `power = max(12, ceil(log2(nConstraints)))` 在 nConstraints 恰为 2 的幂等边界会少选 1:snarkjs 0.7.6 `zkey_new.js` 的硬性要求是 `cirPower = floor(log2(nConstraints + nPubInputs + nOutputs)) + 1` 且 ptau power ≥ cirPower(否则报 "circuit too big")。`scripts/ptau.ts` 实际取 `max(12, cirPower)`,该值恒 ≥ 计划公式,语义不变只堵边界。另设 pot20 下载上限保险(board 止损线 50k 约束按理 pot16/17 封顶)。

### 2026-06-12 Task 0.5 — radius token 收紧至 §7.2,rounded-full 例外

仿 D13 思路把 §7.2「radius ≤4px」交给工具链强制:`@theme` 内 `--radius-*: initial` 清空 Tailwind v4 默认 radius 刻度,只保留 `--radius-xs: 2px`、`--radius-sm: 4px`,`rounded-md/lg/xl/…` 直接编译不出(已实验验证:临时写 `rounded-lg` 后 build,产物 CSS 中无该规则;`rounded-sm` 正常生成,验完已移除临时代码)。例外:`rounded-full` 是静态 utility(9999px),不走 `--radius-*` token,工具链杀不掉——裁决为保留,仅限圆点/状态标记类用途;M4 审计的 grep 清单需为 `rounded-full` 单独立一条规则(按用途人工审,不能指望编译期拦截)。

### 2026-06-12 Task 0.5 — §7.3 miss「白色涟漪」与七色纪律冲突,映射为 --foam

§7.3 写 miss 反馈为「白色涟漪」,但白色不在 §7.2 七色调色板内——D13 清空默认色板后 `text-white`/`bg-white` 本就编译不出,两条规格字面冲突。裁决:M3 落地该效果时,「白色」一律映射为 `--foam`(#C8D8DC,语义即浪沫/前景,视觉上足够"白");**不得通过往色板加白色来"修复"此冲突**,七色纪律优先于 §7.3 的字面描述。

### 2026-06-12 Task 0.4 — foundry 在本 monorepo 的两个坑

(a) `forge update` 在本仓库布局(monorepo 子目录 packages/contracts)+ Windows 下报 os error 267(目录名无效),不可用。升级 forge-std 的正确路径:直接进 submodule checkout 目标 tag + 手改 foundry.lock(name/rev)+ 在父仓提交 gitlink。
(b) foundry.lock 的键已规范化为正斜杠 `"lib/forge-std"`(forge 1.7.1 Windows 实测 `lib\\forge-std` 与 `lib/forge-std` 都接受,正斜杠跨平台安全)。

### 2026-06-12 Task 0.6 — Windows 子进程 spawn 纪律细化

execa 9 + Node ≥22 在 Windows 上不能裸 spawn `.cmd` shim:`execa('tsx', ...)` 这类调用会直接 EINVAL(Node 对 CVE-2024-27980 的防护,无 shell 时禁止 spawn .bat/.cmd)。M2 场景子进程应改用 `execaNode(script, {nodeOptions: ['--import', 'tsx']})` 或 `process.execPath` 显式起 Node 进程;anvil.exe/forge.exe 等真 exe 不受影响,仍按原范式 execa 数组传参。本条是「Windows 专项纪律」第 2 条(spawn 范式)在 e2e 场景脚本上的落地细则。

### 2026-06-12 Task 1.5 — 真电路 setup 产物落库,体积实测,D5 维持不降级

board(15334 约束)自动选型 pot14(18.1MB 下载,blake2b-512 与钉死哈希一致);shot(888 约束)用缓存 pot12。产物实测体积:board.zkey **8.35MB**(8,753,244 B)、board.wasm 3.94MB(4,130,802 B)、shot.zkey **1.06MB**(1,108,964 B)、shot.wasm 3.71MB(3,890,328 B)、vkey 各 ~3KB,artifacts/ 合计 ≈17.1MB——远低于 D5 的 50MB 降级线,**「artifacts/ 提交 git」维持**,且低于 D5 当初 <25MB 的估算。M3 预加载策略输入:web 端需拉取 board(wasm+zkey ≈12.3MB)与 shot(≈4.8MB),合计 ≈17.1MB 静态资源。

D6 确定性按 Task 0.3 约定对真电路重跑复核:board 与 shot 各双跑 `newZKey` sha256 逐字节一致(board `e186a256…`,shot `ecae4f37…`;shot 早前 Task 1.4 期间生成的 zkey 与本次双跑哈希也一致,三跑互证)。manifest.json 记录全部 6 文件 sha256 + 约束数 + ptau power;`build` 二跑幂等已验证(setup skipped,9 个产物哈希逐字节不变)。

同任务落地的上任务评审遗留:artifacts 路径单一真理源收口(export.ts 直接 import lib/node.ts 的 artifactPaths 作拷贝目标,artifactPaths 新增 vkey 字段,shot.test.ts 的 VKEY 重推导改用之);shot.circom 注释编号与 Design §5.3 对齐(Num2Bits/ValidShip 改标「防御性检查 A/B(Design 未编号)」);S5–S7 新增陈旧性断言(setup-meta.json 的 r1csSha256 vs 当前 build/shot/shot.r1cs,不一致即 fail 提示重跑 setup,防在陈旧 zkey 上跑出误导结论)。

新增 `.gitattributes`:`packages/circuits/artifacts/** -text`。本机 autocrlf=true,不钉死的话 verification_key.json/manifest.json 在 checkout 时会被转 CRLF,manifest 记录的 sha256 在新 clone 上对不上号——artifacts 必须字节级还原,manifest 哈希才有意义(已验证 index blob sha == 磁盘 sha == manifest 条目)。
