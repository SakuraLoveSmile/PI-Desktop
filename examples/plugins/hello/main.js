/**
 * Example plugin entry used by local dev load and marketplace packaging samples
 * Host injects global `pi`.
 */

async function onLoad() {
 const settings = await pi.plugin.getSettings();

 await pi.commands.register({
 id: "hello.open",
 title: "Hello: Open Panel",
 keywords: ["hello", "demo"],
 run: async () => {
 await pi.ui.openPanel({ title: "Hello Plugin" });
 await pi.ui.showToast(settings.greeting || "Hello from plugin");
 },
 });

 await pi.agent.registerTool({
 name: "echo_text",
 description: "Echo text back to the agent",
 risk: "low",
 schema: {
 type: "object",
 properties: {
 text: { type: "string" },
 },
 required: ["text"],
 },
 execute: async (args) => {
 const text = String(args?.text ?? "");
 return {
 ok: true,
 echo: text,
 pluginId: pi.plugin.getId(),
 };
 },
 });
}

async function onUnload() {
 await pi.commands.unregister("hello.open");
 await pi.agent.unregisterTool("echo_text");
}

module.exports = {
 onLoad,
 onUnload,
};
