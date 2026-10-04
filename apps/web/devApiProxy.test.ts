import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { test } from "node:test";
import { createServer as viteServer } from "vite";
import { devApiProxy } from "./devApiProxy";

test("dev proxy groups API outages, returns 503, and resumes forwarding without replaying requests", async t => {
  let writes = 0;
  const upstream = httpServer((request, response) => {
    if (request.method === "POST") writes++;
    if (request.url === "/api/reset") { response.destroy(); return; }
    response.end("ready");
  });
  const listen = (port: number) => new Promise<void>(resolve => upstream.listen(port, "127.0.0.1", resolve));
  const close = () => new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
  await listen(0);
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await close();
  t.after(async () => { if (upstream.listening) await close(); });
  const api = devApiProxy(`http://127.0.0.1:${port}`);
  const warnings: string[] = [], info: string[] = [];
  api.logger.warn = message => { warnings.push(message); };
  api.logger.info = message => { info.push(message); };
  const vite = await viteServer({ configFile: false, customLogger: api.logger,
    server: { host: "127.0.0.1", port: 0, proxy: { "/api": api.proxy }, watch: null } });
  t.after(() => vite.close());
  await vite.listen();
  const viteAddress = vite.httpServer!.address();
  assert.ok(viteAddress && typeof viteAddress !== "string");
  const url = `http://127.0.0.1:${viteAddress.port}`;
  const responses = await Promise.all(Array.from({ length: 10 }, () => fetch(`${url}/api/jobs`)));
  for (const response of responses) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "3");
    assert.match((await response.json()).error, /temporarily unavailable/);
  }
  assert.equal(warnings.length, 1, "one warning for the entire outage");
  await listen(port);
  const healthy = await fetch(`${url}/api/jobs`, { method: "POST" });
  assert.equal(healthy.status, 200);
  assert.equal(await healthy.text(), "ready");
  assert.equal(writes, 1);
  assert.equal(info.length, 1, "recovery is reported");
  const interrupted = await fetch(`${url}/api/reset`, { method: "POST" });
  assert.equal(interrupted.status, 503);
  assert.equal(writes, 2, "interrupted writes must not be retried");
  assert.equal(warnings.length, 2, "a new outage gets a new warning");
});
