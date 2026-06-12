# DESIGN:链上海战棋(ZK Battleship)完整设计书

> 本文档是交给 Claude Code 的实现规格书,目标:**逻辑层简洁高效,前端达到作品集水准**。
> 核心机制:玩家棋盘以 Poseidon 承诺上链,每次应答炮击附零知识证明——整局游戏棋盘从未公开,但每一次 hit/miss 应答都被数学锁死,无法谎报。

---

## 0. 给 Claude Code 的执行说明

1. **先通读全文**,进入计划模式产出 M0–M4 的任务拆分,与用户确认后再动手。
2. **按里程碑顺序执行**(§11),每个里程碑的 Definition of Done 全部满足后才能进入下一个,完成时向用户展示验收证据(测试输出/截图)。
3. **锁定项不要更改**:游戏规则(§4)、密码学方案(§5)、合约对外接口(§6.3)、视觉方向(§7.2)。其余实现细节有自由度。
4. **禁止行为**:
   - 为通过测试放宽合约或电路约束;
   - 证明生成放主线程(必须 Web Worker);
   - 假进度条、浏览器原生 alert/confirm;
   - M1 之后遗留任何 mock 验证器(本项目电路小,从一开始就用真实 verifier)。
5. **歧义处理**:先查 §10 裁决清单;未覆盖且不影响核心玩法/安全的,选保守方案记入 `DECISIONS.md`;涉及规则或密码学协议的必须先问用户。
6. 项目面向本地链与测试网,**不托管资金**(MVP 为荣誉对局),不要实现主网部署。

---

## 1. 目标与范围

### 1.1 一句话目标

双人链上海战棋:布船私密(承诺上链)、应答可信(逐炮 ZK 证明)、胜负与回合由合约裁判,前端是一个有完整氛围感的"声呐作战室"。

### 1.2 MVP 必做

- 10×10 棋盘、标准 5 舰、轮流炮击、ZK 应答、17 命中获胜、超时判负。
- 多局并存(同一合约管理多个 gameId)。
- 前端完整流程:大厅 → 布阵 → 对战 → 结算,事件驱动自动刷新。
- `pnpm demo` 一键起 Anvil + 部署 + 双账户演示对局。
- 棋盘与 salt 的本地持久化(丢失即无法应答 = 超时输,见 §8)。

### 1.3 明确不做

- 资金托管/下注(合约留 TODO 注释标位置)、击沉播报(迫使证明泄露船的归属,电路复杂度上升而玩法收益低)、观战模式、移动端原生、主网部署、生产级 trusted setup。

---

## 2. 技术栈(锁定)

| 层 | 选型 | 备注 |
|---|---|---|
| 电路 | circom 2.1.x + snarkjs,Groth16 | 哈希用 circomlib Poseidon;开发用公开 ptau,README 标注生产需重做 setup |
| 合约 | Solidity 0.8.24+,Foundry | 单一游戏合约 + 两个 snarkjs 导出 verifier |
| 前端 | Vite + React 18 + TypeScript + Tailwind | 钱包 viem + wagmi,本地 Anvil 注入测试账户 |
| 证明生成 | snarkjs wasm,**Web Worker** | wasm/zkey 预加载;Node 端同一套产物供 e2e 用 |
| 包管理 | pnpm workspace | |

电路规模预期(实现后若明显超标,说明写法有误,停下重审):
- `board.circom`:~2 万–5 万约束(100 格 × 5 舰占用判断 + Poseidon);
- `shot.circom`:~3 千–8 千约束(仅 1 个目标格 × 5 舰 + Poseidon)。浏览器证明应在 1 秒上下。

---

## 3. 仓库结构

