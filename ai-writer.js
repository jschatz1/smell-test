#!/usr/bin/env node
/**
 * AI Humanizer - Rewrite text to eliminate LLM patterns
 *
 * An expert editor that moves text away from generic, smooth, promotional
 * fluff toward concrete, specific, and verifiable human writing.
 *
 * Usage:
 *   node ai-writer.js --task "Write about X"           # Generate new text
 *   node ai-writer.js --rewrite input.txt              # Humanize existing text
 *   node ai-writer.js --lint input.txt                 # Check without rewriting
 *
 * The tool targets "hallucinations of competence" - the stylistic tics
 * that make AI writing sound confident but hollow.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

// ---------- Config ----------
const DEFAULT_MODEL = process.env.AI_WRITER_MODEL || "gpt-4o";
const MAX_LOOPS_DEFAULT = 3;
const TEMPERATURE = 0.4;

// =============================================================================
// HUMANIZER RULESET
// =============================================================================

const RULES_SPEC = {
  // -------------------------------------------------------------------------
  // 1. TONE AND CONTENT: Concrete over Generic
  // -------------------------------------------------------------------------
  tone: {
    name: "Tone and Content",
    rules: [
      {
        id: "regression_to_mean",
        description: "Eliminate smoothing specific details into generic praise",
        bad: "A revolutionary titan of industry",
        good: "Inventor of a train-coupling device",
      },
      {
        id: "significance_inflation",
        description: "Stop recasting ordinary facts as pivotal or grand",
        bad: "This pivotal shift transformed the landscape",
        good: "Sales increased 12% that quarter",
      },
      {
        id: "puffery",
        description: "Remove peacock words that add no information",
        banned: [
          "groundbreaking", "stunning", "breathtaking", "nestled", "visionary",
          "renowned", "legendary", "iconic", "game-changing", "revolutionary",
          "transformative", "cutting-edge", "world-class", "best-in-class",
          "industry-leading", "unparalleled", "unprecedented", "remarkable",
        ],
      },
      {
        id: "coverage_chest_thumping",
        description: "Don't list media outlets as proof without explaining what was said",
        pattern: /featured in .*(wired|vogue|forbes|techcrunch|nyt|wsj)/i,
      },
      {
        id: "superficial_analysis",
        description: "Remove vague gerunds used to pad word count",
        banned_gerunds: [
          "underscoring", "highlighting", "reflecting", "indicating",
          "showcasing", "demonstrating", "emphasizing", "illustrating",
          "signaling", "revealing", "suggesting", "pointing to",
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 2. VOCABULARY CONSTRAINTS (The Banned List)
  // -------------------------------------------------------------------------
  vocabulary: {
    name: "Vocabulary Constraints",
    rules: [
      {
        id: "banned_verbs_adjectives",
        description: "Statistical tells of AI writing",
        banned: [
          "delve", "delves", "delving",
          "tapestry", "tapestries",
          "interplay",
          "pivotal",
          "underscores", "underscore", "underscored",
          "highlights", "highlight", "highlighted",
          "garnered", "garner", "garnering",
          "enduring",
          "align", "aligns", "aligned", "aligning",
          "showcase", "showcases", "showcased", "showcasing",
          "intricate", "intricately",
          "nuanced", "nuance",
          "multifaceted",
          "comprehensive",
          "robust",
          "leverage", "leverages", "leveraged", "leveraging",
          "utilize", "utilizes", "utilized", "utilizing",
          "facilitate", "facilitates", "facilitated",
          "seamless", "seamlessly",
          "holistic",
          "synergy", "synergies",
          "paradigm",
          "ecosystem",
          "landscape",
          "realm",
          "sphere",
          "arena",
          "space", // when used as "in the X space"
        ],
      },
      {
        id: "banned_transitions",
        description: "Formulaic transition phrases",
        banned: [
          "it is important to note",
          "it's important to note",
          "it is worth noting",
          "it's worth noting",
          "in summary",
          "in conclusion",
          "to summarize",
          "moreover",
          "furthermore",
          "additionally",
          "in today's world",
          "in this day and age",
          "at the end of the day",
          "when it comes to",
          "needless to say",
          "it goes without saying",
          "as we all know",
          "interestingly",
          "notably",
          "importantly",
          "crucially",
          "significantly",
        ],
      },
      {
        id: "negative_parallelism",
        description: "Not only X, but also Y patterns",
        patterns: [
          /not only\s+.{1,80}\s+but\s+(also\s+)?/gi,
          /it's not just\s+.{1,60}\s+it's/gi,
          /it is not just\s+.{1,60}\s+it is/gi,
        ],
      },
      {
        id: "false_scale",
        description: "From X to Y without a coherent scale",
        pattern: /from\s+\w+\s+to\s+\w+/gi,
        note: "Flag for review unless literal scale",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 3. STRUCTURE AND FLOW
  // -------------------------------------------------------------------------
  structure: {
    name: "Structure and Flow",
    rules: [
      {
        id: "formulaic_endings",
        description: "Humans rarely summarize short text at the end",
        patterns: [
          /^in (summary|conclusion),?\s/im,
          /^to (sum up|summarize|conclude),?\s/im,
          /^(overall|ultimately|finally),?\s.{0,30}(this|these|the)\s/im,
        ],
      },
      {
        id: "future_boilerplate",
        description: "Vague future outlook without specific plans",
        patterns: [
          /despite.{0,30}challenges?.{0,30}future.{0,30}(bright|promising)/i,
          /future initiatives will/i,
          /going forward,?\s/i,
          /moving forward,?\s/i,
          /as we move into/i,
          /poised (to|for)/i,
        ],
      },
      {
        id: "rule_of_three",
        description: "Listing exactly three items to sound comprehensive",
        pattern: /(\w+),\s+(\w+),?\s+and\s+(\w+)/g,
        note: "Flag suspicious triads for review",
        severity: "low",
      },
      {
        id: "elegant_variation",
        description: "Complex synonyms to avoid word repetition",
        note: "Prefer simple and clear over varied vocabulary",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 4. FORMATTING AND MECHANICS
  // -------------------------------------------------------------------------
  formatting: {
    name: "Formatting and Mechanics",
    rules: [
      {
        id: "em_dash_overuse",
        description: "Use commas, periods, or parentheses instead",
        pattern: /—/g,
        replacement: ", ",
      },
      {
        id: "quote_consistency",
        description: "Don't mix curly and straight quotes",
        patterns: [/[""]/g, /['']/g],
      },
      {
        id: "title_case_headings",
        description: "Use sentence case, not Title Case",
        note: "History of the region, not History of the Region",
      },
      {
        id: "bold_emphasis",
        description: "Don't use bold for emphasis in paragraphs",
        pattern: /\*\*[^*]+\*\*/g,
      },
      {
        id: "inline_header_bullets",
        description: "No **Header:** Value patterns",
        pattern: /\*\*\w+:\*\*\s/g,
      },
      {
        id: "emoji_in_headings",
        description: "Remove emojis from headings and lists",
        pattern: /[\u{1F300}-\u{1F9FF}]/gu,
      },
      {
        id: "chatbot_leakage",
        description: "Remove assistant artifacts",
        patterns: [
          /i hope this helps/i,
          /as of my last update/i,
          /as an ai/i,
          /i don't have access to/i,
          /i cannot browse/i,
          /let me know if/i,
          /feel free to ask/i,
          /happy to help/i,
        ],
      },
      {
        id: "vague_citations",
        description: "Flag unverifiable sources",
        patterns: [
          /observers say/i,
          /industry reports/i,
          /experts say/i,
          /studies show/i,
          /research indicates/i,
          /according to sources/i,
          /many believe/i,
          /some argue/i,
        ],
      },
      {
        id: "date_cutoff",
        description: "Remove AI date disclaimers",
        pattern: /as of \w+ \d{4}/i,
      },
    ],
  },
};

