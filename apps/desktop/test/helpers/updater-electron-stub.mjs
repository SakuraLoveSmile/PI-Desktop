export const app = {
  getAppPath: () => process.cwd(),
  getVersion: () => "0.16.0",
  isPackaged: false,
  quitCalls: 0,
  quit() {
    this.quitCalls += 1;
  },
};

export const shell = { openExternal: async () => undefined };
