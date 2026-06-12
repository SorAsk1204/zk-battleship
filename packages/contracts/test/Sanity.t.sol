// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Battleship, IBoardVerifier, IShotVerifier} from "../src/Battleship.sol";
import {BoardVerifier} from "../src/verifiers/BoardVerifier.sol";
import {ShotVerifier} from "../src/verifiers/ShotVerifier.sol";

/// @notice 冒烟测试:真 verifier 三件套可部署、constructor 注入正确。
///         完整游戏逻辑测试套件是 Task 1.8,这里只保持 test:all 冒烟绿。
contract SanityTest is Test {
    function test_DeploysWithRealVerifiers() public {
        BoardVerifier bv = new BoardVerifier();
        ShotVerifier sv = new ShotVerifier();
        Battleship b = new Battleship(IBoardVerifier(address(bv)), IShotVerifier(address(sv)));

        assertEq(address(b.boardVerifier()), address(bv));
        assertEq(address(b.shotVerifier()), address(sv));
        assertEq(b.nextGameId(), 0); // 首局 createGame 后应为 1(gameId 从 1 起,D11)
    }
}
