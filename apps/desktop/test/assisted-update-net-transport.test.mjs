import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { createElectronNetTransport } = await import(
  "../electron/main/assisted-update/net-transport.ts"
);

/** A stand-in for `net.request` that plays `script` once the request ends. */
function fakeNet(script) {
  const requests = [];
  return {
    requests,
    net: {
      request(options) {
        const handlers = {};
        const request = {
          options,
          aborts: 0,
          follows: 0,
          ended: false,
          on(event, listener) {
            handlers[event] = listener;
            return request;
          },
          followRedirect() {
            request.follows += 1;
          },
          abort() {
            request.aborts += 1;
          },
          end() {
            request.ended = true;
            queueMicrotask(() => script?.(request, handlers));
          },
        };
        requests.push(request);
        return request;
      },
    },
  };
}

const get = (transport, url, allowRedirect = () => true, signal = new AbortController().signal) =>
  transport.get(url, { signal, allowRedirect });

test("requests carry no cookies or credentials and never follow a redirect on their own", async () => {
  const { net, requests } = fakeNet((_request, handlers) =>
    handlers.response({ statusCode: 200, headers: { "content-length": "3" }, async *[Symbol.asyncIterator]() {} }),
  );
  const response = await get(createElectronNetTransport(net), "https://github.com/x");
  assert.deepEqual(requests[0].options, {
    url: "https://github.com/x",
    method: "GET",
    redirect: "manual",
    credentials: "omit",
    useSessionCookies: false,
  });
  assert.equal(requests[0].ended, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.headers, { "content-length": "3" });
});

test("a redirect is followed only when the caller allows its target", async () => {
  const targets = [];
  const allow = (target) => {
    targets.push(target);
    return target.startsWith("https://release-assets.githubusercontent.com/");
  };
  const allowed = fakeNet((_request, handlers) => {
    handlers.redirect(302, "GET", "https://release-assets.githubusercontent.com/a");
    handlers.response({ statusCode: 200, headers: {}, async *[Symbol.asyncIterator]() {} });
  });
  await get(createElectronNetTransport(allowed.net), "https://github.com/x", allow);
  assert.equal(allowed.requests[0].follows, 1);
  assert.equal(allowed.requests[0].aborts, 0);

  const refused = fakeNet((_request, handlers) =>
    handlers.redirect(302, "GET", "https://evil.example/a"),
  );
  await assert.rejects(
    () => get(createElectronNetTransport(refused.net), "https://github.com/x", allow),
    { code: "redirect-rejected" },
  );
  assert.equal(refused.requests[0].follows, 0);
  assert.equal(refused.requests[0].aborts, 1);
  assert.deepEqual(targets, [
    "https://release-assets.githubusercontent.com/a",
    "https://evil.example/a",
  ]);
});

test("a network error rejects the request", async () => {
  const { net } = fakeNet((_request, handlers) => handlers.error(new Error("net::ERR_PROXY")));
  await assert.rejects(() => get(createElectronNetTransport(net), "https://github.com/x"), {
    message: "net::ERR_PROXY",
  });
});

test("an abort cancels the request, before or after it starts", async () => {
  const before = fakeNet();
  const done = new AbortController();
  done.abort();
  await assert.rejects(
    () => get(createElectronNetTransport(before.net), "https://github.com/x", () => true, done.signal),
    { code: "aborted" },
  );
  assert.equal(before.requests[0].aborts, 1);
  assert.equal(before.requests[0].ended, false, "an aborted request is never sent");

  const during = fakeNet();
  const controller = new AbortController();
  const pending = get(
    createElectronNetTransport(during.net),
    "https://github.com/x",
    () => true,
    controller.signal,
  );
  controller.abort();
  await assert.rejects(() => pending, { code: "aborted" });
  assert.equal(during.requests[0].aborts, 1);
});
