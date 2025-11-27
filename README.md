# AI Humanizer

A CLI tool that eliminates "hallucinations of competence" from AI-generated text. It targets the stylistic tics that make LLM writing sound confident but hollow, moving text toward concrete, specific, and verifiable human writing.

## Quick start

```bash
# From the api/ directory

# Lint existing text (no API key needed)
npm run ai-lint -- path/to/file.md

# Generate new humanized text
npm run ai-writer -- -t "Write 200 words about database indexing"

# Rewrite/humanize existing AI-generated text
npm run ai-rewrite -- ai-draft.txt -o clean.txt
```

## What it catches

The tool checks four categories of AI patterns:

### 1. Tone and content

**Puffery (peacock words)**
- groundbreaking, stunning, breathtaking, nestled, visionary, renowned, legendary, iconic, game-changing, revolutionary, transformative, cutting-edge, world-class, unprecedented

**Superficial analysis (padding gerunds)**
- ", underscoring...", ", highlighting...", ", reflecting...", ", demonstrating..."

**Coverage chest-thumping**
- "Featured in Forbes, Wired, and TechCrunch" without explaining what was actually said

### 2. Vocabulary constraints

**Banned verbs and adjectives**
- delve, tapestry, interplay, pivotal, underscores, highlights, garnered, enduring, align, showcase, intricate, nuanced, multifaceted, comprehensive, robust, leverage, utilize, facilitate, seamless, holistic, synergy, paradigm, ecosystem, landscape, realm, sphere, arena

**Banned transitions**
- "It is important to note", "In summary", "In conclusion", "Moreover", "Furthermore", "Additionally", "In today's world", "At the end of the day", "When it comes to", "Interestingly", "Notably"

**Negative parallelism**
- "Not only X, but also Y..."
- "It's not just... it's..."

### 3. Structure and flow

**Formulaic endings**
- "In summary...", "In conclusion...", "To sum up..."

**Future boilerplate**
- "Despite challenges, the future looks bright..."
- "Going forward...", "Moving forward..."
- "Poised to/for..."

### 4. Formatting and mechanics

**Em dashes**
- Flags overuse of — (suggests commas or periods instead)

**Chatbot leakage**
- "I hope this helps", "As of my last update", "Feel free to ask", "Let me know if"

**Vague citations**
- "Experts say", "Studies show", "Research indicates", "According to sources"

## Usage

```
AI Humanizer - Eliminate LLM patterns from text

USAGE:
  node ai-writer.js --task "Write about X"           Generate new humanized text
  node ai-writer.js --rewrite input.txt              Humanize existing text
  node ai-writer.js --lint input.txt                 Check text for AI patterns

OPTIONS:
  --task, -t        Task/prompt for new text generation
  --taskFile, -f    Read task from file
  --rewrite, -r     Rewrite/humanize an existing file
  --lint, -l        Lint-only mode (no AI, just check)
  --out, -o         Output file (default: stdout)
  --maxLoops, -m    Max repair iterations (default: 3)
  --model           AI model (default: gpt-4o)
  --verbose, -v     Detailed output
  --help, -h        Show this help
```

## Examples

### Lint a file

```bash
node scripts/ai-writer.js --lint article.md --verbose
```

Output:
```
Linting: article.md

Humanization Score: 72/100
Found 8 AI pattern(s):

VOCABULARY:
  [high] AI vocabulary tell (3x)
    line 12: "leverage"
    line 24: "ecosystem"
    line 31: "seamlessly"

STRUCTURE:
  [high] Formulaic ending (1x)
    line 45: "In conclusion"
```

### Generate new text

```bash
node scripts/ai-writer.js -t "Write 150 words explaining why React uses a virtual DOM" -o explanation.txt
```

The tool will:
1. Generate an initial draft with humanization rules
2. Lint the draft
3. Run repair loops (up to 3 by default) until clean
4. Output the final text

### Rewrite existing AI-generated text

```bash
node scripts/ai-writer.js --rewrite chatgpt-output.txt -o humanized.txt --verbose
```

## How it works

```
┌─────────────────┐
│  Input text     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Regex linter   │──────► Score + issues list
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LLM rewrite    │◄────── System prompt with full ruleset
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Lint again     │──────► Still has issues?
└────────┬────────┘              │
         │                       │ yes
         │              ┌────────┴────────┐
         │              │  Targeted repair │
         │              │  (specific lines)│
         │              └────────┬────────┘
         │                       │
         │◄──────────────────────┘
         │
         ▼ (clean or max loops)
┌─────────────────┐
│  Final output   │
└─────────────────┘
```

1. **Regex linter** scans text for known AI patterns without any API calls
2. **LLM rewrite** sends text to the model with a comprehensive system prompt containing all rules, BAD/GOOD examples, and banned word lists
3. **Repair loop** targets specific violations by line number and asks the model to fix just those issues
4. Repeats until clean or max loops reached (default: 3)

## Scoring

Severity-weighted penalties:
- **Critical** (chatbot leakage): -20 points
- **High** (banned vocab, puffery, parallelism): -8 points
- **Medium** (em dashes, vague citations, transitions): -4 points
- **Low** (bold emphasis, emojis): -2 points

Score = 100 - penalties (minimum 0)

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | (required for generation) | OpenAI API key |
| `AI_WRITER_MODEL` | `gpt-4o` | Default model for generation/rewriting |

## Exit codes

- `0` - Success, no AI patterns detected
- `1` - Fatal error (missing file, API error)
- `2` - AI patterns detected (useful for CI)

## CI integration

```yaml
# Example: GitHub Actions
- name: Check for AI patterns
  run: |
    cd api
    node scripts/ai-writer.js --lint ../docs/article.md
```

The tool exits with code 2 if any patterns are found, making it suitable for automated checks.

## Adding new rules

Rules are defined in the `RULES_SPEC` object at the top of the script. To add a new banned word:

```javascript
// In RULES_SPEC.vocabulary.rules[0].banned
banned: [
  "delve",
  "your-new-word",  // add here
  // ...
]
```

To add a new pattern:

```javascript
// In buildRegexRules()
rules.push({
  id: "my_new_rule",
  category: "vocabulary",
  pattern: /your regex here/gi,
  description: "What this catches",
  severity: "high",  // critical, high, medium, low
});
```

## Philosophy

This tool is based on the observation that LLMs have predictable stylistic tells:

1. **Regression to the mean** - Smoothing specific details into generic praise ("revolutionary titan" vs "invented a train coupler")

2. **Significance inflation** - Making ordinary facts sound pivotal ("this paradigm shift" vs "sales grew 12%")

3. **Hollow confidence** - Using impressive-sounding words that add no information (the entire banned vocabulary list)

4. **Structural formulas** - "In conclusion" paragraphs, rule-of-three lists, "not only X but Y" constructions

5. **Hedging artifacts** - Vague citations, future boilerplate, chatbot politeness

Human writing tends to be more specific, less symmetrical, and comfortable with imperfection. This tool pushes AI output in that direction.
