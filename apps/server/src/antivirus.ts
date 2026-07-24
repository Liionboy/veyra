import { createReadStream } from "node:fs";
import { connect } from "node:net";

export interface AntivirusSettings {
  enabled: boolean;
  host: string;
  port: number;
  timeoutMs: number;
}

export type ScanResult =
  | { status: "disabled" }
  | { status: "clean" }
  | { status: "infected"; signature: string };

function parseClamdResponse(value: string): ScanResult {
  const response = value.replace(/\0/g, "").trim();
  if (response.endsWith(" OK")) return { status: "clean" };
  const infected = /: (.+) FOUND$/.exec(response);
  if (infected?.[1]) {
    return { status: "infected", signature: infected[1].slice(0, 240) };
  }
  throw new Error(`ClamAV rejected the scan: ${response || "empty response"}`);
}

export async function scanFile(
  path: string,
  settings: AntivirusSettings,
): Promise<ScanResult> {
  if (!settings.enabled) return { status: "disabled" };

  return new Promise<ScanResult>((resolve, reject) => {
    const socket = connect({
      host: settings.host,
      port: settings.port,
    });
    const source = createReadStream(path, { highWaterMark: 64 * 1024 });
    const response: Buffer[] = [];
    let settled = false;

    const finish = (error?: Error, result?: ScanResult) => {
      if (settled) return;
      settled = true;
      source.destroy();
      socket.destroy();
      if (error) reject(error);
      else resolve(result!);
    };

    socket.setTimeout(settings.timeoutMs, () => {
      finish(new Error("ClamAV scan timed out."));
    });
    socket.once("error", (error) => finish(error));
    source.once("error", (error) => finish(error));

    socket.on("data", (chunk) => response.push(Buffer.from(chunk)));
    socket.once("close", () => {
      if (settled) return;
      try {
        finish(undefined, parseClamdResponse(Buffer.concat(response).toString("utf8")));
      } catch (error) {
        finish(error instanceof Error ? error : new Error("ClamAV scan failed."));
      }
    });

    socket.once("connect", () => {
      socket.write("zINSTREAM\0");
      source.on("data", (chunk: Buffer) => {
        source.pause();
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        if (!socket.write(chunk)) {
          socket.once("drain", () => source.resume());
        } else {
          source.resume();
        }
      });
      source.once("end", () => {
        socket.end(Buffer.alloc(4));
      });
    });
  });
}

export async function testAntivirus(
  settings: AntivirusSettings,
): Promise<void> {
  if (!settings.enabled) return;
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: settings.host, port: settings.port });
    let response = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("ClamAV health check timed out."));
    }, Math.min(settings.timeoutMs, 10_000));
    socket.setEncoding("utf8");
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.once("close", () => {
      clearTimeout(timer);
      if (response.replace(/\0/g, "").trim() === "PONG") resolve();
      else reject(new Error("ClamAV did not answer PONG."));
    });
    socket.once("connect", () => socket.end("zPING\0"));
  });
}