// =============================================================================
// LINTER IMPLEMENTATION
// =============================================================================

function buildRegexRules() {
  const rules = [];

  // Tone rules
  const pufferyWords = RULES_SPEC.tone.rules.find((r) => r.id === "puffery").banned;
  rules.push({
    id: "puffery",
    category: "tone",
    pattern: new RegExp(`\\b(${pufferyWords.join("|")})\\b`, "gi"),
    description: "Peacock word (adds no information)",
    severity: "high",
  });

  const gerunds = RULES_SPEC.tone.rules.find((r) => r.id === "superficial_analysis").banned_gerunds;
  rules.push({
    id: "superficial_gerund",
    category: "tone",
    pattern: new RegExp(`,\\s*(${gerunds.join("|")})\\b`, "gi"),
    description: "Vague gerund padding",
    severity: "high",
  });

  rules.push({
    id: "coverage_chest_thumping",
    category: "tone",
    pattern: /featured in\s+.{0,50}(wired|vogue|forbes|techcrunch|new york times|wsj|wall street journal)/gi,
    description: "Media name-dropping without context",
    severity: "medium",
  });

  // Vocabulary rules
  const bannedWords = RULES_SPEC.vocabulary.rules.find((r) => r.id === "banned_verbs_adjectives").banned;
  rules.push({
    id: "banned_vocabulary",
    category: "vocabulary",
    pattern: new RegExp(`\\b(${bannedWords.join("|")})\\b`, "gi"),
    description: "AI vocabulary tell",
    severity: "high",
  });

  const bannedTransitions = RULES_SPEC.vocabulary.rules.find((r) => r.id === "banned_transitions").banned;
  rules.push({
    id: "banned_transition",
    category: "vocabulary",
    pattern: new RegExp(`\\b(${bannedTransitions.join("|")})`, "gi"),
    description: "Formulaic transition",
    severity: "medium",
  });

  rules.push({
    id: "not_only_but",
    category: "vocabulary",
    pattern: /not only\s+.{1,80}\s+but\s+(also\s+)?/gi,
    description: "Negative parallelism pattern",
    severity: "high",
  });

  rules.push({
    id: "its_not_just",
    category: "vocabulary",
    pattern: /it['']?s not just\s+.{1,60}\s+it['']?s/gi,
    description: "It's not just... it's pattern",
    severity: "high",
  });

  // Structure rules
  rules.push({
    id: "formulaic_ending",
    category: "structure",
    pattern: /^(in (summary|conclusion)|to (sum up|summarize|conclude)|overall|ultimately),?\s/gim,
    description: "Formulaic ending",
    severity: "high",
  });

  rules.push({
    id: "future_boilerplate",
    category: "structure",
    pattern: /(despite.{0,30}challenges?.{0,30}future|future initiatives will|going forward|moving forward|poised (to|for))/gi,
    description: "Future outlook boilerplate",
    severity: "medium",
  });

  // Formatting rules
  rules.push({
    id: "em_dash",
    category: "formatting",
    pattern: /—/g,
    description: "Em dash (use comma or period)",
    severity: "medium",
  });

  rules.push({
    id: "chatbot_leakage",
    category: "formatting",
    pattern: /(i hope this helps|as of my last update|as an ai|let me know if|feel free to ask|happy to help)/gi,
    description: "Chatbot leakage",
    severity: "critical",
  });

  rules.push({
    id: "vague_citation",
    category: "formatting",
    pattern: /(observers say|industry reports|experts say|studies show|research indicates|according to sources|many believe|some argue)/gi,
    description: "Vague/unverifiable citation",
    severity: "medium",
  });

  rules.push({
    id: "bold_emphasis",
    category: "formatting",
    pattern: /\*\*[^*]+\*\*/g,
    description: "Bold emphasis in paragraph",
    severity: "low",
  });

  rules.push({
    id: "emoji",
    category: "formatting",
    pattern: /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
    description: "Emoji in text",
    severity: "low",
  });

  return rules;
}

