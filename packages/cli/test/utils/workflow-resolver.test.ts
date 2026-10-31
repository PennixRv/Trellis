/**
 * Unit tests for the workflow template resolver.
 *
 * Native resolution is offline. Custom workflow resolution uses an explicit
 * source and stubs its index and file requests.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NATIVE_WORKFLOW_ID,
  WorkflowResolveError,
  listWorkflowTemplates,
  resolveWorkflowTemplate,
} from "../../src/utils/workflow-resolver.js";
import { workflowMdTemplate } from "../../src/templates/trellis/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveWorkflowTemplate(native)", () => {
  it("returns the bundled native workflow content without network access", async () => {
    // No fetch stub installed — proves we never call the network for native.
    const resolved = await resolveWorkflowTemplate(NATIVE_WORKFLOW_ID);
    expect(resolved.id).toBe(NATIVE_WORKFLOW_ID);
    expect(resolved.source).toBe("bundled");
    expect(resolved.content).toBe(workflowMdTemplate);
  });
});

describe("resolveWorkflowTemplate(custom source)", () => {
  it("fetches index.json, finds the workflow entry, and downloads its content", async () => {
    const index = {
      version: 1,
      templates: [
        {
          id: "tdd",
          type: "workflow",
          name: "TDD Workflow",
          description: "red/green/refactor",
          path: "workflows/tdd/workflow.md",
        },
        {
          id: "electron-fullstack",
          type: "spec",
          name: "Electron",
          path: "specs/electron-fullstack",
        },
      ],
    };
    const fakeContent = "# TDD\n\nPhase 2.1 red → green → refactor.\n";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/index.json")) {
          return new Response(JSON.stringify(index), { status: 200 });
        }
        if (url.endsWith("workflows/tdd/workflow.md")) {
          return new Response(fakeContent, { status: 200 });
        }
        return new Response("nope", { status: 404 });
      }),
    );

    const resolved = await resolveWorkflowTemplate("tdd", {
      source: "gh:example/repo/workflows",
    });
    expect(resolved.id).toBe("tdd");
    expect(resolved.source).toBe("custom");
    expect(resolved.content).toBe(fakeContent);
  });

  it("throws WorkflowResolveError with workflow-specific copy when id is missing", async () => {
    const index = {
      version: 1,
      templates: [
        {
          id: "tdd",
          type: "workflow",
          name: "TDD",
          path: "workflows/tdd/workflow.md",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(index), { status: 200 })),
    );

    await expect(
      resolveWorkflowTemplate("does-not-exist", {
        source: "gh:example/repo/workflows",
      }),
    ).rejects.toThrow(WorkflowResolveError);
    await expect(
      resolveWorkflowTemplate("does-not-exist", {
        source: "gh:example/repo/workflows",
      }),
    ).rejects.toThrow(/workflow template/i);
  });

  it("surfaces a workflow-specific error when the index cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );

    await expect(
      resolveWorkflowTemplate("tdd", {
        source: "gh:example/repo/workflows",
      }),
    ).rejects.toThrow(
      /workflow template index/i,
    );
  });

  it("rejects an entry whose path does not point to a .md file", async () => {
    const index = {
      version: 1,
      templates: [
        {
          id: "broken",
          type: "workflow",
          name: "Broken",
          path: "workflows/broken/",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(index), { status: 200 })),
    );

    await expect(
      resolveWorkflowTemplate("broken", {
        source: "gh:example/repo/workflows",
      }),
    ).rejects.toThrow(
      /workflow\.md/,
    );
  });

  it("rejects workflow paths that escape the custom source", async () => {
    const index = {
      version: 1,
      templates: [
        {
          id: "escape",
          type: "workflow",
          name: "Escape",
          path: "../workflow.md",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(index), { status: 200 })),
    );

    await expect(
      resolveWorkflowTemplate("escape", {
        source: "gh:example/repo/workflows",
      }),
    ).rejects.toThrow(
      /custom source/,
    );
  });
});

describe("listWorkflowTemplates", () => {
  it("lists only the bundled native entry without an explicit custom source", async () => {
    const { templates, errorMessage } = await listWorkflowTemplates();
    expect(errorMessage).toBeUndefined();
    expect(templates).toHaveLength(1);
    expect(templates[0].id).toBe(NATIVE_WORKFLOW_ID);
    expect(templates[0].source).toBe("bundled");
  });

  it("includes workflow entries only from an explicit custom source", async () => {
    const index = {
      version: 1,
      templates: [
        {
          id: "tdd",
          type: "workflow",
          name: "TDD Workflow",
          path: "workflows/tdd/workflow.md",
        },
        {
          id: "electron-fullstack",
          type: "spec",
          name: "Electron",
          path: "specs/electron-fullstack",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(index), { status: 200 })),
    );

    const { templates } = await listWorkflowTemplates({
      source: "gh:example/repo/workflows",
    });
    const ids = templates.map((t) => t.id);
    expect(ids).toContain(NATIVE_WORKFLOW_ID);
    expect(ids).toContain("tdd");
    expect(ids).not.toContain("electron-fullstack");
  });
});

it("requires an explicit custom source for non-bundled workflow ids", async () => {
  await expect(resolveWorkflowTemplate("tdd")).rejects.toThrow(
    /requires an explicit custom workflow source/,
  );
});
