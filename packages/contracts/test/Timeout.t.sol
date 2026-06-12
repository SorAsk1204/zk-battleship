// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Battleship} from "../src/Battleship.sol";
import {ProofFixtures} from "./fixtures/ProofFixtures.sol";
import {BattleshipHarness} from "./BattleshipHarness.sol";

/// @notice 超时语义测试套件(M1 Task 1.10):claimTimeout 正路双向 + lastActionAt 计时器语义(§4.3)。
///         反向用例(BAD_PHASE / NOT_TIMEOUT 恰好边界 / NOT_CLAIMANT)已由 StateMachine 用例 11
///         覆盖,此处不重复;本套件只测"该赢的人能赢"与"计时锚点何时动、何时不动"。
contract TimeoutTest is BattleshipHarness {
    /// 用例 1:AwaitingAttack 超时 —— 义务方是回合方 P0,守约方 P1(非义务方)判胜。
    function test_timeoutInAwaitingAttack() public {
        uint256 id = createAndJoin();
        Battleship.Game memory g = game.getGame(id);

        // P0(回合方)拒不开炮;严格大于语义,+TIMEOUT+1 越过边界
        vm.warp(uint256(g.lastActionAt) + game.TIMEOUT() + 1);
        vm.prank(p1);
        vm.expectEmit();
        emit Battleship.GameFinished(id, p1, "timeout");
        game.claimTimeout(id);

        g = game.getGame(id);
        assertEq(uint8(g.phase), uint8(Battleship.Phase.Finished), "phase");
        assertEq(g.winner, p1, "winner");
    }

    /// 用例 2:AwaitingResponse 超时 —— 义务方是防守方 P1,攻击方 P0(非义务方)判胜。
    function test_timeoutInAwaitingResponse() public {
        uint256 id = createAndJoin();
        // 先打 2 个完整回合:验证超时语义在局中(而非仅开局)同样成立
        playRounds(id, 2);

        // 第 3 回合上半场:P0 攻 B 船格 2 后,P1(防守方)拒不应答
        vm.prank(p0);
        game.attack(id, ProofFixtures.bShipXs()[2], ProofFixtures.bShipYs()[2]);
        Battleship.Game memory g = game.getGame(id);
        assertEq(uint8(g.phase), uint8(Battleship.Phase.AwaitingResponse), "precondition: awaiting response");

        vm.warp(uint256(g.lastActionAt) + game.TIMEOUT() + 1);
        vm.prank(p0);
        vm.expectEmit();
        emit Battleship.GameFinished(id, p0, "timeout");
        game.claimTimeout(id);

        g = game.getGame(id);
        assertEq(uint8(g.phase), uint8(Battleship.Phase.Finished), "phase");
        assertEq(g.winner, p0, "winner");
    }

    /// 用例 3(§4.3):每次合法状态推进都刷新 lastActionAt —— attack/respond 都把计时锚点拉到当下。
    function test_timerRefreshedByEveryAction() public {
        uint256 id = createAndJoin();
        uint256 t0 = game.getGame(id).lastActionAt; // join 时刻

        // join 后 200s:P0 开炮,锚点应刷新到当下
        vm.warp(t0 + 200);
        vm.prank(p0);
        game.attack(id, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);
        assertEq(uint256(game.getGame(id).lastActionAt), t0 + 200, "attack refreshes timer");

        // 再过 200s:距 attack 仅 200s,但距 join 已 400s > TIMEOUT。
        // 若 attack 没刷新锚点,这一刻 P0 已可对义务方 P1 判胜;刷新语义下必须 NOT_TIMEOUT。
        vm.warp(t0 + 400);
        vm.prank(p0);
        vm.expectRevert(bytes("NOT_TIMEOUT"));
        game.claimTimeout(id);

        // P1 正常应答仍然成功,且锚点再次刷新到当下
        vm.prank(p1);
        game.respond(id, 1, ProofFixtures.shotBHit(0));
        assertEq(uint256(game.getGame(id).lastActionAt), t0 + 400, "respond refreshes timer");
    }

    /// 用例 4(§4.3):非法调用不刷新计时器 —— EVM revert 回滚一切状态写入的文档性保证:
    ///         义务方不能靠反复发非法交易"摸"计时器续命。
    function test_illegalCallDoesNotRefreshTimer() public {
        uint256 id = createAndJoin();
        uint256 t0 = game.getGame(id).lastActionAt; // join 时刻,义务方 P0 此后从未合法行动

        // +250s:错误方 P1(非回合方)尝试开炮,被 NOT_TURN 拒绝
        vm.warp(t0 + 250);
        vm.prank(p1);
        vm.expectRevert(bytes("NOT_TURN"));
        game.attack(id, ProofFixtures.aWaterXs()[0], ProofFixtures.aWaterYs()[0]);
        // revert 不改任何状态:锚点仍是 join 时刻
        assertEq(uint256(game.getGame(id).lastActionAt), t0, "reverted call must not refresh timer");

        // 总 +301s(仍以 join 为锚):超时成立,P1 判胜
        vm.warp(t0 + 301);
        vm.prank(p1);
        game.claimTimeout(id);

        Battleship.Game memory g = game.getGame(id);
        assertEq(uint8(g.phase), uint8(Battleship.Phase.Finished), "phase");
        assertEq(g.winner, p1, "winner");
    }
}
