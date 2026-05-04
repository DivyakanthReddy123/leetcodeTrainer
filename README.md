# LeetCode Pattern Trainer

Active-recall trainer for LeetCode patterns. Vanilla HTML/CSS/JS, no build step, no framework.

---

## Run it locally

Browsers block `fetch()` for `file://` URLs, so you need a tiny local server.

```bash
cd leetcode-trainer
python3 -m http.server 8000
# open http://localhost:8000
```

---

## Deploy to Netlify (~2 minutes)

1. Go to https://app.netlify.com/drop
2. Drag the `leetcode-trainer` folder onto the page.
3. Wait ~10 seconds → you get a URL like `https://random-name.netlify.app`.
4. (Optional) Rename in Netlify dashboard.
5. Open URL on phone → browser menu → **Add to Home Screen**.

To deploy updates: drag the updated folder onto the same Netlify site (Deploys tab → Deploy manually).

---

## Project structure

```
leetcode-trainer/
├── index.html       ← shell, fonts, layout slots
├── styles.css       ← design tokens & all styling
├── app.js           ← engine + stage registry
├── problems.json    ← problem bank (edit often)
└── README.md        ← this file
```

---

## Stage architecture (modular)

Each problem moves through a list of **stages**. Stage TYPES are registered in `app.js` under `STAGE_REGISTRY`. The default flow for a problem is `pattern → approach → brute → optimal → complexity`. Two stages are graded (pattern, complexity); three are read-only.

**A problem can override the default flow** by adding its own `stages` array:

```jsonc
{
  "id": "my-problem",
  // ...all the usual fields...
  "stages": [
    { "type": "pattern" },
    { "type": "approach" },
    { "type": "intuition" },     // hypothetical custom type
    { "type": "optimal" },
    { "type": "complexity" }
  ]
}
```

If `stages` is absent, the default 5-stage flow is used. Existing problems don't need to be modified.

### Adding a new stage type

In `app.js`, add an entry to `STAGE_REGISTRY`:

```js
STAGE_REGISTRY.intuition = {
  label: 'Intuition',
  graded: false,
  render({ problem }) {
    return {
      html: `
        <p class="stage-label">Build the intuition</p>
        <div class="approach">${problem.intuitionContent || ''}</div>
        <div class="nav">
          <button class="btn ghost" data-action="back">← Back</button>
          <button class="btn primary" data-action="next">Next →</button>
        </div>
      `,
      wire(root) {
        root.querySelector('[data-action="back"]').onclick = goBack;
        root.querySelector('[data-action="next"]').onclick = () => advance();
      }
    };
  }
};
```

If the new stage is graded, also extend `stageSkillBucket()` to map its type to a skill bucket (or add a new bucket).

---

## How to add a new problem

Append to `problems.json`. Schema:

```jsonc
{
  "id": "kebab-case-slug",
  "title": "Display Title",
  "diff": "easy",                       // "easy" | "medium" | "hard"
  "pattern": "Hash map",                // canonical pattern name

  "problem": "Problem statement...",
  "example": "Input: ...\nOutput: ...",

  "patternChoices": [
    "Hash map", "Two pointers", "Binary search",
    "Sliding window", "Dynamic programming", "Sorting"
  ],
  "patternReason": {
    "right": "Why the correct pattern fits.",
    "wrong": {
      "Two pointers": "Why two pointers doesn't fit here.",
      "Binary search": "..."
      // one entry per wrong choice
    }
  },

  "approach": {
    "type": "text",                     // "text" | "diagram"
    "content": "<p>HTML walkthrough</p><ol><li>step</li></ol>",
    "svg": "<svg>...</svg>"             // only when type === "diagram"
  },

  "bruteCode": ["def fn():", "    pass"],
  "bruteTC": "O(n²)",
  "bruteSC": "O(1)",

  "optimalCode": ["def fn():", "    pass"],
  "optimalTC": "O(n)",
  "optimalSC": "O(n)",

  "complexityChoices": ["O(1)", "O(log n)", "O(n)", "O(n log n)", "O(n²)", "O(2ⁿ)"],
  "complexityRight": "O(n)",            // must equal optimalTC AND be in complexityChoices
  "complexityReason": "Explanation of both time and space complexity."

  // optional: custom stage flow
  // "stages": [{ "type": "pattern" }, { "type": "approach" }, { "type": "complexity" }]
}
```

**Rules:**

- `pattern` must appear in `patternChoices`.
- `complexityRight` must equal `optimalTC` AND must appear in `complexityChoices`.
- `patternReason.wrong` must have one entry per non-correct option in `patternChoices`.
- `id` must be unique across the bank.
- Use `&lt;`/`&gt;` instead of `<`/`>` inside `approach.content` text.
- Inline code in `approach.content` uses `<code>...</code>` (styled by CSS).

After editing, save and refresh the browser. No restart needed.

---

## Reset progress

DevTools → Application → Local Storage → delete the key `lc-trainer-v3` → refresh.

---

## Tech stack

- Frontend: vanilla HTML/CSS/JS (no framework, no build)
- Fonts: DM Sans (body), DM Mono (code) via Google Fonts
- Storage: browser localStorage (per-device, no sync)
- Hosting: any static host (Netlify recommended)
- Code language for problems: Python only

---

## Score model

Each problem is graded out of N, where N = number of graded stages in that problem's flow. The default flow has 2 graded stages: **Pattern** and **Complexity** (time complexity only — space is shown alongside but not asked).

If a problem declares custom stages with a different number of graded items, the score auto-adjusts (e.g., 3 graded stages → x/3).
