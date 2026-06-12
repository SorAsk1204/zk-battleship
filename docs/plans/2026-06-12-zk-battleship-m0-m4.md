# ZK Battleship(链上海战棋)M0–M4 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `D:\cc-workspace\battleship\Design.md` 规格书,从零搭建双人链上海战棋:布船以 Poseidon 承诺上链,每炮应答附 Groth16 零知识证明,合约裁判胜负,前端为"冷战声呐作战室"风格的完整三幕流程。

**Architecture:** pnpm workspace monorepo,四个包:`circuits`(circom + snarkjs,两电路 board/shot,**兼任 JS 真理源 boardLogic 的宿主**)、`contracts`(Foundry,单合约 + 两个改名后的 snarkjs verifier)、`web`(Vite + React 18 + Tailwind v4 + wagmi v2,证明在 Web Worker 生成)、`e2e`(Node 双代理脚本,真实证明 + Anvil)。

**Tech Stack(版本经 npm registry 实查,2026-06-12):**
circom 2.1.9(已装,脚本断言版本)· snarkjs **0.7.6 全仓精确锁定** · circomlib 2.0.5 · circom_tester 0.0.24(仅 wasm_tester)· poseidon-lite 0.3.0 · circomlibjs 0.1.7(仅测试)· solc 0.8.28(pragma ^0.8.24)+ forge-std · react 18.3.1 · vite ^7 · tailwindcss ^4.3 + @tailwindcss/vite · **wagmi ^2.19.5**(v3 已出但锁 v2,见裁决 D8)· viem ^2.52 · @tanstack/react-query ^5 · zustand ^5 · react-router-dom ^6 · @fontsource/{chakra-petch,inter,ibm-plex-mono} · mocha+tsx · execa ^9 · tree-kill

**平台约束:** Windows 11。所有脚本一律 Node(tsx),零 bash;仓库路径不得含空格(见 Windows 纪律节)。

---

## Context

- `D:\cc-workspace\battleship` 目前只有 `Design.md`,greenfield,**尚未 git init**。
- 规格书 §0:计划确认后按里程碑顺序执行,**每个里程碑 DoD 全满足并向用户展示验收证据(测试输出/截图)后才进下一个**。
- **锁定项(不可改)**:游戏规则 §4、密码学方案 §5、合约对外接口 §6.3、视觉方向 §7.2。
- **禁止**:放宽约束过测试;证明生成放主线程;假进度条/原生 alert;M1 后遗留 mock verifier。
- 本计划由 4 个并行规划 agent(电路/合约+e2e/前端/生态事实核查)+ 1 个评审 agent 产出并裁决冲突;关键生态事实(verifier 模板签名、publicSignals 顺序、ptau 地址、wagmi/Tailwind 版本)均经源码/registry 实查。
- 清理项:执行开始时删除规划残留文件 `C:\Users\Ask\.claude\plans\sunny-bubbling-bear-agent-a202b0645921603b7.md`(subagent 副产物);本计划副本入库到 `battleship/docs/plans/`。

---

## 0. 关键裁决(D1–D14,M0 时写入 DECISIONS.md)

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

---

## 1. 跨包接口契约(变更必须同步所有消费方)

**publicSignals 布局**(r1cs 规范:wire 顺序 = 输出在前、公开输入在后,各按声明序;M1 用 S6 测试 + fixture 自检钉死):
- board:`[commitment]`,verifier N=1
- shot:`[result, commitment, tx, ty]`,verifier N=4 —— 合约三项绑定:`[1]==存储承诺`、`[2]==pendingX`、`[3]==pendingY`,`[0]` 为采信结果

**verifier**:snarkjs 0.7.6 导出合约名固定 `Groth16Verifier`、签名 `verifyProof(uint[2] _pA, uint[2][2] _pB, uint[2] _pC, uint[N] _pubSignals) public view returns (bool)`(模板实查,自带 pubSignals < r 域检查);导出脚本做文本替换改名 `BoardVerifier`/`ShotVerifier` 写入 `packages/contracts/src/verifiers/`。

