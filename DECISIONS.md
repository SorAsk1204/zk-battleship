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

### 2026-06-13 Task 1.7 补记 — fixture 可复现性边界与 snarkjs devDep

补记 Task 1.7 落地时的两条执行期决策(此前只写在 generate.ts 注释里,未入本档):

(a) **可复现性边界**:fixture 用固定棋盘 A/B/C + 固定 salt ⇒ commitment 与全部 pubSignals 跨次生成**恒定**,测试可当常量断言;但 Groth16 证明点 a/b/c 含 prover 随机数 r/s,**每次生成都不同**(恒为同一组公开输入的有效证明)。可复现的是"证明陈述的命题",不是证明字节——这正是 gas snapshot 无容差门禁的根因(见 Task 1.11)。固定 salt 仅限测试 fixture,生产严禁(§5.1:承诺隐藏性完全依赖 salt 熵,可预测则 17 格布阵可被字典攻击还原)。

(b) **snarkjs 进 contracts devDependencies(精确锁 0.7.6)**:D1 全仓钉版纪律在本包的落点;用途仅 generate.ts 的 groth16.verify 生成期抽查(防"格式化层正确但证明本身坏"的盲区),证明生成本身走 `@zk-battleship/circuits/node` 真理源,不在本包重复实现。

### 2026-06-13 Task 1.11 — gas snapshot 范围限定

`.gas-snapshot` 只含 GasTest 六关键操作(createGame / joinGame / attack / respondMiss / respondHit / respondFinal17thHit),snapshot script 锁 `forge snapshot --match-contract GasTest`;每个测试体只含被计量的那一笔调用,前置编排全部在 setUp,数字即单笔操作 gas。范围外排除两类污染源:

- StateMachine 两个篡改用例与 BindingAttacks 用例 5 的 **~1.02B gas 是 bn254 预编译失败语义**(篡改点不在曲线上 ⇒ 配对预编译按 EIP-196/197 吞掉全部转发 gas),非 bug 非死循环,但作为"操作成本"毫无意义;
- Invariants / 全局回放类测试 8–9M gas 是 33 次真证明验证的**累计值**,不代表任何单笔操作。

无容差门禁维持规划期裁决:proof 字节含 prover 随机数(见 Task 1.7 补记),fixture 重新生成后 calldata 非零字节数变化,gas 天然抖动,只记录、靠人审 diff。配套裁决:foundry.toml `optimizer = false` 维持,.gas-snapshot 基于无优化器字节码落库;后续若开优化器属六数字全量重置,须同 commit 重交 .gas-snapshot。

### 2026-06-13 Task 2.5 — D10 schema 追加 rpcUrl 字段

`web/public/deployment.json` 实际 schema = D10 五字段 + `rpcUrl`(`http://127.0.0.1:8545`,demo.ts 写入)。M3 注意:(a) `deployBlock` 是 Number;(b) `rpcUrl` 是 HTTP,wagmi 的 ws transport 须自行推导 `ws://127.0.0.1:8545`(anvil 同端口双协议),Task 3.3 落地时裁决 rpcUrl 是权威还是仅供参考并在此追记;(c) `VITE_DEMO === '1'`(字符串)仅在 pnpm demo 启动的 dev server 中存在,直接 `pnpm -F web dev` 与生产构建均为 undefined → injected connector 路径(D14)。

### 2026-06-13 Task 3.1 — 坐标→标签映射(保守方案,§10 未覆盖)

Design §7.3 唯一具体示例是 "D-7",§10 裁决清单未覆盖坐标→标签映射,按 §0.5 选保守方案记此:
**x → 列字母 A–J(x=0→A, x=3→D),y → 行号 1–10(y=0→1, y=6→7),分隔符 `-`**,故 (3,6)→"D-7"
(D 是第 4 列、7 是第 7 行,与 §7.3 示例自洽)。实现于 `packages/web/src/lib/format.ts`(`formatCoord`/`parseCoord`,双向 + 全 100 格 round-trip 测试)。
**纯人眼显示决定,无协议影响**:协议内坐标始终是 0–9 整数对 (x,y),链上 bit = y*10+x,均不经过本映射。

### 2026-06-13 Task 3.1 — viem 提前进 web 依赖(让 errors.ts 一步到位)

viem 是 Task 3.3(wagmi 接线)的必装项,本任务提前装(`viem ^2.21`,实装 2.52.2,与 D8 锁定的 wagmi v2 同 viem 大版本相容)。
理由:`errors.ts` 的 `mapContractError` 需要 viem 的 `BaseError.walk` / `ContractFunctionRevertedError` 才能从错误层级抠 revert reason;
提前装可让 errors.ts 一次写全(纯字符串 `mapErrorReason` + viem 对象 `mapContractError` 双路径),不留半成品。
**关键事实**:合约用 `require(cond, "CODE")` 即 Solidity `Error(string)`,ABI 里**没有自定义 error 条目**(Battleship.json `errors:[]`),
故 reason 是普通短码字符串,从 `ContractFunctionRevertedError.reason` 取,不走 ABI error 解码。
已验证 viem 链路浏览器安全(probe bundle 扫描:0 snarkjs / 0 node:)。

### 2026-06-13 Task 3.2 — Worker 证明管线落地(最高风险项,Plan A 成功)

**结论:Plan A(Vite module worker)真浏览器验收一次通过,不需 Plan B。** 计划事前两大风险全部证伪:

(1) **不需 COOP/COEP / SharedArrayBuffer**(事前最大未知)。读 ffjavascript@0.2.63 `build/browser.esm.js` 源码 + 验生产 bundle 双证:子 worker 经 `workerSource = "data:application/javascript;base64," + threadSource` 起的**经典 data-URL worker**(线程体仅 WebAssembly + TypedArray,无 import/importScripts/require),`new WebAssembly.Memory({initial,maximum})` **非 shared**。生产 worker chunk grep:`SharedArrayBuffer`=0、`shared:true`=0、`data:application/javascript`=1。浏览器控制台全程 **0 error**(仅 2 条 React-Router v7 future-flag warning,与本任务无关)。

(2) **Vite 把 snarkjs 解析到浏览器构建,无需 alias**。snarkjs@0.7.6 与 ffjavascript 均有 `"browser"` 导出条件(各自 `build/browser.esm.js`),Vite 客户端构建默认走该条件。snarkjs 浏览器构建实测:0 个 `process.X` 运行期引用(181 处 `process` 全在注释/局部函数名)、0 `node:` import、0 `require`、0 `Buffer`。**vite.config 仅加 `worker: { format: 'es' }` 一行**(Plan A 必需:worker 内 `import snarkjs` 要 ES 格式 chunk);未加 `define.global` / `resolve.alias` / `optimizeDeps`——实测不需要。

**真浏览器实测耗时(localhost dev,本机)** —— M3 预加载策略输入:
- **board(15334 约束 / 8.75MB zkey / 4.13MB wasm):本地计算总 704 ms,verify 70.6 ms。** 远低于 §DoD 的 3s 线(~4×余量)。阶段时间线:fetch-wasm@347ms → fetch-zkey@371ms → witness@391ms → prove@435ms,done@704ms。
- **shot(888 约束 / 1.11MB zkey / 3.89MB wasm):本地计算总 167 ms,verify 13.9 ms。** 阶段:fetch-wasm@19ms → fetch-zkey@30ms → witness@33ms → prove@64ms。
- 注:dev 未优化构建即如此快(WASM witness 计算 + ffjavascript 多 worker FFT/MSM 并行,实测 prove 段 board ≈270ms / shot ≈100ms);生产更快。**预加载非必需但有益**:board 拉 12.9MB 工件占 ~样本中 fetch≈90ms(本机磁盘缓存命中),冷网络下预加载可把首证延迟前移到布阵幕。shot 公开信号实测 `["1", commitment, "0", "0"]`,result=1 与打 (0,0) 命中 ship0 自洽。

**真实进度纪律(Design §0,无假进度)**:四个 stage 全对应真实工作——fetch-wasm/fetch-zkey 由 `response.body.getReader()` 按 `Content-Length` 逐块累计(实测字节数精确匹配工件大小),witness/prove 由**拆分 fullProve** 得到:`wtns.calculate(inputs, {type:'mem',data:wasm}, wtnsMem)` 再 `groth16.prove({type:'mem',data:zkey}, wtnsMem)`(mem-object 形态读 fastfile@0.0.20 源码确认:输入只读 `{type,data}`,输出 `{type:'mem'}` 经 close() slice 到真实长度后原样喂 prove,与 fullProve 内部串法一致)。

**协议契约**(`src/workers/proverProtocol.ts`,上层锁定):main→worker `ProveReq`(preload/prove);worker→main `ProveRes`(progress/done/**preloaded**/error)。比规划文档多一个 `preloaded` 类型(替代「done 带空 proof」),让 id 路由能干净区分预热完成与出证完成。

**浏览器安全维持(3.1 D2)**:snarkjs 只活在 worker chunk。生产 bundle 双证:`prover.worker-*.js`(289.73 kB)含 groth16/ffjavascript;主 chunk `index-*.js`(165.94 kB)snarkjs 引用=**0**。worker 进生产图需上层 import `useProver`(本任务用临时 probe 引用验证 chunk 生成后即删;3.5/3.7 接线后自然常驻)——故当前**无上层消费者时主构建不产 worker chunk 属正确 tree-shaking**,不是缺陷。

**dev 验收工具** `/dev/prove`(`src/pages/DevProve.tsx`):`import.meta.env.DEV` 守卫的懒路由,production 经 Rollup 死代码消除走不到;其 `groth16.verify` 走 main 线程**动态** import('snarkjs')(dev-gated,不进生产主 bundle)。固定 salt 仅限本 dev fixture(§5.1 生产严禁)。

**文件**:`src/workers/{prover.worker.ts, proverProtocol.ts, snarkjs.d.ts}`、`src/hooks/useProver.ts`、`src/pages/DevProve.tsx`、`vite.config.ts`(+1 行)、`package.json`(+snarkjs 0.7.6,与 circuits/contracts 同钉版 D1)。

### 2026-06-13 Task 3.2 评审加固 — progress 改按电路分桶 + 超时/messageerror 兜底

评审发现四处问题,均为加固(不改已验收的真证明路径,board 532ms/shot 554ms verify=true 不变):

**I1 — progress 必须按电路标定(ProofStatus 契约定稿)。** 原 `useProverProgress` 把所有在途 id 塌缩成「max id 胜出」并丢掉 circuit,导致 (a) 消费方拿不到「在算哪个电路」、渲染不出「正在编译 board 证明 · fetch-zkey 61%」;(b) board 证明(3.5)与 shot 证明(3.7 useAutoRespond)并发时互相覆盖(后发起的 id 大,盖掉先发起的)。改法:
- `ProveRes` 的 `progress` 变体 + `ProgressSnapshot` 都加 `circuit`(worker 每个 post 点都已知电路,直接随帧带过线)。
- 公开进度 store 改按 **circuit** 键(`Map<Circuit, {id, snap}>`——域内最多 board + shot 各一条并发);桶里存 id 做**归属判定**:同电路只接受 `id ≥ 当前桶 id` 的帧(旧请求迟到帧不覆盖新请求),终态(done/error/超时)只在该 id 仍占桶时清桶(已结束的旧请求不误清同电路上更新请求)。`useProverProgress(circuit)` 选择器返回该电路最新快照或 null,仍用 `useSyncExternalStore`(每电路一个稳定 getSnapshot 闭包 + 引用稳定化防抖)。

**约定的 ProofStatus 契约(§7.5,3.5/3.7 据此接线)**:进度是**每电路**的;ProofStatus 建模为
`{phase:'local', circuit, stage, loaded?, total?} | {phase:'onchain', ...} | {phase:'idle'}`,
其 local 臂数据来自 `useProverProgress(circuit)`。**`ProveStage` 永远只表示本地计算阶段(fetch-wasm/fetch-zkey/witness/prove),绝不掺链上阶段**——链上等待是 ProofStatus 的 `phase:'onchain'` 另一臂,由 useGame 的交易状态喂,不塞进 worker 协议。

**I2 — 堵「promise 永不 settle」缺口**。`prove`/`preload` 各加**单请求超时**(60s,证明实测亚秒级,纯属对「module worker 加载失败但不触发 onerror」「未知卡死」的保险):超时即 reject 可读 Error(`prover 超时(60s)未响应,可能 worker 加载失败`)并清掉该请求的 pending + 进度桶,给 ProofStatus 一个真错误而非无限转圈。另加 `worker.onmessageerror`(接收端 structured-clone 失败,原先完全未处理):此时 `e.data` 不可信、id 不可知,拒掉全部在途并给可读 message。终态收口统一走 `settle(id)`(清 timer + 清归属桶 + 摘 pending)/ `rejectAll`(onerror/onmessageerror),避免六条路径重复清理逻辑分叉。

**M1 — 修锁定契约文件的过时注释**(`proverProtocol.ts` `done:` 那条):原注释说「preload 完成也回 done … 见下方 PreloadDone」,但真实类型是 `preloaded` 且无 `PreloadDone`。已改注释如实描述 `preloaded` 变体(此文件是 3.5/3.7 读的真理源)。

