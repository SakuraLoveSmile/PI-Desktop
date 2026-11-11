const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("piDesktop", { platform: process.platform });