```
zk-battleship/
├── DESIGN.md                # 本文档
├── DECISIONS.md             # 实现决策记录(Claude Code 维护)
├── pnpm-workspace.yaml
├── packages/
│   ├── circuits/
│   │   ├── board.circom
│   │   ├── shot.circom
│   │   ├── scripts/         # 编译、setup、导出 verifier/wasm/zkey
│   │   └── test/            # circom_tester 单测
│   ├── contracts/
│   │   ├── src/Battleship.sol
│   │   ├── src/verifiers/   # BoardVerifier.sol / ShotVerifier.sol(snarkjs 生成)
│   │   └── test/
│   ├── web/
│   │   └── src/{pages,components,workers,lib,styles}
│   └── e2e/                 # Node 双代理脚本(真实证明,Anvil)
└── scripts/demo.ts          # pnpm demo 入口
```

---

## 4. 游戏规则精确定义

### 4.1 棋盘与舰队

- 10×10,坐标 `(x, y)`,`x, y ∈ [0, 9]`,左上为 (0,0)。
- 5 艘船,长度固定 `[5, 4, 3, 3, 2]`,顺序即 shipId 0–4。
- 朝向 `dir ∈ {0, 1}`:0 = 水平(占 `(x..x+len-1, y)`),1 = 垂直(占 `(x, y..y+len-1)`)。
- 约束:全部在界内、任意两船**无重叠格**;允许贴边相邻(不做间隔要求,简化电路)。
- 合法船格总数恒为 17。

### 4.2 回合流程

1. 创建者(P0)带承诺+布船合法性证明开局;加入者(P1)同样带承诺+证明入局,游戏即开始,**P0 先攻**。
2. 攻击方 `attack(x, y)` 报坐标(不得重复攻击同一格);
3. 防守方 `respond(result, proof)` 用 ZK 证明应答 hit(1)/miss(0);
4. 合约记录结果、累计命中数,**攻击权交换**(无论 hit 或 miss,均换边——经典规则的"命中再打一炮"不采用,保持回合对称、减少状态)。
5. 某方累计被命中 17 格 → 对方获胜,`Finished`。

### 4.3 超时

- 唯一计时器 `lastActionAt`:每次合法状态推进时刷新。
- 轮到某方行动(attack 或 respond)超过 `TIMEOUT = 300 秒`,对方可调 `claimTimeout()` 直接获胜。
- 非法调用只 revert、不判负、不刷新计时器。

### 4.4 状态机

```
None ──createGame──▶ Created ──joinGame──▶ AwaitingAttack(turn=P0)
AwaitingAttack ──attack──▶ AwaitingResponse ──respond──▶
        ├── hits[defender] < 17 → AwaitingAttack(turn 交换)
        └── hits[defender] == 17 → Finished(attacker 胜)
任何 AwaitingAttack / AwaitingResponse:超时 → claimTimeout → Finished
Created 超过 24h 无人加入:creator 可 cancelGame → Cancelled
```

### 4.5 单回合时序(实现对照用)

```
攻击方前端                     链上合约                      防守方前端
   │ attack(3,7) ──────────────▶ 校验回合/未重复/界内
   │                             存 pendingShot,发 ShotFired ──▶ 事件唤醒
   │                                                          │ Worker 生成 shot 证明
   │                             校验 proof 公开输入 ◀──────── respond(1, proof)
   │ 事件刷新 UI ◀────────────── 记 hit,换边,发 ShotResolved ──▶ 事件刷新 UI
```

---

## 5. 密码学协议设计

### 5.1 布船编码与承诺

- 布船方案 = 15 个标量:`(x0,y0,d0, x1,y1,d1, ..., x4,y4,d4)` + 随机 `salt`。
- **承诺 = Poseidon(16 inputs)**,输入顺序固定:`[x0,y0,d0, x1,y1,d1, x2,y2,d2, x3,y3,d3, x4,y4,d4, salt]`(circomlib Poseidon 最大支持 16 输入,正好用满;顺序写错会导致前后端承诺对不上,务必两端共用一个编码函数)。
- `salt`:客户端用 CSPRNG 生成 ≥128 bit 随机数。承诺的隐藏性完全依赖 salt 熵——没有 salt,布船空间只有 ~3×10^13,可被暴力枚举。README 中向用户说明。

### 5.2 board.circom(开局合法性证明)