**M4 — HMR dispose**(`useProver.ts`):`import.meta.hot.dispose` 里 `worker.terminate()` 并清模块级状态,避免 dev 热更新残留重复 worker(生产无 `import.meta.hot`,该分支被剔除)。

**回归测试**:新增 `src/hooks/useProver.test.ts`(10 例,mock Worker + fake timers 驱动消息流)锁住:progress 分桶/带 circuit/旧 id 迟到帧不覆盖/done 不误清同电路新桶;done|error|超时|onmessageerror|onerror 各自收口正确。为单测加了非 hook 读取口 `peekProgress(circuit)`(等价 useProverProgress 读路径)。web 测试 83 → 93 全绿,tsc/build 干净。

**文件**:`src/workers/{proverProtocol.ts, prover.worker.ts}`、`src/hooks/useProver.ts`(+`peekProgress`)、`src/hooks/useProver.test.ts`(新增)、本 DECISIONS。

### 2026-06-13 Task 3.3 — connector 选 local-account(非 mock)+ ws-transport + worker calldata 格式化

本任务三处关键裁决,真浏览器验收(pnpm demo + playwright)一次通过:**P0 createGame 落 anvil,GameCreated(gameId=1, p0=0xf39F…2266),tx 0xf85fbaa1…,status 0x1;P1 createGame gameId=2,p0=0x7099…79C8,tx 0x66fb26c8…,链上 from 逐一核对为对应 anvil 账户**。控制台全程 0 error(仅 2 条 React-Router future-flag warning,与本任务无关)。

**(1) connector:采用自建 local-account connector,放弃 wagmi `mock`(D14 兜底转正)。**
读 `@wagmi/core` mock.js 源码定论:mock 的 `getProvider` 对 `eth_sendTransaction` **无本地签名分支**,params 原样 `rpc.http(url, {body})` 转发给节点 HTTP RPC,依赖 anvil 对内置账户 unlocked 自动签名;且 `MockParameters.accounts` 类型是 `readonly [Address, ...Address[]]`(**只收地址串,不收 viem Account 对象**),无 features 签名 hook——故"用 privateKeyToAccount 让 mock 本地签名"这条路类型上就不通。mock 在 anvil 上能跑,但 from 由节点解释、P0/P1 切换正确性挂在节点解锁状态上,换非 anvil 节点即废。
local-account connector(`src/lib/wagmi.ts`,~110 行):每个实例裹一个 demo 私钥,`getProvider` 返回 `custom({request})` provider,`request` 分流——`eth_accounts`/`eth_requestAccounts` 回本账户地址、`eth_chainId` 回本链、`eth_sendTransaction` 交给 `createWalletClient({account: privateKeyToAccount(key)})` 本地签名发 **eth_sendRawTransaction**、其余透传 anvil(eth_call/回执/日志)。wagmi `getConnectorClient` 因本 connector 不实现 `getClient`,走默认路径用 `parseAccount(地址)` + `custom(provider)` 造 client(json-rpc 型账户 → viem 走 eth_sendTransaction → 正好被本 provider 截获本地签名)。P0/P1 切换 = `useSwitchAccount` 切 connector,各自私钥签名,**链上 from 实测精确匹配 active 账户**(非节点猜的 from),确定性最高。证据:两笔 tx 的 `from` 分别 = anvil #0 / #1,逐一 RPC 核对通过。

**(2) ws-transport:`fallback([webSocket(ws), http(http)])`,ws 由 http rpcUrl 派生,deployment.json 的 rpcUrl 仅供运行时校验/展示、不驱动静态 transport。**
wagmi config 必须静态,合约地址才运行时 fetch;chain 用 viem 内置 anvil(其 `rpcUrls.default` 已含 `http://127.0.0.1:8545` + `ws://127.0.0.1:8545`),与 demo.ts 写的 rpcUrl 恒一致。`deriveWsUrl`(纯函数,单测覆盖 http→ws / https→wss / 非 http 原样)从 http rpcUrl 推 ws。transport 用 fallback 优先 ws(M3 对战幕事件推送实时)、失败回落 http 轮询(本任务回执等待即走通)。**追记 Task 2.5 留的问题:deployment.json 的 rpcUrl 在 web 端定位为"仅供参考/校验",静态 transport 取 anvil chain 默认(二者值相同),不让运行时 fetch 阻塞 wagmi 静态初始化。**

**(3) worker calldata 格式化:在 worker 内调 `formatProofCalldata`,bigint 转 0x-hex 串过 postMessage,主线程 BigInt() 还原喂 writeContract。**
合约要 `BoardProof{a,b,c,pubSignals}`(含 pi_b limb 交换),唯一实现 `formatProofCalldata`(D3,走 snarkjs `exportSolidityCallData`)依赖 snarkjs;snarkjs 只能在 worker(浏览器安全 3.1/D2),故格式化也在 worker 做。worker `done` payload 扩为 `{proof, publicSignals, calldata}`(proof/publicSignals 留着供 DevProve verify + 3.7 结果读)。**bigint 过线形态选 0x-hex 串**(非直接 bigint):虽 structured clone 支持 bigint,但既有协议约定"统一 string 过线最稳"(见 ProveInputs),hex 无歧义;主线程 `toBoardProofArg`(`src/lib/proofArgs.ts`)BigInt() 还原成合约 tuple(pubSignals 非 1 项即抛,防 shot calldata 误喂 createGame)。**主 bundle snarkjs-free 维持**:生产 build 后 grep `dist/assets/index-*.js`,snarkjs/groth16/ffjavascript/exportSolidityCallData/wtns.calculate/powersOfTau **全 0**;worker chunk(`prover.worker-*.js`,290.67 kB)含 groth16(4)+exportSolidityCallData(3)。

**依赖**:`wagmi ^2.19.5`(实装 2.19.5)+ `@tanstack/react-query ^5`(wagmi v2 peer);viem 仍 2.52.2(wagmi peer 解析到同版本,类型对齐)。pnpm 11 ignored-builds(bufferutil/keccak/utf-8-validate,walletconnect 传递依赖的可选原生加速包)**显式置 false**(本仓 demo 走自建 connector 不碰 walletconnect,纯 JS 回退够,同 blake-hash 避免依赖 MSVC)。

**文件**:`src/lib/{wagmi.ts, demoAccounts.ts, proofArgs.ts}`(+ 各自 .test.ts)、`src/components/AccountSwitcher.tsx`(新增);`src/workers/{proverProtocol.ts, prover.worker.ts, snarkjs.d.ts}`、`src/hooks/{useProver.ts, useProver.test.ts}`、`src/main.tsx`、`src/components/Layout.tsx`、`src/pages/Lobby.tsx`(改);`pnpm-workspace.yaml`(allowBuilds)。web 测试 93 → 103 全绿,tsc/build 干净,root test:all 全绿。

### 2026-06-13 Task 3.4 大厅 — 信息架构裁决 + lockFleet 管线抽取 + 事件归约列表

真浏览器验收(pnpm demo + playwright)全程通过,**0 console error**(仅 React-Router v7 future-flag warning,同 3.3,与本任务无关)。证据见下「browser」。

**(IA-1)创建 / 加入是「入口」,布船证明 + 交易在「布阵幕」,不在大厅。** Design §7.1 把大厅定为「创建对局 | 输入 gameId 加入 | 进行中对局列表」三件事;§7.3 把 board 证明 + createGame/joinGame 交易明确归到布阵幕的「锁定舰队」。故大厅**不再持有任何证明/交易逻辑**(3.3 临时挂在 Lobby 的 createGame 全栈验收流程已移除):
- 创建对局 = 按钮 → 导航 `/game/new`(布阵幕 create 模式);
- 加入对局 = 数字 gameId 输入 + 「加入」→ 导航 `/game/:id`(3.6 起按 phase 呈现 join 布阵幕);
- 进行中对局列表 = `useGameList` 扫事件重建 + `watchContractEvent` 增量,点行 → `/game/:id`。**无手动刷新按钮**(§7.1 用户永不手动刷新)。

**(IA-2)新增 `/game/new` 路由(create),`/game/:id` 仍是占位(3.6 建相位机)。** v6 静态段优先于动态段,`/game/new` 不会被 `/game/:id` 捕获(顺序仅为清晰)。**join-by-id 导航落到 `/game/:id` 占位页是 3.4 预期**——完整 join(在那里渲染 join 布阵幕)于 3.6 收口;3.4 只验证「列表/输入/行点击 → 正确导航」。

**(IA-3)`/game/new` 用临时固定布局,3.5 只换 UI、复用同一 `useLockFleet`。** 真实布阵交互(FleetDock 点选/预览/R 旋转/非法染红)是 3.5 的活;3.4 用一个**显式围栏标注**的合法固定布局(5 船贴左逐行,validateBoard 必过)+「锁定舰队」按钮,跑**真证明、真交易、真持久化、真事件**,让 create 在 3.4 端到端可用。NewGame 页明确标注「临时:3.5 将替换为真实布阵交互」。ExportButton(§8 导出部署文件)推迟到 3.5 与真实布阵一起做。

**(管线)`useLockFleet` —— 从 3.3 Lobby 抽出并泛化(create → create|join)的可复用锁定管线。** 离散 status `{idle|proving|sending|confirming|done|error}`(done 带 mode+gameId+hash),供 ProofStatus 渲染 + 调用方(NewGame)在 done 时导航。流程:`savePending/saveBoard`(§8 上链前先落盘)→ worker `prove('board')`(proving,本地计算)→ `writeContractAsync` create/joinGame(sending,本地签名发 raw tx)→ `waitForTransactionReceipt`(confirming,链上确认)→ 解析 `GameCreated`/`GameJoined` 取 gameId →(create)`promotePending`。
- **为何命令式(writeContractAsync + publicClient.waitForTransactionReceipt)而非 useWaitForTransactionReceipt 钩子**:本流程是「按一次按钮跑一条龙」的一次性命令序列;钩子是声明式按渲染驱动,把「等回执」塞钩子要把 hash 提升为 state、再用 effect 串下一步,把线性流程拆成隐式状态机,难读且易竞态。命令式 await 一条直线,phase 转换显式(3.3 已实证此路在 anvil + local-account connector 通)。两段等待文案仍严格区分(§7.5)。

**(存储正确性 create vs join,收口 3.3 Lobby 注释警示的 pending 槽冲突)**:storage `pendingKey` 不含 gameId,故同账户同合约只有一个 pending 槽。
- **create**:gameId 上链才知 → 先 `savePending`(不含 gameId)→ 拿到 gameId 后 `promotePending` 迁正式键 `bs:{chainId}:{contract}:{gameId}:{addr}`。
- **join**:gameId **入参即已知** → 直接 `saveBoard`(写正式键),**完全不碰 pending 槽**。
如此 create 的待定布阵与 join 的待定布阵不再争同一 pending 槽(3.3 警示的 last-writer-wins / promote 迁错布阵不会发生)。写盘失败(`StorageWriteError`,§8 = 必然超时输)单独成**阻断态**,文案点名后果,不继续上链。

**(ProofStatus §7.5 两阶段,纯展示,create 现用 / 对战幕将来复用)**:本地计算 = 「正在编译舰队部署证明… {stage} {byte%}」,数据来自 `useProverProgress(circuit)`(worker Content-Length 流式读出,**非假进度条**);链上 = 「提交交易中…」/「等待链上确认… tx 0x…」+ inline spinner(无字节/无百分比——链上耗时不可预估,给百分比即假进度)。**不弹模态**;idle→null;done/error 干净终态。状态由 useLockFleet 喂入(props),circuit 由调用方指定(布阵=board,3.7 应答=shot)。

**(useGameList 归约 + live)**:列表真理 = 「把一串合约事件按 gameId 折叠成当前状态」,抽成**纯函数** `gameListReducer`(node 环境可单测,本仓无 testing-library):`reduceGameEvents` 按 gameId 单调升级 status(created→waiting / joined→active / finished→剔除),**对事件到达顺序不敏感**(status 单调,乱序折叠出同一终态)、**幂等**(重复 log 不改结果);`buildInProgressList` 过滤 waiting+active、按 createdPos 倒序(最新在前)。`useGameList` 负责取数:`getLogs` 从 `deployBlock` 回填(§10 indexer-less:本地全扫,测试网改 fromBlock=max(deployBlock, head-N),已留注记)+ 三个 `useWatchContractEvent`(GameCreated/Joined/Finished)增量,投影入 ref 事件池(按 pos 去重),version state 触发 useMemo 重算。

**(单测)**新增 `gameListReducer.test.ts`(18 例:归类/顺序无关/幂等/过滤排序/多局并存)+ `useLockFleet.test.ts`(6 例:`parseCreatedGameId`/`parseJoinedGameId` 用 viem encodeEventTopics 造真实 log 解析 + 无事件即抛)。web 测试 103 → **127 全绿**;tsc/build 干净;**主 bundle snarkjs-free 维持**(build 后 grep `index-*.js`:groth16/snarkjs/ffjavascript/exportSolidityCallData/powersOfTau/wtns **全 0**;worker chunk 含 groth16+exportSolidityCallData)。

