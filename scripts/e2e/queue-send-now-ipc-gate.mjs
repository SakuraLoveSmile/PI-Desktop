/** Hold only the real abort IPC at the preload boundary; never synthesize a reply. */
export async function installAbortIpcGate(cdp, waitFor) {
  const scripts = [];
  let paused;
  const unsubscribe = cdp.onEvent((event) => {
    if (event.method === "Debugger.scriptParsed") scripts.push(event.params);
    if (event.method === "Debugger.paused") paused = event.params;
  });
  let breakpointId;
  let probe;
  try {
    await cdp.send("Debugger.enable");
    const script = scripts.find(({ url }) => /[/\\]preload[/\\]index\.cjs$/.test(url));
    if (!script) throw new Error("real preload script was not reported by CDP");
    const { scriptSource } = await cdp.send("Debugger.getScriptSource", { scriptId: script.scriptId });
    // Locate the executable invoke in this build, rather than assuming a line
    // number or replacing the frozen contextBridge object in the main world.
    const lines = scriptSource.split("\n");
    const lineNumber = lines.findIndex((line) => /return \w+\.ipcRenderer\.invoke\(channel,/.test(line));
    const ipcExpression = lines[lineNumber]?.match(/return (\w+\.ipcRenderer)\.invoke\(channel,/)[1];
    if (!ipcExpression) throw new Error(`cannot locate the real preload invoke in ${script.url}`);
    ({ breakpointId } = await cdp.send("Debugger.setBreakpoint", {
      location: { scriptId: script.scriptId, lineNumber },
    }));
    // An ordinary settings read enters the preload lexical scope once. The
    // debugger is disabled again before any user-path test actions begin.
    probe = cdp.evaluate("window.piDesktop.invoke(window.piDesktop.channels.invoke.settingsGet)");
    // Attach a rejection handler immediately while the debugger is paused.
    probe.catch(() => {});
    await waitFor(() => paused, "preload invoke debugger pause", 10_000);
    const frame = paused.callFrames.find(({ location }) => location.scriptId === script.scriptId);
    if (!frame) throw new Error("debugger paused outside the expected preload invoke");
    const result = await cdp.send("Debugger.evaluateOnCallFrame", {
      callFrameId: frame.callFrameId,
      expression: `(() => {
        const ipc = ${ipcExpression};
        const original = ipc.invoke;
        let release;
        const ready = new Promise((resolve) => { release = resolve; });
        const gate = { calls: 0, forwarded: 0, requests: [], release };
        ipc.invoke = async function(channel, ...args) {
          if (channel === "pi-desktop/agent/tool/abort") {
            gate.calls += 1;
            gate.requests.push(args[0]);
            await ready;
            gate.forwarded += 1;
          }
          return original.call(ipc, channel, ...args);
        };
        gate.restore = () => { ipc.invoke = original; };
        globalThis.__queueAbortIpcGate = gate;
        return ipc.invoke !== original;
      })()`,
      returnByValue: true,
    });
    if (result.exceptionDetails || result.result?.value !== true) {
      throw new Error(`preload IPC gate installation failed: ${JSON.stringify(result.exceptionDetails ?? result.result)}`);
    }
    await cdp.send("Debugger.removeBreakpoint", { breakpointId });
    breakpointId = undefined;
    await cdp.send("Debugger.resume");
    paused = undefined;
    const response = await probe;
    if (response?.ok !== true) throw new Error("preload gate setup settings read failed");
    await cdp.send("Debugger.disable");
    const evaluate = async (expression) => {
      const result = await cdp.send("Runtime.evaluate", {
        expression,
        contextId: script.executionContextId,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error(`preload IPC gate failed: ${JSON.stringify(result.exceptionDetails)}`);
      return result.result?.value;
    };
    return {
      state: () => evaluate("({ calls: globalThis.__queueAbortIpcGate.calls, forwarded: globalThis.__queueAbortIpcGate.forwarded, requests: globalThis.__queueAbortIpcGate.requests })"),
      release: () => evaluate("globalThis.__queueAbortIpcGate.release(); true"),
      restore: () => evaluate("globalThis.__queueAbortIpcGate.restore(); delete globalThis.__queueAbortIpcGate; true"),
    };
  } catch (error) {
    if (breakpointId) await cdp.send("Debugger.removeBreakpoint", { breakpointId }).catch(() => {});
    if (paused) await cdp.send("Debugger.resume").catch(() => {});
    await cdp.send("Debugger.disable").catch(() => {});
    throw error;
  } finally {
    unsubscribe();
  }
}
