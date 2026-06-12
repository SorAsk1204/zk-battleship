pragma circom 2.1.9;

// common.circom —— board / shot 共享模板(Task 1.1,Design §5.2 锁定写法)。
// 本文件无 main,仅被 board.circom / shot.circom include。
//
// ★ 比较器健全性总纲(本文件最重要的不变量):
// circomlib 的 LessThan(n) 内部计算 in[0] + 2^n - in[1] 再用 Num2Bits(n+1) 取第
// n 位;LessEqThan / GreaterEqThan 都是它的薄包装。该取位结论只有当两个输入都
// < 2^n 时才可靠——输入若是未约束的域元素(可达 p-1 ≈ 2^254),mod p 后取位结果
// 毫无意义,比较器不健全,p-1 这类"负数"就能伪装成小坐标混进来。
// 因此本文件所有比较器统一位宽 n=4(界 16),并保证每个比较器输入都已被约束 < 16:
//   - x, y:ValidShip 第一步用 Num2Bits(4) 显式约束(先于一切比较);
//   - endX / endY / x+len-1:x,y ≤ 9 与 len ≤ 5 联立成立时最大 9+4=13 < 16。
//     R1CS 约束是联立的而非顺序执行:恶意 witness 若取 x>9,会先违反 xle.out===1
//     使整个系统不可满足,所以"13 < 16"这个界在系统可满足的前提下必然成立;
//   - cx, cy:由调用方保证 < 16(board 中是编译期常量 0..9;shot 中 tx/ty 必须
//     先过 Num2Bits(4),见 Task 1.4)。

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

// 单船合法性:坐标域 + 方向布尔 + 船尾界内。
// len 为编译期参数(shipId 0–4 对应长度 [5,4,3,3,2],Design §4.1 锁定)。
template ValidShip(len) {
    signal input x;
    signal input y;
    signal input dir;

    // 1) 类型域:先 Num2Bits(4) 把 x,y 钉死在 [0,16) ——防 p-1 等域回绕值,
    //    这是下方 LessEqThan(4) 健全的前提;再 LessEqThan(4) 收紧到 ≤ 9。
    component xb = Num2Bits(4);
    xb.in <== x;
    component yb = Num2Bits(4);
    yb.in <== y;
    component xle = LessEqThan(4);
    xle.in[0] <== x;
    xle.in[1] <== 9;
    xle.out === 1;
    component yle = LessEqThan(4);
    yle.in[0] <== y;
    yle.in[1] <== 9;
    yle.out === 1;

    // dir ∈ {0,1}:防 dir=2 或任意域元素流入下方线性混合与 InShip 的指示值选择。
    dir * (dir - 1) === 0;

    // 2) 界内(§5.2 锁定写法):用 dir 线性混合出沿船身方向的尾格坐标。
    //    dir=0 → endX = x+len-1, endY = y;dir=1 → endX = x, endY = y+len-1。
    //    头格 ≥ 0 由域检查保证,尾格 ≤ 9 即整船界内——防船身伸出棋盘。
    signal endX <== x + (1 - dir) * (len - 1);
    signal endY <== y + dir * (len - 1);
    component ex = LessEqThan(4);
    ex.in[0] <== endX;
    ex.in[1] <== 9;
    ex.out === 1;
    component ey = LessEqThan(4);
    ey.in[0] <== endY;
    ey.in[1] <== 9;
    ey.out === 1;
}

// 指示值:格 (cx,cy) 是否被该船占用,out ∈ {0,1}。
// 前提(调用方必须保证,本模板不重复约束):
//   - x, y, dir 已被 ValidShip 约束(x,y < 16 且 ≤ 9,dir 布尔);
//   - cx, cy < 16(board 中是编译期常量 0..9;shot 中 tx,ty 须先 Num2Bits(4))。
template InShip(len) {
    signal input x;
    signal input y;
    signal input dir;
    signal input cx;
    signal input cy;
    signal output out;

    component eqY = IsEqual();
    eqY.in[0] <== cy;
    eqY.in[1] <== y;
    component eqX = IsEqual();
    eqX.in[0] <== cx;
    eqX.in[1] <== x;
    component geX = GreaterEqThan(4);
    geX.in[0] <== cx;
    geX.in[1] <== x;
    component leX = LessEqThan(4);
    leX.in[0] <== cx;
    leX.in[1] <== x + len - 1;
    component geY = GreaterEqThan(4);
    geY.in[0] <== cy;
    geY.in[1] <== y;
    component leY = LessEqThan(4);
    leY.in[0] <== cy;
    leY.in[1] <== y + len - 1;

    // dir=0 水平:cy==y AND x ≤ cx ≤ x+len-1;dir=1 垂直对称。
    // 布尔值相乘 = AND;<== 右侧最多二次,故拆两步。
    signal hx <== eqY.out * geX.out;
    signal horiz <== hx * leX.out;
    signal vy <== eqX.out * geY.out;
    signal vert <== vy * leY.out;
    // 按 dir 二选一:(1-dir)*horiz + dir*vert 的等价单乘法形式(dir 布尔已约束)。
    out <== horiz + dir * (vert - horiz);
}
