import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Module-level singleton — one dashboard process per MCP server instance
let dashboardProcess: ChildProcess | null = null;
let currentPort: number | null = null;

export function handleDashboard(
  args: { port?: number },
  projectPath: string
): { content: Array<{ type: "text"; text: string }> } {
  const port = args.port ?? 8420;

  // If a process is already running (on the same port), return its URL
  if (dashboardProcess && !dashboardProcess.killed) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "already_running",
            url: `http://localhost:${currentPort ?? port}`,
            pid: dashboardProcess.pid,
          }),
        },
      ],
    };
  }

  // server.ts compiles to dist/dashboard/server.js.
  // This file (dist/tools/dashboard.js) is at dist/tools/, so server is one level up + dashboard/.
  const serverScript = path.resolve(__dirname, "../dashboard/server.js");

  dashboardProcess = spawn(
    "node",
    [serverScript, "--port", String(port), "--project-path", projectPath],
    {
      detached: true,
      stdio: "ignore",
    }
  );
  dashboardProcess.unref();
  currentPort = port;

  // Clean up reference when the child exits on its own
  dashboardProcess.once("exit", () => {
    dashboardProcess = null;
    currentPort = null;
  });

  // Kill the child when the MCP server process exits
  process.once("exit", () => {
    if (dashboardProcess && !dashboardProcess.killed) {
      dashboardProcess.kill();
    }
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          status: "started",
          url: `http://localhost:${port}`,
          pid: dashboardProcess.pid,
        }),
      },
    ],
  };
}
