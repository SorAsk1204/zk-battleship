/**
 * 自动生成,请勿手改 —— 由 src/lib/scripts/gen-abi.mjs 从
 * packages/contracts/out/Battleship.sol/Battleship.json 提取。
 * 合约 ABI 变动后重跑:pnpm --filter @zk-battleship/web run gen:abi
 *
 * `as const` 供 viem 静态推断函数/事件类型,勿删。
 */
export const battleshipAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_boardVerifier",
        "type": "address",
        "internalType": "contract IBoardVerifier"
      },
      {
        "name": "_shotVerifier",
        "type": "address",
        "internalType": "contract IShotVerifier"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "JOIN_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "TIMEOUT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "TOTAL_SHIP_CELLS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "attack",
    "inputs": [
      {
        "name": "gameId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "x",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "y",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "boardVerifier",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IBoardVerifier"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancelGame",
    "inputs": [
      {
        "name": "gameId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimTimeout",
    "inputs": [
      {
        "name": "gameId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createGame",
    "inputs": [
      {
        "name": "commitment",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct BoardProof",
        "components": [
          {
            "name": "a",
            "type": "uint256[2]",
            "internalType": "uint256[2]"
          },
          {
            "name": "b",
            "type": "uint256[2][2]",
            "internalType": "uint256[2][2]"
          },
          {
            "name": "c",
            "type": "uint256[2]",
            "internalType": "uint256[2]"
          },
          {
            "name": "pubSignals",
            "type": "uint256[1]",
            "internalType": "uint256[1]"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "gameId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "games",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "p0",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "p1",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "commitment0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "commitment1",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "phase",
        "type": "uint8",
        "internalType": "enum Battleship.Phase"
      },
      {
        "name": "turn",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "pendingX",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "pendingY",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "lastActionAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "winner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getGame",
    "inputs": [
      {
        "name": "gameId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct Battleship.Game",
        "components": [
          {
            "name": "p0",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "p1",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "commitment0",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "commitment1",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "phase",
            "type": "uint8",
            "internalType": "enum Battleship.Phase"
          },
          {
            "name": "turn",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "pendingX",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "pendingY",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "hits",
            "type": "uint8[2]",
            "internalType": "uint8[2]"
          },
          {
            "name": "shotMap",
            "type": "uint256[2]",
            "internalType": "uint256[2]"
          },
          {
            "name": "lastActionAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "winner",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "joinGame",
    "inputs": [
      {
        "name": "gameId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "commitment",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct BoardProof",
        "components": [
          {
            "name": "a",
            "type": "uint256[2]",
            "internalType": "uint256[2]"
          },
          {
            "name": "b",
            "type": "uint256[2][2]",
            "internalType": "uint256[2][2]"
          },
          {
            "name": "c",
            "type": "uint256[2]",
            "internalType": "uint256[2]"
          },
          {
            "name": "pubSignals",
            "type": "uint256[1]",
            "internalType": "uint256[1]"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "nextGameId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "respond",
    "inputs": [
      {
        "name": "gameId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "result",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct ShotProof",
        "components": [
          {
            "name": "a",
            "type": "uint256[2]",
            "internalType": "uint256[2]"
          },
          {
            "name": "b",
            "type": "uint256[2][2]",
            "internalType": "uint256[2][2]"
          },
          {
            "name": "c",
            "type": "uint256[2]",
            "internalType": "uint256[2]"
          },
          {
            "name": "pubSignals",
            "type": "uint256[4]",
            "internalType": "uint256[4]"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "shotVerifier",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IShotVerifier"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "GameCreated",
    "inputs": [
      {
        "name": "gameId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "p0",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "GameFinished",
    "inputs": [
      {
        "name": "gameId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "winner",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "reason",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "GameJoined",
    "inputs": [
      {
        "name": "gameId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "p1",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ShotFired",
    "inputs": [
      {
        "name": "gameId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "attacker",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "x",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "y",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ShotResolved",
    "inputs": [
      {
        "name": "gameId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "defender",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "x",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "y",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "result",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "totalHits",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  }
] as const;