**Poseidon 承诺**:输入顺序 `[x0,y0,d0,...,x4,y4,d4,salt]` 共 16(circomlib Poseidon 上限恰 16,t=17);唯一实现 `encoding.ts: computeCommitment()`(poseidon-lite/poseidon16,同步纯 JS);circomlibjs 仅作测试第三方互证。salt = `crypto.getRandomValues` 16 字节 ≥128bit。

**证明 calldata**:`BoardProof{a,b,c,pubSignals[1]}` / `ShotProof{a,b,c,pubSignals[4]}`;格式化唯一走 `formatProofCalldata()`(D3)。

**产物路径**:circuits `artifacts/{board,shot}/` → `sync-web.ts` 拷到 `web/public/zk/`(web predev/prebuild 钩子调它,**不另写拷贝脚本**);e2e 经 `@zk-battleship/circuits/node` 的 `artifactPaths` 直读。

**localStorage**:键 `bs:{chainId}:{contract}:{gameId}:{address}`,值 `{ships, salt, commitment, version:1}`(bigint 一律 hex 字符串);createGame 前先写 `…:pending:{address}` 键,收据拿到 gameId 后迁移正式键(防"交易上链了但本地没存"窗口);导出文件 = 同一 JSON。

**Worker 协议**:
```ts
// main → worker
type Req = { id:number; type:'preload'; circuit:'board'|'shot' }
         | { id:number; type:'prove'; circuit:'board'|'shot'; inputs:Record<string,string|string[]|string[][]> }
// worker → main(progress 阶段全部真实:fetch-wasm/fetch-zkey/witness/prove,禁假进度)
type Res = { id:number; type:'progress'; stage:'fetch-wasm'|'fetch-zkey'|'witness'|'prove'; loaded?:number; total?:number }
         | { id:number; type:'done'; proof:Groth16Proof; publicSignals:string[] }
         | { id:number; type:'error'; message:string }
```

---

## 2. 仓库结构(最终形态)

```
battleship/                      # git init 于 M0
├── Design.md  DECISIONS.md  README.md
├── docs/plans/                  # 本计划副本
├── pnpm-workspace.yaml  package.json(test:all/demo)  .gitignore  .npmrc
├── scripts/demo.ts
└── packages/
    ├── circuits/
    │   ├── board.circom  shot.circom  common.circom(ValidShip/InShip 共享模板)
    │   ├── lib/          # boardLogic.ts encoding.ts salt.ts proof.ts node.ts index.ts(真理源,D2)
    │   ├── scripts/      # compile.ts ptau.ts setup.ts export.ts sync-web.ts(全 tsx)
    │   ├── test/         # mocha+circom_tester: board.test.ts shot.test.ts lib.test.ts
    │   ├── build/ ptau/  # gitignore
    │   └── artifacts/    # 提交 git:{board,shot}/{*.wasm,*_final.zkey,vkey.json} + manifest.json
    ├── contracts/
    │   ├── foundry.toml(solc=0.8.28, ffi=false)  package.json(fixtures/test/snapshot scripts)
    │   ├── src/Battleship.sol  src/verifiers/{Board,Shot}Verifier.sol(生成物,提交)
    │   ├── script/Deploy.s.sol
    │   └── test/  # fixtures/generate.ts(→ProofFixtures.sol,gitignore) BattleshipHarness.sol
    │              # StateMachine.t.sol BindingAttacks.t.sol Timeout.t.sol Invariants.t.sol Gas.t.sol
    ├── web/
    │   ├── public/zk/(gitignore)  public/deployment.json(gitignore)
    │   └── src/{pages,components,components/board,workers,hooks,lib,styles}(职责清单见 M3)
    └── e2e/src/{lib/{anvil,deploy,boards,assert}.ts, a-full-game.ts, b-timeout.ts, c-cancel.ts, run-all.ts}
```

---

## M0 脚手架(DoD:空产物全 build 通过;`pnpm test:all` 骨架可跑)

> 评审纠偏:forge init 与 Vite 空壳原被排到 M1/M3,导致 M0 DoD 字面不可达、M2 demo 依赖倒置——全部前移至此。