```
私有输入: ships[5][3]  (x, y, dir), salt
公开输出: commitment
约束:
  1. 类型域:每个 x,y ∈ [0,9],dir ∈ {0,1}(Num2Bits/LessThan)
  2. 界内:dir=0 时 x + len - 1 ≤ 9;dir=1 时 y + len - 1 ≤ 9
     (用 dir 做线性混合:endX = x + (1-dir)*(len-1);endY = y + dir*(len-1);约束 endX ≤ 9 且 endY ≤ 9)
  3. 无重叠:对全部 100 个格子 c=(cx,cy):
       occ[c] = Σ_{s∈5舰} inShip(s, cx, cy)
       约束 occ[c] * (occ[c] - 1) == 0   (每格占用 ∈ {0,1})
     inShip(s, cx, cy) 实现:
       dir=0: (cy == y_s) AND (x_s ≤ cx) AND (cx ≤ x_s + len_s - 1)
       dir=1: 对称
       用 IsEqual / LessEqThan 组件构造,结果相乘得布尔指示值
     (occ 全格布尔 + 每船界内 ⇒ Σocc == 17 自动成立,无需单独约束)
  4. commitment === Poseidon(15 参数 + salt)
```

### 5.3 shot.circom(逐炮应答证明)

```
私有输入: ships[5][3], salt
公开输入: commitment, tx, ty        (本回合被攻击坐标)
公开输出: result                    (1 = hit, 0 = miss)
约束:
  1. Poseidon(ships, salt) === commitment   (绑定开局承诺,防止换棋盘)
  2. result = OR over 5 舰 of inShip(s, tx, ty)
     (实现为 sum = Σ inShip;由 board 阶段保证无重叠,sum ∈ {0,1};仍补一条 sum*(sum-1)==0 防御性约束)
  3. result 作为公开输出由证明本身保证正确性
注意:此电路只判定一个格子,不重建 100 格棋盘——这是它只有几千约束的原因。
```

### 5.4 公开输入绑定(合约侧必须逐项核对)

`respond` 时合约必须校验证明公开输入与链上状态**完全一致**:
- `commitment` == 防守方开局存储的承诺;
- `(tx, ty)` == 当前 `pendingShot`;
- `result` 即采信的应答值(由证明保证其真实性)。
任何一项不符 → revert。这是整个系统防作弊的关口,测试要专门覆盖"用别的格子/别的棋盘的合法证明来应答"的攻击路径。

### 5.5 安全注记(写入 README)

- 同一 `(commitment, tx, ty)` 的证明重放无害(结果确定),不需防;**跨局重用同一布船+salt 有害**(上一局对手已知你的棋盘),客户端必须每局新 salt。
- Groth16 开发 ptau 不可用于生产;生产需 MPC ceremony。
- 合约无法阻止玩家用脚本对战,这是全链游戏的特性而非缺陷。

---

## 6. 合约设计(Battleship.sol,追求最小必要复杂度)

### 6.1 数据结构

```solidity
enum Phase { None, Created, AwaitingAttack, AwaitingResponse, Finished, Cancelled }

struct Game {
    address p0;            // creator
    address p1;
    uint256 commitment0;
    uint256 commitment1;
    Phase   phase;
    uint8   turn;          // 0/1,当前攻击方
    uint8   pendingX;
    uint8   pendingY;
    uint8[2] hits;         // hits[i] = 玩家 i 被命中数
    uint256[2] shotMap;    // 位图:玩家 i 的棋盘被打过哪些格(bit = y*10+x),防重复攻击
    uint64  lastActionAt;
    address winner;
}
mapping(uint256 => Game) public games;   // gameId 自增
```

### 6.2 常量

`uint8 constant TOTAL_SHIP_CELLS = 17;` `uint64 constant TIMEOUT = 300;` `uint64 constant JOIN_WINDOW = 86400;`

### 6.3 对外接口(锁定)

