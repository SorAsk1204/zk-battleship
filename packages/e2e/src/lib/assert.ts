/**
 * 极简断言(e2e 场景是"脚本"不是测试套件,不引测试框架)。
 * 失败即 throw Error,消息里带调用方给的场景上下文(如 "[A] round3 P1 respond 交易状态")。
 */
import { inspect, isDeepStrictEqual } from 'node:util';

function repr(v: unknown): string {
  return inspect(v, { depth: 4, breakLength: 120 });
}

export function fail(msg: string): never {
  throw new Error(`断言失败:${msg}`);
}

export function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) fail(msg);
}

export function equal<T>(actual: T, expected: T, ctx: string): void {
  if (actual !== expected) {
    fail(`${ctx} — actual=${repr(actual)} expected=${repr(expected)}`);
  }
}

export function deepEqual(actual: unknown, expected: unknown, ctx: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(`${ctx} — actual=${repr(actual)} expected=${repr(expected)}`);
  }
}