### Task 0.1 git init + monorepo 根
- [ ] `git init`(circuits artifacts 提交与 forge-std submodule 都以仓库存在为前提,**第一批动作**)
- [ ] 根 `package.json`(scripts: `test:all`、`demo`)、`pnpm-workspace.yaml`、`.gitignore`、`.npmrc`(锁默认 node-linker,防有人改 hoisted 破坏 circom -l 的 junction 布局)
- [ ] `DECISIONS.md` 初始化:写入 D1–D14
- [ ] 本计划副本入 `docs/plans/2026-06-12-zk-battleship-m0-m4.md`;删除残留文件(见 Context)
- [ ] Commit

### Task 0.2 circuits 包骨架 + lib 真理源(尽早做,解锁 web/e2e 并行)
- [ ] `packages/circuits/package.json`:名 `@zk-battleship/circuits`,exports 双入口(D2),依赖按 Tech Stack 钉死
- [ ] `lib/` 全量:`boardLogic.ts`(SHIP_LENGTHS=[5,4,3,3,2]、shipCells/validateBoard/occupancyGrid/isHit,坐标 idx=y*10+x)、`encoding.ts`(encodeShipsForHash/computeCommitment/toBoardInputs/toShotInputs)、`salt.ts`、`proof.ts`(formatProofCalldata,D3)、`node.ts`(proveBoard/proveShot/artifactPaths)
- [ ] `test/lib.test.ts`:boardLogic 纯 JS 单测(合法/重叠/越界/贴边/isHit 抽样)→ **先跑红再实现**,mocha 配置 `--import=tsx --timeout 120000 --exit`(--exit 防 snarkjs curve worker 挂住进程)
- [ ] 运行 `pnpm -F @zk-battleship/circuits test` → 绿;Commit

### Task 0.3 证明管线脚本 + smoke 电路全链路(Windows 全管线最早暴露点,必须保住此顺序)
- [ ] `scripts/compile.ts`:断言 `circom --version`==2.1.9;`execFile` 数组传参(绕 Windows 引号坑);参数 `--r1cs --wasm --sym -o build/<n> -l node_modules`;打印约束数,board >50k 报错停下(§2)
- [ ] `scripts/ptau.ts`:读 r1cs 约束数 → 自动选 power → 缺则下载(D7)流式写盘
- [ ] `scripts/setup.ts`:`zKey.newZKey` 直出 final zkey + exportVerificationKey;**双次 setup 比对 sha256 实证确定性(D6)**,结果记 DECISIONS.md
- [ ] `scripts/export.ts`:exportSolidityVerifier → 文本替换改名 → 写 contracts/src/verifiers/;拷 wasm/zkey 到 artifacts/;生成 manifest.json(sha256+版本+约束数+ptau power);脚本结尾 `process.exit(0)`(snarkjs worker 不退出坑,所有脚本同此)
- [ ] `scripts/sync-web.ts`:artifacts/ → web/public/zk/
- [ ] 写 ~10 约束 `smoke.circom`,全链路跑通:compile → pot12 下载 → setup → verifier 导出改名 → manifest;mocha smoke 测试(witness 通过)
- [ ] Commit(smoke 产物不留)

### Task 0.4 contracts 包骨架
- [ ] `forge init`(清掉模板文件)+ `forge install foundry-rs/forge-std` + `foundry.toml`(solc=0.8.28, ffi=false, fmt 配置)
- [ ] 占位 `Battleship.sol`(空合约)→ `forge build` 过;Commit

### Task 0.5 web 包空壳
- [ ] create-vite(react-ts)接入 workspace;Tailwind v4 + `@theme` 七色 token + `--color-*: initial`(D13)+ fontsource 三字体;react-router 三页空壳(Lobby/Game/404)
- [ ] `pnpm -F web build` 过;Commit

### Task 0.6 e2e 骨架 + test:all 串联
- [ ] `packages/e2e` 骨架(viem/execa/tree-kill 依赖)+ 占位 run-all.ts
- [ ] 根 `test:all` = circuits test → contracts forge test → e2e 占位,完整跑通
- [ ] **向用户展示 M0 验收证据**(`pnpm test:all` 输出 + 目录树),确认后进 M1

---