const LINT_RULES = buildRegexRules();

function lint(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, lineIdx) => {
    LINT_RULES.forEach((rule) => {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(line)) !== null) {
        const start = Math.max(0, match.index - 25);
        const end = Math.min(line.length, match.index + match[0].length + 25);
        hits.push({
          rule: rule.id,
          category: rule.category,
          description: rule.description,
          severity: rule.severity,
          line: lineIdx + 1,
          column: match.index + 1,
          match: match[0],
          excerpt: line.slice(start, end),
        });
        if (!match[0]) break;
      }
    });
  });

  // Calculate score with severity weighting
  const weights = { critical: 20, high: 8, medium: 4, low: 2 };
  let penalty = 0;
  hits.forEach((h) => {
    penalty += weights[h.severity] || 4;
  });
  const score = Math.max(0, 100 - Math.min(98, penalty));

  return { score, hits };
}

// =============================================================================
// PROMPTS
// =============================================================================

function getSystemPrompt() {
  return `You are an expert editor specializing in humanizing AI-generated text. Your goal is to eliminate "hallucinations of competence" - the stylistic tics that make AI writing sound confident but hollow.

CORE PRINCIPLE: Move text from generic, smooth, promotional fluff toward concrete, specific, and verifiable human writing.

## 1. TONE AND CONTENT: Concrete over Generic

- ELIMINATE "regression to the mean": Don't smooth specific details into generic praise.
  BAD: "A revolutionary titan of industry"
  GOOD: "Inventor of a train-coupling device"

- REMOVE significance inflation: Stop recasting ordinary facts as pivotal or grand.
  BAD: "This pivotal shift transformed the landscape"
  GOOD: "Sales increased 12% that quarter"

- KILL puffery/peacock words: groundbreaking, stunning, breathtaking, nestled, visionary, renowned, legendary, iconic, game-changing, revolutionary, transformative, cutting-edge, world-class, unprecedented

- NO coverage chest-thumping: Don't list "Featured in Wired, Forbes..." without explaining what was said

- FIX superficial analysis: Remove padding gerunds (underscoring, highlighting, reflecting, indicating, showcasing) unless they connect two distinct concepts

## 2. VOCABULARY CONSTRAINTS (Banned List)

BANNED VERBS/ADJECTIVES: delve, tapestry, interplay, pivotal, underscores, highlights, garnered, enduring, align/aligns, showcase, intricate, nuanced, multifaceted, comprehensive, robust, leverage, utilize, facilitate, seamless, holistic, synergy, paradigm, ecosystem, landscape, realm, sphere, arena

BANNED TRANSITIONS: "It is important to note", "In summary", "In conclusion", "Moreover", "Furthermore", "Additionally", "In today's world", "At the end of the day", "When it comes to", "Interestingly", "Notably", "Importantly"

BANNED PATTERNS:
- "Not only X, but also Y" (negative parallelism)
- "It's not just... it's..."
- "From X to Y" unless literal coherent scale

## 3. STRUCTURE AND FLOW

- DELETE formulaic endings: No "In summary" or "Conclusion" paragraphs. Humans rarely summarize short text.

- CUT future boilerplate: Remove "Despite challenges, the future looks bright" or "Future initiatives will address" unless citing a specific plan.

- AVOID rule of three: Don't list exactly three items to sound comprehensive.

- PREFER simple words: Don't use complex synonyms just to avoid repetition.

## 4. FORMATTING AND MECHANICS

- DRASTICALLY reduce em-dashes (—). Use commas, periods, or parentheses.
- Use sentence case for headings, not Title Case
- No bold for emphasis within paragraphs
- No emojis in headings or professional text
- Remove chatbot artifacts ("I hope this helps", "As of my last update", "Feel free to ask")
- Flag or remove vague citations ("Observers say", "Studies show", "Experts believe")

## OUTPUT RULES

Return ONLY the rewritten text. No meta-commentary. No explanations of changes. No "Here is the revised version" preamble. Just the clean, humanized text.`;
}