```solidity
function createGame(uint256 commitment, BoardProof calldata p) external returns (uint256 gameId);
function joinGame(uint256 gameId, uint256 commitment, BoardProof calldata p) external; // 不得自己加入自己
function attack(uint256 gameId, uint8 x, uint8 y) external;          // 校验:回合方、界内、shotMap 未命中过该位
function respond(uint256 gameId, uint8 result, ShotProof calldata p) external; // §5.4 三项绑定校验
function claimTimeout(uint256 gameId) external;
function cancelGame(uint256 gameId) external;                        // 仅 Created 且超 JOIN_WINDOW
// BoardProof / ShotProof = Groth16 a,b,c + 对应公开输入数组,直接对接 snarkjs 导出 verifier
```

### 6.4 事件(前端唯一数据源,字段要够渲染)

```solidity
event GameCreated(uint256 indexed gameId, address indexed p0);
event GameJoined(uint256 indexed gameId, address indexed p1);
event ShotFired(uint256 indexed gameId, uint8 attacker, uint8 x, uint8 y);
event ShotResolved(uint256 indexed gameId, uint8 defender, uint8 x, uint8 y, uint8 result, uint8 totalHits);
event GameFinished(uint256 indexed gameId, address winner, string reason); // "17hits"/"timeout"/"cancelled"
```

### 6.5 实现纪律

- 单文件、无继承迷宫、无可升级代理、无 owner 特权函数;两个 verifier 地址 constructor 注入后不可变。
- 所有 require 带短错误码字符串(如 `"NOT_TURN"`,前端据此映射人话文案,见 §7.6)。
- CEI 顺序;无资金流所以无重入面,但保持纪律。
- `forge fmt` + 注释解释每个 require 防的是什么攻击。

---

## 7. 前端设计(验收权重与逻辑层同级)

### 7.1 信息架构与页面流

```
/            大厅:创建对局 | 输入 gameId 加入 | 进行中对局列表(扫事件重建)
/game/:id    根据 phase 自动呈现三幕:布阵 → 对战 → 结算(同一路由,状态驱动)
```

- 全局事件订阅(wagmi watchContractEvent),**用户永远不需要手动刷新**。
- 双账户演示:页面右上角提供 P0/P1 测试账户切换器(仅 demo 模式显示),配合 `pnpm demo` 同页打完整局。

### 7.2 视觉系统(锁定方向,Token 级定义)

**主题:冷战时期潜艇声呐作战室。** 不是泛泛的"深色科技风"——参照物是 CRT 声呐屏、磷光余辉、海图坐标纸。

调色板(CSS 变量,全站只允许这些颜色):

```
--abyss:    #081019   页面基底(深海)
--console:  #0D1B26   面板/卡片底
--grid:     #1E3A4A   网格线、分隔线
--phosphor: #35E0C8   主青绿:己方信息、扫描线、可交互高亮
--flare:    #FF7A45   命中橙红:hit 标记、危险态、对方命中我方
--foam:     #C8D8DC   正文浅灰蓝
--mist:     #5A7484   次级文字、禁用态
```

字体(三角色,Google Fonts):
- 展示/标题:**Chakra Petch**(600/700)——军事仪表感,只用于大标题与回合横幅,克制使用;
- 正文/界面:**Inter**(400/500);
- 数据/坐标/日志:**IBM Plex Mono**——坐标 `D-7`、命中计数、事件流水全部用等宽,这是"作战记录"质感的来源。

**签名元素(全站唯一的记忆点,做好这一个就够)**:敌方海域是一块**活的声呐屏**——半透明扫描线以 8s/圈匀速旋转,扫过有标记的格子时,该标记短暂提亮再按磷光余辉曲线衰减(hit 用 --flare、miss 用 --phosphor 的衰减)。其余界面保持安静纪律,把全部氛围预算花在这块屏上。

其他视觉纪律:
- 直角为主(radius ≤ 4px),细边框(1px --grid),不用阴影堆叠;
- 背景允许一层极低透明度(≤3%)的扫描线纹理,禁止噪点滤镜滥用;
- 间距系统 4px 基准;两块棋盘并排(<1024px 时上下排列,己方在下)。

### 7.3 三幕的关键交互

