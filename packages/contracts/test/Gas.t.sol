// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProofFixtures} from "./fixtures/ProofFixtures.sol";
import {BattleshipHarness} from "./BattleshipHarness.sol";

/// @notice Gas 计量套件(M1 Task 1.11):六个关键操作各一个独立测试,只为 `forge snapshot`。
///         package.json 的 snapshot script 用 `--match-contract GasTest` 限定到本合约
///         (篡改路径测试 ~1.02B gas 与全局回放测试 8–9M gas 会污染 .gas-snapshot,见 DECISIONS)。
/// @dev 计量纪律:每个测试体只含被计量的那一笔合约调用,全部前置编排在 setUp 完成,
///      让 snapshot 数字尽量贴近单笔操作的真实 gas(测试侧仅余 prank + fixture 内存构造的小额噪声)。
///      正确性断言一律不写——会把 getGame/assert 的 gas 混进计量;正确性由其余套件覆盖,
///      这里测试不 revert 即为通过。数字只记录、无容差门禁:proof 字节含 prover 随机数,
///      fixture 重新生成后 calldata 非零字节数变化,gas 天然抖动(DECISIONS)。
contract GasTest is BattleshipHarness {
    uint256 internal createdId; // Created:等 P1 join(计量 joinGame)
    uint256 internal attackReadyId; // AwaitingAttack:等 P0 开炮(计量 attack)
    uint256 internal missRespondId; // AwaitingResponse:pending=A 水格 0,等 P0 miss 应答
    uint256 internal hitRespondId; // AwaitingResponse:pending=B 船格 0,等 P1 hit 应答
    uint256 internal finalRespondId; // AwaitingResponse:已 16 hit,pending=B 船格 16,等 P1 终局应答

    // attack 计量用坐标,setUp 预存,免去测试体内展开 uint8[17] 数组的额外 gas
    uint8 internal attackX;
    uint8 internal attackY;

    function setUp() public override {
        super.setUp();

        // joinGame 前置:一个 Created 局
        vm.prank(p0);
        createdId = game.createGame(ProofFixtures.commitmentA(), ProofFixtures.boardA());

        // attack 前置:已开局,P0 的回合;目标格取 B 船格 0
        attackReadyId = createAndJoin();
        attackX = ProofFixtures.bShipXs()[0];
        attackY = ProofFixtures.bShipYs()[0];

        // respondMiss 前置:先打上半回合把回合权交给 P1(P0 攻 B 船格 0、P1 hit 应答),
        // 再让 P1 攻 A 的水格 0 ⇒ pending=A 水格,等 P0 miss 应答
        missRespondId = createAndJoin();
        vm.prank(p0);
        game.attack(missRespondId, attackX, attackY);
        vm.prank(p1);
        game.respond(missRespondId, 1, ProofFixtures.shotBHit(0));
        vm.prank(p1);
        game.attack(missRespondId, ProofFixtures.aWaterXs()[0], ProofFixtures.aWaterYs()[0]);

        // respondHit 前置:P0 攻 B 船格 0 ⇒ pending=B 船格,等 P1 hit 应答
        hitRespondId = createAndJoin();
        vm.prank(p0);
        game.attack(hitRespondId, attackX, attackY);

        // respondFinal 前置:helper 打满 16 个完整回合(hits[1]=16),再手动让 P0 攻 B 船格 16
        // ⇒ 等 P1 第 17 hit 应答(respond 同交易走终局结算分支)。
        // 此后不再对该局调 playRounds,不触 Harness docblock 的混用警告。
        finalRespondId = createAndJoin();
        playRounds(finalRespondId, 16);
        vm.prank(p0);
        game.attack(finalRespondId, ProofFixtures.bShipXs()[16], ProofFixtures.bShipYs()[16]);
    }

    /// 计量 1:createGame(board 证明验证 ~15k 约束 + 新局落库)
    function test_gas_createGame() public {
        vm.prank(p0);
        game.createGame(ProofFixtures.commitmentA(), ProofFixtures.boardA());
    }

    /// 计量 2:joinGame(board 证明验证 + 开局状态写入)
    function test_gas_joinGame() public {
        vm.prank(p1);
        game.joinGame(createdId, ProofFixtures.commitmentB(), ProofFixtures.boardB());
    }

    /// 计量 3:attack(纯状态机推进,无证明验证——六操作中最便宜的一笔)
    function test_gas_attack() public {
        vm.prank(p0);
        game.attack(attackReadyId, attackX, attackY);
    }

    /// 计量 4:respond miss 路径(shot 证明验证 + shotMap 置位,不动 hits)
    function test_gas_respondMiss() public {
        vm.prank(p0);
        game.respond(missRespondId, 0, ProofFixtures.shotAMiss(0));
    }

    /// 计量 5:respond hit 路径(shot 证明验证 + shotMap 置位 + hits 自增)
    function test_gas_respondHit() public {
        vm.prank(p1);
        game.respond(hitRespondId, 1, ProofFixtures.shotBHit(0));
    }

    /// 计量 6:respond 第 17 hit(同交易终局结算分支:phase→Finished + winner 写入 + GameFinished)
    function test_gas_respondFinal17thHit() public {
        vm.prank(p1);
        game.respond(finalRespondId, 1, ProofFixtures.shotBHit(16));
    }
}
