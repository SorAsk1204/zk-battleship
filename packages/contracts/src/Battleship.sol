// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============ 证明载体(文件级 struct,对外接口的一部分,Design §6.3) ============
// Groth16 a/b/c + 公开输入数组,直接对接 snarkjs 导出的 verifier。
// pubSignals 布局被电路测试钉死(Task 1.3/1.4):board=[commitment],shot=[result, commitment, tx, ty]。

struct BoardProof {
    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;
    uint256[1] pubSignals; // [commitment]
}

struct ShotProof {
    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;
    uint256[4] pubSignals; // [result, commitment, tx, ty]
}

// snarkjs 生成的 verifier:证明无效时返回 false 而**不 revert**,调用方必须检查返回值。
interface IBoardVerifier {
    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[1] calldata)
        external
        view
        returns (bool);
}

interface IShotVerifier {
    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[4] calldata)
        external
        view
        returns (bool);
}

/// @title ZK Battleship 对局合约(Design §6)
/// @notice 单文件、无继承、无可升级代理、无 owner 特权函数;事件是前端唯一数据源。
///         棋盘真伪由 ZK 证明保证:开局承诺(board 电路)+ 逐炮应答(shot 电路,§5.4 三项绑定)。
contract Battleship {
    enum Phase {
        None, // 槽位未使用 = 对局不存在(gameId 从 1 起,D11)
        Created, // p0 已建局,等 p1 加入
        AwaitingAttack, // 等当前回合方开炮
        AwaitingResponse, // 等防守方携 ZK 证明应答
        Finished, // 有 winner(17hits 或 timeout)
        Cancelled // p0 超 JOIN_WINDOW 无人加入后撤局
    }

    struct Game {
        address p0; // creator
        address p1;
        uint256 commitment0; // 玩家 i 的棋盘 Poseidon 承诺
        uint256 commitment1;
        Phase phase;
        uint8 turn; // 当前攻击方 0/1
        uint8 pendingX; // AwaitingResponse 期间待应答的坐标
        uint8 pendingY;
        uint8[2] hits; // hits[i] = 玩家 i 被命中数,到 17 即败
        uint256[2] shotMap; // 位图:玩家 i 的棋盘被打过哪些格(bit = y*10+x);respond 成功时置位(D11)
        uint64 lastActionAt; // 超时计时锚点
        address winner;
    }

    uint8 public constant TOTAL_SHIP_CELLS = 17; // 5+4+3+3+2,与电路 SHIP_LENS 一致
    uint64 public constant TIMEOUT = 300; // 行动义务方超时窗口(秒)
    uint64 public constant JOIN_WINDOW = 86400; // Created 局无人加入多久后允许撤局(秒)

    // constructor 注入后不可变,无 setter(Design §6.5:无 owner 特权)。
    IBoardVerifier public immutable boardVerifier;
    IShotVerifier public immutable shotVerifier;

    uint256 public nextGameId; // gameId 从 1 起:games[0].phase==None 表"不存在"(D11)
    mapping(uint256 => Game) public games;

    // ============ 事件(Design §6.4,锁定) ============
    event GameCreated(uint256 indexed gameId, address indexed p0);
    event GameJoined(uint256 indexed gameId, address indexed p1);
    event ShotFired(uint256 indexed gameId, uint8 attacker, uint8 x, uint8 y);
    event ShotResolved(uint256 indexed gameId, uint8 defender, uint8 x, uint8 y, uint8 result, uint8 totalHits);
    event GameFinished(uint256 indexed gameId, address winner, string reason); // "17hits"/"timeout"/"cancelled"

    constructor(IBoardVerifier _boardVerifier, IShotVerifier _shotVerifier) {
        boardVerifier = _boardVerifier;
        shotVerifier = _shotVerifier;
    }

    // ============ 对外接口(Design §6.3,签名锁定) ============

    /// @notice 创建对局:提交棋盘承诺 + 布局合法性证明(舰型/界内/不重叠)。
    function createGame(uint256 commitment, BoardProof calldata p) external returns (uint256 gameId) {
        // 防"拿任意一份合法证明配假承诺入库":证明的公开输入必须就是将要存储的那个承诺,
        // 否则攻击者可存一个自己根本开不出来的 commitment,赖掉后续所有应答义务。
        require(p.pubSignals[0] == commitment, "PROOF_MISMATCH");
        // 防非法棋盘(舰型不对/越界/重叠)入局;verifier 失败返回 false 不 revert,必须查返回值。
        require(boardVerifier.verifyProof(p.a, p.b, p.c, p.pubSignals), "BAD_PROOF");

        // TODO(stake): 资金托管挂点 — 此处收取 p0 押金(§1.3 范围外,MVP 为荣誉对局)。

        gameId = ++nextGameId; // 先自增:首局 id=1,games[0] 永远是 None
        Game storage g = games[gameId];
        g.p0 = msg.sender;
        g.commitment0 = commitment;
        g.phase = Phase.Created;
        g.lastActionAt = uint64(block.timestamp); // JOIN_WINDOW 计时起点
        emit GameCreated(gameId, msg.sender);
    }

    /// @notice 加入对局:校验同 createGame;成功后 P0 先攻。
    function joinGame(uint256 gameId, uint256 commitment, BoardProof calldata p) external {
        Game storage g = games[gameId];
        // 只允许加入 Created 局:同时挡住 gameId 不存在(None)、已满员、已结束、已撤销的局。
        require(g.phase == Phase.Created, "BAD_PHASE");
        // 防自己加入自己的局刷对局状态(双账户演示是两个地址,不受影响)。
        require(msg.sender != g.p0, "SELF_JOIN");
        // 同 createGame:防"合法证明配假承诺"。
        require(p.pubSignals[0] == commitment, "PROOF_MISMATCH");
        // 同 createGame:防非法棋盘;verifier 失败返回 false,必须查返回值。
        require(boardVerifier.verifyProof(p.a, p.b, p.c, p.pubSignals), "BAD_PROOF");

        // TODO(stake): 资金托管挂点 — 此处要求 p1 跟注与 p0 等额押金(§1.3 范围外)。

        g.p1 = msg.sender;
        g.commitment1 = commitment;
        g.phase = Phase.AwaitingAttack;
        g.turn = 0; // P0 先攻(锁定语义)
        g.lastActionAt = uint64(block.timestamp);
        emit GameJoined(gameId, msg.sender);
    }

    /// @notice 当前回合方向对手棋盘开炮。
    function attack(uint256 gameId, uint8 x, uint8 y) external {
        Game storage g = games[gameId];
        // 只在 AwaitingAttack 可开炮:挡住不存在的局、未开始、等应答中(防同回合连射)、已结束的局。
        require(g.phase == Phase.AwaitingAttack, "BAD_PHASE");
        // 只有当前回合方能开炮:防对手抢回合、防第三人代打。
        require(msg.sender == _player(g, g.turn), "NOT_TURN");
        // 坐标必须在 10x10 棋盘内:防越界坐标污染 shotMap 位图与 shot 电路输入域。
        require(x < 10 && y < 10, "OOB");
        uint8 defender = 1 - g.turn;
        // 防重复攻击同一格:重复格的应答是确定的,允许重打只会被用来拖时间刷事件。
        require(((g.shotMap[defender] >> (uint256(y) * 10 + uint256(x))) & 1) == 0, "REPEAT");

        g.pendingX = x;
        g.pendingY = y;
        g.phase = Phase.AwaitingResponse;
        g.lastActionAt = uint64(block.timestamp); // 防守方应答义务计时开始
        emit ShotFired(gameId, g.turn, x, y);
    }

    /// @notice 防守方携 shot 证明应答 pending 炮击;§5.4 三项绑定是全系统防作弊关口。
    function respond(uint256 gameId, uint8 result, ShotProof calldata p) external {
        Game storage g = games[gameId];
        // 只在 AwaitingResponse 可应答:挡住无 pending 炮击时的凭空应答。
        require(g.phase == Phase.AwaitingResponse, "BAD_PHASE");
        uint8 defender = 1 - g.turn;
        // 只有被攻击方能应答:防攻击方/第三人替防守方"应答"伪造结果。
        require(msg.sender == _player(g, defender), "NOT_DEFENDER");
        // result 只能是 0/1:挡住脏值进入事件流与 hits 计数。
        require(result <= 1, "BAD_RESULT");

        // ===== §5.4 三项绑定(集中校验,且必须在 verifyProof 之前) =====
        // 证明本身只保证"对 pubSignals 里的那个棋盘/那个格子,结果是 pubSignals[0]";
        // 证明是否谈论"本局链上状态",全靠下面三条逐项核对。
        // (1) 防换棋盘:证明绑定的承诺必须是防守方开局存储的承诺,
        //     否则可用另一块"全 miss 棋盘"的合法证明永远报 miss。
        require(p.pubSignals[1] == (defender == 0 ? g.commitment0 : g.commitment1), "PROOF_MISMATCH");
        // (2) 防换格子:证明谈论的坐标必须是本回合 pending 坐标,
        //     否则可拿自己棋盘上任一空格的合法 miss 证明应答任意炮击。
        require(p.pubSignals[2] == g.pendingX && p.pubSignals[3] == g.pendingY, "PROOF_MISMATCH");
        // (3) 应答值即证明输出:防 calldata 里的 result 与证明实际输出不一致
        //     (事件/hits 采信的是 result 参数,必须与证明保证的值逐位一致)。
        require(p.pubSignals[0] == result, "PROOF_MISMATCH");
        // 绑定通过后才验证明本身;verifier 失败返回 false 不 revert,必须查返回值。
        require(shotVerifier.verifyProof(p.a, p.b, p.c, p.pubSignals), "BAD_PROOF");

        // ===== Effects(CEI:上面只读校验,以下才写状态) =====
        uint8 x = g.pendingX;
        uint8 y = g.pendingY;
        // respond 成功时才置位(D11):phase 机制保证 AwaitingResponse 期间不可能再 attack,
        // 且维持不变量"shotMap 置位数 == ShotResolved 事件数"。
        g.shotMap[defender] |= uint256(1) << (uint256(y) * 10 + uint256(x));
        if (result == 1) {
            g.hits[defender] += 1;
        }
        emit ShotResolved(gameId, defender, x, y, result, g.hits[defender]);

        if (g.hits[defender] == TOTAL_SHIP_CELLS) {
            // 17 格全中:同交易直接结束,不换边(§10)。
            g.phase = Phase.Finished;
            g.winner = _player(g, g.turn);
            // TODO(stake): 资金托管挂点 — 结算处:胜者领取双方押金;
            //              claimTimeout 胜者、cancelGame 退款同属此挂点范围(§1.3 范围外)。
            emit GameFinished(gameId, g.winner, "17hits");
        } else {
            g.turn = defender; // 换边:防守方成为新攻击方
            g.phase = Phase.AwaitingAttack;
            g.lastActionAt = uint64(block.timestamp);
        }
    }

    /// @notice 对手超时不行动时,守约方判胜结束对局(防赖局:输方拒不应答即烂尾)。
    function claimTimeout(uint256 gameId) external {
        Game storage g = games[gameId];
        // 只有对局进行中才有"行动义务方"可言:Created 局走 cancelGame,终局无超时。
        require(g.phase == Phase.AwaitingAttack || g.phase == Phase.AwaitingResponse, "BAD_PHASE");
        // 严格大于:恰好 +TIMEOUT 秒还不能 claim,防边界争议(warp 到恰 +300 必须失败)。
        // 验证者秒级操纵 timestamp 远小于 TIMEOUT=300s,对超时判定无实质影响,lint 告警按设计豁免。
        // forge-lint: disable-next-line(block-timestamp)
        require(block.timestamp > g.lastActionAt + TIMEOUT, "NOT_TIMEOUT");
        // 义务方 = 该出手却没出手的人:等开炮是回合方,等应答是防守方。
        uint8 obligated = g.phase == Phase.AwaitingAttack ? g.turn : 1 - g.turn;
        // 只允许对局中的非义务方 claim:防义务方"自己超时自己判胜",也防第三人替人结束对局。
        require(msg.sender == _player(g, 1 - obligated), "NOT_CLAIMANT");

        g.phase = Phase.Finished;
        g.winner = msg.sender;
        emit GameFinished(gameId, msg.sender, "timeout");
    }

    /// @notice Created 局超 JOIN_WINDOW 无人加入,创建者撤局。
    function cancelGame(uint256 gameId) external {
        Game storage g = games[gameId];
        // 只能撤 Created 局:已开战的局只能打完或走超时,防单方面毁局逃避败局。
        require(g.phase == Phase.Created, "BAD_PHASE");
        // 只有创建者能撤自己的局:防第三人恶意撤掉别人挂出的局。
        require(msg.sender == g.p0, "NOT_CREATOR");
        // 严格大于:窗口期内不可撤,防"挂局钓鱼后在对手 joinGame 上链前抢先撤局"高频骚扰。
        // 同 claimTimeout:秒级 timestamp 操纵远小于 JOIN_WINDOW=86400s,lint 告警按设计豁免。
        // forge-lint: disable-next-line(block-timestamp)
        require(block.timestamp > g.lastActionAt + JOIN_WINDOW, "JOIN_WINDOW");

        g.phase = Phase.Cancelled;
        emit GameFinished(gameId, address(0), "cancelled");
    }

    /// @notice 读取完整对局(D9:public mapping 自动 getter 不返回 struct 内数组,hits/shotMap 拿不到)。
    function getGame(uint256 gameId) external view returns (Game memory) {
        return games[gameId];
    }

    /// @dev 按索引取玩家地址(turn/defender 都是 0/1 索引)。
    function _player(Game storage g, uint8 idx) private view returns (address) {
        return idx == 0 ? g.p0 : g.p1;
    }
}
