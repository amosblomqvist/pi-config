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

function makeMockPi() {
	const handlers = new Map();
	let tool;
	return {
		api: {
			on: (event, handler) => handlers.set(event, handler),
			registerTool: (definition) => { tool = definition; },
		},
		handlers,
		get tool() { return tool; },
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
let passed = 0;
async function test(name, fn) {
	await fn();
	passed++;
	console.log(`  ✓ ${name}`);
}

console.log("ask-user-question integration validation\n");

// Exports exist
await test("exports askUserQuestionCore function", () => {
	assert.equal(typeof mod.askUserQuestionCore, "function");
});

// Unavailable (headless)
await test("unavailable result when ctx.hasUI is false", async () => {
	const ctx = makeMockCtx({ hasUI: false });
	const r = await mod.askUserQuestionCore(ctx, { question: "Headless?" });
	assert.equal(r.details.status, "unavailable");
	assert.equal(r.details.mode, "text");
	assert.equal(r.details.answers.length, 0);
	assert.ok(r.content[0].text.includes("requires interactive mode"));
});

// Aborted signal
await test("cancelled result when signal is already aborted", async () => {
	const ac = new AbortController();
	ac.abort();
	const ctx = makeMockCtx({ hasUI: true, editor: async () => "x", custom: makeMockCustom(null) });
	const r = await mod.askUserQuestionCore(ctx, { question: "Aborted?" }, ac.signal);
	assert.equal(r.details.status, "cancelled");
});

// Text mode — answered
await test("text mode answered", async () => {
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
await test("text mode cancelled (editor returns undefined)", async () => {
	const ctx = makeMockCtx({ hasUI: true, editor: async () => undefined });
	const r = await mod.askUserQuestionCore(ctx, { question: "Name?" });
	assert.equal(r.details.status, "cancelled");
	assert.equal(r.details.mode, "text");
});

// Single-select — answered
await test("single-select answered", async () => {
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
await test("single-select cancelled (done(null))", async () => {
	const ctx = makeMockCtx({ hasUI: true, custom: makeMockCustom(null) });
	const r = await mod.askUserQuestionCore(ctx, {
		question: "Pick one",
		options: [{ label: "A" }],
	});
	assert.equal(r.details.status, "cancelled");
	assert.equal(r.details.mode, "single-select");
});

// Multi-select — answered
await test("multi-select answered", async () => {
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
await test("multi-select cancelled (done(null))", async () => {
	const ctx = makeMockCtx({ hasUI: true, custom: makeMockCustom(null) });
	const r = await mod.askUserQuestionCore(ctx, {
		question: "Pick many",
		options: [{ label: "A" }],
		multiSelect: true,
	});
	assert.equal(r.details.status, "cancelled");
	assert.equal(r.details.mode, "multi-select");
});

// All three executable integration paths expose the same behavior.
await test("export, global seam, and tool execute return the same structured result", async () => {
	const pi = makeMockPi();
	mod.default(pi.api);
	const request = { question: "Integration seam?", details: "Consumer-visible context" };
	const makeCtx = () => makeMockCtx({ hasUI: true, editor: async () => "  seam answer  " });

	const direct = await mod.askUserQuestionCore(makeCtx(), request);
	const globalResult = await globalThis.__piAskUserQuestion(makeCtx(), request);
	const toolResult = await pi.tool.execute("call-1", request, undefined, undefined, makeCtx());

	assert.deepEqual(globalResult, direct);
	assert.deepEqual(toolResult, direct);
	console.log(`    consumer response: ${JSON.stringify(direct)}`);
	await pi.handlers.get("session_shutdown")();
});

// The extracted core keeps the shared popup lock used by tool execution.
await test("programmatic and tool calls remain serialized by the shared UI lock", async () => {
	const pi = makeMockPi();
	mod.default(pi.api);
	const events = [];
	let releaseFirst;
	let markFirstStarted;
	const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
	const holdFirst = new Promise((resolve) => { releaseFirst = resolve; });
	const firstCtx = makeMockCtx({
		hasUI: true,
		editor: async () => {
			events.push("programmatic:start");
			markFirstStarted();
			await holdFirst;
			events.push("programmatic:end");
			return "first";
		},
	});
	const secondCtx = makeMockCtx({
		hasUI: true,
		editor: async () => {
			events.push("tool:start");
			return "second";
		},
	});

	const first = globalThis.__piAskUserQuestion(firstCtx, { question: "First?" });
	await firstStarted;
	const second = pi.tool.execute("call-2", { question: "Second?" }, undefined, undefined, secondCtx);
	await Promise.resolve();
	assert.deepEqual(events, ["programmatic:start"]);
	releaseFirst();
	await Promise.all([first, second]);
	assert.deepEqual(events, ["programmatic:start", "programmatic:end", "tool:start"]);
	await pi.handlers.get("session_shutdown")();
});

// globalThis registration
await test("globalThis.__piAskUserQuestion registered after default export call", async () => {
	const g = globalThis;
	const pi = makeMockPi();
	delete g.__piAskUserQuestion;
	assert.equal(g.__piAskUserQuestion, undefined);
	mod.default(pi.api);
	assert.equal(typeof g.__piAskUserQuestion, "function");
	assert.equal(g.__piAskUserQuestion, mod.askUserQuestionCore);
	await pi.handlers.get("session_shutdown")();
	assert.equal(g.__piAskUserQuestion, undefined);
});

// Hot-reload registration
await test("globalThis registration replaces a stale implementation", async () => {
	const stale = () => {};
	const replacement = () => {};
	const pi = makeMockPi();
	globalThis.__piAskUserQuestion = stale;
	mod.default(pi.api);
	assert.notEqual(globalThis.__piAskUserQuestion, stale);
	assert.equal(globalThis.__piAskUserQuestion, mod.askUserQuestionCore);
	globalThis.__piAskUserQuestion = replacement;
	await pi.handlers.get("session_shutdown")();
	assert.equal(globalThis.__piAskUserQuestion, replacement);
});

console.log(`\nAll ${passed} checks passed.`);