**布阵幕**
- 船坞(FleetDock)列出 5 舰,点选→棋盘上随鼠标预览,`R` 旋转,非法位置整船染 --flare 并禁止落子;已放置可拖回。
- 全部就位后出现唯一主按钮 **「锁定舰队」**:点击 → Worker 生成 board 证明(显示真实阶段文案:"正在编译舰队部署证明…")→ 发交易("等待链上确认…")→ 成功后棋盘上锁(加锁图标 + 网格变暗),进入等待/对战。
- 等待对手加入时:声呐屏空转 + 文案"声呐搜索对手中… 对局编号 #42,把它发给你的对手"。

**对战幕**
- 布局:左 = 己方海域(被打记录),右 = 敌方声呐屏(我的炮击记录),中缝窄列 = 回合横幅、双方命中进度(0–17 刻度条)、事件日志(等宽流水:`▸ 14:02:33  我方炮击 D-7 … 命中`)。
- 我方回合:敌方屏上 hover 出现十字准星(横纵贯穿线 + 坐标角标),点击格子 = 开炮,立即落"待应答"空心标记;
- 对方应答到达(事件):miss → 白色涟漪扩散一次后留磷光点;hit → --flare 脉冲 + 棋盘容器 120ms 横向 2px 抖动 + 留下持续低频闪烁的火点;
- 对方回合:己方棋盘对应格出现来袭标记,我方客户端**自动**生成应答证明并发交易(无需手动点击),状态条显示"正在应答 F-3 的炮击…";
- 超时:对方剩余时间在回合横幅倒数,可点 `claimTimeout` 时按钮以 --flare 呼吸提示。

**结算幕**
- 胜:声呐屏整屏一次 --phosphor 扫亮;负:整屏短暂染 --flare 后熄灭为低亮度。展示战报(总回合、命中率、用时)+「再来一局」回到大厅。

### 7.4 动效预算(orchestrated,不堆散件)

只允许这些动画:声呐扫描线(常驻)、命中/落空反馈(事件触发)、回合横幅切换(180ms 滑入)、锁定舰队的上锁过渡、结算扫屏。其余一律静止。所有动画走 CSS transform/opacity;`prefers-reduced-motion` 时扫描线停转、抖动取消、保留颜色反馈。

### 7.5 证明与交易的状态表达

- Worker 协议:`{type:'prove', circuit:'board'|'shot', inputs}` → `progress` → `done|error`;wasm/zkey 在进入对应幕时预加载。
- 两类等待文案严格区分:证明生成(本地计算)vs 链上确认(网络)。按钮在两阶段分别显示对应文案 + 内联 spinner,不弹模态。
- 失败:页内 toast,文案 = 发生了什么 + 怎么办("应答证明被合约拒绝:本地棋盘与链上承诺不一致。请检查是否清除过浏览器存储。")。

### 7.6 文案纪律

- 错误码 → 人话映射表集中在 `lib/errors.ts`(`NOT_TURN` → "还没轮到你开炮")。
- 按钮动词化且贯穿一致:「锁定舰队」「开炮」「认领超时胜利」;toast 与按钮使用同一词汇。
- 空状态给行动指引,不给装饰性感叹。

### 7.7 质量底线(不另行声明,默认达成)

桌面 1280–1920 与 768 平板可用;全部可交互元素有可见键盘焦点;颜色对比满足 WCAG AA(--mist 只用于次级文字);Lighthouse 可访问性 ≥ 90。

---

## 8. 客户端密钥与持久化(资金虽无,棋盘即资产)

- 布船 + salt 持久化于 `localStorage`,键 `bs:{chainId}:{contract}:{gameId}:{address}`,值 `{ships, salt, commitment}`。
- **丢失后果 = 无法生成应答证明 = 必然超时输**。因此:
  - 锁定舰队成功后,提供「导出部署文件」按钮(下载 JSON);
  - 进入对战幕时校验 localStorage 数据能重算出链上承诺,不一致立即顶部横幅警告并提供导入入口;
  - Finished 后该键可清理。
- demo 模式的两个测试账户各自独立存取。

---

## 9. 测试计划

### 9.1 电路(circom_tester)