function getDraftPrompt(task) {
  return `Write the following, applying all humanization rules from your instructions:

TASK: ${task}

Remember:
- Concrete details over generic praise
- No banned vocabulary or patterns
- Short, direct sentences
- No formulaic structure
- Sound like a thoughtful human, not a press release`;
}

function getRewritePrompt(text) {
  return `Rewrite the following text to eliminate all AI patterns. Apply every rule from your instructions rigorously.

INPUT TEXT:
${text}

Return only the humanized version. No commentary.`;
}

function getRepairPrompt(text, issues) {
  const issueList = issues
    .slice(0, 10)
    .map((i) => `- Line ${i.line}: "${i.match}" (${i.description})`)
    .join("\n");

  return `The following text still has AI patterns. Fix these specific issues:

${issueList}

TEXT TO REPAIR:
${text}

Return only the fixed text. No commentary.`;
}

// =============================================================================
// AI CLIENT
// =============================================================================

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      console.error(c("ERROR: OPENAI_API_KEY is not set.", "red"));
      process.exit(1);
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

async function chat(messages, model = DEFAULT_MODEL) {
  const client = getClient();
  try {
    const resp = await client.chat.completions.create({
      model,
      temperature: TEMPERATURE,
      messages,
    });
    return resp.choices[0]?.message?.content?.trim() ?? "";
  } catch (error) {
    if (error.status === 429) {
      console.error(c("Rate limited. Waiting 5s...", "yellow"));
      await new Promise((r) => setTimeout(r, 5000));
      return chat(messages, model);
    }
    throw error;
  }
}

