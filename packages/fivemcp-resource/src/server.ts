import { createFiveMHttpApp } from "./app";
import type { HttpRequest, HttpResponse } from "./httpTypes";

const app = createFiveMHttpApp();

SetHttpHandler((request: HttpRequest, response: HttpResponse) => {
  void app.handle(request, response);
});

console.log("[fivemcp] HTTP API ready.");
