pragma circom 2.1.9;

// board.circom —— 开局合法性证明(Task 1.2,Design §5.2)。
// 私有输入 ships[5][3] + salt,唯一公开信号是输出 commitment。
// 证明语义:"我知道一组满足全部布阵规则的 ships + salt,其 Poseidon 承诺等于
// commitment"——链上只看 commitment,布阵全程保密。

include "common.circom";
include "circomlib/circuits/poseidon.circom";

template Board() {
    signal input ships[5][3];   // 私有:(x, y, dir) × 5,shipId 序 = 长度表序
    signal input salt;          // 私有:≥128bit CSPRNG,承诺隐藏性的唯一来源(§5.1)
    signal output commitment;   // 公开:Poseidon(16)

    // 协议锁定(§4.1):shipId 0–4 对应长度,与 lib/boardLogic.ts SHIP_LENGTHS 一致
    var LENS[5] = [5, 4, 3, 3, 2];

    // ── 约束 1+2:逐船 类型域 + dir 布尔 + 界内(common.circom ValidShip)──
    // 防:域外坐标(含 p-1 回绕)、dir∉{0,1}、船身伸出棋盘。
    component valid[5];
    for (var s = 0; s < 5; s++) {
        valid[s] = ValidShip(LENS[s]);
        valid[s].x <== ships[s][0];
        valid[s].y <== ships[s][1];
        valid[s].dir <== ships[s][2];
    }

    // ── 约束 3:无重叠 ──
    // 对全部 100 格 c:occ[c] = 五船指示值之和;occ[c]*(occ[c]-1)===0 强制每格
    // 占用 ∈ {0,1}——任意两船共占一格则该格 occ ≥ 2,系统不可满足。
    // 允许贴边相邻(§4.1):相邻格各自 occ=1,不违反任何约束。
    // occ 全格布尔 + 每船 len 格全落界内 ⇒ Σocc = 17 自动成立,无需单独约束(§5.2)。
    component inShip[100][5];
    signal occ[100];
    for (var c = 0; c < 100; c++) {
        var cx = c % 10;    // 行主序 c = cy*10 + cx,与 lib occupancyGrid 同序
        var cy = c \ 10;    // c 是编译期 var,整除用 \
        var acc = 0;
        for (var s = 0; s < 5; s++) {
            inShip[c][s] = InShip(LENS[s]);
            inShip[c][s].x <== ships[s][0];
            inShip[c][s].y <== ships[s][1];
            inShip[c][s].dir <== ships[s][2];
            // cx/cy 是编译期常量 0..9 < 16,满足 InShip 比较器健全性前提
            inShip[c][s].cx <== cx;
            inShip[c][s].cy <== cy;
            acc += inShip[c][s].out;
        }
        occ[c] <== acc;
        occ[c] * (occ[c] - 1) === 0;
    }

    // ── 约束 4:承诺绑定(§5.1 顺序锁定,必须与 lib/encoding.ts 逐字一致)──
    // inputs = [x0,y0,d0, x1,y1,d1, ..., x4,y4,d4, salt],salt 固定在 inputs[15]。
    // 顺序写错 ⇒ JS 与电路承诺对不上,B1 测试就是钉死这条的。
    component h = Poseidon(16);
    for (var s = 0; s < 5; s++) {
        for (var k = 0; k < 3; k++) {
            h.inputs[3 * s + k] <== ships[s][k];
        }
    }
    h.inputs[15] <== salt;
    commitment <== h.out;
}

component main = Board();
