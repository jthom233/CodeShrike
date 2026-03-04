import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { handleDefine } from "./tools/define.js";
import { handleQuery } from "./tools/query.js";
import { handleCompare } from "./tools/compare.js";
import { handleRecord, startAutoCloseTimer } from "./tools/record.js";

// Parse --project-path argument (default: process.cwd())
const args = process.argv.slice(2);
const projectPathIndex = args.indexOf("--project-path");
const projectPath =
  projectPathIndex !== -1 && args[projectPathIndex + 1]
    ? args[projectPathIndex + 1]
    : process.cwd();

const server = new McpServer({
  name: "codeshrike",
  version: "0.1.0",
});

// shrike_define — Create or update a test suite with all steps
server.tool(
  "shrike_define",
  "Create or update a test suite with named steps and scope layers",
  {
    suite_id: z.string().describe("Kebab-case identifier for the suite"),
    name: z.string().describe("Human-readable name"),
    description: z.string().optional().describe("Suite description"),
    layers: z
      .array(z.string())
      .describe("Intended scope layers this suite covers"),
    steps: z
      .array(
        z.object({
          step_id: z.string().describe("Kebab-case step identifier"),
          name: z.string().describe("Verification-level description"),
          layer: z.string().describe("Which scope layer"),
          expected: z.string().describe("What success looks like"),
        })
      )
      .describe("Ordered test steps"),
  },
  async (args) => {
    return handleDefine(args, projectPath);
  }
);

// shrike_record — Record results for one or more steps
server.tool(
  "shrike_record",
  "Record step results for a test run. Auto-creates run if none active.",
  {
    suite_id: z.string().describe("Suite identifier"),
    run_label: z
      .string()
      .optional()
      .describe("Descriptive label for this run"),
    results: z
      .array(
        z.object({
          step_id: z.string().describe("Step identifier"),
          status: z
            .enum(["pass", "fail", "skip", "blocked"])
            .describe("Result status"),
          actual: z.string().optional().describe("What actually happened"),
          screenshot_path: z
            .string()
            .optional()
            .describe("Absolute path to screenshot file"),
          notes: z.string().optional().describe("Additional notes"),
        })
      )
      .describe("Step results to record"),
    _complete: z
      .boolean()
      .optional()
      .describe("If true, closes the run after recording"),
  },
  async (args) => {
    return handleRecord(args, projectPath);
  }
);

// shrike_query — Retrieve suites, runs, and results
server.tool(
  "shrike_query",
  "Retrieve suites, runs, and results with flexible filtering",
  {
    suite_id: z.string().optional().describe("Filter to specific suite"),
    run_id: z.string().optional().describe("Filter to specific run"),
    status_filter: z
      .enum([
        "all",
        "pass",
        "fail",
        "skip",
        "blocked",
        "untested",
        "failing_suites",
      ])
      .optional()
      .describe("Filter by status"),
    include_steps: z
      .boolean()
      .optional()
      .describe("Include step details in response"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(1)
      .describe("Maximum number of results"),
  },
  async (args) => {
    return handleQuery(args, projectPath);
  }
);

// shrike_compare — Compare two runs of the same suite
server.tool(
  "shrike_compare",
  "Compare two runs of the same suite to identify regressions and improvements",
  {
    suite_id: z.string().describe("Suite identifier"),
    run_id_a: z
      .string()
      .optional()
      .describe("First run ID (defaults to second-most-recent)"),
    run_id_b: z
      .string()
      .optional()
      .describe("Second run ID (defaults to most recent)"),
  },
  async (args) => {
    return handleCompare(args, projectPath);
  }
);

// shrike_dashboard — Spawn the web dashboard
server.tool(
  "shrike_dashboard",
  "Launch the web dashboard for viewing test suites and results",
  {
    port: z
      .number()
      .int()
      .positive()
      .optional()
      .default(8420)
      .describe("Port to serve dashboard on"),
  },
  async (_args) => {
    return {
      content: [{ type: "text", text: "Not implemented" }],
    };
  }
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);

// Start auto-close timer for stale runs
const autoCloseInterval = startAutoCloseTimer(projectPath);
process.on('exit', () => clearInterval(autoCloseInterval));

// Export projectPath for use by other modules
export { projectPath };
