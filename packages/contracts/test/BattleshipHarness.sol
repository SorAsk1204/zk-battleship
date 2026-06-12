// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Battleship, IBoardVerifier, IShotVerifier} from "../src/Battleship.sol";
import {BoardVerifier} from "../src/verifiers/BoardVerifier.sol";
import {ShotVerifier} from "../src/verifiers/ShotVerifier.sol";
// ProofFixtures.sol 是生成物(.gitignore):package.json 的 test/snapshot/build script
// 前置 `pnpm run fixtures`,保证编译前存在。裸跑 forge test 缺文件属于用法错误。
import {ProofFixtures} from "./fixtures/ProofFixtures.sol";

/// @notice Task 1.8–1.11 测试套件的公共基座:真 verifier 三件套部署 + 固定角色 + 推局助手。
/// @dev 固定剧本(全部坐标来自 fixture 元数据,不许硬编码):
///      P0 持棋盘 A,P1 持棋盘 B;P0 专攻 B 的 17 个船格(P1 以 shotBHit(i) 应答 hit),
///      P1 专攻 A 的 16 个固定水格(P0 以 shotAMiss(i) 应答 miss)。
///      打满则 P0 第 17 hit 时同交易终局获胜(33 次 ShotFired/ShotResolved)。
///      同一 gameId 上手动落子后不要再调 playRounds(roundsPlayed 不感知手动步,会撞 REPEAT);
///      要么全手动要么全 helper。
abstract contract BattleshipHarness is Test {
    Battleship internal game;
    BoardVerifier internal boardVerifier;
    ShotVerifier internal shotVerifier;

    address internal p0;
    address internal p1;
    address internal outsider;

    /// @dev 簿记:每局已打完的完整回合数 = 下一回合的 fixture 索引。
    ///      playRounds 对同一局可多次调用续打(如 REPEAT 用例:打 1 回合后再继续)。
    mapping(uint256 => uint256) internal roundsPlayed;

    function setUp() public virtual {
        boardVerifier = new BoardVerifier();
        shotVerifier = new ShotVerifier();
        game = new Battleship(IBoardVerifier(address(boardVerifier)), IShotVerifier(address(shotVerifier)));
        p0 = makeAddr("p0");
        p1 = makeAddr("p1");
        outsider = makeAddr("outsider");
    }

    /// @notice P0 以棋盘 A 建局 + P1 以棋盘 B 加入;返回 gameId(P0 先攻)。
    function createAndJoin() internal returns (uint256 gameId) {
        vm.prank(p0);
        gameId = game.createGame(ProofFixtures.commitmentA(), ProofFixtures.boardA());
        vm.prank(p1);
        game.joinGame(gameId, ProofFixtures.commitmentB(), ProofFixtures.boardB());
    }

    /// @notice 从该局上次停下的回合起续打 n 个完整回合。
    /// @dev 第 i 回合 = P0 攻 B 船格 i → P1 hit 应答;若未终局再 P1 攻 A 水格 i → P0 miss 应答。
    ///      第 17 hit(i==16)在 respond 同交易内终局,该回合没有下半场,直接返回。
    function playRounds(uint256 gameId, uint256 n) internal {
        uint8[17] memory bxs = ProofFixtures.bShipXs();
        uint8[17] memory bys = ProofFixtures.bShipYs();
        uint8[16] memory axs = ProofFixtures.aWaterXs();
        uint8[16] memory ays = ProofFixtures.aWaterYs();
        uint256 end = roundsPlayed[gameId] + n;
        for (uint256 i = roundsPlayed[gameId]; i < end; i++) {
            // 上半场:P0 攻 B 的第 i 个船格,P1 以真实 hit 证明应答
            vm.prank(p0);
            game.attack(gameId, bxs[i], bys[i]);
            vm.prank(p1);
            game.respond(gameId, 1, ProofFixtures.shotBHit(i));
            roundsPlayed[gameId] = i + 1;
            if (game.getGame(gameId).phase == Battleship.Phase.Finished) return;
            // 下半场:P1 攻 A 的第 i 个固定水格,P0 以真实 miss 证明应答
            vm.prank(p1);
            game.attack(gameId, axs[i], ays[i]);
            vm.prank(p0);
            game.respond(gameId, 0, ProofFixtures.shotAMiss(i));
        }
    }

    /// @notice 把对局打满至 P0 胜:17 hit + 16 miss,respond(16) 同交易终局。
    function playFullGame(uint256 gameId) internal {
        playRounds(gameId, 17 - roundsPlayed[gameId]);
    }
}
