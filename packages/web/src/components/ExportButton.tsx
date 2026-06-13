/**
 * ExportButton —— 导出部署文件(Design §8:锁定成功后提供「导出部署文件」下载 JSON)。
 *
 * 为什么它是 §8 的硬需求:布船 + salt 丢失 = 无法生成应答证明 = 必然超时输。localStorage 可能被
 * 用户清掉 / 换浏览器,故锁定成功后必须给一份可离线保存、可在对战幕导入恢复(storage.importBoardJSON
 * 会校验布局合法 + 承诺一致)的备份。
 *
 * 实现:storage.exportBoardJSON 把 {ships, salt, commitment}(bigint→hex)+ 定位 meta(chainId/
 * contract/gameId/address)收成纯对象 → Blob 下载,文件名 `battleship-game{id}-{addr6}.json`。
 * 不弹模态、不调 alert(§7.4 禁原生弹窗);失败(理论不达:本地构造 Blob)走 onError 由父级展示。
 *
 * 复用 storage.exportBoardJSON,不自拼 JSON——导入端 importBoardJSON 依赖同一 schema(version/
 * hex 字段),两端必须共用一份编码。
 */
import { useCallback } from 'react';
import type { Board } from '../lib/boardLogic.ts';
import { computeCommitment } from '../lib/commitment.ts';
import type { Address } from '../lib/contracts.ts';
import { exportBoardJSON } from '../lib/storage.ts';

export type ExportButtonProps = {
  chainId: number;
  contract: Address;
  gameId: bigint;
  address: Address;
  board: Board;
  salt: bigint;
  /** 已算好的承诺(避免重复 Poseidon);未给则内部用 board+salt 重算。 */
  commitment?: bigint;
};

/** 短地址尾段(文件名用):取后 6 位 hex(不含 0x),小写。 */
function addr6(address: string): string {
  return address.replace(/^0x/i, '').slice(-6).toLowerCase();
}

export default function ExportButton({
  chainId,
  contract,
  gameId,
  address,
  board,
  salt,
  commitment,
}: ExportButtonProps) {
  const onExport = useCallback(() => {
    const commit = commitment ?? computeCommitment(board, salt);
    const payload = exportBoardJSON(chainId, contract, gameId, address, {
      ships: board,
      salt,
      commitment: commit,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `battleship-game${gameId.toString()}-${addr6(address)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 释放 object URL(下载已触发,资源可回收)。
    URL.revokeObjectURL(url);
  }, [chainId, contract, gameId, address, board, salt, commitment]);

  return (
    <button
      type="button"
      data-testid="export-deployment"
      onClick={onExport}
      className="border border-phosphor/70 bg-console px-4 py-2 font-display text-sm font-bold text-phosphor hover:bg-grid"
    >
      导出部署文件
    </button>
  );
}
