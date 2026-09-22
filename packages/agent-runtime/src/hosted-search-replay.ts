import type { HostedSearchContent } from "@earendil-works/pi-ai";
import { normalizeHostedSearchContent } from "@earendil-works/pi-ai/utils/hosted-search";
import { LocalRequestError } from "@earendil-works/pi-ai/utils/local-request-error";
import type { HostedSearch } from "@pi-desktop/shared";

/**
 * 持久化类型保持向后兼容；只在进入模型上下文的边界收敛为正式搜索类型。
 * 旧记录没有 replay 时仍可展示。有 replay 但结构损坏时必须给出本地错误，
 * 不能靠类型断言或静默过滤丢掉 grounding 数据后继续发请求。
 */
export function restoreHostedSearchReplay(
  search: HostedSearch | undefined,
): HostedSearchContent[] {
  if (search?.replay === undefined) return [];
  if (!Array.isArray(search.replay)) throw new LocalRequestError("context-validation");
  return search.replay.map((block) => normalizeHostedSearchContent(block));
}
