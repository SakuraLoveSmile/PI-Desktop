import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

export const relayQuestions = [{ question: "Choose a result", options: ["Zero", { label: "One", description: "Return one" }] },
  { question: "Choose checks", options: ["Unit", "Integration"], multiSelect: true }];

/** Only the provider is simulated: production tool execution writes the accepted answer. */
export async function executionAskProvider({ requests, inspect }) {
  const instances = new Map();
  let failure;
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, "POST");
      let body = "";
      for await (const part of req) { body += part; assert.ok(body.length <= 2 * 1024 * 1024); }
      const input = JSON.parse(body);
      if (req.url === "/execution-ask/control") {
        const state = instances.get(input.instanceId);
        assert.ok(state, "unknown fixture instance");
        let output;
        if (input.action === "release_final") {
          assert.equal(input.scenario, state.scenario);
          state.released = true; state.release?.();
          output = { ok: true, instanceId: input.instanceId };
        } else if (input.action === "inspect") output = { ok: true, instanceId: input.instanceId, asks: await inspect(input.instanceId) };
        else throw new Error("unknown fixture control action");
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(output)); return;
      }
      const history = JSON.stringify(input.messages);
      const instanceId = /EXECUTION_ASK_RELAY_INSTANCE=([\w-]+)/.exec(history)?.[1];
      const scenario = /EXECUTION_ASK_RELAY_SCENARIO=([\w-]+)/.exec(history)?.[1];
      const names = (input.tools ?? []).map(tool => tool.function?.name);
      if (!instanceId && !names.length) {
        emit(res, input.model, null, "Execution questions fixture"); return;
      }
      assert.ok(instanceId && scenario, "fixture prompt must pin scenario and instance");
      let state = instances.get(instanceId);
      if (!state) { state = { scenario, goalAsk: false, goalSubmitted: false, executionAsk: false, bash: false, verified: false, report: false, released: false }; instances.set(instanceId, state); }
      assert.equal(state.scenario, scenario);
      const execution = names.includes("SubmitGoalReport") || scenario.startsWith("ordinary_");
      const phase = execution ? "execution" : "goal";
      requests.push({ instanceId, scenario, phase, registeredRequestAt: new Date().toISOString(), request: input });
      let tool, args;
      if (!state[execution ? "executionAsk" : "goalAsk"]) {
        state[execution ? "executionAsk" : "goalAsk"] = true;
        tool = "asktool"; args = { questions: relayQuestions };
      } else if (!execution) {
        assert.equal(state.goalSubmitted, false, "Goal must pause at its real approval");
        state.goalSubmitted = true;
        tool = names.includes("SubmitGoal") ? "SubmitGoal" : "SubmitPlan";
        args = { title: `Execution ask relay ${scenario}`, question: "Approve the isolated execution?",
          markdown: `# Execution ask relay\n\nEXECUTION_ASK_RELAY_SCENARIO=${scenario}\nEXECUTION_ASK_RELAY_INSTANCE=${instanceId}\n\n## Acceptance criteria\n- execution-answer.txt contains the accepted original question labels.\n` };
      } else if (!state.bash) {
        state.bash = true;
        const result = input.messages.findLast(message => message.role === "tool" && message.tool_call_id === `execution-ask-${instanceId}`);
        assert.ok(result, "original execution ask result is required");
        state.answer = String(result.content);
        tool = "Bash"; args = { command: `printf '%s\\n' '${state.answer.replaceAll("'", "'\\''")}' > execution-answer.txt` };
      } else if (!state.verified && names.includes("SubmitGoalReport")) {
        state.verified = true;
        tool = "Bash"; args = { command: "python3 verify_execution_answer.py" };
      } else if (!state.report && names.includes("SubmitGoalReport")) {
        if (scenario !== "fast_completed" && !state.released) await new Promise(done => { state.release = done; });
        state.report = true; tool = "SubmitGoalReport";
        args = { summary: "The accepted original answers were written by the real Bash tool.", verdict: "met",
          criteria: [{ id: "answers", text: "execution-answer.txt contains the accepted original question labels.", verdict: "met", explanation: state.answer }],
          steps: [{ id: "write", title: "Write accepted answers", status: "completed", detail: "Bash wrote the original tool result in the same execution turn." }],
          files: [{ path: "execution-answer.txt", changeType: "created", attribution: "direct" }],
          checks: [{ id: "verify", command: "python3 verify_execution_answer.py", result: "passed", detail: "The real standard-library fixture checker accepted the original answer file." }],
          evidences: [{ id: "answers", kind: "file", refId: "execution-answer.txt", summary: state.answer }] };
      }
      if (tool) assert.ok(names.includes(tool), `${tool} must be advertised by production runtime`);
      const id = tool === "asktool" ? `${phase}-ask-${instanceId}` : `${phase}-${tool}-${tool === "Bash" && state.verified ? "verify-" : ""}${instanceId}`;
      emit(res, input.model, tool ? { id, name: tool, args } : null, `EXECUTION_ASK_RELAY_COMPLETE ${instanceId}`);
    } catch (error) {
      failure ??= error;
      if (!res.headersSent) res.writeHead(500);
      res.end("Isolated provider fixture failed");
    }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { server, baseUrl, controlUrl: `${baseUrl}/execution-ask/control`, instances,
    check() { if (failure) throw failure; },
    async stop() { for (const state of instances.values()) state.release?.(); server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}

function emit(res, model, tool, text) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const delta = tool ? { role: "assistant", tool_calls: [{ index: 0, id: tool.id, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { role: "assistant", content: text };
  for (const [value, finish] of [[delta, null], [{}, tool ? "tool_calls" : "stop"]]) {
    res.write(`data: ${JSON.stringify({ id: randomUUID(), model, choices: [{ index: 0, delta: value, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
  }
  res.end("data: [DONE]\n\n");
}
