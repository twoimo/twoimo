#!/usr/bin/env node
/**
 * TWOIMO AI Coding Usage Card
 *
 * Adapted from Baek-Seunghyun/ai-coding-usage-card.
 * Copyright (c) 2026 BAEKSEUNGHYEON (DGO0)
 * Licensed under the MIT License. See ai-usage-card.LICENSE.
 *
 * Reads local AI coding CLI logs through ccusage, renders five SVG variants,
 * and commits them to the twoimo/twoimo profile repository.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONFIG = {
  repo: process.env.USAGE_CARD_REPO ?? 'twoimo/twoimo',
  branch: process.env.USAGE_CARD_BRANCH ?? 'main',
  dir: process.env.USAGE_CARD_DIR ?? 'profile',
  currencies: [['KRW', '₩'], ['EUR', '€'], ['JPY', '¥']],
  npx: process.env.NPX_PATH ?? (process.platform === 'win32' ? 'npx.cmd' : 'npx'),
  gh: process.env.GH_PATH ?? (process.platform === 'win32' ? 'gh.exe' : 'gh'),
  accent: process.env.USAGE_CARD_ACCENT ?? '#38BDF8',
  background: '#020617',
  border: '#1E293B',
  text: '#E2E8F0',
  muted: '#94A3B8',
  subtle: '#64748B',
  localOnly: process.env.USAGE_CARD_LOCAL === '1',
  localDir: process.env.USAGE_CARD_LOCAL_DIR ?? './ai-usage-preview',
};

const REPO = CONFIG.repo;
const BRANCH = CONFIG.branch;
const USER = `@${REPO.split('/')[0]}`;
const DIR = CONFIG.dir;
const NPX = CONFIG.npx;
const GH = CONFIG.gh;
const A = CONFIG.accent;
const GRASS_RAMP = ['#0F172A', '#172554', '#1E3A8A', '#4F46E5', '#38BDF8'];

const sh = (command, big = false) => execSync(command, {
  encoding: 'utf8',
  maxBuffer: (big ? 128 : 32) * 1024 * 1024,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const readUsage = () => {
  try {
    const parsed = JSON.parse(sh(`"${NPX}" -y ccusage@latest --json`, true));
    return {
      totals: parsed?.totals ?? {},
      daily: Array.isArray(parsed?.daily) ? parsed.daily : [],
    };
  } catch (error) {
    const detail = error?.stderr?.toString?.().trim();
    throw new Error(`Unable to read local AI coding logs with ccusage.${detail ? `\n${detail}` : ''}`);
  }
};

const { totals: rawTotals, daily } = readUsage();
const totals = {
  totalTokens: number(rawTotals.totalTokens),
  totalCost: number(rawTotals.totalCost ?? rawTotals.costUSD),
  inputTokens: number(rawTotals.inputTokens),
  outputTokens: number(rawTotals.outputTokens),
  cacheReadTokens: number(rawTotals.cacheReadTokens),
  cacheCreationTokens: number(rawTotals.cacheCreationTokens),
};

const toolCost = (tool) => {
  try {
    const parsed = JSON.parse(sh(`"${NPX}" -y ccusage@latest ${tool} daily --json`, true));
    const toolTotals = parsed?.totals ?? {};
    return number(toolTotals.costUSD ?? toolTotals.totalCost);
  } catch {
    return 0;
  }
};

const detectedTools = [
  ['Codex', toolCost('codex')],
  ['Gemini', toolCost('gemini')],
  ['Copilot', toolCost('copilot')],
].filter(([, cost]) => cost > 0);

const detectedOtherCost = detectedTools.reduce((sum, [, cost]) => sum + cost, 0);
const tools = [
  ['Claude Code', Math.max(0, totals.totalCost - detectedOtherCost)],
  ...detectedTools,
].filter(([, cost]) => cost > 0);

const loadRates = async () => {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data?.rates ?? { USD: 1 };
  } catch (error) {
    console.warn(`FX lookup failed; non-USD values will be unavailable: ${error.message}`);
    return { USD: 1 };
  }
};

const fx = await loadRates();
const usd = totals.totalCost;

const fmtTokens = (value) => {
  const n = number(value);
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return new Intl.NumberFormat('en-US').format(Math.round(n));
};

const fmtInteger = (value) => new Intl.NumberFormat('en-US').format(Math.round(number(value)));
const fmtCost = (value) => number(value) >= 100 ? fmtInteger(value) : number(value).toFixed(2);
const pct = (value) => {
  if (usd <= 0) return '0%';
  const share = (number(value) / usd) * 100;
  return share >= 1 ? `${share.toFixed(0)}%` : '&lt;1%';
};

const daysActive = daily.length;
const avgDay = usd / Math.max(daysActive, 1);
const peak = daily.reduce(
  (best, day) => number(day?.totalCost) > number(best?.totalCost) ? day : best,
  { totalCost: 0, period: '—' },
);
const cacheShare = totals.totalTokens > 0
  ? ((totals.cacheReadTokens / totals.totalTokens) * 100).toFixed(1)
  : '0.0';

const modelCost = {};
for (const day of daily) {
  for (const model of day?.modelBreakdowns ?? []) {
    const name = String(model?.modelName ?? '').trim();
    if (!name || name.startsWith('<')) continue;
    modelCost[name] = (modelCost[name] ?? 0) + number(model?.cost ?? model?.costUSD);
  }
}

const prettyModel = (id) => {
  const match = String(id).match(/claude-([a-z]+)-(\d+)(?:-(\d+))?/);
  if (!match) return String(id);
  const family = match[1][0].toUpperCase() + match[1].slice(1);
  const version = match[3] ? `${match[2]}.${match[3]}` : match[2];
  return `${family} ${version}`;
};

const [topModelId] = Object.entries(modelCost).sort((a, b) => b[1] - a[1])[0] ?? ['—'];
const localISO = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  .toISOString()
  .slice(0, 10);
const today = localISO(new Date());
const costByDate = Object.fromEntries(daily.map((day) => [day.period, number(day.totalCost)]));
const maxDay = Math.max(...daily.map((day) => number(day.totalCost)), 1);

const STYLE = `<style>
.title{font:700 18px 'Segoe UI',Ubuntu,sans-serif;fill:${A}}
.user{font:600 14px 'Segoe UI',Ubuntu,sans-serif;fill:${CONFIG.muted}}
.hdr{font:700 11px 'Segoe UI',Ubuntu,sans-serif;fill:${CONFIG.subtle};letter-spacing:1.5px}
.big{font:800 44px 'Segoe UI',Ubuntu,sans-serif;fill:${A}}
.sub{font:400 13px 'Segoe UI',Ubuntu,sans-serif;fill:${CONFIG.muted}}
.lbl{font:400 13px 'Segoe UI',Ubuntu,sans-serif;fill:${CONFIG.muted}}
.val{font:700 14px 'Segoe UI',Ubuntu,sans-serif;fill:${CONFIG.text}}
.accent{font:700 14px 'Segoe UI',Ubuntu,sans-serif;fill:${A}}
.foot{font:400 11px 'Segoe UI',Ubuntu,sans-serif;fill:${CONFIG.subtle}}
.fade{opacity:0;animation:fadeIn .8s ease-in-out forwards}
@keyframes fadeIn{to{opacity:1}}
</style>`;

const frame = (width, height, body) => `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
<title id="title">TWOIMO AI coding usage</title>
<desc id="desc">Self-hosted usage summary generated from local AI coding CLI logs.</desc>
${STYLE}
<rect width="${width - 1}" height="${height - 1}" x="0.5" y="0.5" rx="10" fill="${CONFIG.background}" stroke="${CONFIG.border}" stroke-width="1"/>
${body}
</svg>
`;

const header = (width, titleY = 38) => `<text x="30" y="${titleY}" class="title fade">&#9889; AI Coding Usage</text>
<text x="${width - 30}" y="${titleY}" text-anchor="end" class="user fade">${escapeXml(USER)}</text>
<text x="${width - 30}" y="${titleY + 15}" text-anchor="end" class="foot fade">local logs &#183; API-equivalent &#183; ${today}</text>`;

const row = (x, y, label, value, end) => `<text x="${x}" y="${y}" class="lbl">${escapeXml(label)}</text><text x="${end}" y="${y}" text-anchor="end" class="val">${value}</text>`;

const allTimeBlock = (x, headerY, valueY) => `<text x="${x}" y="${headerY}" class="hdr">ALL-TIME</text>
<text x="${x}" y="${valueY}" class="big">${fmtTokens(totals.totalTokens)}</text>
<text x="${x}" y="${valueY + 25}" class="sub">tokens &#183; ${cacheShare}% cache-hit</text>`;

const costRows = (x, y0, step, end) => [
  ['USD', `$ ${fmtInteger(usd)}`],
  ...CONFIG.currencies.map(([code, symbol]) => {
    const rate = number(fx[code]);
    return [code, rate > 0 ? `${escapeXml(symbol)} ${fmtInteger(usd * rate)}` : '—'];
  }),
].slice(0, 4).map(([label, value], index) => row(x, y0 + index * step, label, value, end)).join('');

const grass = (weeks, x0, y0, withLegend = true, legendY = null) => {
  const step = 14;
  const cell = 11;
  const now = new Date();
  const dayOfWeek = now.getDay();
  let cells = '';

  for (let week = 0; week < weeks; week += 1) {
    for (let day = 0; day < 7; day += 1) {
      const back = (weeks - 1 - week) * 7 + (dayOfWeek - day);
      if (back < 0) continue;
      const key = localISO(new Date(now.getTime() - back * 86400000));
      const cost = costByDate[key] ?? 0;
      const level = cost === 0 ? 0
        : cost <= maxDay * 0.25 ? 1
        : cost <= maxDay * 0.5 ? 2
        : cost <= maxDay * 0.75 ? 3
        : 4;
      cells += `<rect x="${x0 + week * step}" y="${y0 + day * step}" width="${cell}" height="${cell}" rx="2" fill="${GRASS_RAMP[level]}"/>`;
    }
  }

  if (withLegend) {
    const y = legendY ?? y0 + 7 * step + 14;
    const x = x0 + weeks * step - 3 - 5 * step - 60;
    cells += `<text x="${x - 8}" y="${y + 9}" text-anchor="end" class="foot">less</text>`;
    for (let index = 0; index < 5; index += 1) {
      cells += `<rect x="${x + index * step}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${GRASS_RAMP[index]}"/>`;
    }
    cells += `<text x="${x + 5 * step + 5}" y="${y + 9}" class="foot">more</text>`;
  }

  return cells;
};

const buildFull = () => {
  const width = 846;
  const height = 225;
  const columns = [30, 235, 465, 665];
  const dividers = [215, 445, 645];
  const tokenRows = [
    ['Output', fmtTokens(totals.outputTokens)],
    ['Input', fmtTokens(totals.inputTokens)],
    ['Cache read', fmtTokens(totals.cacheReadTokens)],
    ['Cache write', fmtTokens(totals.cacheCreationTokens)],
  ].map(([label, value], index) => row(columns[2], 98 + index * 25, label, value, 630)).join('');
  const activityRows = [
    ['Active days', String(daysActive)],
    ['Avg / day', `$ ${fmtInteger(avgDay)}`],
    ['Peak day', `$ ${fmtInteger(peak.totalCost)}`],
    ['Top model', escapeXml(prettyModel(topModelId))],
  ].map(([label, value], index) => row(columns[3], 98 + index * 25, label, value, 816)).join('');
  const toolLine = tools.length > 0
    ? tools.map(([name, cost]) => `<tspan class="lbl">${escapeXml(name)}</tspan> <tspan class="accent">$ ${fmtCost(cost)}</tspan><tspan class="foot"> (${pct(cost)})</tspan>`)
      .join('<tspan class="foot">&#160;&#160;&#183;&#160;&#160;</tspan>')
    : '<tspan class="foot">No supported local usage detected yet</tspan>';

  return frame(width, height, `${header(width)}
${dividers.map((x) => `<line x1="${x}" y1="62" x2="${x}" y2="178" stroke="${CONFIG.border}" stroke-width="1"/>`).join('')}
<g class="fade" style="animation-delay:150ms">${allTimeBlock(columns[0], 72, 135)}</g>
<g class="fade" style="animation-delay:300ms"><text x="${columns[1]}" y="72" class="hdr">COST</text>${costRows(columns[1], 98, 25, 430)}</g>
<g class="fade" style="animation-delay:450ms"><text x="${columns[2]}" y="72" class="hdr">TOKEN MIX</text>${tokenRows}</g>
<g class="fade" style="animation-delay:600ms"><text x="${columns[3]}" y="72" class="hdr">ACTIVITY</text>${activityRows}</g>
<g class="fade" style="animation-delay:750ms"><text x="30" y="205" class="hdr">BY TOOL</text><text x="110" y="205">${toolLine}</text></g>`);
};

const buildHalf = () => frame(423, 195, `${header(423, 34)}
<line x1="200" y1="60" x2="200" y2="175" stroke="${CONFIG.border}" stroke-width="1"/>
<g class="fade" style="animation-delay:150ms">${allTimeBlock(30, 74, 140)}</g>
<g class="fade" style="animation-delay:300ms"><text x="222" y="74" class="hdr">COST</text>${costRows(222, 98, 25, 393)}</g>`);

const buildGrass = () => frame(423, 195, `${header(423, 34)}
<g class="fade" style="animation-delay:200ms">${grass(26, 30, 58, true, 168)}</g>`);

const buildHalfGrass = () => frame(423, 335, `${header(423, 34)}
<line x1="200" y1="60" x2="200" y2="175" stroke="${CONFIG.border}" stroke-width="1"/>
<g class="fade" style="animation-delay:150ms">${allTimeBlock(30, 74, 140)}</g>
<g class="fade" style="animation-delay:300ms"><text x="222" y="74" class="hdr">COST</text>${costRows(222, 98, 25, 393)}</g>
<g class="fade" style="animation-delay:500ms"><text x="30" y="200" class="hdr">GRASS &#183; LAST 26 WEEKS</text>${grass(26, 30, 212, true, 316)}</g>`);

const buildCombo = () => frame(846, 195, `${header(846, 34)}
<line x1="200" y1="60" x2="200" y2="175" stroke="${CONFIG.border}" stroke-width="1"/>
<line x1="420" y1="60" x2="420" y2="175" stroke="${CONFIG.border}" stroke-width="1"/>
<g class="fade" style="animation-delay:150ms">${allTimeBlock(30, 74, 140)}</g>
<g class="fade" style="animation-delay:300ms"><text x="222" y="74" class="hdr">COST</text>${costRows(222, 98, 25, 393)}</g>
<g class="fade" style="animation-delay:500ms"><text x="440" y="74" class="hdr">GRASS &#183; LAST 26 WEEKS</text>${grass(26, 440, 84, false)}</g>`);

const files = [
  [`${DIR}/ai-usage-full.svg`, buildFull()],
  [`${DIR}/ai-usage-half.svg`, buildHalf()],
  [`${DIR}/ai-usage-half-grass.svg`, buildHalfGrass()],
  [`${DIR}/ai-usage-grass.svg`, buildGrass()],
  [`${DIR}/ai-usage-combo.svg`, buildCombo()],
];

if (CONFIG.localOnly) {
  const outputDirectory = resolve(CONFIG.localDir);
  mkdirSync(outputDirectory, { recursive: true });
  for (const [filePath, content] of files) {
    const fileName = filePath.split('/').at(-1);
    writeFileSync(resolve(outputDirectory, fileName), content, 'utf8');
  }
  console.log(`Wrote ${files.length} preview cards to ${outputDirectory}`);
  process.exit(0);
}

const token = sh(`"${GH}" auth token`).trim();
const api = (url, options = {}) => fetch(`https://api.github.com/${url}`, {
  ...options,
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...options.headers,
  },
});

const json = async (response) => {
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
};

const ref = await json(await api(`repos/${REPO}/git/ref/heads/${BRANCH}`));
const baseCommit = await json(await api(`repos/${REPO}/git/commits/${ref.object.sha}`));
const tree = await json(await api(`repos/${REPO}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({
    base_tree: baseCommit.tree.sha,
    tree: files.map(([filePath, content]) => ({
      path: filePath,
      mode: '100644',
      type: 'blob',
      content,
    })),
  }),
}));
const commit = await json(await api(`repos/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message: `chore: refresh AI usage cards (${fmtTokens(totals.totalTokens)} tokens)`,
    tree: tree.sha,
    parents: [ref.object.sha],
  }),
}));
await json(await api(`repos/${REPO}/git/refs/heads/${BRANCH}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commit.sha }),
}));

const toolSummary = tools.length > 0
  ? tools.map(([name, cost]) => `${name} $${fmtCost(cost)}`).join(' | ')
  : 'no supported usage detected';
console.log(`[${new Date().toISOString()}] AI usage cards updated @ ${commit.sha.slice(0, 7)}: ${fmtTokens(totals.totalTokens)} tokens | $${fmtInteger(usd)} | ${toolSummary}`);
