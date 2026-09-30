#!/usr/bin/env node
// Gateway HTTP tối giản cho local development khi Kafka/Kong/Judge chạy trên EC2.
// Production vẫn dùng Kong; file này chỉ giữ contract localhost:8000 để frontend local
// gọi đúng các service đang chạy native trên máy phát triển mà không cần Docker Desktop.
import http from "node:http";
import { Readable } from "node:stream";

const port = Number(process.env.PORT_GATEWAY ?? 8000);
const localOrigins = new Set([
  "http://localhost:3000",
  "http://localhost:3010",
  "http://localhost:3011",
]);

const routes = [
  [["/api/v1/me", "/api/v1/users", "/api/v1/technologies", "/api/v1/tags", "/api/v1/companies", "/api/v1/announcements", "/api/v1/audit-logs", "/api/v1/health"], "http://127.0.0.1:3001"],
  [["/api/v1/courses", "/api/v1/chapters", "/api/v1/lessons", "/api/v1/roadmaps", "/api/v1/articles", "/api/v1/activity", "/api/v1/commerce"], "http://127.0.0.1:3002"],
  [["/api/v1/exercises", "/api/v1/exercise-sets"], "http://127.0.0.1:3003"],
  [["/api/v1/workspaces", "/api/v1/groups"], "http://127.0.0.1:3004"],
  [["/api/v1/submissions"], "http://127.0.0.1:3006"],
  [["/api/v1/notifications"], "http://127.0.0.1:3012"],
  [["/api/v1/recommendations"], "http://127.0.0.1:3013"],
  [["/api/v1/ai"], "http://127.0.0.1:3008"],
  [["/api/v1/judge"], process.env.JUDGE_SERVICE_URL ?? "https://api.nguyennguyen0.id.vn"],
];

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function corsHeaders(request) {
  const origin = request.headers.origin;
  return origin && localOrigins.has(origin)
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        vary: "Origin",
      }
    : {};
}

function targetFor(pathname) {
  for (const [prefixes, target] of routes) {
    if (prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`))) {
      return target;
    }
  }
  return null;
}

const server = http.createServer(async (request, response) => {
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      ...cors,
      "access-control-allow-methods": "GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "Accept,Authorization,Content-Type,Origin",
      "access-control-max-age": "3600",
    });
    response.end();
    return;
  }

  const incomingUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const target = targetFor(incomingUrl.pathname);
  if (!target) {
    response.writeHead(404, { ...cors, "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ message: `Dev gateway không có route cho ${incomingUrl.pathname}` }));
    return;
  }

  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || hopByHopHeaders.has(name.toLowerCase())) continue;
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else headers.set(name, value);
  }
  headers.set("x-forwarded-host", request.headers.host ?? "localhost:8000");
  headers.set("x-forwarded-proto", "http");

  try {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstream = await fetch(new URL(`${incomingUrl.pathname}${incomingUrl.search}`, target), {
      method: request.method,
      headers,
      body: hasBody ? request : undefined,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
    });

    const responseHeaders = { ...cors };
    upstream.headers.forEach((value, name) => {
      if (!hopByHopHeaders.has(name.toLowerCase())) responseHeaders[name] = value;
    });
    response.writeHead(upstream.status, responseHeaders);
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(response);
    else response.end();
  } catch (error) {
    response.writeHead(502, { ...cors, "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ message: "Không kết nối được upstream local", detail: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`CodeMentor dev gateway đang nghe tại http://localhost:${port}`);
});
