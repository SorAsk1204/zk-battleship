pragma circom 2.1.9;

// shot.circom —— 逐炮应答证明(Task 1.4,Design §5.3)。
// 证明语义:"我知道一组 ships + salt,其 Poseidon 承诺等于公开的 commitment,
// 且 (tx,ty) 这一格的命中结果是 result"——防守方无法对自己 board 阶段承诺过的
// 布阵谎报 hit/miss。
//
// ★ publicSignals 布局契约(S6 测试钉死,合约 respond 逐项核对,Design §5.4):
//   [result, commitment, tx, ty] —— 输出在前,公开输入按下方声明顺序。
//   禁止调换 commitment/tx/ty 的声明顺序,禁止增删公开信号。

include "common.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

template Shot() {
    signal input ships[5][3];   // 私有:(x, y, dir) × 5,shipId 序 = 长度表序
    signal input salt;          // 私有:与 board 证明同一 salt
    signal input commitment;    // 公开:开局承诺(合约校验 == 链上存储值)
    signal input tx;            // 公开:本回合被攻击坐标 x(合约校验 == pendingShot)
    signal input ty;            // 公开:本回合被攻击坐标 y
    signal output result;       // 公开:1 = hit,0 = miss

    // 协议锁定(§4.1):与 board.circom / lib SHIP_LENGTHS 一致
    var LENS[5] = [5, 4, 3, 3, 2];

    // ── 约束 1:承诺绑定(防换棋盘)──
    // 填法必须与 board.circom 逐字一致(§5.1 顺序锁定):
    // inputs = [x0,y0,d0, ..., x4,y4,d4, salt],salt 固定在 inputs[15]。
    // 顺序写错 ⇒ 同一布阵在 board/shot 两电路承诺对不上,S2/S3 测试钉死这条。
    component h = Poseidon(16);
    for (var s = 0; s < 5; s++) {
        for (var k = 0; k < 3; k++) {
            h.inputs[3 * s + k] <== ships[s][k];
        }
    }
    h.inputs[15] <== salt;
    h.out === commitment;

    // ── 约束 3(防御性):tx, ty 钉死 < 16 ──
    // InShip 比较器健全性前提(common.circom 总纲):cx, cy 必须 < 16,否则
    // 4bit 比较器对 p-1 等域回绕值取位是垃圾。注意这里只挡 ≥16:tx∈[10,15]
    // 能通过本约束,此时 InShip 全 0、result=0(与 lib isHit 域外=0 一致);
    // tx ≤ 9 由合约 attack 入口管(Design §5.4),电路只负责比较器健全性。
    component txb = Num2Bits(4);
    txb.in <== tx;
    component tyb = Num2Bits(4);
    tyb.in <== ty;

    // ── 约束 4(防御性冗余、非协议要求):ships 合法性 ──
    // 承诺绑定已保证 ships 与 board 电路验证过的完全一致(Poseidon 抗碰撞),
    // 这里重跑 ValidShip 仅作纵深防御,不承担协议语义。
    component valid[5];
    for (var s = 0; s < 5; s++) {
        valid[s] = ValidShip(LENS[s]);
        valid[s].x <== ships[s][0];
        valid[s].y <== ships[s][1];
        valid[s].dir <== ships[s][2];
    }

    // ── 约束 2:result = Σ 五舰 InShip(s, tx, ty) ──
    // board 阶段已保证无重叠 ⇒ sum ∈ {0,1};仍加 sum*(sum-1)===0 防御性约束
    // (若上游不变量被打破,这里让系统不可满足而不是输出 2)。
    component inShip[5];
    var acc = 0;
    for (var s = 0; s < 5; s++) {
        inShip[s] = InShip(LENS[s]);
        inShip[s].x <== ships[s][0];
        inShip[s].y <== ships[s][1];
        inShip[s].dir <== ships[s][2];
        inShip[s].cx <== tx;    // 已由上方 Num2Bits(4) 保证 < 16
        inShip[s].cy <== ty;
        acc += inShip[s].out;
    }
    result <== acc;
    result * (result - 1) === 0;
}

// 公开输入声明(§5.3 锁定):publicSignals = [result, commitment, tx, ty]
component main {public [commitment, tx, ty]} = Shot();