## M1 密码学与合约(DoD:两电路+单测全绿;verifier 导出;§9.2 全绿 + gas snapshot)

> 跨包关键路径:contracts 骨架(M0 已备)→ circuits 电路+测试+导出(写 verifier 进 contracts)→ contracts 实现+fixtures+测试。

### Task 1.1 common.circom(ValidShip / InShip)
- [ ] 按 §5.2 锁定写法实现:ValidShip(len) = Num2Bits(4) 域检查 + LessEqThan(4) ≤9 + dir 布尔 + `endX = x+(1-dir)*(len-1)` 界内;InShip(len) = IsEqual + GreaterEqThan/LessEqThan(4) 构造布尔指示值,`out = horiz + dir*(vert-horiz)`
- [ ] **比较器健全性要点(注释写明)**:位宽 n=4 的前提是输入已被 Num2Bits(4) 约束 <16(最大 x+len-1=13);LessThan 系输入超 n bit 时不健全

### Task 1.2 board.circom + 编译
- [ ] 按 §5.2 实现:5×ValidShip + 100 格 ×5 舰 occ 求和 + `occ*(occ-1)===0` + Poseidon(16)(顺序 §5.1,salt 在 inputs[15])
- [ ] `pnpm -F circuits compile` → 打印约束数(预估 17–18k;>50k 触发 §2 停下重审,备用降级:按行/列提升比较器,注释留方案不实现)

### Task 1.3 test/board.test.ts(B1–B9)
- [ ] B1 合法布阵 assertOut(commitment) == lib computeCommitment(poseidon-lite),并与 circomlibjs 三方互证 —— JS↔电路 Poseidon 一致性的关键测试
- [ ] B2 贴边极限合法(len5 x=5 dir=0 终点恰 9;全船贴边相邻);B3 重叠 → witness 抛错;B4/B5 水平/垂直越界;B6 域外(x=10;x=p-1 域回绕,专测比较器健全性);B7 dir=2;B8 salt 改变承诺/同输入确定;B9 约束数守门(>50000 fail)
- [ ] circom_tester 用 `output: build/<n>` + `recompile:false` 吃 compile.ts 产物(board 重编译几十秒);测试启动断言路径不含空格
- [ ] 全绿后 Commit

### Task 1.4 shot.circom + test/shot.test.ts(S1–S7)
- [ ] 按 §5.3 实现:`component main {public [commitment, tx, ty]} = Shot()`;tx/ty Num2Bits(4) 防御性范围(比较器健全前提);Poseidon === commitment 绑定;result = Σ InShip + `s*(s-1)===0`;ships 防御性 ValidShip 保留但**注释标明"防御性冗余、非协议要求"**
- [ ] S1 **全 100 格穷举**对拍 lib isHit(§9.1 核心);S2 换 salt / S3 换 ships → fail;S4 tx 域外;S5 fullProve 后翻转 publicSignals[0]/tx → groth16.verify false;**S6 publicSignals 顺序断言 == [result, commitment, tx, ty](合约接口契约测试)**;S7 prove→verify 冒烟
- [ ] 全绿后 Commit

### Task 1.5 真 ptau setup + 导出 + 产物提交
- [ ] ptau 自动选型下载(board 实测约束数定 16/17)→ setup(确定性已 M0 实证)→ export:`BoardVerifier.sol`/`ShotVerifier.sol` 落 contracts、artifacts/ + manifest 提交 git(D5)
- [ ] `sync-web.ts` 跑通;记录 zkey 实际体积回填 M3 预加载策略;Commit

