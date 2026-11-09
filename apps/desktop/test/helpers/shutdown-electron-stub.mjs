/**
 * Electron stand-in for the shutdown tests: `app.quit()` emits `before-quit`
 * the way Electron does and exits only when no handler prevented it.
 */
export const app = {
  handlers: new Map(),
  quitCalls: 0,
  exited: false,
  on(event, handler) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  },
  quit() {
    this.quitCalls += 1;
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (const handler of this.handlers.get("before-quit") ?? []) handler(event);
    if (!event.defaultPrevented) this.exited = true;
  },
  reset() {
    this.handlers = new Map();
    this.quitCalls = 0;
    this.exited = false;
  },
};

export const globalShortcut = { unregister() {} };