// =============================================================================
// PIPELINE
// =============================================================================

async function generateText(task, options = {}) {
  const { maxLoops = MAX_LOOPS_DEFAULT, model = DEFAULT_MODEL, verbose = false } = options;

  console.log(c(`\nGenerating with ${model}`, "cyan"));
  console.log(c("Phase 1: Initial draft...", "dim"));

  let text = await chat(
    [
      { role: "system", content: getSystemPrompt() },
      { role: "user", content: getDraftPrompt(task) },
    ],
    model
  );

  return runRepairLoop(text, { maxLoops, model, verbose });
}

async function rewriteText(inputText, options = {}) {
  const { maxLoops = MAX_LOOPS_DEFAULT, model = DEFAULT_MODEL, verbose = false } = options;

  console.log(c(`\nRewriting with ${model}`, "cyan"));
  console.log(c("Phase 1: Initial rewrite...", "dim"));

  let text = await chat(
    [
      { role: "system", content: getSystemPrompt() },
      { role: "user", content: getRewritePrompt(inputText) },
    ],
    model
  );

  return runRepairLoop(text, { maxLoops, model, verbose });
}

async function runRepairLoop(text, options) {
  const { maxLoops, model, verbose } = options;

  let { score, hits } = lint(text);
  let loops = 0;

  if (verbose) {
    console.log(c(`Initial score: ${score}`, score >= 80 ? "green" : "yellow"));
    if (hits.length > 0) {
      console.log(c(`Found ${hits.length} issues`, "yellow"));
    }
  }

  while (hits.length > 0 && loops < maxLoops) {
    console.log(c(`Phase ${loops + 2}: Repair loop ${loops + 1}/${maxLoops}...`, "dim"));

    text = await chat(
      [
        { role: "system", content: getSystemPrompt() },
        { role: "user", content: getRepairPrompt(text, hits) },
      ],
      model
    );

    ({ score, hits } = lint(text));
    loops += 1;

    if (verbose) {
      console.log(c(`  Score: ${score}, Issues: ${hits.length}`, "dim"));
    }
  }

  return { text, score, hits, loops };
}

