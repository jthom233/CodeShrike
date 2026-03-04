import { getDatabase } from "../db/connection.js";
import {
  createSuite,
  updateSuite,
  getSuite,
  replaceSteps,
  getSteps,
} from "../db/queries.js";
import type { Step } from "../db/queries.js";

export function handleDefine(
  args: {
    suite_id: string;
    name: string;
    description?: string;
    layers: string[];
    steps: Array<{
      step_id: string;
      name: string;
      layer: string;
      expected: string;
    }>;
  },
  projectPath: string
): { content: [{ type: "text"; text: string }] } {
  const VALID_LAYERS = new Set(['ui', 'api', 'logic', 'data', 'filesystem', 'auth', 'integration', 'performance']);

  // Validate step layers
  const invalidSteps = args.steps.filter(s => !VALID_LAYERS.has(s.layer));
  if (invalidSteps.length > 0) {
    const details = invalidSteps.map(s => `step "${s.step_id}" has invalid layer "${s.layer}"`).join('; ');
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          error: `Invalid layer values: ${details}. Valid layers: ${[...VALID_LAYERS].join(', ')}`
        })
      }]
    };
  }

  const db = getDatabase(projectPath);

  const existing = getSuite(db, args.suite_id);

  if (existing) {
    updateSuite(db, {
      id: args.suite_id,
      name: args.name,
      description: args.description,
      layers: args.layers,
    });
  } else {
    createSuite(db, {
      id: args.suite_id,
      name: args.name,
      description: args.description,
      layers: args.layers,
    });
  }

  const stepsToInsert = args.steps.map((s, index) => ({
    id: s.step_id,
    ordinal: index,
    name: s.name,
    layer: s.layer as Step["layer"],
    expected: s.expected,
  }));

  replaceSteps(db, args.suite_id, stepsToInsert);

  const suite = getSuite(db, args.suite_id)!;
  const steps = getSteps(db, args.suite_id);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          suite_id: suite.id,
          version: suite.version,
          step_count: steps.length,
          step_ids: steps.map((s) => s.id),
        }),
      },
    ],
  };
}
