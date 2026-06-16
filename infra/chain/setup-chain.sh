#!/usr/bin/env bash
# Prepare datadirs + static-nodes + geth-init for the 3-node GoQuorum QBFT consortium chain.
# Idempotent: wipes node{0,1,2} datadirs and re-inits from the generated genesis.
set -euo pipefail
BASE=/opt/bschain
IMG=quorumengineering/quorum:latest
ART=$(ls -d "$BASE"/qbft-artifacts/*/ | head -1)
echo "artifacts: $ART"

# static-nodes.json: enode pubkeys from the generated nodekeys, pinned to the docker-net IPs.
cat > "$BASE/static-nodes.json" <<'EOF'
[
  "enode://ce2f2696215159bf63b4f2080a0383e2e57540e2f7ab81e358c5093b472c860276e3af3efe59245e325ae86951638d3d62d069968ba268cc5604a63976e92b88@172.30.0.11:30303?discport=0",
  "enode://f2d3d826e7b5855f640a50bfd6b1725fb2cdd40202d1808252a911c1bc646a52606678c991e7d2a7df3d6af3e504b5d3986d708c3a4c07ddfbd20b20ec3be60d@172.30.0.12:30303?discport=0",
  "enode://eb5515333e6acc8e2ca86b4d1058ba4c67a4869182ee7fbbb6b5e0bb143064acb8114b438492c508b6ce4d053e16a341f170453ce096b3d620aa4f7ffd1dd800@172.30.0.13:30303?discport=0"
]
EOF

for i in 0 1 2; do
  V="${ART}validator$i"
  D="$BASE/node$i"
  rm -rf "$D"
  mkdir -p "$D/geth" "$D/keystore"
  cp "$V/nodekey"          "$D/geth/nodekey"
  cp "$V/accountKeystore"  "$D/keystore/key.json"
  cp "$V/accountPassword"  "$D/password.txt"
  cp "$BASE/static-nodes.json" "$D/static-nodes.json"
  cp "$BASE/static-nodes.json" "$D/geth/static-nodes.json"
  cp "${ART}goQuorum/genesis.json" "$D/genesis.json"
  echo "--- init node$i (validator account $(cat "$V/accountAddress")) ---"
  docker run --rm -v "$D:/data" "$IMG" --datadir /data init /data/genesis.json 2>&1 | tail -2
done
echo "SETUP_DONE"
