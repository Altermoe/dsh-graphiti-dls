export * from './plugin';
export * from './host';
/**
 * loader 的模块默认导出（`dsh-graphiti-dls/dls-memory`）。
 * 依赖由 profile patch 行声明：`inject: [agents]`。
 */
export { apply as default } from './host';