### Task 1.6 Battleship.sol 完整实现
- [ ] 文件级 `BoardProof{a,b,c,pubSignals[1]}` / `ShotProof{a,b,c,pubSignals[4]}` struct + IBoardVerifier/IShotVerifier 接口;§6.1 Game struct;§6.2 常量;verifier 地址 immutable constructor 注入
- [ ] §6.3 六函数签名一字不改 + §6.4 五事件 + `getGame()`(D9):
  - createGame/joinGame:`pubSignals[0]==commitment` → `PROOF_MISMATCH`,verifyProof → `BAD_PROOF`;joinGame 查 `SELF_JOIN`
  - attack:BAD_PHASE/NOT_TURN/OOB/REPEAT(查 shotMap 位 `y*10+x`)
  - respond:**§5.4 三项绑定集中在 verifyProof 之前**(承诺/坐标/result 各一条 require `PROOF_MISMATCH`)→ verifyProof → Effects(置位 shotMap、hit 则 ++hits;17 命中同交易直接 Finished 不换边 §10;否则换边刷新 lastActionAt)
  - claimTimeout:义务方 = AwaitingAttack?turn:1-turn,只许非义务方,NOT_TIMEOUT/NOT_CLAIMANT
  - cancelGame:仅 Created+超 JOIN_WINDOW+creator
- [ ] **每个 require 注释解释防什么攻击(§6.5 验收项)**;CEI;`TODO(stake)` 挂点三处;`forge fmt`;`forge build` 过;Commit

### Task 1.7 fixtures/generate.ts → ProofFixtures.sol(D4)
- [ ] mtime 缓存(比 zkey/脚本新则跳过);固定棋盘 A/B/C + 固定 salt;消费 `@zk-battleship/circuits/node` 生成:boardA/B/C 证明、shotB_hit×17、shotA_miss×16、`shotB_missAt00`(换格攻击素材)、`shotC_hitAtP`(换棋盘攻击素材);内置 publicSignals 顺序自检(错了在生成期爆,不进 forge);拼 Solidity library 写出;结尾 process.exit(0)
- [ ] contracts package.json:`fixtures` / `test`(fixtures→forge test)/ `snapshot` scripts

### Task 1.8 BattleshipHarness.sol + StateMachine.t.sol(用例 1–13)
- [ ] Harness:setUp 部署三合约 + 双玩家 + `playFullGame()` 助手
- [ ] 正路 6 用例(create/join/attack+respond miss/hit/17 命中全局/cancel)+ **全部 13 个错误码反向用例逐一 `vm.expectRevert`**(含边界:x=10、`vm.warp(last+300)` 整点、86400 整边界)+ Finished 后六函数全 revert;全绿 Commit

### Task 1.9 BindingAttacks.t.sol(M1 安全验收核心)
- [ ] §5.4 三项各 break 一项:换格证明(`shotB_missAt00` vs pending=(x₁,y₁))→ PROOF_MISMATCH;换棋盘证明(`shotC_hitAtP`)→ PROOF_MISMATCH;翻转 result 参数 → PROOF_MISMATCH;篡改 proof 字节(`a[0]^=1`)→ BAD_PROOF;重放语义断言(§5.5);全绿 Commit

### Task 1.10 Timeout.t.sol + Invariants.t.sol
- [ ] 超时双向(AwaitingAttack/AwaitingResponse 各自非义务方 claim 胜)+ 非法调用不刷新计时器
- [ ] 回放式属性检查:playFullGame 每步断言 hits 单调 ≤17、shotMap popcount==ShotResolved 计数(vm.recordLogs)、phase 合法迁移(fuzzing suite 已裁决砍掉)
- [ ] 全绿 Commit

### Task 1.11 Gas.t.sol + snapshot;Task 1.12 收尾
- [ ] `forge snapshot` 覆盖六关键操作,提交 `.gas-snapshot`(只记录,无容差门禁)
- [ ] `script/Deploy.s.sol`(辅助路径,envOr 读 RPC/私钥,不进自动化);DECISIONS.md 补 D 系列执行结果
- [ ] **向用户展示 M1 验收证据**(mocha+forge 全绿输出、gas snapshot、约束数),确认后进 M2

---

## M2 端到端(DoD:e2e 三脚本全绿真实证明;`pnpm demo` 起链部署可用)