// =============================================================================
// CLI
// =============================================================================

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function c(text, color) {
  return process.stdout.isTTY ? `${colors[color]}${text}${colors.reset}` : text;
}

function parseArgs(args) {
  const opts = {
    task: "",
    taskFile: "",
    rewrite: "",
    lint: "",
    out: "",
    maxLoops: MAX_LOOPS_DEFAULT,
    model: DEFAULT_MODEL,
    verbose: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--task" || arg === "-t") { opts.task = next || ""; i++; }
    else if (arg === "--taskFile" || arg === "-f") { opts.taskFile = next || ""; i++; }
    else if (arg === "--rewrite" || arg === "-r") { opts.rewrite = next || ""; i++; }
    else if (arg === "--lint" || arg === "-l") { opts.lint = next || ""; i++; }
    else if (arg === "--out" || arg === "-o") { opts.out = next || ""; i++; }
    else if (arg === "--maxLoops" || arg === "-m") { opts.maxLoops = parseInt(next, 10) || MAX_LOOPS_DEFAULT; i++; }
    else if (arg === "--model") { opts.model = next || DEFAULT_MODEL; i++; }
    else if (arg === "--verbose" || arg === "-v") { opts.verbose = true; }
    else if (arg === "--help" || arg === "-h") { opts.help = true; }
  }

  return opts;
}

function showHelp() {
  console.log(`
${c("AI Humanizer", "bold")} - Eliminate LLM patterns from text

${c("USAGE:", "cyan")}
  node ai-writer.js --task "Write about X"           Generate new humanized text
  node ai-writer.js --rewrite input.txt              Humanize existing text
  node ai-writer.js --lint input.txt                 Check text for AI patterns

${c("OPTIONS:", "cyan")}
  --task, -t        Task/prompt for new text generation
  --taskFile, -f    Read task from file
  --rewrite, -r     Rewrite/humanize an existing file
  --lint, -l        Lint-only mode (no AI, just check)
  --out, -o         Output file (default: stdout)
  --maxLoops, -m    Max repair iterations (default: ${MAX_LOOPS_DEFAULT})
  --model           AI model (default: ${DEFAULT_MODEL})
  --verbose, -v     Detailed output
  --help, -h        Show this help

${c("WHAT IT CATCHES:", "cyan")}
  ${c("Tone:", "yellow")}       Puffery, significance inflation, superficial gerunds
  ${c("Vocabulary:", "yellow")} Banned AI words (delve, leverage, pivotal, etc.)
  ${c("Structure:", "yellow")}  Formulaic endings, future boilerplate, negative parallelism
  ${c("Formatting:", "yellow")} Em-dashes, chatbot leakage, vague citations

${c("EXAMPLES:", "cyan")}
  # Generate a humanized blog post
  node ai-writer.js -t "Write 200 words about React hooks"

  # Humanize existing AI-generated text
  node ai-writer.js --rewrite ai-draft.txt -o final.txt

  # Just check for issues
  node ai-writer.js --lint article.md --verbose
`);
}