**(browser 证据,pnpm demo + playwright)**:Battleship `0x9fe46…`,anvil 31337。
- P0:大厅→创建对局→`/game/new`→锁定舰队→ ProofStatus 实测阶段序列(轮询 `data-testid=proof-status` 的 `data-phase`):`proving`「正在编译舰队部署证明… 拉取电路 wasm 4.1/4.1MB · 100%」→「计算见证(witness)」→「生成 Groth16 证明」→ `sending`「提交交易中(本地签名 → 广播)…」→ done 导航 `/game/1`;返回大厅 #1 出现在列表(`#1 等待对手 P0 0xf39F…2266 · P1 待加入`)。
- 切 P1:同 4 局全部显示 `等待对手`(P1 视角可加入);点行 → `/game/1` 占位(3.4 预期)。
- **live(watchContractEvent,无手动刷新)**:大厅 tab 保持不动(`/`,未 reload),另一 tab 创建第 4 局,大厅列表自动从 `[3,2,1]` → `[4,3,2,1]`(最新在前)。
- join-by-id 输入「2」→「加入」启用 → `/game/2`;空输入时「加入」禁用。
- 持久化(§8):localStorage 见各局正式键 `bs:31337:0x9fe46…:{1,3,4}:0xf39f…`(P0,promotePending 后无残留 `:pending:` 键)。0 console error。

**文件**:`src/hooks/{useLockFleet.ts, useGameList.ts, gameListReducer.ts}`(新增)+ `{gameListReducer.test.ts, useLockFleet.test.ts}`(新增)、`src/components/ProofStatus.tsx`(新增)、`src/pages/{NewGame.tsx(新增), Lobby.tsx(重写)}`、`src/App.tsx`(+`/game/new` 路由)。复用 3.1/3.2/3.3:storage/commitment/salt/proofArgs/errors/format/useProver/wagmi/abi 均 re-use,未重造。

### 2026-06-13 Task 3.5 布阵幕 — BoardGrid 复用原语 + 点选预览交互 + 锁定→导出→等待

真浏览器验收(pnpm demo + playwright)全程通过,**0 console error**(仅 React-Router v7 future-flag warning,同 3.3/3.4,与本任务无关)。证据见下「browser」。

**(状态机)布阵态用 `useReducer`,不引 zustand(任务留给实现者的选择)。** 布阵态是**组件作用域、瞬时**:刷新即弃(锁定前不持久化——§8 只在锁定**成功**后落盘),无跨组件/跨路由共享需求。引全局 store 是 YAGNI;`placementReducer`(`src/components/board/placement.ts`,纯函数)把 8 个互斥转换(carry/hover/rotate/place/pickup/cancel/reset)收成一个可单测的 reducer,action 显式、转换可读,正是「一处临时交互状态」的标准解。geometry/合法性同在该模块(纯、node 可单测),React 层(PlacementBoard/FleetDock)只把手势翻成 action、把派生量翻成每格样式。

**(IA)锁定成功后留在 `/game/new` 就地 in-place 呈现,不立即导航到 `/game/:id`。** §7.3 锁定后进入「等待/对战」,§8 要求锁定成功后「导出部署文件」必须可达。但 3.6 才把 `/game/:id` 建成相位驱动页;若 3.5 就跳过去,导出按钮与等待态会落在一个**还没实现它们的占位页**上 = 导出够不到(§8 违反)。故 3.5 在本页就地:棋盘上锁(`locked` cellState:占格转暗磷光 `bg-phosphor/20` + ▦ 锁标 + `[disabled]`)+ 锁定横幅「🔒 已锁定 · 10×10 · 17 占格」+「导出部署文件」(ExportButton,§8)+ 等待态「声呐搜索对手中… 对局编号 #N,把它发给你的对手」(§7.3;声呐空转动画是 M4,这里静态简版)+ 一个「进入对局 →」链接手动去 `/game/:id`。完整自动切幕在 3.6 收口。(3.4 NewGame 临时版是 done 即 `navigate('/game/:id')`,3.5 替换为就地——3.4 那条只为让 create 端到端跑通,无导出需求。)

**(BoardGrid 复用契约,为 3.7 OwnBoard/SonarBoard 而设计)** `src/components/board/BoardGrid.tsx` 是纯展示 / 受控的 10×10 原语,不内置任何业务语义:
- **cell render-prop + 样式钩子**:`renderCell(x,y)` 渲染格内容、`cellClassName(x,y)` 决定语义着色、`ariaLabel(x,y)` 给可达标签——棋盘本身不知道「己方/敌方/预览/命中」(那是各 Board 的事,3.7 用同一原语铺对战双盘);
- **roving tabindex(§7.7 键盘可达)**:整盘只一个 tabstop,方向键 / Home / End 移动焦点,焦点格 tabIndex=0 其余 -1,移动时真实 `.focus()`;焦点环 `outline phosphor`(实测 `solid 2px rgb(53,224,200)` = `#35E0C8`)。焦点格记在 BoardGrid **内部 state**(focus 是纯 UI 关注点,不属布阵业务态,故不上提父 reducer);父级经 `onCellFocus` 得知焦点落点(布阵幕据此把预览跟到键盘焦点格);
- 视觉(§7.2 锁定):1px `--grid` 边框、32px 直角方格、无圆角;颜色全部由 `cellClassName` 注入,原语不引调色板外颜色。

**(交互模型)不用 HTML5 DnD,点选→预览→落子。** 自绘预览(`previewCells` = 复用 boardLogic.shipCells 几何),半透明磷光(`bg-phosphor/40`);`R` 旋转手持朝向、`Esc` 取消。**R/Esc 走 window 级 keydown**(仅 `carrying && !locked` 时挂载),而非棋盘格 keydown:鼠标手持时焦点通常不在任何格上(hover≠focus),实测确认只挂格级则鼠标用户按 R 不旋转;window 监听让鼠标路径与键盘路径统一可用(格级 keydown 只留 BoardGrid 处理方向键,R/Esc 不在格级重复处理,免与 window 双触发抵消)。键盘落子路径:方向键移焦点 → 预览跟随 → Enter/Space(button 原生 onClick)落子——实测 Enter 在焦点格成功落子,故键盘路径完整(非仅鼠标兜底)。

**(canPlace 复用 boardLogic 真理源,不重造 overlap/bounds)** `placement.canPlaceShip(placed, shipId, candidate)`:候选船每格 ∈ [0,9]²(界内,等价 validateBoard 的「船尾 ≤ 9」)+ 无一格落在「**其它**已放置船」的占用集(无重叠;`excludeId` 摘自身旧位置,支持重放;贴边相邻合法,§4.1 不做间隔)。占用集由 boardLogic.shipCells 逐船构建(同一几何真理源,与电路/e2e/合约 fixture 共用)。**与 validateBoard 的等价**由 `placement.test.ts` 钉死:对一批全 5 船布局,逐 shipId 增量 canPlaceShip 的接受性 === `validateBoard.ok`(增量判定没分叉规则)。锁定前再过一次 `validateFinal` = `validateBoard(toBoard(...))` 总闸(双保险,与电路同判据)。

**(实测发现并修复的渲染 bug:出界预览格折行)** 初版预览集用 `y*10+x` 索引**全部**几何格(含出界 x>9 / y>9);浏览器实测水平船头 (7,0) 长 5 时,出界格 (10,0)(11,0) 被折成 idx 10/11 = 格 (0,1)(1,1),把下一行无关格染了 --flare(playwright 读 DOM class 抓到 flare 落在 `0,1`/`1,1`)。修复:抽 `placement.inBoundsPreviewCells(state)` 只取在界子集,渲染层用它索引;出界船的在界部分照常染红(legal=false 整段 --flare),出界部分无格可染(预期);合法性判定仍走 previewLegal(出界即非法),与渲染解耦。加回归单测 3 例(完全在界 / 水平近右缘 / 垂直近下缘,断言绝不含 x>9 或 y>9 的格)。

**(ExportButton §8)** `src/components/ExportButton.tsx`:复用 `storage.exportBoardJSON`(不自拼 JSON——导入端 importBoardJSON 依赖同一 schema:version/hex 字段/meta)把 `{ships, salt, commitment}`(bigint→hex)+ 定位 meta 收成纯对象 → Blob 下载,文件名 `battleship-game{id}-{addr6}.json`。不弹模态 / 不调 alert(§7.4)。实测下载触发 `battleship-game1-b92266.json`,内容含 ships(5)+salt(0x…)+commitment(0x…)+ version/chainId/gameId/address。

**(预热)** 进入布阵幕即 `preload('board')`(3.4 handoff 建议),把 8.35MB zkey 拉取藏在布阵时间后,「锁定舰队」时证明少等网络。

**(单测)** 新增 `placement.test.ts` 31 例:FLEET 取真理源长度 / shipCellsAt 几何 / canPlaceShip 界内+无重叠+贴边+重放排除自身 / **canPlaceShip≡validateBoard 等价(4 布局)** / previewCells+previewLegal / inBoundsPreviewCells 回归 3 例 / allPlaced+placedCount+toBoard+validateFinal / placementReducer 每条转换 + 非法 place no-op + 完整走一局。web 测试 127 → **158 全绿**;tsc/build 干净;**主 bundle snarkjs-free 维持**(build 后 grep `index-*.js`:groth16/snarkjs/ffjavascript/exportSolidityCallData/powersOfTau/wtns/plonk/fflonk **全 0**;worker chunk `prover.worker-*.js` 含 groth16+exportSolidityCallData)。

**(browser 证据,pnpm demo + playwright,P0 视角 /game/new)**:Battleship `0x9fe46…`,anvil 31337。
- 点船坞航母 → 棋盘随 hover 出预览:水平船头 C-3 → 预览精确落 C-3..G-3(preview-ok,aria「X-3 预览 可放置」)。
- 手持时按 R → 预览水平↔垂直翻转(C-3..G-3 ↔ C-3..C-7),DOM class 确认。
- 非法落子:船头 H-1 水平(长 5 出界)→ 在界 3 格 (7,0)(8,0)(9,0) 染 --flare、出界 2 格无格可染(修复后不再折行);点击 = no-op(placedCells 仍空、carrier 仍 carrying)。
- 拿回:点已放置航母 → 回 carrying(dock「手持中」、棋盘清空),再放别处成功。
- 放满 5 船 → 占格恰 17、「锁定舰队」出现且 enabled、进度提示消失 → 点击 → ProofStatus 终态「✓ 对局已创建 · 编号 #1」(board 证明亚秒 + anvil 即时挖矿,中间相位极快)→ 棋盘上锁(17 格 `[disabled]` + aria「…(已锁定)」+ ▦)+ 锁定横幅 + 导出按钮 + 等待态「声呐搜索对手中… #1」+「进入对局 →」/game/1。
- 导出 → 下载 `battleship-game1-b92266.json`,内容 = ships+salt+commitment+meta(见上)。
- 持久化(§8):localStorage 正式键 `bs:31337:0x9fe46…:1:0xf39f…`(P0),无残留 `:pending:`(promotePending 已迁)。
- 键盘:聚焦棋盘 → 仅 1 格 tabIndex=0(roving 单 tabstop);ArrowRight×2+ArrowDown → 焦点 (0,0)→(2,1)=C-2,tabIndex=0 随迁,焦点环 phosphor;手持后焦点 E-5 按 Enter → 航母落 (4,4)..(8,4)(键盘落子路径成立)。0 console error。

**文件**:`src/components/board/{BoardGrid.tsx, PlacementBoard.tsx, FleetDock.tsx, placement.ts, placement.test.ts}`(新增)、`src/components/ExportButton.tsx`(新增)、`src/pages/NewGame.tsx`(重写:真实布阵 + 锁定→导出→等待)。复用 boardLogic(shipCells/validateBoard/SHIP_LENGTHS)、useLockFleet/ProofStatus(3.4)、storage.exportBoardJSON、commitment/salt/format/useProver/contracts/wagmi——均 re-use,未重造。

### 2026-06-13 Task 3.6 useGame + 三幕切换 — 相位驱动单局页 + join 流程 + 账户切换视角翻转

真浏览器验收(pnpm demo + playwright)全程通过,**0 console error**(仅 React-Router v7 future-flag warning,同 3.3/3.4/3.5,与本任务无关)。证据见下「browser」。

**(分层)取数(useGame,React/wagmi)与派生(gameView.ts,纯函数)严格分工。** gameView.ts(3.6 前置,已 41 单测绿)是「getGame struct + ShotResolved 回放 + 当前地址 → GameView」的唯一纯映射;`useGame(id)` 只负责取数并喂它:
- **struct 投影**:`publicClient.readContract({getGame})` → `projectSnapshot` 投影成 GameSnapshot(uint8→number、承诺 bigint、turn 收窄 0/1;**不**投影 shotMap 位图——坐标级 hit/miss 走事件)。**为何用命令式 readContract 而非 useReadContract 钩子**:本钩子要让 watch 收到事件时**同时**重取 struct + ShotResolved(两者必须同刷,否则坐标级历史与计数态漂移),命令式在一个 effect 里 `Promise.all` 一把取齐最直;`useReadContract` 是独立缓存,要再起一套 refetch 协调,反把「一次刷新」拆成两条异步线易竞态。与 3.4 useGameList 的命令式 getLogs 同治理。
- **getLogs 回放**:`ShotResolved`(从 deployBlock,`args:{gameId}` 只取本局)→ ResolvedShot[](坐标级);并回放 GameJoined/ShotFired/GameFinished 进 append-only **事件日志池**(§7.3 战报流,3.7 渲染;3.6 只用到计数)。
- **watch 增量**:四类事件(ShotFired/ShotResolved/GameJoined/GameFinished)各一个 `useWatchContractEvent`,`onLogs` 既**触发 refetch**(重取 struct+shots)又追加日志。

