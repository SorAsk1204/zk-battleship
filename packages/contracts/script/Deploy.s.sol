// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Battleship, IBoardVerifier, IShotVerifier} from "../src/Battleship.sol";
import {BoardVerifier} from "../src/verifiers/BoardVerifier.sol";
import {ShotVerifier} from "../src/verifiers/ShotVerifier.sol";

/// @notice 手动/测试网部署辅助脚本(M1 Task 1.12)。
/// @dev 注意:demo 与 e2e 的 canonical 部署路径是 viem 程序化部署(M2 的 lib/deploy.ts /
///      scripts/demo.ts,读 forge out/*.json 自行部署并写 deployment.json),**不走本脚本**;
///      本脚本不进任何自动化,仅供手动起本地链/测试网时一条命令拉起三件套用。
///
///      用法(私钥经 PRIVATE_KEY 环境变量注入,缺省为 anvil #0 的公知私钥):
///        本地 dry-run(不广播,仅模拟):
///          forge script script/Deploy.s.sol
///        对本地 anvil 广播:
///          forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///        对测试网广播(自备 RPC 与私钥;broadcast/ 产物已在 .gitignore):
///          PRIVATE_KEY=0x... forge script script/Deploy.s.sol --rpc-url <RPC_URL> --broadcast
contract Deploy is Script {
    /// @dev anvil 内置账户 #0 的公知私钥(全网皆知,仅限本地链;真网部署必须显式传 PRIVATE_KEY)。
    uint256 internal constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function run() external {
        uint256 pk = vm.envOr("PRIVATE_KEY", ANVIL_KEY_0);

        // 部署顺序与 M2 lib/deploy.ts 约定一致:两个 verifier 先行,地址注入 Battleship(不可变,无 setter)
        vm.startBroadcast(pk);
        BoardVerifier boardVerifier = new BoardVerifier();
        ShotVerifier shotVerifier = new ShotVerifier();
        Battleship battleship =
            new Battleship(IBoardVerifier(address(boardVerifier)), IShotVerifier(address(shotVerifier)));
        vm.stopBroadcast();

        console.log("BoardVerifier:", address(boardVerifier));
        console.log("ShotVerifier: ", address(shotVerifier));
        console.log("Battleship:   ", address(battleship));
    }
}
