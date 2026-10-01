// Local model fixture for Plan UI execution and contract conversion.
export function planModelFixture() {
  let scenario = null;
  let calls = 0;
  const handler = async (req, res) => {
    if (req.method === "GET" && req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: ["fixture", "fixture-alt"].map((id) => ({ id, object: "model" })) }));
      return;
    }
    try {
      let body = "";
      for await (const part of req) body += part;
      const request = JSON.parse(body);
      calls += 1;
      const base = {
        id: `plan-model-${calls}`,
        object: "chat.completion.chunk",
        created: 1,
        model: request.model,
      };
      const emit = (delta, finish_reason = null) =>
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (scenario === "goal" || scenario === "plan") {
        const tools = request.tools ?? [];
        const submitName = scenario === "goal" ? "SubmitGoal" : "SubmitPlan";
        const matchedSubmit = tools.find((tool) => {
          const n = tool.function?.name?.toLowerCase();
          return n === submitName.toLowerCase() || n === `submit_${scenario}`;
        });
        const matchedSearch = tools.find((tool) => {
          const n = tool.function?.name?.toLowerCase();
          return n === "toolsearch" || n === "tool_search";
        });
        const matchedTool = matchedSubmit || matchedSearch || tools[0];
        const name = matchedTool?.function?.name ?? submitName;
        const submitAvailable = Boolean(matchedSubmit);
        const args = submitAvailable
          ? scenario === "goal"
            ? {
                title: "Converted Goal",
                markdown: "# Goal\n\nDeliver the approved outcome.\n\n## Acceptance criteria\n\n- Confirm the result.\n\n## Boundaries\n\n- Keep user data intact.",
                question: "Approve this Goal contract separately?",
              }
            : {
                title: "Revised Plan",
                markdown: "# Revised Plan\n\n- Include the requested verification.",
                question: "Approve this revised plan?",
              }
          : { query: submitName };
        emit({ role: "assistant", tool_calls: [{
          index: 0,
          id: `plan-model-tool-${calls}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        }] });
        emit({}, "tool_calls");
        if (submitAvailable) scenario = null;
      } else {
        emit({ role: "assistant", content: "Scheduled review complete." });
        emit({}, "stop");
      }
      res.end("data: [DONE]\n\n");
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  };
  return {
    handler,
    setScenario(value) {
      if (value !== "goal" && value !== "plan") throw new Error("unsupported Plan model scenario");
      scenario = value;
    },
  };
}
