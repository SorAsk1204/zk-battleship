// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {Battleship} from "../src/Battleship.sol";
import {ProofFixtures} from "./fixtures/ProofFixtures.sol";
import {BattleshipHarness} from "./BattleshipHarness.sol";

/// @notice 回放式属性检查(M1 Task 1.10):固定剧本逐回合推进,在每个回合边界断言全局性质。
///         按计划裁决,无证明的随机 fuzzing 套件已砍(不写 forge invariant_/handler):
///         respond 必须携带真实 Groth16 证明,随机输入构造不出合法状态推进,fuzz 只会撞 revert。
contract InvariantsTest is BattleshipHarness {
    /// 用例 1:全局回放 —— 每个回合边界检查 hits 单调性、phase 单向性、turn 节奏;
    ///         终局后对账事件流:shotMap 置位数 == ShotResolved 事件数,totalHits 随事件流单调。
    function test_replayPropertiesFullGame() public {
        uint256 id = createAndJoin();
        vm.recordLogs();

        uint8 prevHits0 = 0;
        uint8 prevHits1 = 0;
        bool sawFinished = false;
        for (uint256 r = 1; r <= 17; r++) {
            playRounds(id, 1);
            Battleship.Game memory g = game.getGame(id);

            // hits 单调不减(与上回合快照比)且封顶 17
            assertGe(g.hits[0], prevHits0, "hits[0] monotonic");
            assertGe(g.hits[1], prevHits1, "hits[1] monotonic");
            assertLe(g.hits[0], 17, "hits[0] cap");
            assertLe(g.hits[1], 17, "hits[1] cap");
            // 固定剧本的确定值:P0 只挨 miss,P1 每回合恰好 +1 hit
            assertEq(g.hits[0], 0, "hits[0] stays 0 in scripted game");
            assertEq(uint256(g.hits[1]), r, "hits[1] == rounds played");
            prevHits0 = g.hits[0];
            prevHits1 = g.hits[1];

            // 回合边界观察点只允许 AwaitingAttack / Finished,且 Finished 是吸收态(单向)
            bool finished = g.phase == Battleship.Phase.Finished;
            assertTrue(finished || g.phase == Battleship.Phase.AwaitingAttack, "phase at round boundary");
            // 早终局防御断言:固定剧本恰在 r==17 才终局,此分支正常不会进入;
            // 若剧本/合约异常导致提前 Finished,单向性检查仍生效而非被静默跳过。
            if (sawFinished) assertTrue(finished, "Finished is terminal: no phase after it");
            sawFinished = sawFinished || finished;

            // turn 节奏:每个完整回合 = P0 攻(hit 后换边到 P1)→ P1 攻(miss 后换边回 P0),
            // 边界处恒轮到 P0;终局回合(第 17 hit)同交易结束、不换边,turn 也停在 0。
            assertEq(g.turn, 0, "turn at round boundary");
        }

        // 终局:17 回合恰好打满,P0 胜
        assertTrue(sawFinished, "game finished after 17 rounds");
        Battleship.Game memory gf = game.getGame(id);
        assertEq(gf.winner, p0, "winner");
        assertEq(gf.hits[0], 0, "final hits[0]");
        assertEq(gf.hits[1], 17, "final hits[1]");

        // 事件流对账:ShotResolved 计数 + totalHits 按防守方单调(defender=1 走 1..17,defender=0 恒 0)
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 resolved = 0;
        uint8[2] memory lastTotalHits;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != Battleship.ShotResolved.selector) continue;
            resolved++;
            (uint8 defender,,,, uint8 totalHits) = abi.decode(logs[i].data, (uint8, uint8, uint8, uint8, uint8));
            assertGe(totalHits, lastTotalHits[defender], "totalHits monotonic per defender");
            lastTotalHits[defender] = totalHits;
        }
        assertEq(resolved, 33, "17 hits on B + 16 misses on A");
        // D11 不变量:respond 成功时才置位 ⇒ 两边 shotMap 置位总数 == ShotResolved 事件数
        assertEq(_popcount(gf.shotMap[0]) + _popcount(gf.shotMap[1]), resolved, "shotMap bits == ShotResolved count");
        assertEq(_popcount(gf.shotMap[0]), 16, "A board: 16 water cells shot");
        assertEq(_popcount(gf.shotMap[1]), 17, "B board: 17 ship cells shot");
    }

    /// 用例 2:shotMap 与棋盘事实逐位对照 —— 全局后 shotMap[1] 恰是 B 的 17 个船格,
    ///         shotMap[0] 恰是 A 的 16 个固定水格;全字相等同时排除多余置位。
    function test_shotMapMatchesShipTruth() public {
        uint256 id = createAndJoin();
        playFullGame(id);
        Battleship.Game memory g = game.getGame(id);

        // 期望位图从 fixture 元数据重建(bit = y*10+x,与合约置位公式一致)
        uint8[17] memory bxs = ProofFixtures.bShipXs();
        uint8[17] memory bys = ProofFixtures.bShipYs();
        uint256 expectedB = 0;
        for (uint256 i = 0; i < 17; i++) {
            expectedB |= uint256(1) << (uint256(bys[i]) * 10 + uint256(bxs[i]));
        }
        assertEq(_popcount(expectedB), 17, "fixture sanity: 17 distinct ship cells");
        assertEq(g.shotMap[1], expectedB, "shotMap[1] == B's 17 ship cells, no extra bits");

        uint8[16] memory axs = ProofFixtures.aWaterXs();
        uint8[16] memory ays = ProofFixtures.aWaterYs();
        uint256 expectedA = 0;
        for (uint256 i = 0; i < 16; i++) {
            expectedA |= uint256(1) << (uint256(ays[i]) * 10 + uint256(axs[i]));
        }
        assertEq(_popcount(expectedA), 16, "fixture sanity: 16 distinct water cells");
        assertEq(g.shotMap[0], expectedA, "shotMap[0] == A's 16 water cells, no extra bits");
    }

    /// 用例 3:Finished 是冻结态 —— 拒绝面已由 StateMachine 用例 13 详尽覆盖,
    ///         此处轻量重申并补上缺失的一半:被拒调用后整个 Game struct 逐字段不变。
    function test_finishedStateFrozen() public {
        uint256 id = createAndJoin();
        playFullGame(id);
        bytes memory snapshot = abi.encode(game.getGame(id));

        vm.prank(outsider);
        vm.expectRevert(bytes("BAD_PHASE"));
        game.joinGame(id, ProofFixtures.commitmentC(), ProofFixtures.boardC());

        vm.prank(p0);
        vm.expectRevert(bytes("BAD_PHASE"));
        game.attack(id, ProofFixtures.aWaterXs()[0], ProofFixtures.aWaterYs()[0]);

        vm.prank(p1);
        vm.expectRevert(bytes("BAD_PHASE"));
        game.respond(id, 0, ProofFixtures.shotBMissAtW());

        vm.prank(p1);
        vm.expectRevert(bytes("BAD_PHASE"));
        game.claimTimeout(id);

        vm.prank(p0);
        vm.expectRevert(bytes("BAD_PHASE"));
        game.cancelGame(id);

        // abi.encode 快照比较:覆盖含 hits/shotMap 数组在内的全部字段
        assertEq(abi.encode(game.getGame(id)), snapshot, "Finished game state frozen field-by-field");
    }

    /// @dev uint256 位图置位计数(Brian Kernighan:每轮清掉最低位的 1)。测试用,gas 不敏感。
    function _popcount(uint256 x) internal pure returns (uint256 n) {
        while (x != 0) {
            x &= x - 1;
            n++;
        }
    }
}
