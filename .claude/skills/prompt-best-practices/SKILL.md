---
name: prompt-best-practices
description: Write, review, or improve prompts for Claude (system prompts, agent instructions, CLAUDE.md, skill files, API calls) following Anthropic's official prompting best practices. Use when the user asks to write a prompt, fix a prompt that behaves badly, migrate prompts to newer Claude models, or review prompt quality. Also triggers on Arabic requests like "اكتب برومبت" or "حسّن البرومبت".
---

# Claude prompting best practices

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices

When writing or reviewing a prompt, apply the checklist below. When reviewing, quote each problem line, say which rule it breaks, and give the rewritten line.

## 1. Clarity and context
- Be explicit and direct. Imagine a brilliant new employee with zero context: would they understand?
- If you want more than the minimum, ask for it ("Go beyond the basics to create a fully-featured implementation").
- Explain *why* a rule exists. Bad: `NEVER use ellipses`. Good: `The output is read by a text-to-speech engine, so never use ellipses; it can't pronounce them.`
- Use numbered steps when order or completeness matters.
- Give a role in one line of the system prompt (e.g. `You are a helpful coding assistant specializing in Python.`).

## 2. Structure
- Separate instructions, context, examples and input with consistent XML tags: `<instructions>`, `<context>`, `<input>`.
- Give 3–5 diverse, relevant examples in `<examples><example>…</example></examples>`.
- Long context (over 20k tokens): put documents at the TOP, the question at the END. Wrap each in `<document index="n"><source>…</source><document_content>…</document_content></document>`. Ask for relevant quotes first, then the answer.

## 3. Output format
- Say what to do, not what to avoid: `Write in flowing prose paragraphs` rather than `Don't use markdown`.
- The prompt's style shapes the output's style (a markdown-heavy prompt gets markdown-heavy output).
- Need a summary after tool use? Ask for it explicitly; recent models skip it.
- Don't use prefilled assistant turns: they return a 400 error from Claude 4.6 onward. Use structured outputs, tool enums, or `Respond directly without preamble.`

## 4. Tools and actions
- Use action verbs: `Change this function…`, not `Can you suggest changes…`.
- Remove shouting: replace `CRITICAL: You MUST use this tool` with `Use this tool when…`. Newer models overtrigger on it.
- Run independent tool calls in parallel and dependent ones in sequence. Never guess missing parameters.

## 5. Thinking
- Use `thinking: {type: "adaptive"}` plus `output_config: {effort: …}`. `budget_tokens` is deprecated and returns a 400 error on Claude 4.7 and later.
- To curb overthinking, lower effort or add: `Choose an approach and commit to it.`
- Prefer general guidance ("think thoroughly") over hand-scripted reasoning steps.

## 6. Agentic prompts
- Keep state in files (`tests.json`, `progress.txt`, git commits) and give a fixed startup routine for each new context window.
- Allow local, reversible actions freely. Require confirmation for destructive or shared actions (delete, force-push, posting). Forbid `--no-verify`.
- Keep changes minimal: no unrequested features or abstractions. Never hard-code values to pass tests.
- Read files before making claims about them (`<investigate_before_answering>`).
- Say when subagents are warranted (parallel or independent work) and when they aren't (simple, sequential, single-file tasks).
- Ask the agent to delete its temporary scripts when done.

## Output when writing a new prompt
1. The final prompt in a code block.
2. A short list explaining the key choices (which rules were applied).
3. Reply in the user's language (Arabic if they wrote in Arabic); keep the prompt itself in the language the target app needs.