function printResults(hits, score, verbose) {
  const scoreColor = score >= 90 ? "green" : score >= 70 ? "yellow" : "red";
  console.log(c(`\nHumanization Score: ${score}/100`, scoreColor));

  if (hits.length === 0) {
    console.log(c("No AI patterns detected.", "green"));
    return;
  }

  console.log(c(`Found ${hits.length} AI pattern(s):\n`, "yellow"));

  // Group by category
  const byCategory = {};
  hits.forEach((h) => {
    if (!byCategory[h.category]) byCategory[h.category] = [];
    byCategory[h.category].push(h);
  });

  Object.entries(byCategory).forEach(([cat, catHits]) => {
    console.log(c(`${cat.toUpperCase()}:`, "cyan"));

    // Group by rule within category
    const byRule = {};
    catHits.forEach((h) => {
      if (!byRule[h.rule]) byRule[h.rule] = [];
      byRule[h.rule].push(h);
    });

    Object.entries(byRule).forEach(([rule, ruleHits]) => {
      const sev = ruleHits[0].severity;
      const sevColor = sev === "critical" ? "red" : sev === "high" ? "yellow" : "dim";
      console.log(c(`  [${sev}] ${ruleHits[0].description} (${ruleHits.length}x)`, sevColor));

      if (verbose) {
        ruleHits.slice(0, 3).forEach((h) => {
          console.log(c(`    line ${h.line}: `, "dim") + `"${h.match}"`);
          console.log(c(`    context: ...${h.excerpt}...`, "dim"));
        });
        if (ruleHits.length > 3) {
          console.log(c(`    ...and ${ruleHits.length - 3} more`, "dim"));
        }
      } else {
        ruleHits.slice(0, 2).forEach((h) => {
          console.log(c(`    line ${h.line}: `, "dim") + `"${h.match}"`);
        });
      }
    });
    console.log();
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    showHelp();
    process.exit(0);
  }

  // LINT MODE
  if (opts.lint) {
    const filePath = path.resolve(opts.lint);
    if (!fs.existsSync(filePath)) {
      console.error(c(`File not found: ${filePath}`, "red"));
      process.exit(1);
    }
    const text = fs.readFileSync(filePath, "utf8");
    console.log(c(`Linting: ${opts.lint}`, "cyan"));
    const { score, hits } = lint(text);
    printResults(hits, score, opts.verbose);
    process.exit(hits.length > 0 ? 2 : 0);
  }

  // REWRITE MODE
  if (opts.rewrite) {
    const filePath = path.resolve(opts.rewrite);
    if (!fs.existsSync(filePath)) {
      console.error(c(`File not found: ${filePath}`, "red"));
      process.exit(1);
    }
    const inputText = fs.readFileSync(filePath, "utf8");

    const { text, score, hits, loops } = await rewriteText(inputText, {
      maxLoops: opts.maxLoops,
      model: opts.model,
      verbose: opts.verbose,
    });

    printResults(hits, score, opts.verbose);
    console.log(c(`Repair loops: ${loops}`, "dim"));

    if (opts.out) {
      fs.writeFileSync(path.resolve(opts.out), text, "utf8");
      console.log(c(`\nWrote: ${opts.out}`, "green"));
    } else {
      console.log(c("\n----- HUMANIZED TEXT -----\n", "cyan"));
      console.log(text);
      console.log(c("\n----- END -----", "cyan"));
    }

    process.exit(hits.length > 0 ? 2 : 0);
  }

  // GENERATE MODE
  let task = opts.task;
  if (!task && opts.taskFile) {
    const filePath = path.resolve(opts.taskFile);
    if (!fs.existsSync(filePath)) {
      console.error(c(`File not found: ${filePath}`, "red"));
      process.exit(1);
    }
    task = fs.readFileSync(filePath, "utf8");
  }

  if (!task) {
    console.error(c("No task provided. Use --task, --taskFile, --rewrite, or --lint", "red"));
    console.error("Run with --help for usage.");
    process.exit(1);
  }

  const { text, score, hits, loops } = await generateText(task, {
    maxLoops: opts.maxLoops,
    model: opts.model,
    verbose: opts.verbose,
  });

  printResults(hits, score, opts.verbose);
  console.log(c(`Repair loops: ${loops}`, "dim"));

  if (opts.out) {
    fs.writeFileSync(path.resolve(opts.out), text, "utf8");
    console.log(c(`\nWrote: ${opts.out}`, "green"));
  } else {
    console.log(c("\n----- GENERATED TEXT -----\n", "cyan"));
    console.log(text);
    console.log(c("\n----- END -----", "cyan"));
  }

  process.exit(hits.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(c(`Fatal: ${err.message}`, "red"));
  process.exit(1);
});
