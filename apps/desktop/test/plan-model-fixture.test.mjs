import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { planModelFixture } from "../../../scripts/e2e/plan-model.mjs";

const tool = (name) => ({ type: "function", function: { name } });

async function ask(fixture, body) {
  const request = Object.assign(Readable.from([JSON.stringify(body)]), {
    method: "POST",
    url: "/v1/chat/completions",
  });
  const written = [];
  await fixture.handler(request, {
    headersSent: false,
    writeHead() {},
    write: (chunk) => written.push(String(chunk)),
    end: (chunk) => chunk && written.push(String(chunk)),
  });
  const choices = written
    .join("")
    .split("\n\n")
    .filter((event) => event.startsWith("data: {"))
    .map((event) => JSON.parse(event.slice("data: ".length)).choices[0]);
  const call = choices.flatMap((choice) => choice.delta.tool_calls ?? [])[0];
  return {
    toolName: call?.function.name,
    toolArgs: call ? JSON.parse(call.function.arguments) : undefined,
    text: choices.map((choice) => choice.delta.content ?? "").join(""),
    finish: choices.find((choice) => choice.finish_reason)?.finish_reason,
  };
}

test("an armed scenario answers only the request that can submit its contract", async () => {
  const fixture = planModelFixture();
  fixture.setScenario("plan");

  // A request without SubmitPlan, such as the Agent executing an approved
  // Plan, ends its run and must not consume the scenario armed for the
  // revision request.
  const executing = await ask(fixture, { model: "fixture", tools: [tool("Read"), tool("ToolSearch")] });
  assert.deepEqual(executing, {
    toolName: undefined,
    toolArgs: undefined,
    text: "Scheduled review complete.",
    finish: "stop",
  });

  const revision = await ask(fixture, { model: "fixture-alt", tools: [tool("Read"), tool("SubmitPlan")] });
  assert.equal(revision.toolName, "SubmitPlan");
  assert.equal(revision.toolArgs.title, "Revised Plan");
  assert.equal(revision.finish, "tool_calls");

  const consumed = await ask(fixture, { model: "fixture-alt", tools: [tool("SubmitPlan")] });
  assert.equal(consumed.toolName, undefined);
  assert.equal(consumed.finish, "stop");
});

test("the Agent executing a converted Goal gets a plain reply, never a ToolSearch call", async () => {
  const fixture = planModelFixture();
  fixture.setScenario("goal");

  // The tool list of the real converted-Goal execution request: ToolSearch and
  // the Goal report tools, but neither SubmitGoal nor SubmitPlan.
  const executing = await ask(fixture, {
    model: "fixture",
    tools: ["Read", "Bash", "ToolSearch", "SubmitGoalReport", "UpdateGoalProgress"].map(tool),
  });
  assert.equal(executing.toolName, undefined);
  assert.equal(executing.text, "Scheduled review complete.");
  assert.equal(executing.finish, "stop");

  const contract = await ask(fixture, { model: "fixture", tools: [tool("SubmitGoal")] });
  assert.equal(contract.toolName, "SubmitGoal");
  assert.equal(contract.toolArgs.title, "Converted Goal");
});
