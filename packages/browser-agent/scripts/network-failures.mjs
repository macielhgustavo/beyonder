// Keep explicit RSC cancellations separate from transport, HTTP and API failures.
// API failures, navigation failures and non-abort transport errors remain failures.
function isRscAbort(failure, baseUrl) {
  const target = new URL(failure.url);
  return failure.errorText === "net::ERR_ABORTED"
    && failure.method === "GET"
    && !failure.navigation
    && target.origin === new URL(baseUrl).origin
    && !target.pathname.startsWith("/api/")
    && target.searchParams.has("_rsc")
    && failure.headers.rsc === "1";
}

export function isBenignPrefetchAbort(failure, baseUrl) {
  return isRscAbort(failure, baseUrl)
    && (failure.headers["next-router-prefetch"] === "1" || Boolean(failure.headers["next-router-segment-prefetch"]));
}

export function classifyRequestFailure(failure, baseUrl) {
  if (isBenignPrefetchAbort(failure, baseUrl)) return "benign-rsc-prefetch-abort";
  if (!isRscAbort(failure, baseUrl)) return null;
  const response = failure.response;
  if (response?.status >= 200 && response.status < 300 && response.contentType?.split(";")[0] === "text/x-component" && failure.documentUrl) {
    const document = new URL(failure.documentUrl);
    const target = new URL(failure.url);
    // Next can cancel an unused Flight stream after a successful route refresh.
    // Transport failures (ERR_FAILED, incomplete body, timeout) never enter here.
    if (document.origin === target.origin && document.pathname === target.pathname) return "benign-rsc-stream-cancellation";
  }
  const replacement = failure.documentReplacement;
  if (!replacement || !["qa-document-navigation", "qa-page-close"].includes(replacement.reason)) return null;
  const from = new URL(replacement.from);
  const target = new URL(failure.url);
  // The harness must prove this request belonged to the document it replaced.
  if (replacement.requestPredatesReplacement && from.origin === target.origin && from.pathname === target.pathname) return "benign-rsc-document-replacement-abort";
  return null;
}