- board:合法布阵 → 承诺正确;重叠 / 出界 / dir∉{0,1} → witness 不可满足。
- shot:对已知布阵全 100 格断言 hit/miss 与 JS 参考实现一致;篡改 result / 换 salt / 换坐标 → 不可满足或公开输入不符。
- JS 参考实现 `lib/boardLogic.ts` 是唯一真理源,电路、前端、e2e 共用。

### 9.2 合约(forge)

- 状态机全路径 + 全部 require 的反向用例(错误码逐一断言)。
- 攻击专项:重复打同一格、非回合方 attack、防守方用**另一格的合法证明**应答、用**另一棋盘的合法证明**应答(§5.4 三项绑定各 break 一项)。
- 不变量:hits 单调不减且 ≤17;Finished 后任何游戏函数 revert;shotMap 置位数 == 双方 ShotResolved 事件数。
- `forge snapshot` 记录 attack/respond gas。

### 9.3 端到端(packages/e2e,Node + Anvil,真实证明)

- 脚本 A:固定双方布阵与炮击序列,打满至 17 命中,断言 winner 与事件序列;
- 脚本 B:防守方在第 3 回合停止应答,攻击方 claimTimeout 获胜;
- 脚本 C:创建后无人加入,24h 快进后 cancelGame。
- 统一入口 `pnpm test:all` = 电路测试 + forge test + e2e 三脚本。

### 9.4 前端手测清单(M3 验收随附录屏/截图)

布阵非法提示 / 锁定舰队全流程 / 双账户互打三回合 / hit 与 miss 动效 / 刷新页面后状态恢复 / 清空 localStorage 后的警告与导入恢复 / reduced-motion 模式。

---

## 10. 边界裁决清单

| 情形 | 裁决 |
|---|---|
| 加入自己创建的对局 | revert `SELF_JOIN`(demo 用两个账户,不开后门) |
| attack 越界 / 重复格 | revert `OOB` / `REPEAT` |
| respond 携带合法但不匹配的证明 | revert `PROOF_MISMATCH`(§5.4) |
| 双方都可指认对方超时(理论不可能,防御性) | 状态机保证同一时刻只有一方有行动义务,claimTimeout 只对非义务方开放 |
| respond 后立刻达到 17 | 同交易内直接 Finished,不再换边 |
| 事件回放重建大厅列表过慢 | 允许 indexer-less:只扫最近 N 万块,README 说明 |
| 浏览器关闭期间轮到自己 | 重新打开后由 phase + pendingShot 恢复并自动补应答 |
| gas 由谁付 | 各自为自己的交易付 |

---

## 11. 里程碑与 Definition of Done

**M0 脚手架**:monorepo + circom 工具链 + Foundry + Vite 就绪,空产物全部 build 通过;`pnpm test:all` 骨架可跑。
**M1 密码学与合约**:两电路 + 单测全绿;verifier 导出;Battleship.sol + §9.2 全绿 + gas snapshot;`DECISIONS.md` 启用。
**M2 端到端**:e2e 三脚本全绿(真实证明);`pnpm demo` 起链部署可用。
**M3 前端完整流程**:三幕可玩,§9.4 清单通过,Worker 证明管线 + 持久化 + 错误映射就位。
**M4 视觉打磨与文档**:§7.2–7.4 完成度自查(对照表逐项截图);README:架构图、单回合时序图、协议说明、运行步骤、安全注记(§5.5)。

### 未来扩展(只记录,不实现)

下注托管(合约 TODO 位)、击沉播报(电路输出 shipId 的代价分析)、ELO 大厅、L2 测试网部署、用同一套"承诺+逐步证明"范式做扫雷对战/猜数字。

---

## 12. 参考资料

- Dark Forest 白皮书与电路 —— 链上隐藏信息范式来源。
- BattleZips(GitHub)与 zku.one 课程的 Battleship 作业 —— 同类实现,可对照电路写法(允许参考思路,禁止整段照搬未审计代码)。
- circomlib(Poseidon、比较器组件)文档。
- snarkjs README —— Groth16 全流程与 Solidity verifier 导出。
