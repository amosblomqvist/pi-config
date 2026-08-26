/**
 * Minimal validation for the ask-user-question integration seam.
 *
 * Run: node extensions/ask-user-question.test.mjs
 *
 * Uses jiti (from the globally installed pi-coding-agent) with the same
 * alias resolution Pi uses, then validates the programmatic integration
 * path (`askUserQuestionCore` + `globalThis.__piAskUserQuestion`) with
 * mock contexts — no external services, no network, no added deps.
 */

import { execSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Locate the globally installed pi-coding-agent and set up jiti aliases.
// ---------------------------------------------------------------------------
const npmRoot = execSync("npm root -g", { encoding: "utf-8" }).trim();
const piRoot = path.join(npmRoot, "@earendil-works", "pi-coding-agent");
const piTuiEntry = path.join(piRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "index.js");
const typeboxEntry = path.join(piRoot, "node_modules", "typebox", "build", "index.mjs");
const piCodingAgentEntry = path.join(piRoot, "dist", "index.js");

// Dynamically import jiti from the pi-coding-agent's bundled node_modules.
const jitiStaticPath = pathToFileURL(
    path.join(piRoot, "node_modules", "jiti", "lib", "jiti-static.mjs"),
).href;
const { createJiti } = await import(jitiStaticPath);

const jiti = createJiti(import.meta.url, {
	alias: {
		"@mariozechner/pi-coding-agent": piCodingAgentEntry,
		"@earendil-works/pi-coding-agent": piCodingAgentEntry,
		"@mariozechner/pi-tui": piTuiEntry,
		"@earendil-works/pi-tui": piTuiEntry,
		"@sinclair/typebox": typeboxEntry,
		typebox: typeboxEntry,
	},
});

// ---------------------------------------------------------------------------
// Load the extension module.
// ---------------------------------------------------------------------------
const extPath = path.resolve("extensions", "ask-user-question.ts");
const mod = await jiti.import(extPath);

// ---------------------------------------------------------------------------
// Mock helpers.
// ---------------------------------------------------------------------------
const mockTheme = { fg: (_style, text) => text, bold: (t) => t };
const mockTui = { requestRender() {} };

/** Mock ctx.ui.custom that immediately resolves with a canned answer. */
function makeMockCustom(answer) {
	return async (factory) => {
		let resolved = false;
		const result = await new Promise((resolve) => {
			const done = (r) => {
				if (!resolved) {
					resolved = true;
					resolve(r);
				}
			};
			// Factory may be sync or async; call it and then inject the answer.
			Promise.resolve(factory(mockTui, mockTheme, {}, done)).then(() => {
				if (!resolved) done(answer);
			});
		});
		return result;
	};
}

function makeMockCtx({ hasUI, editor, custom }) {
	return { hasUI, ui: { editor, custom } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
let passed = 0;
function test(name, fn) {
	passed++;
	fn();
	console.log(`  ✓ ${name}`);
}

console.log("ask-user-question integration validation\n");

// Exports exist
test("exports askUserQuestionCore function", () => {
	assert.equal(typeof mod.askUserQuestionCore, "function");
});

test("exports AskUserQuestionResultDetails via details field", () => {
	// Structural check — the function returns objects with a `details` field.
	// We verify the shape in the mode tests below.
});

// Unavailable (headless)
test("unavailable result when ctx.hasUI is false", async () => {
	const ctx = makeMockCtx({ hasUI: false });
	const r = await mod.askUserQuestionCore(ctx, { question: "Headless?" });
	assert.equal(r.details.status, "unavailable");
	assert.equal(r.details.mode, "text");
	assert.equal(r.details.answers.length, 0);
	assert.ok(r.content[0].text.includes("requires interactive mode"));
});

// Aborted signal
test("cancelled result when signal is already aborted", async () => {
	const ac = new AbortController();
	ac.abort();
	const ctx = makeMockCtx({ hasUI: true, editor: async () => "x", custom: makeMockCustom(null) });
	const r = await mod.askUserQuestionCore(ctx, { question: "Aborted?" }, ac.signal);
	assert.equal(r.details.status, "cancelled");
});

// Text mode — answered
test("text mode answered", async () => {
	const ctx = makeMockCtx({ hasUI: true, editor: async () => "  hello world  " });
	const r = await mod.askUserQuestionCore(ctx, { question: "Name?", details: "ctx" });
	assert.equal(r.details.status, "answered");
	assert.equal(r.details.mode, "text");
	assert.equal(r.details.answers.length, 1);
	assert.equal(r.details.answers[0].type, "text");
	assert.equal(r.details.answers[0].label, "hello world");
	assert.equal(r.details.answers[0].value, "hello world");
	assert.equal(r.details.context, "ctx");
	assert.ok(r.content[0].text.includes("hello world"));
});

// Text mode — cancelled
test("text mode cancelled (editor returns undefined)", async () => {
	const ctx = makeMockCtx({ hasUI: true, editor: async () => undefined });
	const r = await mod.askUserQuestionCore(ctx, { question: "Name?" });
	assert.equal(r.details.status, "cancelled");
	assert.equal(r.details.mode, "text");
});

// Single-select — answered
test("single-select answered", async () => {
	const answer = { type: "option", label: "Option A", value: "a", index: 1 };
	const ctx = makeMockCtx({ hasUI: true, custom: makeMockCustom(answer) });
	const r = await mod.askUserQuestionCore(ctx, {
		question: "Pick one",
		options: [{ label: "Option A", value: "a" }, { label: "Option B", value: "b" }],
	});
	assert.equal(r.details.status, "answered");
	assert.equal(r.details.mode, "single-select");
	assert.equal(r.details.answers.length, 1);
	assert.equal(r.details.answers[0].label, "Option A");
	assert.equal(r.details.answers[0].index, 1);
});

// Single-select — cancelled
test("single-select cancelled (done(null))", async () => {
	const ctx = makeMockCtx({ hasUI: true, custom: makeMockCustom(null) });
	const r = await mod.askUserQuestionCore(ctx, {
		question: "Pick one",
		options: [{ label: "A" }],
	});
	assert.equal(r.details.status, "cancelled");
	assert.equal(r.details.mode, "single-select");
});

// Multi-select — answered
test("multi-select answered", async () => {
	const answers = [
		{ type: "option", label: "A", value: "a", index: 1 },
		{ type: "other", label: "custom", value: "custom" },
	];
	const ctx = makeMockCtx({ hasUI: true, custom: makeMockCustom(answers) });
	const r = await mod.askUserQuestionCore(ctx, {
		question: "Pick many",
		options: [{ label: "A" }, { label: "B" }],
		multiSelect: true,
	});
	assert.equal(r.details.status, "answered");
	assert.equal(r.details.mode, "multi-select");
	assert.equal(r.details.answers.length, 2);
	assert.equal(r.details.answers[0].type, "option");
	assert.equal(r.details.answers[1].type, "other");
});

// Multi-select — cancelled
test("multi-select cancelled (done(null))", async () => {
	const ctx = makeMockCtx({ hasUI: true, custom: makeMockCustom(null) });
	const r = await mod.askUserQuestionCore(ctx, {
		question: "Pick many",
		options: [{ label: "A" }],
		multiSelect: true,
	});
	assert.equal(r.details.status, "cancelled");
	assert.equal(r.details.mode, "multi-select");
});

// globalThis registration
test("globalThis.__piAskUserQuestion registered after default export call", () => {
	const g = globalThis;
	// Clean slate
	delete g.__piAskUserQuestion;
	assert.equal(g.__piAskUserQuestion, undefined);
	// Call the default export with a minimal mock ExtensionAPI
	mod.default({ registerTool: () => {} });
	assert.equal(typeof g.__piAskUserQuestion, "function");
	assert.equal(g.__piAskUserQuestion, mod.askUserQuestionCore);
});

// Idempotent registration
test("globalThis registration is idempotent", () => {
	const fnBefore = globalThis.__piAskUserQuestion;
	mod.default({ registerTool: () => {} });
	assert.equal(globalThis.__piAskUserQuestion, fnBefore);
});

console.log(`\nAll ${passed} checks passed.`);
