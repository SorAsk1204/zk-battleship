pragma circom 2.1.9;

// 管线常驻冒烟电路:验证 compile→ptau→setup→export 全链路与 circomlib include
// 解析(-l node_modules → pnpm junction)。必须 include circomlib —— 这是本电路
// 的核心目的之一,不要"优化"成无依赖的小电路。
// Poseidon(2) 约 240 约束,pot12 绰绰有余。
include "circomlib/circuits/poseidon.circom";

template Smoke() {
    signal input a;
    signal input b;
    signal output h;

    h <== Poseidon(2)([a, b]);
}

component main = Smoke();
