import { describe, expect, it } from "vitest";
import {
  cleanSummarizedTitle,
  sessionTitleSummarizeContext,
  summarizeSessionTitle,
} from "./session-title-summarize.js";
import type { RuntimeProviderConfig } from "./provider-binding.js";

const provider: RuntimeProviderConfig = {
  id: "test-provider",
  name: "Test Provider",
  baseUrl: "http://localhost:8000",
  apiKey: "test-key",
  modelId: "test-model",
  supportsReasoning: false,
  supportedThinkingLevels: [],
};

describe("cleanSummarizedTitle", () => {
  it("strips outer quotes, backticks, and markdown brackets", () => {
    expect(cleanSummarizedTitle('"Debug WebSocket reconnection"')).toBe("Debug WebSocket reconnection");
    expect(cleanSummarizedTitle('“重构用户认证模块”')).toBe("重构用户认证模块");
    expect(cleanSummarizedTitle('`Fix typo in README`')).toBe("Fix typo in README");
    expect(cleanSummarizedTitle('「优化数据库查询」')).toBe("优化数据库查询");
  });

  it("removes redundant Title prefix and trailing punctuation", () => {
    expect(cleanSummarizedTitle("Title: Improve search indexing.")).toBe("Improve search indexing");
    expect(cleanSummarizedTitle("标题：修复登录失败问题！")).toBe("修复登录失败问题");
    expect(cleanSummarizedTitle("Session Title: Add export CSV feature")).toBe("Add export CSV feature");
  });

  it("collapses internal whitespace and limits length", () => {
    expect(cleanSummarizedTitle("  Refactor   theme   switching  ")).toBe("Refactor theme switching");
    const long = "A".repeat(100);
    expect(cleanSummarizedTitle(long).length).toBe(80);
  });
  it("rejects pure URLs and absolute filesystem paths", () => {
    expect(cleanSummarizedTitle("https://github.com/earendil-works/pi-desktop")).toBe("");
    expect(cleanSummarizedTitle("http://localhost:8000/api/v1")).toBe("");
    expect(cleanSummarizedTitle("/Users/alice/projects/test")).toBe("");
    expect(cleanSummarizedTitle("C:\\Users\\Bob\\Documents")).toBe("");
    expect(cleanSummarizedTitle("C:/Windows/System32")).toBe("");
  });

  it("enforces <= 25 graphemes for CJK titles and <= 7 words for space-separated titles", () => {
    const cjkLong = "这是一个非常长的主题用于测试二十五个字符限制以及是否能够正确截断标题文本";
    const cjkClean = cleanSummarizedTitle(cjkLong);
    expect(Array.from(cjkClean).length).toBeLessThanOrEqual(25);

    const enLong = "This is a very long title with more than seven words in it";
    const enClean = cleanSummarizedTitle(enLong);
    expect(enClean.split(" ").length).toBeLessThanOrEqual(7);
    expect(enClean).toBe("This is a very long title with");
  });
});

describe("sessionTitleSummarizeContext", () => {
  it("formats user prompt and optional reply into context", () => {
    const ctx = sessionTitleSummarizeContext("How to configure Nginx reverse proxy?");
    expect(ctx.messages[0]?.content).toContain("User Prompt:\nHow to configure Nginx reverse proxy?");
    expect(ctx.systemPrompt).toContain("short, concise, descriptive session title");
  });

  it("includes assistant response summary when provided", () => {
    const ctx = sessionTitleSummarizeContext(
      "Deploy Docker container",
      "Created docker-compose.yml and started the services.",
    );
    expect(ctx.messages[0]?.content).toContain("User Prompt:\nDeploy Docker container");
    expect(ctx.messages[0]?.content).toContain("Assistant Response Summary:\nCreated docker-compose.yml");
  });
});
