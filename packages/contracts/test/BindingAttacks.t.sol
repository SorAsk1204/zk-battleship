// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Battleship, ShotProof} from "../src/Battleship.sol";
import {ProofFixtures} from "./fixtures/ProofFixtures.sol";
import {BattleshipHarness} from "./BattleshipHarness.sol";

/// @notice 绑定攻击套件(M1 Task 1.9,本项目安全验收核心):§5.4 三项绑定逐项钉死。
///         respond 的证明只保证"对 pubSignals 里那个棋盘/那个格子,结果是 pubSignals[0]";
///         证明谈论的是否是**本局链上状态**,全靠三条绑定逐项核对:
///         (1) 承诺绑定 pubSignals[1]==存储承诺,(2) 坐标绑定 pubSignals[2/3]==pending,
///         (3) result 绑定 pubSignals[0]==result 参数。任何一项失守都是可白嫖的作弊面。
/// @dev 攻击 fixture 纪律(generate.ts 生成期断言):每个攻击与活状态合法应答**恰差一个
///      pubSignal**,保证 PROOF_MISMATCH 精确打在被测的那条绑定上,而不是被别的绑定碰巧拦下。
///      所有对局均为手动落子(不与 playRounds 混用,见 Harness docblock)。
contract BindingAttacksTest is BattleshipHarness {
    /// @dev 攻击用例公共前置断言:P0 已开炮、P1 是防守方、pending 坐标正确。
    ///      防"用例红是因为前置剧本摆错"——失败信息直接指出是哪一项前置没立住。
    function _assertAwaitingP1Response(uint256 gameId, uint8 x, uint8 y) internal view {
        Battleship.Game memory g = game.getGame(gameId);
        assertEq(uint8(g.phase), uint8(Battleship.Phase.AwaitingResponse), "pre: phase != AwaitingResponse");
        assertEq(g.pendingX, x, "pre: pendingX");
        assertEq(g.pendingY, y, "pre: pendingY");
        assertEq(g.turn, 0, "pre: attacker should be P0 (defender = P1)");
        assertEq(g.commitment1, ProofFixtures.commitmentB(), "pre: defender commitment != commitmentB");
    }

    // ============ 绑定 (2):坐标 ============

    /// 用例 1:换格攻击(tx 偏差)。pending=W′=(1,0),提交 B 在 W=(0,0) 的合法 miss 证明。
    /// W/W′ 都是 B 的水格:result 同 0、commitment 同、ty 同,仅 tx 不同 ⇒ 失败必须且只能
    /// 来自坐标绑定的 x 半边。无此绑定 = 防守方可拿任一水格的 miss 证明应答任意炮击。
    function test_respondWithOtherCellProof_x() public {
        uint256 id = createAndJoin();
        vm.prank(p0);
        game.attack(id, ProofFixtures.wPrimeX(), ProofFixtures.wPrimeY());
        _assertAwaitingP1Response(id, ProofFixtures.wPrimeX(), ProofFixtures.wPrimeY());

        // 单偏差自证:与合法应答 [0, commitmentB, W′x, W′y] 仅差 pubSignals[2]
        ShotProof memory p = ProofFixtures.shotBMissAtW();
        assertEq(p.pubSignals[0], 0, "fixture: result matches legal response");
        assertEq(p.pubSignals[1], ProofFixtures.commitmentB(), "fixture: commitment matches");
        assertNotEq(p.pubSignals[2], uint256(ProofFixtures.wPrimeX()), "fixture: tx must be the sole deviation");
        assertEq(p.pubSignals[3], uint256(ProofFixtures.wPrimeY()), "fixture: ty matches");

        vm.prank(p1);
        vm.expectRevert(bytes("PROOF_MISMATCH"));
        game.respond(id, 0, p);
    }

    /// 用例 2:换格攻击(ty 偏差)——封掉 Task 1.8 变异检验发现的留白:此前没有任何用例
    /// 在 `pubSignals[3] == pendingY` 半边失守时转红。pending=W″=(0,1),提交 W=(0,0) 的
    /// miss 证明:仅 ty 不同(tx 同、commitment 同、result 同 0)。
    function test_respondWithOtherCellProof_y() public {
        uint256 id = createAndJoin();
        vm.prank(p0);
        game.attack(id, ProofFixtures.wX(), ProofFixtures.wDoubleY());
        _assertAwaitingP1Response(id, ProofFixtures.wX(), ProofFixtures.wDoubleY());

        // 单偏差自证:与合法应答 [0, commitmentB, Wx, W″y] 仅差 pubSignals[3]
        ShotProof memory p = ProofFixtures.shotBMissAtW();
        assertEq(p.pubSignals[0], 0, "fixture: result matches legal response");
        assertEq(p.pubSignals[1], ProofFixtures.commitmentB(), "fixture: commitment matches");
        assertEq(p.pubSignals[2], uint256(ProofFixtures.wX()), "fixture: tx matches");
        assertNotEq(p.pubSignals[3], uint256(ProofFixtures.wDoubleY()), "fixture: ty must be the sole deviation");

        vm.prank(p1);
        vm.expectRevert(bytes("PROOF_MISMATCH"));
        game.respond(id, 0, p);
    }

    // ============ 绑定 (1):承诺 ============

    /// 用例 3:换棋盘攻击。pending=P=(5,0),P 同时是 B 与 C 的船格;提交 C 在 P 的合法 hit
    /// 证明:坐标对、result 对,仅 commitment 是 C 的 ⇒ 失败必须且只能来自承诺绑定。
    /// 无此绑定 = 防守方可预制一块"全 miss 棋盘"的证明集永远报 miss。
    function test_respondWithOtherBoardProof() public {
        uint256 id = createAndJoin();
        vm.prank(p0);
        game.attack(id, ProofFixtures.pX(), ProofFixtures.pY());
        _assertAwaitingP1Response(id, ProofFixtures.pX(), ProofFixtures.pY());

        // 单偏差自证:与合法应答 [1, commitmentB, Px, Py] 仅差 pubSignals[1]
        ShotProof memory p = ProofFixtures.shotCHitAtP();
        assertEq(p.pubSignals[0], 1, "fixture: result matches legal response");
        assertNotEq(p.pubSignals[1], ProofFixtures.commitmentB(), "fixture: commitment must be the sole deviation");
        assertEq(p.pubSignals[1], ProofFixtures.commitmentC(), "fixture: commitment is C's");
        assertEq(p.pubSignals[2], uint256(ProofFixtures.pX()), "fixture: tx matches");
        assertEq(p.pubSignals[3], uint256(ProofFixtures.pY()), "fixture: ty matches");

        vm.prank(p1);
        vm.expectRevert(bytes("PROOF_MISMATCH"));
        game.respond(id, 1, p);
    }

    // ============ 绑定 (3):result 参数 ============

    /// 用例 4:篡改 result 参数(双向)。事件流与 hits 采信的是 calldata 的 result,
    /// 必须与证明实际输出 pubSignals[0] 逐位一致,否则防守方可"证明说 hit、嘴上报 miss"
    /// 赖掉命中(方向 1),或反向虚报命中污染事件流(方向 2)。
    function test_respondWithFlippedResult() public {
        // 方向 1:证明说 1(hit),参数说 0 —— pending=B 船格 0,proof 全部吻合,仅参数撒谎
        uint256 id = createAndJoin();
        vm.prank(p0);
        game.attack(id, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);
        _assertAwaitingP1Response(id, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);

        ShotProof memory pHit = ProofFixtures.shotBHit(0);
        assertEq(pHit.pubSignals[0], 1, "fixture: proof actually says hit");
        vm.prank(p1);
        vm.expectRevert(bytes("PROOF_MISMATCH"));
        game.respond(id, 0, pHit);

        // 方向 2:证明说 0(miss),参数说 1 —— 再来一局,pending=W(shotBMissAtW 自己的格子,
        // proof 的 commitment/tx/ty 与链上全吻合),仅参数撒谎
        uint256 id2 = createAndJoin();
        vm.prank(p0);
        game.attack(id2, ProofFixtures.wX(), ProofFixtures.wY());
        _assertAwaitingP1Response(id2, ProofFixtures.wX(), ProofFixtures.wY());

        ShotProof memory pMiss = ProofFixtures.shotBMissAtW();
        assertEq(pMiss.pubSignals[0], 0, "fixture: proof actually says miss");
        vm.prank(p1);
        vm.expectRevert(bytes("PROOF_MISMATCH"));
        game.respond(id2, 1, pMiss);
    }

    // ============ verifyProof 关口(绑定全过之后的最后一道) ============

    /// 用例 5:篡改证明字节。pubSignals 原封不动 ⇒ 三项绑定全部通过,失败必须落在
    /// verifyProof ⇒ BAD_PROOF(verifier 对非曲线点返回 false 不 revert,靠 require 拦)。
    /// 干净对照:同一 fixture 不篡改即成功——证明本套件攻击用例转红的原因是绑定/验证
    /// 在起作用,而不是 fixture 本身坏。
    function test_tamperedProofBytes() public {
        uint256 id = createAndJoin();
        vm.prank(p0);
        game.attack(id, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);
        _assertAwaitingP1Response(id, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);

        ShotProof memory p = ProofFixtures.shotBHit(0);
        p.a[0] += 1; // 破坏证明点,pubSignals 不动
        // gas 报告里本用例 ~1.02B gas 属预期:篡改后的点不在 bn254 曲线上 ⇒ 配对预编译失败,按
        // EIP-196/197 语义吞掉全部转发 gas(verifier 用 staticcall(sub(gas(), 2000), ...) 转发);非 bug 非死循环。
        vm.prank(p1);
        vm.expectRevert(bytes("BAD_PROOF"));
        game.respond(id, 1, p);

        // 干净对照:revert 不改状态,仍在 AwaitingResponse,原 fixture 直接成功
        vm.prank(p1);
        game.respond(id, 1, ProofFixtures.shotBHit(0));
        Battleship.Game memory g = game.getGame(id);
        assertEq(uint8(g.phase), uint8(Battleship.Phase.AwaitingAttack), "control: phase advanced");
        assertEq(g.hits[1], 1, "control: hit counted");
    }

    /// 用例 6(unit 级,不走 respond):verifier 层本身把"证明点 ↔ 公开输入"绑死。
    /// 取 shotBHit(0) 的证明点 + shotBHit(1) 的 pubSignals 拼一个嵌合证明:
    /// 点良构(真证明的曲线点)、pubSignals 良构(真证明的域元素),仅互相错配
    /// ⇒ pairing 不等,走"廉价 false"路径——与用例 5 的非曲线点/预编译失败路径互补,
    /// 两条 false 路径都被钉死。
    function test_crossProofPubSignalSwap() public view {
        ShotProof memory points = ProofFixtures.shotBHit(0);
        ShotProof memory signals = ProofFixtures.shotBHit(1);
        // 两组 pubSignals 确实不同(同船相邻格,坐标必有偏差),错配才有意义
        assertTrue(
            points.pubSignals[2] != signals.pubSignals[2] || points.pubSignals[3] != signals.pubSignals[3],
            "pre: the two proofs must differ in coordinates"
        );
        assertFalse(
            shotVerifier.verifyProof(points.a, points.b, points.c, signals.pubSignals),
            "chimera proof (points of #0, pubSignals of #1) must not verify"
        );
    }

    // ============ 重放语义(§5.5) ============

    /// 用例 7:同局重放。正常打完一回合后,同一证明再 respond ⇒ 此刻 phase==AwaitingAttack
    /// (已换边到 P1 的回合)⇒ BAD_PHASE,被状态机挡在所有绑定之前。
    /// 语义说明(§5.5):同 (commitment,tx,ty) 的证明重放本质**无害**——result 由棋盘与
    /// 坐标唯一确定,重放只能"再说一遍同样的真话",不可能改写结果;REPEAT 守卫又保证同一格
    /// 不会二次进入 pending。状态机让重放连表达机会都没有:无 pending 炮击即无处可答。
    function test_sameGameReplayRejected() public {
        uint256 id = createAndJoin();
        vm.prank(p0);
        game.attack(id, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);
        _assertAwaitingP1Response(id, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);
        vm.prank(p1);
        game.respond(id, 1, ProofFixtures.shotBHit(0)); // 正常应答成功

        Battleship.Game memory g = game.getGame(id);
        assertEq(uint8(g.phase), uint8(Battleship.Phase.AwaitingAttack), "post: awaiting P1's attack");
        assertEq(g.turn, 1, "post: turn flipped to P1");

        // 同一防守方、同一证明、同一局:重放被状态机挡下
        vm.prank(p1);
        vm.expectRevert(bytes("BAD_PHASE"));
        game.respond(id, 1, ProofFixtures.shotBHit(0));
    }

    /// 用例 8:跨局"重放"是**特性不是 bug**(常被误标为漏洞,这里把语义辨析写透)。
    /// 两局同人马、同棋盘承诺,各自 pending=B 船格 0:局 1 已用过的应答证明在局 2 照样
    /// 成功——这是**正确**行为,不是绑定失守。三项绑定核对的是 (commitment, tx, ty, result)
    /// 与本局链上状态的一致性,而证明陈述的命题"承诺为 commitmentB 的棋盘在 (x,y) 处
    /// result=r"是与局号无关的数学事实:只要局 2 的链上状态恰好提出同一问题,同一份证明
    /// 就是它的合法答案(§5.5 重放无害的跨局版,respond 语义上不存在"哪一局的证明"之分)。
    /// 跨局防重放真正的需求是**隐藏布阵**,靠"每局新 salt ⇒ 新承诺"(客户端纪律,M3):
    /// 承诺一变,绑定 (1) 自动让旧证明全部失效;合约层不防,也不需要防。
    function test_crossGameProofReuseIsValid_byDesign() public {
        uint256 id1 = createAndJoin();
        uint256 id2 = createAndJoin();

        // 局 1:正常打到 P1 防守并应答成功
        vm.prank(p0);
        game.attack(id1, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);
        _assertAwaitingP1Response(id1, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);
        vm.prank(p1);
        game.respond(id1, 1, ProofFixtures.shotBHit(0));
        assertEq(game.getGame(id1).hits[1], 1, "game 1: hit counted");

        // 局 2:同承诺、同 pending 坐标,"局 1 用过的"同一份证明 ⇒ 成功
        vm.prank(p0);
        game.attack(id2, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);
        _assertAwaitingP1Response(id2, ProofFixtures.bShipXs()[0], ProofFixtures.bShipYs()[0]);
        vm.prank(p1);
        game.respond(id2, 1, ProofFixtures.shotBHit(0));

        Battleship.Game memory g2 = game.getGame(id2);
        assertEq(uint8(g2.phase), uint8(Battleship.Phase.AwaitingAttack), "game 2: respond accepted");
        assertEq(g2.hits[1], 1, "game 2: hit counted");
        assertEq(g2.turn, 1, "game 2: turn flipped");
    }
}