**(决策)事件当刷新触发器、不做乐观 reducer(记此,gameView.ts 模块注释亦详述)。** 真理源是 getGame 的 struct(phase/turn/hits/pending 全在链上)。事件只两用:(a) ShotResolved 回放出 struct 给不出的**坐标级** hit/miss(struct 只给 hits 计数 + shotMap 位图,位图只标「打过」不标结果;哪格 hit 哪格 miss 只在事件里);(b) 当刷新/动效触发器(收事件 → useGame refetch struct)。**不**用事件乐观推进 struct(turn/phase)——那等于前端重写一遍合约状态机、易与链上漂移。本地 anvil 无重组(no-reorg),事件不被回滚,故「事件触发 refetch」这条简化安全(测试网若有重组需加确认数,届时在 watch 层加,派生/取数层不动)。

**(决策,§7.1 killer feature 的关键不变量)账户切换零 refetch。** useGame 取数 effect 的依赖是 `[validId, gameId, deployment, publicClient, refetchVersion]`——**刻意不含 address**。deriveGameView 对 address 是纯函数:同一份 snapshot+shots 换地址,myIdx/isMyTurn/my-enemy shots/hits 全翻。故 P0↔P1 切换只让 `useMemo([snapshot,shots,address])` 重算,**零网络**。若把 address 列进取数 effect,每次切账户白白重拉 struct + 全部日志,既慢又违背「同一局、不同立场」本意。**实测**:battle 幕切 P1→P0,注入 fetch 计数器测得 **eth_call=0 / eth_getLogs=0 / 总 RPC=0**、无 loading 态、回合横幅由「等待对手开炮」翻成「轮到你开炮」、对手地址 P0↔P1 互换、视角 P1↔P0 互换(见 browser)。

**(决策,3.4 I1 同款纪律)watch 回调全 useCallback 钉死身份。** wagmi 的 useWatchContractEvent 把 onLogs 列进 effect 依赖(viem observerId 去重键却不含 onLogs):onLogs 每渲染换身份 → 订阅拆毁重建(uninstallFilter + 重 createFilter,新 filter 一个轮询周期空窗可能漏事件)。故 `bumpRefetch`/`ingestLog`/`onEventLogs` 全 `useCallback`(依赖仅稳定的 setter/ingest),四个订阅各只挂一次跨事件存活。**无重取风暴**:onLogs 只 bump `refetchVersion`,取数 effect 不 bump 它自己;取数里 `ingestLog` 只 bump `logVersion`(非取数 effect 依赖)——单向无环。

**(reviewer 建议)PostLockPanel 抽出 NewGame 的 post-lock 块,等待 UI 只一处。** 3.5 时 /game/:id 还是占位页,故 3.5 把锁定后「上锁盘 + 导出 + 等待」就地留在 NewGame。3.6 把 /game/:id 建成相位驱动页后:NewGame 锁定 `done` 即 `navigate('/game/:id')`(回到 3.4 的最简收口,只是这次落在真页),Game.tsx 的 p0-waiting 幕(act='placement' 且 myIdx===0)渲染 `PostLockPanel`——**等待 UI 单一实现**,不再两处各写。PostLockPanel 拿到的是 `Board`(storage 还原 / 锁定定格),没有布阵 reducer 态,故上锁盘**直接用 BoardGrid 原语**(全盘 disabled + 占格 ▦ + 暗磷光,从 board 经 shipCells 算占用格),**不**经 PlacementBoard(后者要 PlacementState)。Props `{board,salt,commitment,gameId,address,chainId,contract,showEnterLink?}`。

**(决策)join 成功不本页跳转,靠相位自动切幕。** Game.tsx 在 act='placement' 且非 P0(observer / p1 尚空)时渲染 **join 模式布阵**(复用 PlacementBoard/FleetDock/placementReducer/`useLockFleet({mode:'join',gameId})`/ProofStatus,与 NewGame 同套原语,薄包一层布局 JSX——重逻辑全在复用单元里,不抽 PlacementScreen,YAGNI)。join `done` **不** navigate:合约 joinGame 把 phase 置 AwaitingAttack(turn=0,P0 先攻),useGame 的 GameJoined watch → refetch → view.act 自动变 'battle',本页自然切对战幕(§7.1 相位驱动)。**实测**:P1 锁定加入 → 证明+joinGame → 页面**无手动刷新自动进对战幕**,回合横幅 P1 视角「等待对手开炮」(turn=0=P0)。

**(决策)p0-waiting 棋盘从 storage 还原(`loadBoard(chainId,contract,id,address)`)。** P0 等 P1 期间要展示自己的上锁盘(§7.3),棋盘在 §8 落盘(create 经 promotePending 迁到正式键 `bs:{chainId}:{contract}:{id}:{addr}`)。Game.tsx 的 P0Waiting 子组件 `loadDeployment` 后 `loadBoard` 还原 → 有则 PostLockPanel,**缺失**(换浏览器 / 清存储)则最小提示「本地棋盘缺失,无法展示布局(完整恢复/导入见结算前)」+ 等待文案(完整 PersistenceBanner + 导入恢复是 3.8,此处最小面)。

