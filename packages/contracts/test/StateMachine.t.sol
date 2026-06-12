// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {Battleship, BoardProof} from "../src/Battleship.sol";
import {ProofFixtures} from "./fixtures/ProofFixtures.sol";
import {BattleshipHarness} from "./BattleshipHarness.sol";

/// @notice 状态机测试套件(M1 Task 1.8):正路用例 1–6 + 反向用例 7–13。
///         反向用例逐一钉死全部 13 个错误码,vm.expectRevert(bytes("CODE")) 精确匹配。
contract StateMachineTest is BattleshipHarness {
    // ============ 正路(用例 1–6) ============

    /// 用例 1:createGame 的全部可观察效果。
    function test_createGame() public {
        vm.prank(p0);
        vm.expectEmit();
        emit Battleship.GameCreated(1, p0); // gameId 从 1 起(D11)
        uint256 id = game.createGame(ProofFixtures.commitmentA(), ProofFixtures.boardA());
        assertEq(id, 1, "first gameId");

        Battleship.Game memory g = game.getGame(id);
        assertEq(uint8(g.phase), uint8(Battleship.Phase.Created), "phase");
        assertEq(g.p0, p0, "p0");
        assertEq(g.commitment0, ProofFixtures.commitmentA(), "commitment0");
        assertEq(g.lastActionAt, uint64(block.timestamp), "lastActionAt");

        // gameId 自增:连开第二局 id=2
        vm.prank(p1);
        uint256 id2 = game.createGame(ProofFixtures.commitmentB(), ProofFixtures.boardB());
        assertEq(id2, 2, "second gameId");
    }

    /// 用例 2:joinGame 后进入 AwaitingAttack、P0 先攻。
    function test_joinGame() public {
        vm.prank(p0);
        uint256 id = game.createGame(ProofFixtures.commitmentA(), ProofFixtures.boardA());

        vm.prank(p1);
        vm.expectEmit();
        emit Battleship.GameJoined(id, p1);
        game.joinGame(id, ProofFixtures.commitmentB(), ProofFixtures.boardB());

        Battleship.Game memory g = game.getGame(id);
        assertEq(uint8(g.phase), uint8(Battleship.Phase.AwaitingAttack), "phase");
        assertEq(g.turn, 0, "P0 first to attack");
        assertEq(g.p1, p1, "p1");
        assertEq(g.commitment1, ProofFixtures.commitmentB(), "commitment1");
    }

    /// 用例 3:attack→respond 的 miss 全链路(pending/事件字段/换边/shotMap)。
    function test_attackThenRespond_miss() public {
        uint256 id = createAndJoin();
        // 先打上半回合把回合权交给 P1:P0 攻 B 船格 0,P1 hit 应答(hits[1]=1,turn→1)
        vm.prank(p0);
        game.attack(id, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);
        vm.prank(p1);
        game.respond(id, 1, ProofFixtures.shotBHit(0));

        uint8 x = ProofFixtures.aWaterXs()[0];
        uint8 y = ProofFixtures.aWaterYs()[0];

        // P1 开炮:ShotFired 携带攻击方索引 1(uint8,非地址)
        vm.prank(p1);
        vm.expectEmit();
        emit Battleship.ShotFired(id, 1, x, y);
        game.attack(id, x, y);

        Battleship.Game memory g = game.getGame(id);
        assertEq(uint8(g.phase), uint8(Battleship.Phase.AwaitingResponse), "phase after attack");
        assertEq(g.pendingX, x, "pendingX");
        assertEq(g.pendingY, y, "pendingY");
        assertEq(g.turn, 1, "turn unchanged while awaiting response");

        // P0 miss 应答:ShotResolved 携防守方索引 0,result=0,totalHits=0
        vm.prank(p0);
        vm.expectEmit();
        emit Battleship.ShotResolved(id, 0, x, y, 0, 0);
        game.respond(id, 0, ProofFixtures.shotAMiss(0));

        g = game.getGame(id);
        assertEq(uint8(g.phase), uint8(Battleship.Phase.AwaitingAttack), "phase after respond");
        // miss 后换边:turn = defender,即 1→0(P0 重新成为攻击方)
        assertEq(g.turn, 0, "turn flips to defender after miss");
        // hits 不因 miss 改变:hits[0] 仍 0(hits[1] 的 1 来自前置上半回合)
        assertEq(g.hits[0], 0, "hits[0]");
        assertEq(g.hits[1], 1, "hits[1]");
        // shotMap[0] 对应位置位(bit = y*10+x)
        assertEq((g.shotMap[0] >> (uint256(y) * 10 + uint256(x))) & 1, 1, "shotMap[0] bit set");
    }

    /// 用例 4:hit 应答计入 hits、事件字段正确。
    function test_respond_hit() public {
        uint256 id = createAndJoin();
        uint8 x = ProofFixtures.bShipXs()[0];
        uint8 y = ProofFixtures.bShipYs()[0];
        vm.prank(p0);
        game.attack(id, x, y);

        vm.prank(p1);
        vm.expectEmit();
        emit Battleship.ShotResolved(id, 1, x, y, 1, 1);
        game.respond(id, 1, ProofFixtures.shotBHit(0));

        Battleship.Game memory g = game.getGame(id);
        assertEq(g.hits[1], 1, "hits[1]");
        assertEq(g.hits[0], 0, "hits[0]");
        assertEq(uint8(g.phase), uint8(Battleship.Phase.AwaitingAttack), "phase");
        assertEq(g.turn, 1, "turn flips to defender after hit");
    }

    /// 用例 5:打满全局 P0 胜;事件流 33+33+1,终局 respond 同交易先 ShotResolved 后 GameFinished。
    function test_fullGame_17hits() public {
        uint256 id = createAndJoin();
        vm.recordLogs();
        playFullGame(id);

        Battleship.Game memory g = game.getGame(id);
        assertEq(uint8(g.phase), uint8(Battleship.Phase.Finished), "phase");
        assertEq(g.winner, p0, "winner");
        assertEq(g.hits[0], 0, "hits[0]");
        assertEq(g.hits[1], 17, "hits[1]");
        // 终局 respond 同交易直接 Finished,turn 不再换边(仍停在攻击方 P0)
        assertEq(g.turn, 0, "turn not flipped at game end");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 67, "33 ShotFired + 33 ShotResolved + 1 GameFinished");
        uint256 fired;
        uint256 resolved;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == Battleship.ShotFired.selector) fired++;
            if (logs[i].topics[0] == Battleship.ShotResolved.selector) resolved++;
        }
        assertEq(fired, 33, "ShotFired count");
        assertEq(resolved, 33, "ShotResolved count");

        // 倒数第二条:第 17 hit 的 ShotResolved(defender=1,坐标=B 船格 16,totalHits=17)
        Vm.Log memory lastResolved = logs[logs.length - 2];
        assertEq(lastResolved.topics[0], Battleship.ShotResolved.selector, "second-to-last is ShotResolved");
        (uint8 defender, uint8 rx, uint8 ry, uint8 result, uint8 totalHits) =
            abi.decode(lastResolved.data, (uint8, uint8, uint8, uint8, uint8));
        assertEq(defender, 1, "defender index");
        assertEq(rx, ProofFixtures.bShipXs()[16], "x");
        assertEq(ry, ProofFixtures.bShipYs()[16], "y");
        assertEq(result, 1, "result");
        assertEq(totalHits, 17, "totalHits");

        // 最后一条:同交易紧随其后的 GameFinished(gameId, p0, "17hits"),winner/reason 非 indexed
        Vm.Log memory finished = logs[logs.length - 1];
        assertEq(finished.topics[0], Battleship.GameFinished.selector, "last is GameFinished");
        assertEq(finished.topics[1], bytes32(id), "gameId topic");
        (address winner, string memory reason) = abi.decode(finished.data, (address, string));
        assertEq(winner, p0, "winner in event data");
        assertEq(reason, "17hits", "reason");
    }

    /// 用例 6:JOIN_WINDOW 过后创建者撤局。
    function test_cancelGame() public {
        vm.prank(p0);
        uint256 id = game.createGame(ProofFixtures.commitmentA(), ProofFixtures.boardA());
        Battleship.Game memory g = game.getGame(id);

        vm.warp(uint256(g.lastActionAt) + game.JOIN_WINDOW() + 1); // 严格大于才允许撤
        vm.prank(p0);
        vm.expectEmit();
        emit Battleship.GameFinished(id, address(0), "cancelled");
        game.cancelGame(id);

        g = game.getGame(id);
        assertEq(uint8(g.phase), uint8(Battleship.Phase.Cancelled), "phase");
    }

    // ============ 反向用例(7–13):13 个错误码逐一精确匹配 ============

    /// 用例 7:createGame 的 PROOF_MISMATCH / BAD_PROOF。
    function test_createGame_reverts() public {
        // PROOF_MISMATCH:boardA 证明配 B 的承诺(pubSignals[0] != commitment 参数)
        vm.prank(p0);
        vm.expectRevert(bytes("PROOF_MISMATCH"));
        game.createGame(ProofFixtures.commitmentB(), ProofFixtures.boardA());

        // BAD_PROOF:承诺正确但证明被篡改(verifier 返回 false 不 revert,靠 require 拦)
        BoardProof memory p = ProofFixtures.boardA();
        p.a[0] += 1;
        vm.prank(p0);
        vm.expectRevert(bytes("BAD_PROOF"));
        game.createGame(ProofFixtures.commitmentA(), p);
    }

    /// 用例 8:joinGame 的 BAD_PHASE(不存在/已 join)/ SELF_JOIN / PROOF_MISMATCH / BAD_PROOF。
    function test_joinGame_reverts() public {
        // BAD_PHASE:gameId 不存在(games[id].phase == None)
        vm.prank(p1);
        vm.expectRevert(bytes("BAD_PHASE"));
        game.joinGame(42, ProofFixtures.commitmentB(), ProofFixtures.boardB());

        vm.prank(p0);
        uint256 id = game.createGame(ProofFixtures.commitmentA(), ProofFixtures.boardA());

        // SELF_JOIN:创建者加入自己的局
        vm.prank(p0);
        vm.expectRevert(bytes("SELF_JOIN"));
        game.joinGame(id, ProofFixtures.commitmentB(), ProofFixtures.boardB());

        // PROOF_MISMATCH:boardB 证明配 C 的承诺
        vm.prank(p1);
        vm.expectRevert(bytes("PROOF_MISMATCH"));
        game.joinGame(id, ProofFixtures.commitmentC(), ProofFixtures.boardB());

        // BAD_PROOF:承诺正确但证明被篡改
        BoardProof memory p = ProofFixtures.boardB();
        p.a[0] += 1;
        vm.prank(p1);
        vm.expectRevert(bytes("BAD_PROOF"));
        game.joinGame(id, ProofFixtures.commitmentB(), p);

        // BAD_PHASE:已 join 的局再 join(phase 已是 AwaitingAttack)
        vm.prank(p1);
        game.joinGame(id, ProofFixtures.commitmentB(), ProofFixtures.boardB());
        vm.prank(outsider);
        vm.expectRevert(bytes("BAD_PHASE"));
        game.joinGame(id, ProofFixtures.commitmentC(), ProofFixtures.boardC());
    }

    /// 用例 9:attack 的 BAD_PHASE(Created/AwaitingResponse)/ NOT_TURN / OOB / REPEAT。
    function test_attack_reverts() public {
        // BAD_PHASE:Created 阶段(对手未加入)不可开炮
        vm.prank(p0);
        uint256 created = game.createGame(ProofFixtures.commitmentA(), ProofFixtures.boardA());
        vm.prank(p0);
        vm.expectRevert(bytes("BAD_PHASE"));
        game.attack(created, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);

        uint256 id = createAndJoin();

        // NOT_TURN:P0 的回合 P1 抢攻
        vm.prank(p1);
        vm.expectRevert(bytes("NOT_TURN"));
        game.attack(id, ProofFixtures.aWaterXs()[0], ProofFixtures.aWaterYs()[0]);

        // NOT_TURN:局外人代打
        vm.prank(outsider);
        vm.expectRevert(bytes("NOT_TURN"));
        game.attack(id, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);

        // OOB:x/y 各自越界(合法域 0..9)
        vm.prank(p0);
        vm.expectRevert(bytes("OOB"));
        game.attack(id, 10, ProofFixtures.bShipYs()[0]);
        vm.prank(p0);
        vm.expectRevert(bytes("OOB"));
        game.attack(id, ProofFixtures.bShipXs()[0], 10);

        // REPEAT:打满一个完整回合后,P0 再攻已应答过的同一格
        playRounds(id, 1);
        vm.prank(p0);
        vm.expectRevert(bytes("REPEAT"));
        game.attack(id, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);

        // BAD_PHASE:AwaitingResponse 期间不可连射(先合法开炮进入等应答态)
        vm.prank(p0);
        game.attack(id, ProofFixtures.bShipXs()[1], ProofFixtures.bShipYs()[1]);
        vm.prank(p0);
        vm.expectRevert(bytes("BAD_PHASE"));
        game.attack(id, ProofFixtures.bShipXs()[2], ProofFixtures.bShipYs()[2]);
    }

    /// 用例 10:respond 的 BAD_PHASE / NOT_DEFENDER / BAD_RESULT。
    function test_respond_reverts() public {
        uint256 id = createAndJoin();

        // BAD_PHASE:AwaitingAttack 阶段无 pending 炮击,不可凭空应答
        vm.prank(p1);
        vm.expectRevert(bytes("BAD_PHASE"));
        game.respond(id, 1, ProofFixtures.shotBHit(0));

        // 进入 AwaitingResponse:P0 攻 B 船格 0,defender = P1
        vm.prank(p0);
        game.attack(id, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);

        // NOT_DEFENDER:攻击方自己应答
        vm.prank(p0);
        vm.expectRevert(bytes("NOT_DEFENDER"));
        game.respond(id, 1, ProofFixtures.shotBHit(0));

        // NOT_DEFENDER:局外人应答
        vm.prank(outsider);
        vm.expectRevert(bytes("NOT_DEFENDER"));
        game.respond(id, 1, ProofFixtures.shotBHit(0));

        // BAD_RESULT:result 只允许 0/1
        vm.prank(p1);
        vm.expectRevert(bytes("BAD_RESULT"));
        game.respond(id, 2, ProofFixtures.shotBHit(0));
    }

    /// 用例 11:claimTimeout 的 BAD_PHASE / NOT_TIMEOUT(恰好边界)/ NOT_CLAIMANT。
    function test_claimTimeout_reverts() public {
        // BAD_PHASE:Created 局没有行动义务方(该走 cancelGame)
        vm.prank(p0);
        uint256 created = game.createGame(ProofFixtures.commitmentA(), ProofFixtures.boardA());
        vm.prank(p0);
        vm.expectRevert(bytes("BAD_PHASE"));
        game.claimTimeout(created);

        // AwaitingAttack:义务方是回合方 P0,守约方 P1 才有 claim 资格
        uint256 id = createAndJoin();
        Battleship.Game memory g = game.getGame(id);

        // NOT_TIMEOUT:恰好 +TIMEOUT 秒是边界,严格大于才算超时(用守约方 P1 隔离掉 claimant 检查)
        vm.warp(uint256(g.lastActionAt) + game.TIMEOUT());
        vm.prank(p1);
        vm.expectRevert(bytes("NOT_TIMEOUT"));
        game.claimTimeout(id);

        // +TIMEOUT+1:超时成立,但义务方自己不能"自己超时自己判胜"
        vm.warp(uint256(g.lastActionAt) + game.TIMEOUT() + 1);
        vm.prank(p0);
        vm.expectRevert(bytes("NOT_CLAIMANT"));
        game.claimTimeout(id);

        // 局外人也不能替守约方结束对局
        vm.prank(outsider);
        vm.expectRevert(bytes("NOT_CLAIMANT"));
        game.claimTimeout(id);
    }

    /// 用例 12:cancelGame 的 NOT_CREATOR / JOIN_WINDOW(恰好边界)/ BAD_PHASE(已 join)。
    function test_cancelGame_reverts() public {
        vm.prank(p0);
        uint256 id = game.createGame(ProofFixtures.commitmentA(), ProofFixtures.boardA());

        // NOT_CREATOR:非创建者不能撤别人挂的局
        vm.prank(p1);
        vm.expectRevert(bytes("NOT_CREATOR"));
        game.cancelGame(id);

        // JOIN_WINDOW:恰好 +JOIN_WINDOW 秒是边界,严格大于才允许撤
        Battleship.Game memory g = game.getGame(id);
        vm.warp(uint256(g.lastActionAt) + game.JOIN_WINDOW());
        vm.prank(p0);
        vm.expectRevert(bytes("JOIN_WINDOW"));
        game.cancelGame(id);

        // BAD_PHASE:已 join 的局(AwaitingAttack)不可单方面撤掉
        uint256 joined = createAndJoin();
        vm.prank(p0);
        vm.expectRevert(bytes("BAD_PHASE"));
        game.cancelGame(joined);
    }

    /// 用例 13:终局后所有携 gameId 的对外函数全被 BAD_PHASE 闸死。
    /// (createGame 不携 gameId,签名上无法指向已结束的局,天然不在拒绝面内。)
    function test_finishedGameRejectsAll() public {
        uint256 id = createAndJoin();
        playFullGame(id);

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
    }
}
