/**
 * 实例内评测驱动插件（`dsh-graphiti-dls/dls-eval`）。
 *
 * profile patch 行以 `inject: [dlsMemory]` 等待记忆插件就绪，随后在宿主
 * 进程里异步运行对比/消融套件并把结果写回仓库 `eval/results/dsh-live/`。
 * 只在 `run !== false` 时运行；跑完由 profile 层把该行禁用，避免每次启动
 * 重复执行。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { detectProfile, runLiveSuites } from './live';

export interface HostEvalConfig {
  /** 默认 true；设为 false 时该行只占位不执行。 */
  run?: boolean;
}

export interface HostEvalContext {
  get(name: string): unknown;
  logger?: unknown;
}

/** loader 依赖声明：等待记忆插件提供 ctx.dlsMemory。 */
export const inject = ['dlsMemory'];

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT_DIR = `${ROOT}eval/results/dsh-live`;

function writeError(error: unknown): void {
  const message = error instanceof Error ? `${error.stack ?? error.message}` : String(error);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/error.log`, `${new Date().toISOString()}\n${message}\n`, 'utf8');
}

export function apply(ctx: HostEvalContext, config: HostEvalConfig = {}): void {
  if (config.run === false) return;
  const kickoff = (): void => {
    void runLiveSuites({ ctx, profile: detectProfile() }).catch((error) => {
      writeError(error);
    });
  };
  // 不阻塞宿主激活：等当前 fiber 完全就绪后再跑。
  setTimeout(kickoff, 0);
}

export default apply;
