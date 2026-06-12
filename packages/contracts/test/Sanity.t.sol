// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Battleship} from "../src/Battleship.sol";

/// @notice M0 sanity 测试:验证 forge-std 可用、占位合约可部署。
///         让根目录 test:all 的 contracts 段从 M0 起就有真实测试可跑;M1 替换为完整测试。
contract SanityTest is Test {
    function test_PlaceholderDeploys() public {
        Battleship b = new Battleship();
        assertTrue(address(b) != address(0));
    }
}
