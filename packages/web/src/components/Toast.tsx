/**
 * Toast —— 页内消息浮层(Design §7.5/§7.6:失败用**页内 toast**,文案 = 发生了什么 + 怎么办;
 * 禁止浏览器原生 alert/confirm,见 §0.4 禁止行为)。
 *
 * 这是 3.8 引入的最小页级 toast 设施(此前无):PersistenceBanner 导入失败、以及任何「错误需告知但不
 * 该用 alert」的场景,经 useToast().show(msg, kind?) 推一条可自动消失 / 可手动关的浮层。
 *
 * 设计取舍(功能版,克制):
 *   - Context + Provider:show 经 context 暴露,任意后代组件可调(PersistenceBanner、未来别处);
 *     Provider 持 toast 列表 state,在固定层(右下)渲染。无外部依赖、无动画库(§7.4 动效预算)。
 *   - 自动消失:默认 6s 后自身移除(错误文案要给用户读完的时间);手动「✕」立即移除。
 *     定时器存在 effect 内、卸载清理(无泄漏)。
 *   - kind:'error'(--flare,默认)/ 'info'(--phosphor)。结算/导入失败用 error。
 *   - role:error → role="alert"(assertive,打断读屏);info → role="status"(polite)。
 *   - 直角(§7.2 radius≤4px)、1px 边框、font-mono;不堆阴影。
 *
 * 为何不引第三方 toast 库:一个错误浮层不值得一个依赖;§7.4 要求 orchestrated 动效、不堆散件,
 * 自实现最小集即可,且与全站 7 token / 直角纪律一致。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastKind = 'error' | 'info';

type ToastItem = {
  id: number;
  message: string;
  kind: ToastKind;
};

type ToastApi = {
  /** 推一条 toast(默认 error)。返回该条 id(一般无需用)。 */
  show: (message: string, kind?: ToastKind) => number;
  /** 主动移除一条(一般交给自动消失 / ✕)。 */
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** toast 自动消失时长(ms):错误文案给足阅读时间。 */
const AUTO_DISMISS_MS = 6000;

/**
 * useToast —— 取 show/dismiss。必须在 ToastProvider 内调用;否则给一个 no-op 兜底(不抛),
 * 避免在没接 Provider 的上下文(如个别单测渲染)里炸——但生产树 main.tsx 已包 Provider。
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  // 兜底 no-op:未包 Provider 时不抛(toast 是增强,非关键路径);开发期 Provider 已在 main.tsx 接好。
  return ctx ?? NOOP_API;
}

const NOOP_API: ToastApi = {
  show: () => -1,
  dismiss: () => {},
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message: string, kind: ToastKind = 'error') => {
    const id = nextId.current++;
    setItems((list) => [...list, { id, message, kind }]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* 固定右下角浮层;pointer-events-none 让空白处不挡点击,单条内部再开启交互。 */}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
        data-testid="toast-stack"
      >
        {items.map((t) => (
          <ToastRow key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  // 自动消失:挂载即排一个定时器,卸载 / 提前关时清理(无泄漏)。
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.id, onDismiss]);

  const isError = item.kind === 'error';
  const accent = isError ? 'border-flare bg-abyss' : 'border-phosphor bg-abyss';
  const textColor = isError ? 'text-flare' : 'text-phosphor';

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 border px-3 py-2 ${accent}`}
      role={isError ? 'alert' : 'status'}
      data-testid="toast"
      data-kind={item.kind}
    >
      <p className={`flex-1 font-mono text-xs leading-relaxed ${textColor}`}>{item.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        className={`shrink-0 font-mono text-xs ${textColor} hover:opacity-70`}
        aria-label="关闭提示"
        data-testid="toast-dismiss"
      >
        ✕
      </button>
    </div>
  );
}