**(三幕)** Game.tsx `useGame(id)` → `view.act` 分派:loading(声呐扫描中…/spinner,无假进度)→ notfound(getGame 对不存在 id 返回零 struct phase None,**不 revert**;「未找到对局 #N」+ 返回大厅,即 3.4 deferred 的 join-by-id-typo landing,§7.6)→ placement(P0 等待 / join 布阵)→ battle(**最小占位 + 真实派生**:回合横幅 4 态[轮到你开炮/等待对手开炮/轮到你应答/对手应答中,由 isMyTurn×phase 推]、双方被命中 x/17、pending 坐标、双方开炮数、对手短地址、我的视角;3.7 换双盘+准星+自动应答)→ finish(**最小占位**:你赢了/对局已取消/对手获胜 + 战损 + 返回大厅;3.8 完整结算)。整页随 watch 实时刷新,**无手动刷新按钮**。

**(单测)** 新增 `useGame.test.ts` 19 例:`projectSnapshot`(struct→GameSnapshot:玩家/承诺/uint8 转换/越界 phase 归 None/turn 收窄/不存在零 struct)、`toResolvedShot`(完整/miss/缺字段→null/totalHits 缺省)、`toLogEntry`(四类事件投影/非四类→null/缺 pos→null)、`comparePos`(块号优先 + 块内 logIndex + 大 bigint 不溢出)——钉死「链上→派生输入」投影契约(React 钩子取数本身在浏览器验收,node 环境无 testing-library,同 gameView/gameListReducer 治理)。web 测试 220 →(含 gameView 41 + useGame 19)**239 全绿**;tsc/build 干净;**主 bundle snarkjs-free 维持**(build 后 grep `index-*.js`:groth16/snarkjs/ffjavascript/exportSolidityCallData/powersOfTau/wtns/plonk/fflonk **全 0**;worker chunk `prover.worker-*.js` 含 groth16×4 + exportSolidityCallData×3)。root `pnpm run test:all` 四包全绿(circuits/contracts/e2e[真 anvil+证明]/web)。

**(browser 证据,pnpm demo + playwright)**:Battleship `0x9fe46…`,anvil 31337,P0 `0xf39F…2266` / P1 `0x7099…79C8`。
- **not-found**:`/game/9999` → 「未找到对局 #9999」+「← 返回大厅」,0 error(截图 36-notfound)。
- **P0 create→waiting**:大厅→创建→`/game/new`→布满 5 船(17 占格)→锁定舰队→ board 证明 + createGame → **自动导航 `/game/1`** → p0-waiting 幕渲染 PostLockPanel:上锁盘 17 格 `[disabled]`+▦+「已部署(已锁定)」aria(A-1..E-1/A-3..D-3/A-5..C-5/A-7..C-7/A-9..B-9 = 我刚摆的布局,storage 正确还原)、「🔒 已锁定·10×10·17 占格」、「导出部署文件」、「声呐搜索对手中… 把对局编号 #1 发给你的对手」(截图 36-p0-waiting)。
- **切 P1 → 视角翻转到 join 布阵**:同 `/game/1` 不动,切 P1 → 幕从 p0-waiting 翻成 **join 模式布阵**(「加入对局 #1」+ 空布阵盘 + 船坞 5 船 +「已就位 0/5…锁定舰队加入」)——同一局、不同立场,纯派生翻转(截图 36-p1-join-placement)。
- **P1 布阵→加入→自动进对战**:P1 摆 5 船 →「锁定舰队·加入」→ board 证明 + joinGame → **无手动刷新自动进 battle 幕**(等 30s 内 `对战·Task 3.7 实现` marker 出现);P1 视角真实派生:回合「等待对手开炮」(turn=0=P0)、我方/对手战损 0/17、开炮数 0/0、待应答 —、对手 0xf39F…2266、视角 P1(截图 36-battle-p1-derived)。
- **battle 幕账户切换翻转(§7.1 killer feature)**:切 P0 → 同一局派生全翻:回合「等待对手开炮」→**「轮到你开炮」**、对手 0xf39F…2266→**0x7099…79C8**、视角 P1→**P0**;注入 fetch 计数器测切换 **0 RPC、无 loading**(截图 36-battle-p0-flipped)。
- **持久化(§8)**:localStorage 正式键 `bs:31337:0x9fe46…:1:0xf39f…`(P0,promotePending 迁移后无 `:pending:` 残留)+ `bs:31337:0x9fe46…:1:0x7099…`(P1,join 直写正式键,不碰 pending),均 ships=5+commitment ✓。
- **大厅 live**:回大厅,#1 自动显「进行中 · P0 0xf39F…2266 · P1 0x7099…79C8」(GameJoined watch 升级状态)。
- 全程 **0 console error**(仅 RR v7 future-flag warning)。demo 干净停(anvil + vite kill,端口释放)。

**文件**:`src/hooks/{useGame.ts, useGame.test.ts}`(新增)、`src/components/PostLockPanel.tsx`(新增,抽自 NewGame post-lock 块)、`src/pages/{Game.tsx(重写:三幕路由 + join 布阵), NewGame.tsx(改:done 导航 /game/:id,删就地 post-lock 块)}`;`src/hooks/{gameView.ts, gameView.test.ts}`(3.6 前置,纯派生核 + 41 单测,本提交一并纳入)。复用 gameView/storage(loadBoard)/contracts(loadDeployment/DeploymentNotFoundError)/boardLogic(shipCells/Board)/useLockFleet/ProofStatus/PlacementBoard/FleetDock/placement/BoardGrid/ExportButton/salt/format/useProver/abi——均 re-use,未重造。

### 2026-06-14 Task 3.7 对战幕功能版 — 双盘 + 准星 + 开炮 + 自动应答 + 倒计时 + 事件日志

真浏览器验收(pnpm demo + playwright,单浏览器双账户对打)全程通过,fresh-load **0 console error**(仅 RR v7 future-flag warning,同 3.3–3.6)。Game.tsx 的 `BattleAct` 占位**原位替换**为完整对战幕。

**(布局,§7.3)三栏 grid**:左 OwnBoard(己方海域/被打记录)、中缝(TurnBanner + HitProgress + BattleStatus[倒计时 + 自动应答状态 + claimTimeout] + EventLog)、右 SonarBoard(敌方声呐屏/我的炮击 + 开炮)。`lg:grid-cols-[auto_minmax(0,1fr)_auto]` + `order-*`:<1024px 堆叠且中缝置顶(order-first lg:order-2),≥1024px 三栏并排。我的棋盘**父级 loadBoard 一次**,同源喂 OwnBoard(画船轮廓)与 useAutoRespond(出证明用);address 变(切账户)重读(同一局换立场棋盘也换)。

**(useAttack + 乐观待应答标记)** 开炮 = 一笔 attack(gameId,x,y)(无证明)。useAttack(alreadyFired):REPEAT **前端预检**(命中即拦,省一次必 revert 往返)→ onFired 回调让 SonarBoard 落乐观空心待应答标记(交易确认前就有反馈)→ writeContractAsync → waitForReceipt;成功**不在 hook 内推进相位**(useGame 的 ShotFired watch refetch 把 phase 推进 + 该格转链上 pending),hook 只发交易报相位(职责单一)。SonarBoard 乐观格生命周期(本地 state):点击设;清除 = 进 myFiredCells ∨ 链上 pending 接管该格 ∨ 开炮失败。

**(SonarBoard 禁点集 = D11 真理)** battleMarks.sonarDisabledSet = myFiredCells(链上 shotMap[对手],respond 才置位) ∪ 在飞 pending 出炮格(链上 pending 我是 attacker + 本地乐观)。后者尚不在 shotMap 但绝不能再点(AwaitingResponse 阶段 attack 会 BAD_PHASE),并进禁点集。SonarBoard 仅「我方攻击回合」(phase===AwaitingAttack && isMyTurn && deployment!==null)可点 + hover/focus 出 Crosshair(经 BoardGrid overlay 槽);非攻击回合整盘 disabled。Crosshair = 竖线 + 横线 + 坐标角标(px 绝对定位,格 32px,中心 x*32+16;角标靠右两列贴左缘防越界),**功能版无动画**(声呐扫描/余辉是 M4)。

**(useAutoRespond — 自动应答,§7.3 + §8 + §10)**
- **触发**:phase===AwaitingResponse && pendingShotIsForMe && myIdx∈{0,1}——**只读链上派生量**,故关页再开/换设备导入棋盘后重开,只要链上仍「待我应答」,effect 挂载即自动开跑(§10 天然成立,无「我刚做了什么」本地记忆)。effect 依赖 pending 的**坐标基元 px/py/pcoord**(非 pendingShot 对象身份:deriveGameView 每次重算都新建该对象,依赖对象会在每次无关 refetch 重跑)。
- **inFlight 去重**:**module 级** Set 键 `${chainId}:${gameId}:${x},${y}`。module(非 ref)因 StrictMode 双挂载共用 module 作用域、ref 各自独立挡不住;与 useProver module 单例同层。进流程前占键;**成功后不清键**(成功后 phase 翻走触发条件自然 false;保留键堵「respond 已上链、useGame 未 refetch」窗口里重渲染再触发 → 重发必 BAD_PHASE 的噪声);**仅终态错误清键**允许重试。
- **棋盘缺失 = 大声阻断(§8,绝不静默跳过 = 静默弃权)**:loadBoard 缺失,或 verifyBoardCommitment 对不上 → status='blocked' 带阻断文案,Game.tsx role="alert" 横幅 + OwnBoard 缺失提示双重呈现;**不**进 prove/respond,blocked 占键不释放(防每次无关 refetch 重跑 loadBoard 抖动;重试 = 重载页面 / 3.8 导入)。
- **出证 + 发交易**:prove('shot', toShotInputs(board, salt, px, py)) → result = Number(publicSignals[0]) → respond(gameId, result, toShotProofArg(calldata))。ProofStatus circuit='shot',provingLabel='正在应答 {coord} 的炮击…'、doneLabel='已应答 {coord}'。

**(toShotProofArg,proofArgs.ts)** 与 toBoardProofArg 同胞:hex calldata → ShotProof bigint tuple,pubSignals 守卫**恰 4 项**(shot 电路 [result, commitment, tx, ty],result 输出在首位)。非 4 项即抛(挡 board calldata 误喂 respond)。respond ABI:result 是 uint8 单独传(= Number(publicSignals[0])),proof.pubSignals 是 uint256[4]。reviewer 建议:ProofStatus 加 provingLabel/doneLabel 泛化路径(不把 respond 模式硬编),接受 LockFleetStatus | AutoRespondStatus。

**(useCountdown + claimTimeout,§4.3 TIMEOUT=300)** 纯核 computeCountdown(已 16 单测)。**now 取链上块时间(非纯墙钟)**:claimTimeout 权威判据是 block.timestamp > lastActionAt+TIMEOUT,而 evm_increaseTime(测试/演示)把**链时间**跳到墙钟之前——纯墙钟倒计时不到点但链上已可 claim。故 hook 周期(5s)getBlock() 取链锚 + 墙钟增量插值平滑 1s 跳动;取块失败回退墙钟。claimant(调用方组合):义务方不能 claim 自己超时,**非义务方玩家**才是 claimant(§4.3+§10);按钮可见 = iAmClaimant && expired,点了由合约最终裁决——**前端决定按钮何时出现,合约决定点了是否成功**。

**(EventLog 措辞翻面,§7.3 + demo 视角)** eventLogLines.toLogLines(纯,14 单测):同一事件按 myIdx 说成「我方/对方」——**fired 的 side=attacker;resolved 的 side=defender(主语翻面:defender===我 → 对方炮击我方 {coord} … 命中/未命中)**;observer 用 P0/P1 客观称谓;reason 短码→人话。TurnBanner.bannerLabel(7 单测)4(玩家)+2(旁观)态 + active 旗 aria-live。HitProgress 双 0–17 刻度条(role=progressbar)。

**(旁观,§7.1 review 建议)** myIdx==='observer' → 双盘客观只读:HitProgress 用 P0/P1 标签、TurnBanner/EventLog 客观称谓、不渲染 BattleStatus(无自动应答/开炮/claim)、SonarBoard 整盘 disabled。**功能版**静态色/点 + 功能性准星,无涟漪/脉冲/抖动/声呐扫描(M4)。

**(单测)** 新增 54 例:proofArgs(+5 toShotProofArg)、useCountdown(16)、battleMarks(12:标记优先级 + 禁点集 D11 + 不 mutate)、eventLogLines(14:翻面 + resolved defender 主语翻面 + observer + reason)、turnBanner(7)。web 271 → **325 全绿**;tsc/build 干净;**主 bundle snarkjs-free 维持**(grep index-*.js:8 个禁用符号全 0;worker chunk 含 groth16×4 + exportSolidityCallData×3——shot 证明在 worker)。root pnpm test:all 四包全绿(含 b-timeout claimTimeout 路径)。

**(browser 证据,单浏览器双账户,真 UI create→join)**:两局均经真 UI create→join(各 2 board 证明落正确 localStorage)。
- create→join→**无手动刷新自动进对战幕**;回合 + **视角翻转 0 RPC**(P1「等待对手开炮」+ 声呐 100 格 disabled ↔ 切 P0「轮到你开炮」+ 100 格可点,对手/视角/倒计时归属全翻)。
- 准星:hover F-6 → Crosshair overlay(data-coord=F-6,3 span)。开炮 + 乐观标记:P0 点 A-1(P1 船格)→ tx → 回合翻「等待对手应答 A-1」+ 该格 pending-out + 事件日志「我方开炮 A-1」(时间戳)。
- **自动应答(零手动点击)**:切 P1 → useAutoRespond 自动开跑 → ProofStatus(shot)→ respond → 回合翻;P1 OwnBoard A-1=hit、战损 1/17;切回 P0 声呐 A-1=hit disabled、对手战损 1/17——**同批事件两端「我方/对方」对称翻面**。
- **≥3 整回合**:A-1 命中 / J-10 未命中(战损不增)/ B-1 命中(P1 战损 2/17),每回合 auto-respond 自动、进度按命中累加、日志带时间戳、双盘双视角标记正确。
- **§10 reload 恢复**:P1 攻 H-8 → P0 owes;设 recentConnectorId=demo-p0 + reload → P0 起、H-8 owed → useAutoRespond **reload 后自动 re-fire** → H-8=miss、回合翻、resolved 事件时间戳为 reload 后。
- **claimTimeout(evm_increaseTime 穿越)**:+301+mine → 倒计时 00:00 expired(链时间 fix 生效);**P0 义务方无 claim 按钮**,切 P1 非义务方 → 「认领超时胜利」可点 → claimTimeout → GameFinished("timeout") → 自动进结算幕「你赢了」。
- **missing-board 大声失败(§8)**:清 P1 localStorage 棋盘 + reload(F-6 owed)→ **大声 blocked 横幅 role=alert** + OwnBoard 缺失提示——**绝不静默弃权**,未发 respond tx。
- fresh-load 0 console error(一次 HMR 期 hooks-order 报错仅热更新 useCountdown 加 hook 的过渡产物,clean load 不复现已验证)。demo 干净停(树杀 vite+anvil,8545/5173 释放)。

**文件**:新增 `src/components/board/{OwnBoard.tsx, SonarBoard.tsx, Crosshair.tsx, battleMarks.ts, battleMarks.test.ts}`、`src/components/{TurnBanner.tsx, HitProgress.tsx, EventLog.tsx, eventLogLines.ts, eventLogLines.test.ts, turnBanner.test.ts}`、`src/hooks/{useAttack.ts, useAutoRespond.ts, useClaimTimeout.ts, useCountdown.ts, useCountdown.test.ts}`;改 `src/lib/proofArgs.ts(+toShotProofArg)` + `proofArgs.test.ts`、`src/components/ProofStatus.tsx(+provingLabel/doneLabel 泛化,接受 AutoRespondStatus)`、`src/pages/Game.tsx(BattleAct 原位换全对战幕 + BattleStatus)`。复用 useGame/GameView、BoardGrid(isCellDisabled+overlay)、useProver、storage(loadBoard)、commitment(verifyBoardCommitment/toShotInputs)、ProofStatus、format、errors、abi、boardLogic——均 re-use,未重造。主线程 snarkjs-free(shot 证明在 worker)。

### 2026-06-14 Task 3.8 结算幕 + 持久化闭环 — FinishAct 战报 + PersistenceBanner 导入恢复 + Toast

真浏览器验收(pnpm demo + playwright,单浏览器双账户,真 UI create→join→对战→claimTimeout 结算)全程通过,全程 **0 console error**(仅 RR v7 future-flag warning)。Game.tsx 的 `FinishAct` 3.6 占位**原位替换**为完整结算幕;新增 PersistenceBanner(§8 守卫)+ Toast(§7.5/7.6 页内提示)+ clearInFlight(闭合 3.7 Rec 1)。

**(决策)战报派生为纯函数 `computeBattleReport(eventLog, view)`(`src/pages/battleReport.ts`,22 单测)。** 全部从 eventLog + view 派生,**无新链上读、无新乐观态**(纪律):
- `rounds` = **ShotResolved 事件数**(§4.2 每炮无论 hit/miss 都换边,一次 attack→respond 即一回合;pending[已 attack 未 respond]不计——尚未走完一回合)。
- 命中率**视角相对**:ShotResolved 的 `side` 是 defender(被打方),攻击方 = `1-defender`。`mine` = 攻击方===我的事件(fired/hits),`opponent` = 攻击方===对手的。`rate = hits/fired`,`fired===0 → null`(渲染「—」)。observer(myIdx 非 0/1)无「我方」立场 → rate 全 null。
- `durationSec` = 事件 ts 跨度(最早→最晚带 ts 事件)。**eventLog 无 GameCreated 项**(useGame 只回放 Joined/Fired/Resolved/Finished),故用日志内 ts 极值近似整局时长(通常最早 GameJoined、最晚 GameFinished);全无 ts → null。
- 最终命中数取 **view.myHits/opponentHits(链上 hits 真值)**,不从事件累加(回放不全时少算)。`finishReason` 取 eventLog 的 `finished.reason`(GameView 不带 reason,只在事件里)。
- 展示:`formatDuration`(mm:ss)、`formatRate`(%)、`reasonText`(视角相关:17hits 胜「全灭对手」/ 负「舰队被全灭」;timeout 胜「对手超时未应答」/ 负「你超时未应答」)。

**(决策)存储清理时机 = 进 finish 时(once),非「点再来一局」。** §8「Finished 后该键可清理」。`FinishAct` 挂载 effect(deps [id,address,isPlayer])→ `loadDeployment` 后 `removeBoard(chainId, contract, id, myAddress)`——**只清我自己的键、绝不碰对手的**。选「进 finish」而非「点按钮」:① 进结算后棋盘已不再需要(应答阶段已过,证明只在对战幕用);② **避免复用同一 gameId 的下一局误读陈旧棋盘**(3.4/3.5 stale-cross-session 教训)——若等用户点按钮、用户不点就留陈旧键。换账户(切对手视角)effect 重跑、各清各的键(实测:P1 视角进 finish 清 P1 键;切 P0 清 P0 键,两键各自清、互不越界)。**推论**:结算幕**不展示己方盘、不挂 PersistenceBanner**——棋盘已主动清,挂了反而恒报缺失自相矛盾;战报不依赖棋盘 ships/salt(只依赖事件 + 链上 hits),故清掉无碍。

**(决策)PersistenceBanner 检查范围 = 玩家(myCommitment 有值)且需本地棋盘的幕。** 挂载点:**对战幕**(应答必需棋盘)+ **p0-waiting**(P0 展示己方上锁盘);**不挂结算幕**(见上)。纯检查 `checkBoardIntegrity(chainId,contract,gameId,address,myCommitment,load)`(5 单测,注入 load stub 免 localStorage):myCommitment===undefined(observer/未连)→ ok(不守卫,横幅自隐 + 短路不读 storage);loadBoard 缺失 → {missing};`verifyBoardCommitment(ships,salt,myCommitment)` 不符 → {mismatch};对得上 → ok。横幅 role="alert"(--flare)点名后果(无法生成应答证明=超时判负)+ 导入入口。**导入双层校验**:① `importBoardJSON`(入口即 形状+validateBoard+verifyBoardCommitment,任一失败抛→ toast 具体诊断,**绝不存非匹配棋盘**);② 额外核 `rec.commitment === myCommitment`(importBoardJSON 只保证「ships/salt 自洽于文件里的 commitment」,不保证那 commitment 就是本局的——挡掉「导入别局的合法部署文件」,toast「该文件与本对局承诺不符」)。实测:导入 P0 的合法部署文件(承诺≠P1 本局)→ 被②挡,toast + 横幅留 + 不写盘;导入 P1 本局文件 → saveBoard + 横幅自隐。

**(决策)clearInFlight + useSyncExternalStore 释放信号 = 导入恢复无需重载(闭合 3.7 Rec 1)。** 3.7 的 useAutoRespond:棋盘缺失 → status='blocked' 且**保留 module 级 inFlight 占键**,文档恢复路径是「重载页面」。3.8 闭环:导出 `clearInFlight(chainId, gameId)`——按 `chainId:gameId:` 前缀清掉该局所有在途/阻断键,**并 emit 一个 module 级 releaseVersion**。光清 Set 不够(Set 增删不触发 React 重渲染,触发 effect 不会重跑,blocked 态一直挂——这正是「需重载」的根因);故每个 useAutoRespond 实例 `useSyncExternalStore` 订阅 releaseVersion,版本一变即重渲染、并把它列进触发 effect 依赖 → effect 重评估(shouldRespond 仍 true、键已释放、棋盘已 saveBoard 可读)→ runRespond 重跑 → **自动 re-fire 无需重载**。PersistenceBanner 导入成功后调 `saveBoard` → `clearInFlight` → `onImported()`(父级 reloadVersion+1 重读棋盘,OwnBoard 显出布局)。**实测**:P1 owes A-6 应答 + 清 P1 localStorage → 切 P1 → 横幅 + blocked → 导入 P1 文件 → `noReloadMarker` 不变(无重载)+ 横幅消失 + auto-respond re-fire → A-6 应答上链 → P1 战损 1/17、回合翻「轮到你开炮」。

**(决策)页内 Toast(§7.5/7.6,禁原生 alert)= 最小 ToastProvider + useToast。** 此前全仓无页级 toast。新增 `src/components/Toast.tsx`:Context + Provider(持 toast 列表,固定右下浮层渲染)+ useToast().show(msg, kind?)。error(--flare,role=alert,默认)/ info(--phosphor,role=status);自动 6s 消失 + ✕ 手动关(定时器在 effect 内、卸载清理);未包 Provider 时 useToast 返回 no-op 兜底(不抛)。包进 main.tsx(WagmiProvider→Query→Router→**ToastProvider**→App)。不引第三方库(一个错误浮层不值一个依赖,且与 7 token/直角纪律一致)。

**(视觉)功能版,无 M4 动画。** outcome 静态 accent(胜 --phosphor / 负 --flare / 取消 --mist 边框+标题色);**无** §7.3 整屏扫亮/染红动画(M4)。战报数字 font-mono(总回合/用时/双方命中率 Stat 块 + HitProgress 双 0–17 条 + EventLog 整局流水回看)。「再来一局」→ navigate('/')。Locked 7 token、直角 radius≤4px 维持。

**(单测)** 新增 27 例:battleReport(22:rounds=resolved 数 / pending 不计 / 命中率视角翻面[P0↔P1 mine-opponent 对调] / observer 无立场 / 用时跨度[min-max、部分缺 ts、全无 ts、单事件 0] / finishReason / formatDuration·formatRate·reasonText)、persistenceBanner(5:checkBoardIntegrity ok/missing/mismatch[承诺不符 + salt 篡改]/observer 短路不读 storage)。web 325 →(含 battleReport 22 + persistenceBanner 5)**352 全绿**;tsc/build 干净;**主 bundle snarkjs-free 维持**(build 后 grep `index-*.js`:groth16/snarkjs/ffjavascript/exportSolidityCallData/powersOfTau/wtns/plonk/fflonk **全 0**;worker chunk 含 groth16×4 + exportSolidityCallData×3)。root `pnpm test:all` 四包全绿(circuits/contracts/e2e[真 anvil+证明 A/B/C]/web)。

**(browser 证据,单浏览器双账户,真 UI)**:Battleship `0x9fe46…`,anvil 31337,P0 `0xf39F…2266` / P1 `0x7099…79C8`。游戏 #1 真 UI:P0 create(5 船 board 证明 + createGame)→ 切 P1 join(5 船 + joinGame)→ **无手动刷新自动进对战幕**。
- **§9.4 清空-恢复(关键新能力,无重载 re-fire)**:P0 开炮 A-6(P1 船格)→ P1 owes 应答;**清 P1 localStorage 棋盘键** → 切 P1 → **PersistenceBanner role=alert**(reason=missing,文案「本地棋盘缺失,无法生成应答证明(将超时判负)。请导入此对局的部署文件以恢复。」+ 导入按钮)+ useAutoRespond blocked 横幅 + OwnBoard 缺失提示(截图 38)。
- **wrong-file 拒绝**:导入 P0 的合法部署文件(承诺≠P1 本局)→ **toast「该文件与本对局承诺不符(可能是其它对局的部署文件)。」(role=alert)** + 横幅留 + **P1 键未写盘**(截图 39)。
- **正确导入 → 无重载 re-fire**:导入 P1 本局文件 → `window.__noReloadMarker` 恒=1(**无重载**)+ 横幅消失 + 成功 toast「部署文件已导入,棋盘已恢复。」+ **auto-respond 自动 re-fire**(clearInFlight 释放信号)→ A-6 应答上链 → P1 OwnBoard A-6=中弹、战损 1/17、回合翻「轮到你开炮」(截图 40)。
- **结算 + 战报(claimTimeout 路径)**:P1 攻 A-1 → P0 owes;evm_increaseTime +301 + mine → P1 倒计时 00:00 expired → P1(非义务方)「认领超时胜利」可点 → claimTimeout → GameFinished("timeout")→ **自动进结算幕**。P1 视角战报:**「你赢了」(phosphor accent)+「对手超时未应答」**、总回合 1、用时 mm:ss、我方命中率 —(0/0,A-1 未 resolved)、对手命中率 100%(1/1,A-6 hit)、双方战损 1/17 vs 0/17、「再来一局」(截图 41)。
- **账户切换结算翻面**:切 P0 → 同一局结算翻 **「对手获胜」(flare accent)+「你超时未应答」**(P0 是超时方)+ P0 战损 0/17。
- **存储清理**:进 finish 即清我的键——P1 视角进 finish 清 P1 键(P0 键仍在);切 P0 清 P0 键;**两键最终全清、对手键各自只由各自视角清**(不越界)。「再来一局」→ 落 `/`(作战大厅),game-1 的 bs: 键已全无(无 stale 残留给未来同 gameId 复用)。
- 全程 fresh-load **0 console error**(仅 RR v7 warning)。demo 干净停(树杀 vite+anvil,8545/5173 释放,「清理完成」)。

**文件**:新增 `src/pages/{battleReport.ts, battleReport.test.ts}`、`src/components/{Toast.tsx, PersistenceBanner.tsx, persistenceBanner.test.ts}`;改 `src/hooks/useAutoRespond.ts(+clearInFlight + useSyncExternalStore 释放信号)`、`src/pages/Game.tsx(FinishAct 原位换全结算幕 + Stat 小件;BattleAct/P0Waiting 挂 PersistenceBanner + boardReload 信号)`、`src/main.tsx(包 ToastProvider)`。复用 computeBattleReport·HitProgress·EventLog·storage(loadBoard/saveBoard/removeBoard/importBoardJSON)·commitment(verifyBoardCommitment)·format(shortAddr)·GameView/eventLog——均 re-use,未重造。主线程 snarkjs-free 维持。

### 2026-06-14 Task 3.9 收尾 — 错误呈现面策略 + reduced-motion 基线 + §9.4 手测全过 + 一个串号缺陷修复

M3 收尾。真浏览器(pnpm demo + playwright)跑完 §9.4 全 7 项,fresh-load **0 console error**(仅 RR v7 future-flag warning)。

**(决策 1)错误呈现面分界:瞬时 tx/动作错误 → 页内 Toast;§8 持久阻断 → PersistenceBanner(常驻 + 导入 CTA)。** §7.5/§7.6 要求失败用页内 toast(禁原生 alert)。3.8 已建 ToastProvider(此前只 PersistenceBanner 导入失败在用)。3.9 把瞬时 tx/动作错误接上 toast:
- `useAttack`(开炮 NOT_TURN/REPEAT/OOB/BAD_PHASE…)、`useClaimTimeout`(认领 NOT_TIMEOUT/NOT_CLAIMANT)、`useAutoRespond` 的**证明/respond tx 失败** → 各自 catch 内 `mapContractError(err)` 成人话后 `setStatus(error)` **并** `toast.show(msg,'error')`(新增 `fail()` 收口,一处置态+toast)。内联红字撤除:SonarBoard 的 `attack-error <p>`、Game.tsx 的 `claim-error <p>` 删除(toast 是主面);auto-respond 的 ProofStatus 只保留 proving/sending/confirming/done(§7.5 两阶段进度必须可见),**error 不再内联**(toast-only,避免与 toast 双重呈现)。
- **`useAutoRespond` 的 `blocked` 态(§8 棋盘缺失/承诺不符)绝不 toast**:那是**持续**阻断(必须导入恢复),toast 会自动消失;改由 Game.tsx 顶部常驻 `autorespond-blocked` 横幅 + PersistenceBanner(带导入 CTA)承载。这是「瞬时→toast、持久阻断→banner」的硬分界。
- **`useLockFleet` 维持内联 ProofStatus error**(锁定按钮旁,上下文相关,§7.5「lock 错误靠近按钮」),**不**toast(避免双面);proving 两阶段不变。
- 文案唯一来源仍 `mapContractError`(§7.6),绝不裸 revert 串。13 码映射的单测(errors.test.ts 24 例)已全覆盖;**§9.4 实测**:off-turn `attack` 真链上 revert → `mapContractError` 得「还没轮到你开炮…」(NOT_TURN);打已开炮格真 revert → 「这一格已经打过了…」(REPEAT);wrong-file 导入 → 页内 toast role=alert「该文件与本对局承诺不符…」;correct-file → info toast「部署文件已导入,棋盘已恢复。」——均真浏览器实测过。

**(决策 2)reduced-motion:M3 只建**基线 + 脚手架**,完整退化随 M4 动效落地。** §7.4 要求 reduced-motion 时扫描线停转、抖动取消、**保留颜色反馈**;但声呐扫描/涟漪/脉冲/抖动/结算扫屏全是 M4。故 3.9:
- **index.css 全局 `@media (prefers-reduced-motion: reduce)`**:即时完成现存 CSS **过渡**(transition-duration→0.01ms,如 FleetDock 的 transition-colors)。**刻意不 blanket 关 `animation`**——当前唯一 animation 是「在进行」spinner(animate-spin),它是功能性进度反馈且文案已同步表意,保留;且 CSS 无从判断哪条 animation 是装饰、哪条是功能,blanket 关会误伤 spinner。**颜色反馈(hit --flare / miss --phosphor·--foam)是着色非动效,本规则不碰,天然保留。**
- **新增 `useReducedMotion` hook**(`src/hooks/useReducedMotion.ts`,matchMedia + useSyncExternalStore 订阅,SSR/node 安全降级 false)+ 纯读取口 `getReducedMotionSnapshot`(7 单测)。**M4 的 sweep/ripple/pulse/shake 必须在 JS 侧 `useReducedMotion()` 为真时退化为静态**(它们是 animation 非 transition,不被 CSS 基线自动停)——这是有意分工:CSS 基线管过渡,hook 管 M4 装饰动效的条件渲染。实测:emulate reduced-motion → matchMedia.matches=true、300ms 过渡探针 computed=0.01ms、命中格仍 --flare、布局不破、app 全可用。

**(决策 3)§7.7 可见键盘焦点:index.css 全局 `:focus-visible` 基线(一处规则,免逐按钮)。** 大厅/对战/结算的按钮原先只吃浏览器默认焦点环(暗色低对比)。加一条 `:focus-visible { outline: 2px solid --phosphor; outline-offset: 2px }` 覆盖全部可聚焦元素;BoardGrid 格子另有更具体的内嵌环(utilities 层,晚于 base)→ 格子保留自己的 -2px inset 环,其它元素吃基线,二者同色一致。实测:create-game 按钮聚焦 computed outline = solid 2px rgb(53,224,200)。768/1280/1920 三档无横向溢出、<1024 棋盘上下堆叠、≥1024 并排(§7.2/§7.7)。

**(缺陷修复,§9.4 实测暴露)`useAutoRespond` 的 inFlight 去重键漏了应答方地址 → demo 单标签同坐标串号。** 旧键 = `chainId:gameId:x,y`。demo 双账户在**同一标签页**共用同一 module 作用域;P1 round1 应答 A-1 后按设计**不清键**(堵 respond 已上链未 refetch 的重发窗口),P0 round2 又被打**同一坐标 A-1** 时,其 `runRespond` 撞上 P1 残留的同坐标键 `31337:1:0,0` 被 `if(inFlight.has(key)) return` 静默跳过 → **P0 永不自动应答 → 假超时判负**。这是 §7.1/§9.4 一等场景(单标签双账户对打)的真 bug(生产分标签页本就不同 module 作用域、无碰撞)。修复:键加 **address 段** `chainId:gameId:address(小写):x,y`,两方各占各键;`gamePrefix`(clearInFlight 用)仍 `chainId:gameId:` 前缀,覆盖该局两方全部键不变。`flightKey`/`gamePrefix` 导出 + 7 单测(`useAutoRespond.test.ts`:同坐标异地址异键 / 同址同坐标同键 / 大小写归一 / gamePrefix 覆盖两方)。实测:reload 后 P0 对 A-1 立刻自动应答、3 整回合双向 auto-respond 全通。

**(单测)** 新增 `useReducedMotion.test.ts`(7)+ `useAutoRespond.test.ts`(7);web 352 → **364 全绿**;tsc/build 干净;**主 bundle snarkjs-free 维持**(build 后 grep `index-*.js`:groth16/snarkjs/ffjavascript/exportSolidityCallData/powersOfTau/wtns/plonk/fflonk **全 0**;worker chunk 含 groth16×4 + exportSolidityCallData×3)。root `pnpm test:all` 四包全绿(circuits/contracts/e2e[真 anvil+证明 A/B/C]/web)。

**(§9.4 手测全 7 项,真浏览器 pnpm demo + playwright,单标签双账户)**:Battleship `0x8a79…`,anvil 31337,P0 `0xf39F…2266` / P1 `0x7099…79C8`。
1. **布阵非法提示**:航母(len5)悬停 H-1 水平(出界)→ 仅在界 (7,0)(8,0)(9,0) 染 --flare、出界格不折行染 row1(3.5 修复保持)、点击 no-op(进度仍 0/5、航母仍手持)。✓
2. **锁定舰队全流程**:摆满 5 船(17 占格)→ 锁定舰队 → board 证明(亚秒)+ createGame → /game/1 上锁盘(17 ▦ disabled)+「🔒 已锁定·10×10·17 占格」+ 导出部署文件 + 等待「声呐搜索对手中…#1」+ localStorage 正式键写入。✓
3. **双账户互打三回合**:P1 join(摆 5 船 + R 旋转实测预览翻转 + joinGame)→ 无手动刷新自动进对战幕。R1 P0→A-1 命中、R2 P1→A-1 命中、R3 P0→J-10 未命中;每回合**自动应答零手动点击**、回合/进度/事件日志(带时间戳)/双盘双视角标记全对;视角切换翻转(P0↔P1 回合/对手/视角全翻)。✓
4. **hit 与 miss 动效(功能标记)**:hit = --flare 实心 `bg-flare/80` ✸;miss = `bg-console` ◦ 余晖点,双盘可辨。✓(动画是 M4)
5. **刷新恢复**:对战中 reload → 相位/双方命中(1/17)/坐标级 hit·miss 标记/己方盘轮廓全从链上+storage 恢复;另实测**欠应答 reload 后自动 re-fire**(P0 reload → A-1 自动应答)。✓(§10)
6. **清空 localStorage 警告 + 导入恢复**:清 P1 键 + reload → PersistenceBanner role=alert(reason=missing)+ 导入按钮;wrong-file(承诺≠本局)→ 拒绝 + toast「该文件与本对局承诺不符…」+ 键未写;correct-file → 键写入 + 横幅自隐 + info toast +「无重载」标记恒 1 + 己方盘轮廓显出。✓(注:playwright 的 file-chooser 不触发隐藏 aria-hidden file input 的 React onChange[工具侧 quirk],改用等价 `change` 事件派发真 File 跑同一 onFile 生产代码路径)
7. **reduced-motion 模式**:emulate `prefers-reduced-motion: reduce` + reload → matchMedia.matches=true、过渡探针 0.01ms、命中格仍 --flare、双盘+状态全在、布局不破、app 全可用。✓
**额外**:claimTimeout 全程(evm_increaseTime+301 → P1 义务方无按钮、P0 claimant「认领超时胜利」可点 → GameFinished → 自动进结算幕「你赢了·对手超时未应答·总回合3」+ 进 finish 清我方键 only)。crosshair 悬停 overlay(F-6,3 span)。0 console error(仅 RR v7);main snarkjs-free 再 grep 全 0。

**M3 DoD 达成**:三幕可玩(lobby→placement→battle→finish 全链路实测)/ §9.4 全 7 项过(证据如上)/ Worker 证明管线(board+shot,worker chunk snarkjs)+ 持久化(localStorage 正式键 + 导出/导入恢复 + §10 reload)+ 错误映射(13 码 → mapContractError → 页内 toast)就位。

**文件**:新增 `src/hooks/{useReducedMotion.ts, useReducedMotion.test.ts, useAutoRespond.test.ts}`;改 `src/styles/index.css(+reduced-motion 基线 + :focus-visible 基线)`、`src/hooks/{useAttack.ts, useClaimTimeout.ts, useAutoRespond.ts}(+useToast/fail 接 toast;useAutoRespond inFlight 键加 address + 导出 flightKey/gamePrefix)`、`src/components/board/SonarBoard.tsx(删 attack-error 内联)`、`src/pages/Game.tsx(删 claim-error 内联;auto-respond ProofStatus 排除 error 态)`。复用 Toast/useToast·mapContractError·ProofStatus·PersistenceBanner——均 re-use,未重造 M4 动效(只建 reduced-motion 脚手架 + 功能确认)。主线程 snarkjs-free 维持。

---

## M4 Task 4.1 —— 声呐屏签名扫描线 + 相位锁定余辉(§7.2 签名元素)

**(决策 1)余辉用「相位数学锁定」而非 rAF 逐帧命中测试。** §7.2 要求扫描线扫过标记格时该标记提亮再衰减。朴素解=每帧测扫描线角度、与各格 hit-test——昂贵且会漂移。改用:扫描层 WAAPI `rotate(0→360°)` period=8000ms 且 `anim.startTime=0` 钉到 `document.timeline` 原点 → 任意时刻前沿角 `R(t)=(t mod 8000)/8000·360` 是 wall-clock 的确定函数、与挂载时刻无关;每个 hit/miss 余辉跑同周期动画、峰值在关键帧 offset 0、`startTime=(θ/360)·8000`(θ=格中心方位角)。因 startTime 是共享时间轴**绝对**值,峰值恰落在 `R(t)=θ` 即前沿扫过该格的瞬间。**零 per-frame JS、零 setInterval、零漂移;晚挂载的新命中(对战中途 resolve)自动入相**(偏移对绝对时间轴算,非对挂载时刻)。

**(决策 2)角度约定单一来源:0°=正上、顺时针,与 CSS `conic-gradient(from 0deg)` 原生角一致。** `cellAzimuthDeg=atan2(dx,-dy)` 归一 [0,360)(dy 取负把屏幕 y-down 翻成上为正)。conic 0° 天然在 12 点、顺时针增,把亮前沿放 0° 刻度 → `rotate(R)` 后前沿屏幕角=R,与 θ 同零点同向,故 `R(t)=θ` 时前沿压在该格。几何抽纯模块 `sonarPhase.ts`(无 React/DOM)+ 14 单测钉死(四象限/对角 45·135·225·315°/范围/θ→startTime 线性映射)——本仓 node-env vitest 无 WAAPI,唯一能测也必须测的是这套映射(角度错则余辉在错误时刻亮、浏览器一眼可见)。

**(决策 3)三层 overlay 兄弟叠放,余辉由 marks 驱动不回查 DOM。** SonarBoard 的 BoardGrid `overlay` 槽 = `<SonarSweep/>`(常驻,§7.2「活的声呐屏」非仅我方回合)+`<SonarAfterglow marks={marks}/>`(逐 hit/miss 格,pending-out 不发光——§7.2 只点名 hit/miss)+`{isMyAttackTurn && <Crosshair/>}`(最后=最上,M3 准星零改动)。余辉读 SonarBoard 已算好的 marks、不回查 DOM → 纯、可控、reduced-motion 时整层 null。只动 transform(扫描 rotate)/opacity+drop-shadow(余辉),合成层友好。`SonarAfterglow` effect deps=`[glowKey,reduced]`(glowKey=hit/miss 格集的稳定字符串签名)→ 仅命中集真变或 reduced 切换才重建动画,其余渲染零打断相位;WAAPI 全在 cleanup `cancel()`(HMR/卸载无泄漏)。

**(决策 4)reduced-motion 在 JS 侧 gate(承接 M3 决策 2 分工)。** `useReducedMotion()` 为真:扫描不创建旋转动画(静止 conic 层留存)、余辉整层 null;hit/miss 的**颜色反馈**(BoardGrid 静态 `bg-flare/80` ✸ / `bg-console` ◦)是着色非动效,天然保留。false↔true 实时切换由 effect deps 含 reduced 收口(cancel/recreate)。颜色不新增:conic/drop-shadow 的 `rgba(53,224,200,α)`/`rgba(255,122,69,α)` 是 --phosphor/--flare 同色变 alpha(非新调色板项;DRY 跟进留 4.3)。

**(浏览器实证,pnpm demo + playwright,确定性相位核验)** demo 链 31337、Battleship `0x9fe4…a6e0`;种子脚本(e2e lib 真证明直打合约)造 P0 声呐 hit@A-1(方位 315°)+ miss@C-1(330.95°)、终局 P0 回合。`getAnimations()` 实读:扫描 `startTime=0`/running/dur8000;hit 余辉 `actualStartTime=7000`==期望(315/360·8000)、底色 `rgb(255,122,69)`=--flare;miss `7354.34`==期望、底色 `rgb(53,224,200)`=--phosphor——**精确吻合**。冻帧 R=315°(currentTime=7000)截图:亮前沿精确指左上 A-1、命中余辉峰值点亮(opacity 1)、miss 暗相(opacity 0)——**视觉零偏移**。准星 hover G-7 与扫描/余辉三层共存(无回归)。两轮 opus 审查(规格独立重推几何一致 ✓ / 质量 Ready-to-merge,WAAPI 无泄漏·闭包-deps 实为正确)。

**文件**:新增 `src/components/board/{sonarPhase.ts, sonarPhase.test.ts, SonarSweep.tsx, SonarAfterglow.tsx}`;改 `SonarBoard.tsx`(overlay 三层叠放)。web 364→**378 全绿**(+14 sonarPhase);tsc -b + vite build 干净。commit `8bde994`。

---

## M4 Task 4.2a —— 棋盘事件反馈(命中脉冲/落空涟漪/容器抖动,§7.3 一次性动效)

**(决策 1)一次性反馈由「新落标记」驱动,承重不变量=刷新不重放。** 标记来自链上 ShotResolved,刷新重进时整局历史 hit/miss 会被 GameView 重放进 marks。若挂载时全部 ripple/pulse=每次刷新一片乱闪。正确语义:维护「已见格」集合,**首渲染惰性播种为当时 marks 的全部可触发格**(历史直接进 seen、永不触发),此后每渲染 `newlyResolved(seen, marks)` 取真正新格、各放一个自卸载 WAAPI 元件再并入 seen。纯增量(`shotBurst.ts: newlyResolved/burstableCells/isBurstKind`,不 mutate 入参)抽出 + 13 单测钉死(mount→0、单个新格恰一次、pending-out/in 不触发、刷新语义、pending→resolved 生命周期)。渲染层 `ShotBurst.tsx` 是其薄壳(seenRef + markKey 稳定签名作 effect dep,同 4.1 afterglow 的 glowKey 法)。

**(决策 2)动效具体:miss 涟漪(--foam 描边环 scale+opacity 一次)、hit 脉冲(--flare 实心 scale+opacity+drop-shadow)、hit 抖动(`useBoardShake`:容器 translateX 0→+2→-2→+1→0,120ms,§7.3 verbatim「120ms 横向 2px」)。** 抖动判「新命中」**不另立 seen-set**——由 ShotBurst 的 `newlyResolved`(唯一真相源)经 `onHit` 回调驱动父级 `shake()`,避免两套已见格分叉。抖**容器**(包 BoardGrid 的 wrapper,不改 BoardGrid 契约)。"白色涟漪"用 --foam(#C8D8DC,白不在 7 色锁定调色板;最浅 token 达观感守纪律)。"持续低频闪烁火点"=声呐屏 4.1 SonarAfterglow(每 8s 扫过提亮=低频闪烁),**不新增持续动效**;OwnBoard(无扫描)hit 留静态 --flare。双盘对称(SonarBoard 我打敌 / OwnBoard 敌打我)。全 transform/opacity/filter,WAAPI cleanup,reduced-motion 全 gate(不放任何一次性动效,但**仍把新格并入 seen**——避免开启动效那刻历史补爆;颜色反馈由 BoardGrid 静态着色保留)。

**(缺陷修复,浏览器验收暴露)demo 账户切换误爆。** §7.1 招牌:P0↔P1 同标签切换=`useGame` 对 address 纯重派生、0 RPC(fetch effect deps **故意排除 address**)。但切换只让 view 重算、**不 remount** SonarBoard/OwnBoard;ShotBurst 的 seenRef 仍持旧视角已见格,新视角历史 shots 落在不同格 → `newlyResolved` 判为「新」→ 切换瞬间一片误爆。**浏览器实证**:装 `[data-burst]` MutationObserver,P0→P1 切换触发 2 个 spurious burst(own+sonar 各 1 miss)。修复(commit e4e4ea1):BattleAct 把 `perspectiveKey={address ?? 'none'}` 线程给双盘,各盘 `<ShotBurst key={perspectiveKey}>` ——**只 remount ShotBurst**(M4.1 sweep/afterglow 相位与 BoardGrid roving 焦点不受扰),重挂即用当前(新视角)marks 重新播种 seen → 切换 0 爆;切后真新事件照常爆。`switchAccount` 是两个已连 connector 的 current 指针翻转,address 直接 P0→P1 不经 undefined,`?? 'none'` 仅全断连时启用(故无 undefined 抖动误 remount)。

**(浏览器实证,修复后复验)** 切换双向(P1→P0→P1)**0 burst**(修复前 2);refresh 0 burst(原子 snapshot+shots+isLoading 提交,BattleAct 首渲染 marks 必齐→播种可靠);真 live 事件(脚本作 P1 应答 P0 的 B-1 攻击=命中)→ 恰 **1 个 sonar hit 脉冲**(+onHit→抖动)触发。两轮 opus 审查(规格 ✅ 合规无越界 / 质量 Ready-to-merge,无 critical/important;唯一 minor=一处过时注释已修)。

**文件**:新增 `src/components/board/{shotBurst.ts, shotBurst.test.ts, ShotBurst.tsx}`、`src/hooks/useBoardShake.ts`;改 `SonarBoard.tsx`/`OwnBoard.tsx`(overlay 接 ShotBurst + shake wrapper + perspectiveKey)、`Game.tsx`(BattleAct 传 perspectiveKey)。web 378→**391 全绿**(+13);tsc -b + vite build 干净。commit `4a1dfbf`(feat)+ `e4e4ea1`(fix)。

---

## M4 Task 4.2b —— 编排过渡(横幅滑入 / 上锁过渡 / 结算扫屏,§7.3-7.4)

**(决策 1)三种过渡按机制分工:横幅/上锁用 CSS @keyframes,结算用 WAAPI。** 横幅滑入与上锁settle是「挂载/重挂即播一次、无运行期分支」→ CSS keyframes 最轻;结算扫屏需按 outcome 运行期分支(胜 phosphor / 负 flare / 取消 none)+ fill 因支异(负 forwards 持留低亮、胜 none 落回常态)+ 受 useReducedMotion() hook 值 gate → 正是 WAAPI-in-effect(同 SonarSweep/ShotBurst)的用武之地。强求统一两边都更差。

**(决策 2)reduced-motion:CSS keyframes 必须包在 `@media (prefers-reduced-motion: no-preference)` 里。** index.css 的全局 reduce 基线只把 `transition` 归零,**不停 `animation`**。故新增的 banner-slide-in/lock-board-settle/lock-banner-in 三个 keyframes 连同其 .anim-* 类全定义在 no-preference media 内 → reduce 用户拿到类但无 keyframe 定义 → 浏览器忽略 animation → 即时落到末态(文字/锁/outcome 色全在,§7.4「保留颜色反馈」)。结算 WAAPI 由 `useReducedMotion()` gate(reduce→不 animate)。

**(决策 3)横幅滑入触发=`key={text}` 重挂内层 `<p>`。** text 变(回合切换)→ React 重挂 `<p>` → CSS animation 在新元件上重播。`bannerLabel` 里每个 text 串与 active 一一对应,故「仅 active 变色不改 text」不会误触发;`aria-live="polite"` 在**稳定的外层 div**(非 keyed 的 `<p>`),重挂子节点仍被 live region 播报。**(决策 4)结算「整屏」=outcome 面板**(结算幕无声呐屏);accent→sweep 种类经纯函数 `finishSweepKind`(已单测)映射(phosphor 胜/flare 负/mist 取消→none),三色同源。负末态 `brightness(0.9)` 用 fill:forwards 持留(§7.3「熄灭为低亮度」仍可读)。

**(浏览器实证,pnpm demo + playwright)** demo 链 game 1:① 横幅——MutationObserver 抓 turn-banner 内新 `<p>`:开炮触发回合切换 → 新 `<p>` 带 **running** `banner-slide-in`/`0.18s`(currentTime 0 刚起),aria-live=polite 在父级。② 结算——种子超时胜终局(P0 攻一炮 + evm_increaseTime 301 + P0 claimTimeout)→ 进结算幕 headline「你赢了」accent=phosphor;monkey-patch `Element.prototype.animate` 跨客户端导航(大厅输入1加入)重进 FinishAct,捕获 outcome 面板 animate:duration **720**、fill `none`、首帧 `brightness(1) drop-shadow(rgba(53,224,200,0))`=磷光扫亮(胜)。willChange 实测为 'auto'(review 修复:从常驻改为 effect 内随动画挂/清)。③ 上锁settle=与横幅同 CSS-keyframe-no-preference 机制(已证)+ 双审查覆盖。两轮 opus 审查(规格 ✅ 合规无越界 / 质量 Ready-to-merge,唯一 minor=willChange 常驻已修)。

**文件**:新增 `src/pages/{finishSweep.ts, finishSweep.test.ts}`;改 `src/styles/index.css`(3 keyframes + .anim-* 全在 no-preference media)、`src/components/TurnBanner.tsx`(key={text}+.anim-banner-slide)、`src/components/PostLockPanel.tsx`(.anim-lock-settle 盘 + .anim-lock-banner 锁条,两 wrapper 防 scale 耦合)、`src/pages/Game.tsx`(FinishAct WAAPI 扫屏 + willChange scoped)。web 391→**394 全绿**(+3 finishSweep);build 干净。commit `9b78b41`(feat)+ `002c394`(review fix)。

---

## M4 Task 4.5 —— 响应式布局(§7.2/§7.7)

**修复:BattleAct <1024px 堆叠时「己方在下」。** 此前三列仅中缝带 order-first、己方/声呐无 base order → 按 DOM 源序堆叠为 中缝→己方→声呐,己方排在**中间**,违反 §7.2「<1024px 上下排列,己方在下」。显式给三列各加 mobile base order(中缝 order-1 顶 / 声呐 order-2 / 己方 order-3 底),`lg:order-*` 桌面三列(己方|中缝|声呐 并排)保持不变。仅改 Tailwind order 类——**不动 320px 固定棋盘**(M4.1 扫描 / M4.2a 爆发覆盖层按 px 对齐到 320px 格阵,棋盘流式化会让动效漂移脱格;响应式=堆叠重排而非缩盘)。

**实证(Playwright,我方独立复测)**:800px → 状态(top 273)→ 敌方声呐(762)→ 己方(1146),`own.top>sonar.top` 己方在底 ✓、无横向溢出、盘宽固定 340px(320+轴 gutter);1440px → 己方(left 168)/声呐(left 932)同高(297)并排、己方在左 ✓、无溢出。实现者另验 768/1280/1920 全幕(battle/placement/postlock/join/finish/lobby)无溢出 + `:focus-visible` 2px --phosphor 焦点环(§7.7)。web 394 绿、build 净。commit `ecaef97`。**因系纯 CSS-order 微改 + 直接 DOM 测量验证(布局序改动测量即权威),跳过 subagent 双审查(相称)。**

**留给 4.4 的 a11y 项**:CSS `order` 只重排视觉、DOM/SR/tab 序仍 中缝→己方→声呐。视觉序(状态→声呐→己方)与 tab 序在 <lg 不完全一致(WCAG 2.4.3 焦点序——但 tab 序「状态→己方→敌方」语义合理,非乱序)。4.4 a11y 评估是否需 DOM 重排;当前判定 §7.2 是视觉堆叠要求,CSS order 满足即可。

---

## M4 Task 4.4 —— reduced-motion 完整化 + a11y + Lighthouse≥90(§7.4/§7.7 DoD)

本任务以**验证为主、最小修复**:M4 全部动效各自已 gate,逐项跑活、确认整套在 `reduce` 下正确退化;a11y 复核 M3 棋盘格 + 焦点环;Lighthouse 可访问性达标。唯一代码改动是**一枚 token 因 WCAG AA 上调亮度**(计划已预授权)。

**(决策 1)`--mist` 提亮 #5A7484 → #6E8A9C(§7.7 WCAG AA 实测,计划预授权的唯一 token 调整)。** 实测(WCAG 相对亮度):原 #5A7484 对**正文**在 --abyss=3.88:1 / --console=3.55:1 / --grid=2.43:1,**全部 < 4.5:1 不达标**。关键判定:本站 `text-mist` **全部**用于 10–14px 小字(`text-[10px]`/`text-[11px]`/`text-xs`=12px/`text-sm`=14px),按 WCAG「大字」门槛(≥18.66px 粗体 / ≥24px 常规)**无一够格**→ 一律按**正文 4.5:1** 判,而非 3:1。故必须调。提亮到 #6E8A9C:--abyss **5.26:1**、--console **4.81:1**(均过 4.5:1 留余量;最小擦线值 #6E8593 console 仅 4.53 太险,故取 #6E8A9C),仍是克制的「次级文字」灰蓝。§7.2 七色基调与其余六枚 token 不动;Design.md 调色表同步加注 AA 缘由。其余文字色实测全过:--phosphor(abyss 11.5 / console 10.5 / grid 7.2)、--foam(13.0 / 11.9 / 8.1)、--flare(7.4 / 6.8 / grid 4.62)均 ≥4.5。注:`--mist` 仅在 abyss/console 上做正文(已达标);唯一与 grid 接触是 AccountSwitcher 未激活键 `hover:bg-grid`(mist-on-grid 约 3.3:1)——transient hover、axe 只查静止态不报,留置。无单测 pin `5A7484`(仅 index.css token 定义本身),故零测试改动。

**(决策 2)reduced-motion 整套退化——活验证全过,无需补 fallback。** Playwright `emulateMedia({reducedMotion:'reduce'})` 在对战页(game 1)实测:声呐扫描 `getAnimations()` 1→**0** 条、`animation-name:none`;余辉层 `[data-testid=sonar-afterglow]` **不渲染**(glow 元件 2→0);`[data-burst]`=0;回合横幅 `<p>` `animation-name:none` 文案「轮到你开炮」**留存**;全文档 `document.getAnimations()` 运行中=**0**;hit/miss 标记静态色保留。结算页(finished game)`[data-testid=outcome]` `getAnimations()`=0、willChange=auto、headline「你赢了」+accent=phosphor 留存。**反向**(reduce→no-preference)扫描 0→1 复转、余辉复渲染 → 证 `useReducedMotion()`(useSyncExternalStore)**实时双向**响应。index.css 的 reduce 基线(零化 transition)+ 各组件 JS gate + 三 keyframe 包 no-preference media,三者合起来已**完整覆盖**,未发现泄漏,**未加任何新 CSS**。

**(决策 3)a11y 复核——M3 棋盘格契约完好,焦点环全覆盖,零改动。** 活验证:两盘各 100 个真 `<button role=gridcell>`、容器 `role=grid`;**roving tabindex** 每盘恰 1 个 `tabindex=0`(余 -1),方向键 B-1→↓B-2→→C-2 走位正确且跳禁用格(已开炮格 disabled+aria-disabled);aria-label 含坐标+态(「A-1 命中」「C-1 未命中」「B-1 未探测,点击开炮」「E-5 海域」),读得通。真键盘 Tab 走查 7 个停靠点(标题链接→P0→P1→导入→作战记录区→棋盘单格→返回大厅)**每个**命中 `:focus-visible` + 2px --phosphor 焦点环(格用 -2px inset 环,余吃 index.css 基线),棋盘整体只占**一个** Tab 停靠(roving 生效)。

**(决策 4)M4.5 焦点序(WCAG 2.4.3)——判定可辩护,保留 DOM 序不重排。** BattleAct DOM/tab 序恒为 状态→己方→敌方(CSS `order` 只改视觉不改 DOM/tab);<1024px 视觉为 状态→敌方→己方,与 tab 序差一个「己方/敌方」对调。判定**留置**:① tab 序「控制→我方防务→我方攻击」本身是连贯叙事,2.4.3 只要求焦点序「保持意义与可操作性」、**不**要求逐像素对齐视觉;② 两盘均有清晰 aria-label + 各为单 roving 停靠,无陷阱/跳格/操作性损失;③ 重排 DOM(随 resize JS 重排或复制标记)是为「非违规」过度工程。延续 M4.5 注的初判,现以活 tab 走查佐证。

**(Lighthouse,真跑 v13.4.0 headless)** 对战页 **/game/1**(种子 demo-seed:game1 P0 回合,声呐 hit=(0,0) miss=(2,0))=**可访问性 100/100**,0 失败 / 27 通过(含 color-contrast、button-name、aria-required-children/parent、tabindex、target-size、aria-valid-attr-value、landmark-one-main…);大厅 **/**=**100/100**,0 失败 / 19 通过(含 color-contrast、label、link-name)。均远超 ≥90 DoD;color-contrast 通过即决策 1 的 --mist 提亮生效佐证。(注:chrome-launcher 在 Win 收尾删临时 Chrome profile 抛 EPERM,发生在**审计之后**、不影响已落盘报告,score 读取正常。)

**文件**:改 `src/styles/index.css`(--color-mist #5A7484→#6E8A9C + AA 注释)、`Design.md`(调色表 --mist 值 + AA 缘由)。**无新代码、无新组件**(纯验证 + 一 token 微调)。web **394 全绿**(无测试 pin 旧 hex,零改动);tsc -b + vite build 干净。commit `aff73b8`(同步 SHA 见随后 docs 提交)。

**控制器复验建议**:① `pnpm demo` 后浏览器 DevTools 切 emulate prefers-reduced-motion → 对战页扫描线停、余辉灭、横幅不滑,色/字在;② 真跑 `npx lighthouse http://localhost:5173/game/1 --only-categories=accessibility`(种子见 demo-seed)复核 ≥90;③ 目视 --mist 次级文字在深底可读(对战页倒计时标签 / EventLog 时间戳 / 大厅地址)。
