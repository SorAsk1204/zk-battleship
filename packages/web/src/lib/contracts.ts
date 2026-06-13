/**
 * 部署信息加载(DECISIONS D10 + Task 2.5 追记)。
 *
 * deployment.json 由 `pnpm demo` 写到 web/public/(gitignored,fresh clone 不存在 → fetch 404)。
 * 运行时 fetch 而非静态 import:文件缺失时 vite 静态 import 会直接崩,fetch 可优雅降级为人话错误。
 *
 * schema(D10 五字段 + Task 2.5 追记的 rpcUrl):
 *   { chainId:31337, battleship, boardVerifier, shotVerifier, deployBlock:Number, rpcUrl }
 *
 * rpcUrl 是 HTTP(http://127.0.0.1:8545)。本任务只如实暴露该字段不做加工;
 * Task 3.3 接 wagmi 时,watchContractEvent 需要的 ws transport 由那一层自行从同端口推导
 * `ws://127.0.0.1:8545`(anvil 同端口双协议),并在 DECISIONS 追记 rpcUrl 是权威还是仅供参考。
 */

/** 地址用 viem 的 0x 前缀模板类型,便于下游直接喂给 viem/wagmi 而不再断言。 */
export type Address = `0x${string}`;

export type Deployment = {
  chainId: number;
  battleship: Address;
  boardVerifier: Address;
  shotVerifier: Address;
  /** 部署区块号(Number;事件回放起点,见 §10 indexer-less) */
  deployBlock: number;
  /** anvil RPC,HTTP 协议;ws 由消费层推导(见上方注释) */
  rpcUrl: string;
};

/** 未找到部署信息时抛出的错误,UI 顶层据此展示行动指引(而非裸 fetch/parse 报错)。 */
export class DeploymentNotFoundError extends Error {
  constructor(
    message = '未找到部署信息。请先在另一个终端运行 pnpm demo 启动本地链。',
  ) {
    super(message);
    this.name = 'DeploymentNotFoundError';
  }
}

const DEPLOYMENT_URL = '/deployment.json';
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function isAddress(v: unknown): v is Address {
  return typeof v === 'string' && ADDRESS_RE.test(v);
}

/**
 * 校验 fetch 回来的对象符合 Deployment schema;任一字段缺失/类型错误即抛
 * DeploymentNotFoundError(带具体原因),避免脏 deployment.json 让下游拿到坏地址。
 */
function parseDeployment(data: unknown): Deployment {
  if (typeof data !== 'object' || data === null) {
    throw new DeploymentNotFoundError('部署信息格式错误:不是一个对象。请重新运行 pnpm demo。');
  }
  const d = data as Record<string, unknown>;
  const reasons: string[] = [];
  if (typeof d.chainId !== 'number') reasons.push('chainId');
  if (!isAddress(d.battleship)) reasons.push('battleship');
  if (!isAddress(d.boardVerifier)) reasons.push('boardVerifier');
  if (!isAddress(d.shotVerifier)) reasons.push('shotVerifier');
  if (typeof d.deployBlock !== 'number') reasons.push('deployBlock');
  if (typeof d.rpcUrl !== 'string') reasons.push('rpcUrl');
  if (reasons.length > 0) {
    throw new DeploymentNotFoundError(
      `部署信息字段无效(${reasons.join(', ')})。请重新运行 pnpm demo 生成 deployment.json。`,
    );
  }
  return {
    chainId: d.chainId as number,
    battleship: d.battleship as Address,
    boardVerifier: d.boardVerifier as Address,
    shotVerifier: d.shotVerifier as Address,
    deployBlock: d.deployBlock as number,
    rpcUrl: d.rpcUrl as string,
  };
}

/**
 * 加载部署信息。文件不存在(404)或内容损坏 → 抛 DeploymentNotFoundError(人话文案),
 * 由 UI 顶层捕获展示;网络/解析以外的意外错误原样上抛。
 */
export async function loadDeployment(): Promise<Deployment> {
  let res: Response;
  try {
    res = await fetch(DEPLOYMENT_URL, { cache: 'no-store' });
  } catch {
    // fetch 本身失败(开发服务器没起等)——同样归为"没准备好"。
    throw new DeploymentNotFoundError();
  }
  if (!res.ok) {
    // 404 = fresh clone 未跑 demo 的典型情形。
    throw new DeploymentNotFoundError();
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new DeploymentNotFoundError('部署信息不是合法 JSON。请重新运行 pnpm demo。');
  }
  return parseDeployment(json);
}
