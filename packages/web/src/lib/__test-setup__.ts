/**
 * 测试环境补丁 —— 给 node 环境注入一个内存 localStorage(storage.ts 用例需要)。
 * 行为对齐浏览器 Storage 的关键语义:getItem 缺失返回 null、setItem 强制转字符串、
 * removeItem / clear。不引 jsdom。
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

// 每个测试文件加载一次;beforeEach 清空在各 test 文件内自理(storage 用例会 clear)。
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});
