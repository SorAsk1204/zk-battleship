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
