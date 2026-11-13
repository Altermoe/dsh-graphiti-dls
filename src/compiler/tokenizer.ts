/**
 * Token 估算。
 *
 * 生产应替换为目标模型对应的 Tokenizer，并为工具 Schema、系统规则和格式
 * 开销预留空间（README「Token 预算」）。这里用确定性近似，使评测可离线复现：
 * CJK 每字约 1 token，其余字符约 4 字符 / token。
 */

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let units = 0;
  for (const char of text) {
    units += /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char) ? 1 : 0.25;
  }
  return Math.max(1, Math.ceil(units));
}

/** 按 token 预算截断单行文本，避免生成半截标记。 */
export function truncateToTokens(text: string, budget: number): string {
  if (estimateTokens(text) <= budget) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(text.slice(0, mid)) <= budget) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low)}…`;
}
