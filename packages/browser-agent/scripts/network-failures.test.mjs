import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRequestFailure, isBenignPrefetchAbort } from "./network-failures.mjs";

const baseUrl = "http://127.0.0.1:4187";
const prefetch = { url: `${baseUrl}/missions?_rsc=abc`, method: "GET", errorText: "net::ERR_ABORTED", headers: { rsc: "1", "next-router-prefetch": "1" }, navigation: false };

test("classifies only explicit same-origin RSC prefetch aborts as benign", () => {
  assert.equal(isBenignPrefetchAbort(prefetch, baseUrl), true);
  assert.equal(isBenignPrefetchAbort({ ...prefetch, headers: { rsc: "1", "next-router-segment-prefetch": "/_tree" } }, baseUrl), true);
});

test("classifies a superseded RSC read only with evidence of deliberate document replacement", () => {
  const cancelled = { ...prefetch, headers: { rsc: "1" }, documentReplacement: { from: `${baseUrl}/missions`, to: `${baseUrl}/decisions`, reason: "qa-document-navigation", requestPredatesReplacement: true } };
  assert.equal(classifyRequestFailure(cancelled, baseUrl), "benign-rsc-document-replacement-abort");
  assert.equal(classifyRequestFailure({ ...cancelled, documentReplacement: { ...cancelled.documentReplacement, reason: "qa-page-close" } }, baseUrl), "benign-rsc-document-replacement-abort");
  for (const change of [
    { documentReplacement: undefined },
    { documentReplacement: { ...cancelled.documentReplacement, requestPredatesReplacement: false } },
    { documentReplacement: { ...cancelled.documentReplacement, from: `${baseUrl}/opportunities` } },
    { documentReplacement: { ...cancelled.documentReplacement, reason: "unknown" } },
    { url: `${baseUrl}/api/control/missions/task_abc?_rsc=abc` },
    { errorText: "net::ERR_CONNECTION_REFUSED" },
    { navigation: true }
  ]) assert.equal(classifyRequestFailure({ ...cancelled, ...change }, baseUrl), null, JSON.stringify(change));
});

test("keeps real API, navigation, transport and unclassified RSC failures visible", () => {
  for (const change of [
    { url: `${baseUrl}/api/control/missions/task_abc?_rsc=abc` },
    { url: "https://external.example/missions?_rsc=abc" },
    { url: `${baseUrl}/missions` },
    { method: "POST" },
    { navigation: true },
    { headers: { rsc: "1" } },
    { headers: { "next-router-prefetch": "1" } },
    { errorText: "net::ERR_CONNECTION_REFUSED" },
    { errorText: "net::ERR_FAILED" },
    { errorText: "net::ERR_TIMED_OUT" }
  ]) assert.equal(isBenignPrefetchAbort({ ...prefetch, ...change }, baseUrl), false, JSON.stringify(change));
});

test("retains evidence for client-cancelled successful Flight streams without hiding HTTP or transport errors", () => {
  const stream = { ...prefetch, headers: { rsc: "1" }, documentUrl: `${baseUrl}/missions`, response: { status: 200, contentType: "text/x-component; charset=utf-8" } };
  assert.equal(classifyRequestFailure(stream, baseUrl), "benign-rsc-stream-cancellation");
  for (const change of [
    { response: undefined },
    { response: { status: 500, contentType: "text/x-component" } },
    { response: { status: 200, contentType: "application/json" } },
    { documentUrl: `${baseUrl}/tasks` },
    { navigation: true },
    { url: `${baseUrl}/api/control/health?_rsc=abc` },
    { errorText: "net::ERR_INCOMPLETE_CHUNKED_ENCODING" },
    { errorText: "net::ERR_CONNECTION_RESET" },
    { errorText: "net::ERR_TIMED_OUT" }
  ]) assert.equal(classifyRequestFailure({ ...stream, ...change }, baseUrl), null, JSON.stringify(change));
});