### Task 2.1 e2e 基建
- [ ] `lib/anvil.ts`:execa spawn anvil(`--host 127.0.0.1`,e2e 用 8546 避开 demo 的 8545),轮询 eth_chainId 就绪;清理用 **tree-kill**(Windows 无进程组语义,kill 顶层带不走孙进程——全仓约定)
- [ ] `lib/deploy.ts`:读 forge out/*.json(abi+bytecode.object),viem 顺序部署 BoardVerifier→ShotVerifier→Battleship
- [ ] `lib/boards.ts`:固定棋盘+炮击序列(复用 @zk-battleship/circuits);证明直接用 `…/node` 的 proveBoard/proveShot(**不自建 prover**,评审裁决);`lib/assert.ts` 极简断言
- [ ] 每脚本结尾 `process.exit(exitCode)`(snarkjs worker 坑)

### Task 2.2 脚本 A(全局打满)
- [ ] anvil #0/#1 账户;create(boardA)→join(boardB)→33 回合(P0 打 B 的 17 船格,P1 间插 16 水格,每发现场 fullProve 应答)→ 断言 winner==P0、事件序列完整回放(1+1+33+33+1)、hits==[0,17];绿后 Commit

### Task 2.3 脚本 B(超时)+ 脚本 C(取消)
- [ ] B:打 2 回合 → 第 3 回合不应答 → 提前 claim 断言 NOT_TIMEOUT → viem testClient `increaseTime({seconds:301})`+`mine({blocks:1})` → claimTimeout → "timeout"
- [ ] C:create → 提前 cancel 断言 JOIN_WINDOW → increaseTime(86401)+mine → Cancelled、GameFinished(addr0,"cancelled");绿后 Commit

### Task 2.4 run-all + 完整 test:all
- [ ] run-all.ts 顺序跑三脚本(各独立子进程,崩了 anvil 不泄漏);根 `test:all` = circuits mocha → contracts(fixtures+forge)→ e2e 三脚本,全链绿

### Task 2.5 scripts/demo.ts
- [ ] 前置检查(contracts out/ 与 circuits artifacts 存在,缺则给精确修复命令)→ anvil(127.0.0.1:8545)→ viem 部署 → 写 `web/public/deployment.json`(D10 schema)→ execa 起 `pnpm --filter web dev`(shell:true,**env 注入 VITE_DEMO=1**,评审补缺)→ 打印双账户(anvil #0/#1 地址+私钥)+ URL → SIGINT tree-kill 全树
- [ ] 干净 clone 验证 `pnpm demo`(此时 web 是空壳,只验证链起来+地址注入)
- [ ] **向用户展示 M2 验收证据**(三脚本输出、demo 运行截图),确认后进 M3

---

## M3 前端完整流程(DoD:三幕可玩;§9.4 清单过;Worker 管线+持久化+错误映射)

> 文件职责速查:`hooks/useGame`(struct 快照 getGame + getLogs 回放 + 5 事件订阅 → 派生 myIdx/isMyTurn/三幕 act)、`useGameList`、`useProver`(worker 单例 promise 化)、`useAutoRespond`、`useCountdown`、`useLocalBoard`、`useReducedMotion`;`lib/`(re-export 真理源 + abi.ts 生成 + contracts.ts + storage.ts + errors.ts + format.ts + wagmi.ts);`components/board/`(BoardGrid/PlacementBoard/OwnBoard/SonarBoard/SonarBeam/ShotMarker/Crosshair)+ FleetDock/TurnBanner/HitProgress/EventLog/ProofStatus/PersistenceBanner/ExportButton/Toast。

### Task 3.1 lib 层接线
- [ ] re-export `@zk-battleship/circuits`(boardLogic/encoding/salt/proof);gen-abi 脚本(forge artifact → `as const` ABI);contracts.ts(fetch deployment.json,缺失给人话错误);storage.ts(键模板+pending 迁移+导出/导入 schema);errors.ts 全 13 错误码人话映射(§7.6);format.ts((x,y)→"D-7")
- [ ] vitest:storage 迁移逻辑 + 承诺向量与 circuits 测试向量互验;绿后 Commit

### Task 3.2 Worker spike(最高风险项,刻意提前)
- [ ] Plan A(timebox 半天):vite module worker(`new URL(...,import.meta.url)`,`worker.format:'es'`),snarkjs 走 browser 入口(必要时 `resolve.alias: {snarkjs:'snarkjs/build/browser.esm.js'}`);**不需要 COOP/COEP**(ffjavascript 不用 SharedArrayBuffer,源码已核)
- [ ] 失败立刻切 Plan B:classic worker `public/zk/prover.worker.js` + importScripts snarkjs.min.js(UMD),协议不变上层无感
- [ ] wasm/zkey fetch 成 Uint8Array 驻留 worker 内存({type:'mem'});进度 = fetch Content-Length 流式 + witness/prove 真实阶段;`singleThread` 兜底开关(Safari 嵌套 worker 低置信)
- [ ] 验收:浏览器对真 board.zkey 出证明 + groth16.verify 通过,<3s;Commit

### Task 3.3 wagmi + 双账户 + 首笔链上交易
- [ ] wagmi config(chains:[anvil],transport `ws://127.0.0.1:8545`——**127.0.0.1 不用 localhost**);VITE_DEMO 分支 mock×2 / injected(D14);AccountSwitcher(仅 demo 显示);proofFormat re-export
- [ ] 验收:浏览器发 createGame 上 anvil,链上 GameCreated 可查;mock connector 不行立刻切 D14 兜底;Commit

### Task 3.4 Lobby(创建流含 ProofStatus 两阶段文案、按 id 加入、useGameList 事件回放列表)
### Task 3.5 布阵幕
- [ ] 点选-预览-落子交互(不用 HTML5 DnD):FleetDock 点船/拾回 → onPointerMove 预览 → canPlace false 整船染 --flare + 点击 no-op;`R` 旋转、Esc 取消
- [ ] 锁定流程:salt 生成 → **先写 pending 键** → worker 证明("正在编译舰队部署证明…")→ 交易("等待链上确认…")→ 收据 gameId → 迁移正式键 → 上锁态;失败按钮回 idle 且 pending 保留可重试
- [ ] ExportButton、等待对手态("声呐搜索对手中… 对局编号 #N");Commit
### Task 3.6 useGame + 三幕切换(getGame 快照 + getLogs(fromBlock=deployBlock)回放 + watchContractEvent 触发 refetch;事件只当刷新+动效触发器,不做乐观 reducer)
### Task 3.7 对战幕功能版
- [ ] OwnBoard/SonarBoard 静态标记;十字准星(仅我回合,pointer-events:none,已打格禁点);attack 发射 + 待应答空心标记(全站唯一乐观渲染)
- [ ] useAutoRespond:只依赖链上状态(刷新/关页恢复天然成立,§10);inFlight Set 防 StrictMode 双发;**仅 myIdx==defender 触发**(双账户同页防抢答双保险);无本地棋盘 → PersistenceBanner 不发
- [ ] EventLog(回放+实时统一 append,hover 暂停滚底)、TurnBanner(aria-live=polite)+ useCountdown + claimTimeout 按钮、HitProgress;Commit
### Task 3.8 结算幕 + 持久化闭环
- [ ] 战报(回合/命中率/用时,全由事件推导)+ 再来一局 + Finished 清理存储键
- [ ] PersistenceBanner 三幕可见:重算承诺 vs 链上不一致/缺失 → 警告 + 导入(校验承诺才落库);刷新恢复专测(关页期间轮到自己 → 重开自动补应答);Commit
### Task 3.9 收尾
- [ ] 全错误码接 toast(页内,禁原生 alert);§9.4 清单功能层逐项过(布阵非法/锁定全流程/双账户三回合/刷新恢复/清存储警告导入/reduced-motion 基础)并录屏截图
- [ ] **向用户展示 M3 验收证据**,确认后进 M4

---

## M4 视觉打磨与文档(DoD:§7.2–7.4 对照表逐项截图;README 完整)

### Task 4.1 声呐屏签名元素(本里程碑最大单项)
- [ ] 扫描线 = conic-gradient 层 + WAAPI `animate(rotate 360°, {duration:8000, iterations:Infinity})` 且 `anim.startTime=0`(document.timeline 原点)
- [ ] 余辉 = 每 ShotMarker 按方位角 θ 同周期 glow 动画,`startTime = θ/360*8000` —— 相位数学锁定零漂移,晚挂载自动入相;只动 opacity/drop-shadow(合成层);hit 用 --flare、miss 用 --phosphor 衰减曲线
### Task 4.2 事件动效(全部在 §7.4 预算内,其余一律静止)
- [ ] miss 白涟漪一次→留磷光点;hit --flare 脉冲 + 容器 120ms/2px 抖动 + 持续低频火点;回合横幅 180ms 滑入;锁定上锁过渡;结算整屏扫亮(胜)/染暗(负);全走 transform/opacity
### Task 4.3 视觉纪律审计:全站颜色 grep 只许 7 token、radius ≤4px、1px --grid 边框、4px 间距基准、Chakra Petch 仅标题、≤3% 扫描线纹理——逐项截图
### Task 4.4 reduced-motion + a11y
- [ ] prefers-reduced-motion:不创建 WAAPI 动画、扫描线停、抖动取消、保留颜色反馈(+纯 CSS @media 兜底)
- [ ] 格子真 `<button>` + roving tabindex + aria-label("D-7,命中/落空/未探测");焦点环 --phosphor;--mist 对比实测(踩 AA 线则微调亮度);Lighthouse 可访问性 ≥90
### Task 4.5 响应式:<1024px 上下排列(己方在下);768 平板可用
### Task 4.6 README(M4 主交付物,评审补缺)
- [ ] 架构图、单回合时序图(§4.5)、协议说明(§5)、运行步骤(pnpm demo / test:all)、安全注记全文(§5.5:重放无害/跨局 salt 重用有害/生产需 MPC ceremony/脚本对战是特性)、salt 熵说明(§5.1)、"只扫最近 N 万块"说明(§10)、Windows 路径无空格约束、gas 数字
- [ ] **向用户展示 M4 验收证据**(对照表截图包 + Lighthouse 报告 + README),项目完成

---

## Windows 专项纪律(全仓约定,写入 DECISIONS.md)

1. 仓库路径不得含空格(circom_tester 内部 exec 不加引号);测试启动代码断言 + README 写明
2. spawn 范式:exe(circom/anvil/forge)用 execFile/execa 数组传参;`pnpm` 必须 `{shell:true}` 或 `pnpm.cmd`(Node 20+ EINVAL 限制)
3. 进程树清理一律 **tree-kill**(taskkill /T 语义;execa cleanup 只杀直接子进程,cmd.exe → pnpm → node → vite 多级树会残留占端口)
4. RPC 一律 `127.0.0.1` 不用 `localhost`(Node 17+ 可能解析 ::1,anvil 显式 `--host 127.0.0.1`)
5. 全部脚本 tsx,零 bash;snarkjs 脚本结尾 process.exit / mocha --exit

## 风险与缓解(top)

| 风险 | 置信度 | 缓解 |
|---|---|---|
| newZKey 确定性(D5/D6 承重假设) | 未实证 | M0 Task 0.3 双次 setup sha256 对比;失败切"只提交 verifier+manifest" |
| snarkjs 进 Vite module worker | 中 | Plan A timebox 半天 → Plan B classic worker,协议不变(Task 3.2) |
| wagmi v2 mock connector 直发 eth_sendTransaction | 中高 | D14 兜底自定义 connector,<1 天 |
| publicSignals 组内声明序 | 中高 | S6 测试 + fixture 自检,M1 即暴露 |
| circom_tester Windows(无已知阻断≠有验证) | 中 | M0 smoke 最早暴露;recompile:false 吃自家产物 |
| board 约束数/zkey 体积为估算 | 中高 | B9 守门 + ptau 自动选型 + M1 实测回填 M3 预加载策略 |
| Vite 消费 workspace TS 源 | 中 | 不行就给 circuits 加 tsc build 出 dist,5 分钟 |

## 验证(总)

- 每里程碑末:跑该里程碑全部测试并**向用户展示证据(测试输出/截图/录屏),用户确认后才进下一里程碑**(§0.2)
- 全量回归:`pnpm test:all` = circuits mocha(电路+lib)→ contracts(fixtures 生成+forge test)→ e2e 三脚本(真实证明)
- 手动验证:`pnpm demo` 起链 → 浏览器双账户完整对局;§9.4 七项手测清单
- M4 终验:视觉对照表截图 + Lighthouse ≥90 + README 通读
