/**
 * Renderer-facing contract for the optional local MCP control plane.
 *
 * This is machine-local runtime status only. It deliberately carries no bearer
 * token and no rendered connection manifest, so a renderer store, a log line,
 * or an IPC response can hold it without leaking control-plane credentials.
 */

/** Which input decided the effective on/off state. */
export type McpControlSource = "preference" | "environment";

export type McpControlStatus = {
  /**
   * Effective decision for this launch. An explicit startup environment value
   * (`PI_DESKTOP_MCP_CONTROL=0|1`) wins over the saved machine-local
   * preference, which in turn wins over the `false` default.
   */
  enabled: boolean;
  /** True while this process listens on the loopback control port. */
  running: boolean;
  /** Which input produced `enabled`. */
  source: McpControlSource;
  /**
   * Absolute path of the `mcp-control.json` manifest an external client reads.
   * The file (not this response) owns the token, and it is mode `0600`.
   */
  connectionFile: string;
  /**
   * Why the last start / stop / persist request could not be applied, or
   * `null` after a request that succeeded. The text never contains the token
   * or the connection manifest.
   */
  error: string | null;
};

export type McpControlSetInput = {
  enabled: boolean;
};
