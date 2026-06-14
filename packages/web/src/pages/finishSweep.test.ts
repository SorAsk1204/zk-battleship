/**
 * finishSweep 单测(Task 4.2b)。
 *
 * 钉死 outcome.accent → 结算扫屏种类的映射(胜=phosphor 提亮 / 负=flare 熄灭 / 取消=mist 不扫)。
 * 扫屏的 WAAPI 视觉本身留浏览器验收;此处只保证「哪种结局放哪种扫屏 / 取消不放」这一承重映射。
 */
import { describe, expect, it } from 'vitest';
import { finishSweepKind } from './finishSweep.ts';

describe('finishSweepKind — accent → 扫屏种类', () => {
  it('phosphor(胜)→ phosphor 提亮扫屏', () => {
    expect(finishSweepKind('phosphor')).toBe('phosphor');
  });

  it('flare(负)→ flare 染橙熄灭扫屏', () => {
    expect(finishSweepKind('flare')).toBe('flare');
  });

  it('mist(取消)→ none(中性静态,不扫屏)', () => {
    expect(finishSweepKind('mist')).toBe('none');
  });
});
