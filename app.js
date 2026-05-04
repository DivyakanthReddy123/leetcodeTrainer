/* ============================================================
   LeetCode Pattern Trainer — vanilla JS engine
   Modular stage registry: each problem declares its stage list.
   ============================================================ */

(function () {
  'use strict';

  // ─── constants ───────────────────────────────────────────
  const STATE_KEY = 'lc-trainer-v3'; // unchanged so existing progress carries over
  const LETTERS = 'ABCDEF';

  // Default stage flow for a problem that doesn't specify its own.
  // Listed by stage TYPE name; each type is registered in STAGE_REGISTRY below.
  const DEFAULT_STAGES = [
    { type: 'pattern' },     // graded
    { type: 'approach' },    // read-only
    { type: 'brute' },       // read-only
    { type: 'optimal' },     // read-only
    { type: 'complexity' },  // graded (time + space shown together; only time graded for x/2)
  ];

  // ─── state ───────────────────────────────────────────────
  const DEFAULT_STATE = () => ({
    progress: {},          // { [problemId]: { seen, score } }
    filter: 'all',
    streak: 0,
    lastDay: null,
    todayCount: 0,
    skills: {
      pattern:    { r: 0, t: 0 },
      complexity: { r: 0, t: 0 },
    },
  });

  let state = DEFAULT_STATE();
  let PROBLEMS = [];

  function loadState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = Object.assign(DEFAULT_STATE(), parsed);
        // Defensive: ensure skill buckets exist
        state.skills = Object.assign({ pattern: { r: 0, t: 0 }, complexity: { r: 0, t: 0 } }, state.skills);
      }
    } catch (_) {
      state = DEFAULT_STATE();
    }
    const today = new Date().toDateString();
    if (state.lastDay !== today) {
      if (state.lastDay) {
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        if (state.lastDay !== yesterday) state.streak = 0;
      }
      state.todayCount = 0;
      state.lastDay = today;
    }
  }

  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function getProg(id) {
    return state.progress[id] || { seen: 0, score: 0 };
  }

  /**
   * Records the result of a finished card.
   * @param {string} id
   * @param {object} graded — { [stageIdx]: boolean } for graded stages
   */
  function recordCard(id, graded) {
    const p = getProg(id);
    p.seen += 1;
    const score = Object.values(graded).filter(Boolean).length;
    p.score = score;
    state.progress[id] = p;

    // Tally skills based on which stage scored what.
    // We bucket by stage TYPE so future stage types can be added without touching this.
    Object.entries(graded).forEach(([stageIdx, correct]) => {
      const stage = currentStages()[stageIdx];
      if (!stage) return;
      const bucket = stageSkillBucket(stage.type);
      if (!bucket) return;
      if (!state.skills[bucket]) state.skills[bucket] = { r: 0, t: 0 };
      state.skills[bucket].t += 1;
      if (correct) state.skills[bucket].r += 1;
    });

    state.todayCount += 1;
    if (state.todayCount === 1) state.streak += 1;
    saveState();
  }

  /** Maps a stage type to a skill bucket. Add new types here when you add new graded stages. */
  function stageSkillBucket(type) {
    return ({
      pattern:    'pattern',
      complexity: 'complexity',
    })[type] || null;
  }

  // ─── queue ───────────────────────────────────────────────
  let queue = [], qIndex = 0;
  function buildQueue() {
    let pool = PROBLEMS.slice();
    if (state.filter !== 'all') pool = pool.filter(p => p.pattern === state.filter);
    pool.sort((a, b) => {
      const pa = getProg(a.id), pb = getProg(b.id);
      if (pa.seen === 0 && pb.seen > 0) return -1;
      if (pb.seen === 0 && pa.seen > 0) return 1;
      return (pa.score || 0) - (pb.score || 0);
    });
    queue = pool;
    qIndex = 0;
  }

  // ─── card runtime ────────────────────────────────────────
  // The card is a state machine driven by a list of stage descriptors
  // (problem.stages || DEFAULT_STAGES). Each stage's renderer is in STAGE_REGISTRY.
  let card = null;
  function resetCard() {
    card = {
      idx: 0,                        // current stage index
      graded: {},                    // { stageIdx: boolean }
      anim: null,                    // 'forward' | 'back' | null
    };
  }

  function currentProblem() {
    return queue[qIndex];
  }

  /** Returns the active stage list for the current problem (with default fallback). */
  function currentStages() {
    const p = currentProblem();
    if (!p) return [];
    return Array.isArray(p.stages) && p.stages.length ? p.stages : DEFAULT_STAGES;
  }

  function advance(graded) {
    const stages = currentStages();
    if (graded) Object.assign(card.graded, graded);
    card.anim = 'forward';
    if (card.idx < stages.length) {
      card.idx += 1;
    }
    // Once past the last stage, the renderer shows the summary.
    if (card.idx === stages.length) {
      recordCard(currentProblem().id, card.graded);
    }
    render();
  }

  function goBack() {
    if (card.idx === 0) return;
    card.idx -= 1;
    card.anim = 'back';
    render();
  }

  function retryProblem() {
    resetCard();
    render();
  }

  function nextProblem() {
    qIndex = (qIndex + 1) % Math.max(queue.length, 1);
    resetCard();
    render();
  }

  // ─── syntax highlighter (token-based, safe) ──────────────
  const PY_KW = new Set([
    'def','class','for','while','if','elif','else','return','in','not','and','or',
    'None','True','False','import','from','lambda','break','continue','yield',
    'pass','global','nonlocal','try','except','finally','raise','with','as','is','self'
  ]);
  const PY_BUILTIN = new Set([
    'range','enumerate','len','min','max','set','dict','print','int','str','float','bool',
    'list','tuple','sum','abs','sorted','reversed','zip','map','filter'
  ]);

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlightLine(line) {
    if (!line) return '&nbsp;';
    const tokenRe = /(#[^\n]*)|('[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\w\s])/g;
    let out = '';
    let m;
    while ((m = tokenRe.exec(line)) !== null) {
      const [, comment, str, num, ident, ws, sym] = m;
      if (comment !== undefined) out += '<span class="tok-cmt">' + escHtml(comment) + '</span>';
      else if (str !== undefined) out += '<span class="tok-str">' + escHtml(str) + '</span>';
      else if (num !== undefined) out += '<span class="tok-num">' + escHtml(num) + '</span>';
      else if (ident !== undefined) {
        if (PY_KW.has(ident))         out += '<span class="tok-kw">'  + ident + '</span>';
        else if (PY_BUILTIN.has(ident)) out += '<span class="tok-fn">' + ident + '</span>';
        else                          out += escHtml(ident);
      } else if (ws !== undefined) out += ws;
      else if (sym !== undefined) out += escHtml(sym);
    }
    return out;
  }

  function renderCodeBlock(lines, tc, sc) {
    const code = lines.map((line, i) => `
      <div class="code-line">
        <span class="code-num">${i + 1}</span>
        <span class="code-text">${highlightLine(line)}</span>
      </div>
    `).join('');
    return `
      <div class="code-block">${code}</div>
      <div class="tc-row">
        <span class="tc-pill"><span class="tc-label">Time</span><span class="tc-val">${esc(tc)}</span></span>
        <span class="tc-pill"><span class="tc-label">Space</span><span class="tc-val">${esc(sc)}</span></span>
      </div>
    `;
  }

  // ─── escape helpers ──────────────────────────────────────
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ============================================================
  // STAGE REGISTRY
  // Each stage type registers a renderer. The renderer returns:
  //   { html: string, wire: (root, ctx) => void }
  // ctx = { problem, stageIdx, stageDef, advance, goBack, isFirstStage, isLastStage }
  // To add a new stage type:
  //   1. Add an entry below.
  //   2. Optionally extend stageSkillBucket() if it's graded.
  //   3. Reference it from a problem's `stages` array.
  // ============================================================

  const STAGE_REGISTRY = {

    // ─── pattern (graded) ─────────────────────────────────
    pattern: {
      label: 'Pattern recognition',
      graded: true,
      render({ problem }) {
        const choices = problem.patternChoices.map((c, i) => `
          <button class="choice" data-pick="${esc(c)}">
            <span class="letter">${LETTERS[i]}</span>${esc(c)}
          </button>
        `).join('');
        return {
          html: `
            <p class="stage-label">Which pattern solves this?</p>
            <div class="choice-list" data-state="picking">${choices}</div>
            <div class="callout-slot"></div>
            <div class="nav">
              <button class="btn primary" data-action="submit" disabled>Submit →</button>
            </div>
          `,
          wire(root) {
            let selected = null;
            let submitted = false;
            const choiceList = root.querySelector('[data-state]');
            const submitBtn = root.querySelector('[data-action]');

            function paintChoices() {
              [...choiceList.querySelectorAll('.choice')].forEach(b => {
                const c = b.dataset.pick;
                b.classList.remove('selected', 'correct', 'wrong');
                if (submitted) {
                  if (c === problem.pattern) b.classList.add('correct');
                  else if (c === selected) b.classList.add('wrong');
                  b.disabled = true;
                } else if (c === selected) {
                  b.classList.add('selected');
                }
              });
            }

            choiceList.addEventListener('click', (ev) => {
              const btn = ev.target.closest('.choice');
              if (!btn || submitted) return;
              selected = btn.dataset.pick;
              submitBtn.disabled = false;
              paintChoices();
            });

            submitBtn.addEventListener('click', () => {
              if (!selected && !submitted) return;
              if (!submitted) {
                submitted = true;
                paintChoices();
                renderCallout();
                submitBtn.textContent = 'Next →';
              } else {
                advance({ [card.idx]: selected === problem.pattern });
              }
            });

            function renderCallout() {
              const isCorrect = selected === problem.pattern;
              const slot = root.querySelector('.callout-slot');
              const reason = isCorrect
                ? problem.patternReason.right
                : (problem.patternReason.wrong[selected] || problem.patternReason.right);
              slot.innerHTML = `
                <div class="callout ${isCorrect ? 'right' : 'miss'}">
                  <div class="callout-label">${isCorrect ? '✓ Correct' : '✗ Incorrect'}</div>
                  <p class="callout-text">${esc(reason)}</p>
                  ${!isCorrect ? `
                    <div class="callout-divider">
                      <strong>✓ Why ${esc(problem.pattern)}:</strong> ${esc(problem.patternReason.right)}
                    </div>
                  ` : ''}
                </div>
              `;
            }
          }
        };
      }
    },

    // ─── approach (read-only) ─────────────────────────────
    approach: {
      label: 'Approach',
      graded: false,
      render({ problem }) {
        const ap = problem.approach || {};
        // approach.content is HTML; trusted (authored, not user input)
        const diagram = ap.type === 'diagram' && ap.svg
          ? `<div class="diagram-wrap">${ap.svg}</div>`
          : '';
        return {
          html: `
            <p class="stage-label">How the optimal solution works</p>
            ${diagram}
            <div class="approach">${ap.content || ''}</div>
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
    },

    // ─── brute force code (read-only) ─────────────────────
    brute: {
      label: 'Brute force',
      graded: false,
      render({ problem }) {
        return {
          html: `
            <p class="stage-label">Brute force</p>
            ${renderCodeBlock(problem.bruteCode, problem.bruteTC, problem.bruteSC)}
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
    },

    // ─── optimal code (read-only) ─────────────────────────
    optimal: {
      label: 'Optimal solution',
      graded: false,
      render({ problem }) {
        return {
          html: `
            <p class="stage-label">Optimal solution</p>
            ${renderCodeBlock(problem.optimalCode, problem.optimalTC, problem.optimalSC)}
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
    },

    // ─── complexity (graded — time only, space shown for context) ─────
    complexity: {
      label: 'Complexity',
      graded: true,
      render({ problem }) {
        const right = problem.complexityRight || problem.optimalTC;
        const choices = problem.complexityChoices.map((c, i) => `
          <button class="choice mono" data-pick="${esc(c)}">
            <span class="letter">${LETTERS[i]}</span>${esc(c)}
          </button>
        `).join('');
        return {
          html: `
            <p class="stage-label">What is the time complexity of the optimal solution?</p>
            <div class="choice-list" data-state="picking">${choices}</div>
            <div class="callout-slot"></div>
            <div class="nav">
              <button class="btn primary" data-action="submit" disabled>Submit →</button>
            </div>
          `,
          wire(root) {
            let selected = null;
            let submitted = false;
            const choiceList = root.querySelector('[data-state]');
            const submitBtn = root.querySelector('[data-action]');

            function paintChoices() {
              [...choiceList.querySelectorAll('.choice')].forEach(b => {
                const c = b.dataset.pick;
                b.classList.remove('selected', 'correct', 'wrong');
                if (submitted) {
                  if (c === right) b.classList.add('correct');
                  else if (c === selected) b.classList.add('wrong');
                  b.disabled = true;
                } else if (c === selected) {
                  b.classList.add('selected');
                }
              });
            }

            choiceList.addEventListener('click', (ev) => {
              const btn = ev.target.closest('.choice');
              if (!btn || submitted) return;
              selected = btn.dataset.pick;
              submitBtn.disabled = false;
              paintChoices();
            });

            submitBtn.addEventListener('click', () => {
              if (!submitted) {
                if (!selected) return;
                submitted = true;
                paintChoices();
                renderCallout();
                submitBtn.textContent = 'See summary →';
              } else {
                advance({ [card.idx]: selected === right });
              }
            });

            function renderCallout() {
              const isCorrect = selected === right;
              const slot = root.querySelector('.callout-slot');
              slot.innerHTML = `
                <div class="callout ${isCorrect ? 'right' : 'miss'}">
                  <div class="tc-row" style="margin-bottom:10px">
                    <span class="tc-pill">
                      <span class="tc-label">Time</span>
                      <span class="tc-val" style="color:${isCorrect ? 'var(--green)' : 'var(--red)'}">${esc(right)}</span>
                    </span>
                    <span class="tc-pill">
                      <span class="tc-label">Space</span>
                      <span class="tc-val" style="color:var(--green)">${esc(problem.optimalSC)}</span>
                    </span>
                  </div>
                  <p class="callout-text">${esc(problem.complexityReason)}</p>
                </div>
              `;
            }
          }
        };
      }
    },

  };

  // ─── card renderers ──────────────────────────────────────
  function renderSummary() {
    const stages = currentStages();
    const gradedStages = stages
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => STAGE_REGISTRY[s.type] && STAGE_REGISTRY[s.type].graded);

    const totalGraded = gradedStages.length;
    const correctCount = gradedStages.reduce((acc, { i }) => acc + (card.graded[i] ? 1 : 0), 0);

    const items = gradedStages.map(({ s, i }) => {
      const correct = !!card.graded[i];
      const label = STAGE_REGISTRY[s.type].label;
      return `
        <div class="summary-item ${correct ? 'right' : 'miss'}">
          <div class="sym">${correct ? '✓' : '✗'}</div>
          <div class="name">${esc(label)}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="summary">
        <div class="summary-score">${correctCount}/${totalGraded}</div>
        <p class="summary-sub">Score for this problem</p>
        <div class="summary-items">${items}</div>
        <div class="summary-actions">
          <button class="btn ghost" data-action="retry">↺ Retry</button>
          <button class="btn primary" data-action="next-problem">Next problem →</button>
        </div>
      </div>
    `;
  }

  function renderPips() {
    const stages = currentStages();
    return `<div class="pips">${stages.map((s, i) => {
      let cls = 'pip';
      if (i < card.idx) {
        // done — graded stages get right/wrong, others neutral
        if (STAGE_REGISTRY[s.type] && STAGE_REGISTRY[s.type].graded) {
          cls += card.graded[i] ? ' done right' : ' done wrong';
        } else {
          cls += ' done neutral';
        }
      } else if (i === card.idx) {
        cls += ' active';
      }
      return `<div class="${cls}"></div>`;
    }).join('')}</div>`;
  }

  function renderProblemHeader(prob) {
    const pr = getProg(prob.id);
    const stages = currentStages();
    const totalGraded = stages.filter(s => STAGE_REGISTRY[s.type]?.graded).length;
    const seenTag = pr.seen
      ? `Seen ${pr.seen}× · last ${pr.score || 0}/${totalGraded}`
      : 'New';
    return `
      <div class="diff-row">
        <span class="diff-badge ${prob.diff}">${esc(prob.diff)}</span>
        <span class="seen-tag">${esc(seenTag)}</span>
      </div>
      <h2 class="problem-title">${esc(prob.title)}</h2>
      <p class="problem-text">${esc(prob.problem)}</p>
      <div class="problem-example">${esc(prob.example)}</div>
    `;
  }

  function renderCard() {
    const prob = currentProblem();
    if (!prob) return '<div class="empty">no problems match this filter</div>';

    const stages = currentStages();
    const isSummary = card.idx >= stages.length;
    let stageHtml;
    let wire = null;

    if (isSummary) {
      stageHtml = renderSummary();
    } else {
      const stageDef = stages[card.idx];
      const renderer = STAGE_REGISTRY[stageDef.type];
      if (!renderer) {
        stageHtml = `<div class="error">Unknown stage type: <code>${esc(stageDef.type)}</code></div>`;
      } else {
        const result = renderer.render({ problem: prob, stageDef, stageIdx: card.idx });
        stageHtml = result.html;
        wire = result.wire;
      }
    }

    const animClass = card.anim === 'forward' ? ' stage-anim-forward'
                    : card.anim === 'back'    ? ' stage-anim-back'
                    : '';

    return {
      html: `
        <div class="card">
          ${renderPips()}
          ${renderProblemHeader(prob)}
          <div class="stage-host${animClass}">${stageHtml}</div>
        </div>
      `,
      wire(host) {
        const stageHost = host.querySelector('.stage-host');
        if (isSummary) {
          host.querySelector('[data-action="retry"]').onclick = retryProblem;
          host.querySelector('[data-action="next-problem"]').onclick = nextProblem;
        } else if (wire) {
          wire(stageHost);
        }
      }
    };
  }

  function renderTopbar() {
    const totalSeen = Object.values(state.progress).filter(p => p.seen > 0).length;
    return `
      <div class="topbar-left">
        <span class="streak-badge">🔥 ${state.streak}-day streak</span>
        <span class="today-badge">${state.todayCount} done today</span>
      </div>
      <span class="topbar-right">${totalSeen} / ${PROBLEMS.length} seen</span>
    `;
  }

  function renderSidebar() {
    const totalSeen = Object.values(state.progress).filter(p => p.seen > 0).length;
    const skills = state.skills;
    const skillRow = (label, key) => {
      const s = skills[key] || { r: 0, t: 0 };
      const pct = s.t ? Math.round((s.r / s.t) * 100) : 0;
      return `
        <div class="sb-skill">
          <div class="sb-skill-row"><span>${label}</span><span>${pct}%</span></div>
          <div class="sb-skill-bar"><div class="sb-skill-fill" style="width:${pct}%"></div></div>
        </div>
      `;
    };

    const patterns = ['all', ...new Set(PROBLEMS.map(p => p.pattern))];
    const pills = patterns.map(p => `
      <button class="sb-pill${state.filter === p ? ' active' : ''}" data-filter="${esc(p)}">
        ${esc(p === 'all' ? 'All' : p)}
      </button>
    `).join('');

    return `
      <div class="sb-section sb-mobile-collapse">Activity</div>
      <div class="sb-stat sb-mobile-collapse"><span>Streak</span><span class="sb-stat-val streak">🔥 ${state.streak}</span></div>
      <div class="sb-stat sb-mobile-collapse"><span>Today</span><span class="sb-stat-val">${state.todayCount} done</span></div>
      <div class="sb-stat sb-mobile-collapse"><span>Seen</span><span class="sb-stat-val">${totalSeen} / ${PROBLEMS.length}</span></div>

      <div class="sb-section sb-mobile-collapse">Skills</div>
      <div class="sb-mobile-collapse">
        ${skillRow('Pattern', 'pattern')}
        ${skillRow('Complexity', 'complexity')}
      </div>

      <div class="sb-section sb-mobile-collapse">Filter</div>
      <div class="sb-pills sb-mobile-pills-row">${pills}</div>
    `;
  }

  // ─── render orchestration ────────────────────────────────
  function render() {
    document.getElementById('topbar').innerHTML = renderTopbar();
    document.getElementById('sidebar').innerHTML = renderSidebar();
    const host = document.getElementById('card-host');
    const result = renderCard();
    if (typeof result === 'string') {
      host.innerHTML = result;
    } else {
      host.innerHTML = result.html;
      result.wire(host);
    }

    // Wire sidebar pill clicks
    document.querySelectorAll('[data-filter]').forEach(b => {
      b.onclick = () => {
        state.filter = b.dataset.filter;
        buildQueue();
        resetCard();
        saveState();
        render();
      };
    });

    // Clear animation flag after one render so it doesn't replay on next render
    card.anim = null;
  }

  // ─── boot ────────────────────────────────────────────────
  async function boot() {
    loadState();
    try {
      const res = await fetch('problems.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      PROBLEMS = await res.json();
      if (!Array.isArray(PROBLEMS) || PROBLEMS.length === 0) {
        throw new Error('problems.json is empty or not an array');
      }
    } catch (err) {
      document.getElementById('card-host').innerHTML = `
        <div class="error">
          <strong>Couldn't load problems.json.</strong><br><br>
          If you're opening <code>index.html</code> directly, browsers block <code>fetch()</code> for local files. Either:<br>
          • run <code>python3 -m http.server</code> in this folder, then open <code>http://localhost:8000</code>, or<br>
          • deploy to Netlify (drag-and-drop) and open the URL.<br><br>
          <small>Error: ${esc(err.message)}</small>
        </div>
      `;
      return;
    }
    buildQueue();
    resetCard();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
