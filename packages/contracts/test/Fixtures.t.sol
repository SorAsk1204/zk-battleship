// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BoardProof, ShotProof} from "../src/Battleship.sol";
import {BoardVerifier} from "../src/verifiers/BoardVerifier.sol";
import {ShotVerifier} from "../src/verifiers/ShotVerifier.sol";
// ProofFixtures.sol 是生成物(.gitignore):package.json 的 test/snapshot script
// 前置 `pnpm run fixtures`,保证编译前存在。裸跑 forge test 缺文件属于用法错误。
import {ProofFixtures} from "./fixtures/ProofFixtures.sol";

/// @notice fixture 冒烟:真 verifier 对真证明返回 true、对篡改证明返回 false。
///         这是"fixture 是真实 Groth16 证明、verifier 在真验证"的活证据;
///         完整游戏逻辑测试套件是 Task 1.8–1.11 的事,这里不展开。
contract FixturesTest is Test {
    BoardVerifier internal boardVerifier;
    ShotVerifier internal shotVerifier;

    function setUp() public {
        boardVerifier = new BoardVerifier();
        shotVerifier = new ShotVerifier();
    }

    function test_BoardProofVerifies() public view {
        BoardProof memory p = ProofFixtures.boardA();
        assertTrue(boardVerifier.verifyProof(p.a, p.b, p.c, p.pubSignals));
        // 元数据对齐:board 证明的公开输入就是导出的 commitmentA
        assertEq(p.pubSignals[0], ProofFixtures.commitmentA());
    }

    function test_ShotProofVerifies() public view {
        ShotProof memory p = ProofFixtures.shotBHit(0);
        assertTrue(shotVerifier.verifyProof(p.a, p.b, p.c, p.pubSignals));
        // 元数据对齐:pubSignals=[result=1, commitmentB, bShipXs()[0], bShipYs()[0]]
        assertEq(p.pubSignals[0], 1);
        assertEq(p.pubSignals[1], ProofFixtures.commitmentB());
        assertEq(p.pubSignals[2], uint256(ProofFixtures.bShipXs()[0]));
        assertEq(p.pubSignals[3], uint256(ProofFixtures.bShipYs()[0]));
    }

    /// 篡改 a[0] 后必须返回 false(verifier 失败返回 false 不 revert,Battleship 靠查返回值守门)。
    function test_TamperedBoardProofRejected() public view {
        BoardProof memory p = ProofFixtures.boardA();
        p.a[0] += 1;
        assertFalse(boardVerifier.verifyProof(p.a, p.b, p.c, p.pubSignals));
    }

    function test_TamperedShotProofRejected() public view {
        ShotProof memory p = ProofFixtures.shotBHit(0);
        p.a[0] += 1;
        assertFalse(shotVerifier.verifyProof(p.a, p.b, p.c, p.pubSignals));
    }
}
