import { mkdir, writeFile } from 'node:fs/promises';

const username = process.env.PROFILE_USERNAME ?? process.env.GITHUB_REPOSITORY_OWNER ?? 'twoimo';
const token = process.env.GITHUB_TOKEN;

if (!token) {
  throw new Error('GITHUB_TOKEN is required.');
}

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': `${username}-profile-card-generator`,
};

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const formatNumber = (value) => new Intl.NumberFormat('en-US', {
  notation: Number(value) >= 1000 ? 'compact' : 'standard',
  maximumFractionDigits: 1,
}).format(Number(value) || 0);

async function api(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${path}: ${body}`);
  }
  return response.json();
}

async function fetchAllRepositories() {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(`/users/${encodeURIComponent(username)}/repos?type=owner&sort=updated&direction=desc&per_page=100&page=${page}`);
    repositories.push(...batch);
    if (batch.length < 100) break;
  }
  return repositories;
}

async function mapWithConcurrency(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

const [user, repositories] = await Promise.all([
  api(`/users/${encodeURIComponent(username)}`),
  fetchAllRepositories(),
]);

const originalRepositories = repositories.filter((repo) => !repo.fork && !repo.archived);
const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
const activeRepositories = originalRepositories.filter((repo) => {
  const pushedAt = Date.parse(repo.pushed_at ?? repo.updated_at ?? 0);
  return Number.isFinite(pushedAt) && pushedAt >= oneYearAgo;
});

const stats = {
  publicRepos: Number(user.public_repos ?? repositories.length),
  originalRepos: originalRepositories.length,
  stars: repositories.reduce((sum, repo) => sum + Number(repo.stargazers_count ?? 0), 0),
  followers: Number(user.followers ?? 0),
  forks: repositories.reduce((sum, repo) => sum + Number(repo.forks_count ?? 0), 0),
  activeRepos: activeRepositories.length,
};

const languageMaps = await mapWithConcurrency(originalRepositories, 6, async (repo) => {
  try {
    return await api(`/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo.name)}/languages`);
  } catch (error) {
    console.warn(`Skipping languages for ${repo.full_name}: ${error.message}`);
    return {};
  }
});

const languageTotals = new Map();
for (const languageMap of languageMaps) {
  for (const [language, bytes] of Object.entries(languageMap)) {
    languageTotals.set(language, (languageTotals.get(language) ?? 0) + Number(bytes));
  }
}

const totalLanguageBytes = [...languageTotals.values()].reduce((sum, value) => sum + value, 0);
const topLanguages = [...languageTotals.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 6)
  .map(([name, bytes]) => ({
    name,
    bytes,
    percentage: totalLanguageBytes > 0 ? (bytes / totalLanguageBytes) * 100 : 0,
  }));

const palette = {
  TypeScript: '#3178C6',
  JavaScript: '#F1E05A',
  Python: '#3572A5',
  Java: '#B07219',
  HTML: '#E34C26',
  CSS: '#563D7C',
  Vue: '#41B883',
  Shell: '#89E051',
  'Jupyter Notebook': '#DA5B0B',
  C: '#555555',
  'C++': '#F34B7D',
  Rust: '#DEA584',
  Go: '#00ADD8',
  Dockerfile: '#384D54',
};

function fallbackColor(name) {
  let hash = 0;
  for (const character of name) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 58% 58%)`;
}

function colorForLanguage(name) {
  return palette[name] ?? fallbackColor(name);
}

function buildStatsSvg() {
  const metrics = [
    ['Public repositories', stats.publicRepos],
    ['Original projects', stats.originalRepos],
    ['Stars earned', stats.stars],
    ['Followers', stats.followers],
    ['Repository forks', stats.forks],
    ['Active last year', stats.activeRepos],
  ];

  const positions = [
    [25, 82, 205],
    [245, 82, 442],
    [25, 117, 205],
    [245, 117, 442],
    [25, 152, 205],
    [245, 152, 442],
  ];

  const rows = metrics.map(([label, value], index) => {
    const [x, y, valueX] = positions[index];
    return `<circle cx="${x}" cy="${y - 5}" r="4" fill="#818CF8"/>
      <text x="${x + 13}" y="${y}" class="label">${escapeXml(label)}</text>
      <text x="${valueX}" y="${y}" text-anchor="end" class="value">${escapeXml(formatNumber(value))}</text>`;
  }).join('\n');

  return `<svg width="467" height="195" viewBox="0 0 467 195" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(user.name ?? username)} GitHub snapshot</title>
  <desc id="desc">GitHub statistics generated from lightweight REST API requests.</desc>
  <style>
    .header{font:600 18px 'Segoe UI',Ubuntu,Sans-Serif;fill:#38BDF8}
    .sub{font:400 11px 'Segoe UI',Ubuntu,Sans-Serif;fill:#64748B}
    .label{font:500 13px 'Segoe UI',Ubuntu,Sans-Serif;fill:#94A3B8}
    .value{font:700 15px 'Segoe UI',Ubuntu,Sans-Serif;fill:#E2E8F0}
  </style>
  <rect x="0.5" y="0.5" width="466" height="194" rx="8" fill="#020617" stroke="#1E293B"/>
  <text x="25" y="35" class="header">${escapeXml(user.name ?? username)}'s GitHub Snapshot</text>
  <text x="25" y="53" class="sub">REST API · public repositories · no GraphQL aggregation</text>
  <line x1="25" y1="64" x2="442" y2="64" stroke="#1E293B"/>
  ${rows}
</svg>\n`;
}

function buildLanguagesSvg() {
  const safeLanguages = topLanguages.length > 0
    ? topLanguages
    : [{ name: 'No language data', bytes: 1, percentage: 100 }];

  let offset = 25;
  const barWidth = 250;
  const segments = safeLanguages.map((language, index) => {
    const width = index === safeLanguages.length - 1
      ? 275 - offset
      : Math.max(2, (language.percentage / 100) * barWidth);
    const segment = `<rect x="${offset.toFixed(2)}" y="55" width="${width.toFixed(2)}" height="8" fill="${colorForLanguage(language.name)}"/>`;
    offset += width;
    return segment;
  }).join('\n');

  const rows = safeLanguages.slice(0, 6).map((language, index) => {
    const y = 87 + index * 17;
    return `<circle cx="27" cy="${y - 4}" r="4" fill="${colorForLanguage(language.name)}"/>
      <text x="39" y="${y}" class="language">${escapeXml(language.name)}</text>
      <text x="275" y="${y}" text-anchor="end" class="percentage">${language.percentage.toFixed(1)}%</text>`;
  }).join('\n');

  return `<svg width="300" height="190" viewBox="0 0 300 190" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Top languages</title>
  <desc id="desc">Top languages across original, non-archived public repositories.</desc>
  <style>
    .header{font:600 18px 'Segoe UI',Ubuntu,Sans-Serif;fill:#38BDF8}
    .sub{font:400 10px 'Segoe UI',Ubuntu,Sans-Serif;fill:#64748B}
    .language{font:500 12px 'Segoe UI',Ubuntu,Sans-Serif;fill:#E2E8F0}
    .percentage{font:600 12px 'Segoe UI',Ubuntu,Sans-Serif;fill:#94A3B8}
  </style>
  <rect x="0.5" y="0.5" width="299" height="189" rx="8" fill="#020617" stroke="#1E293B"/>
  <text x="25" y="32" class="header">Top Languages</text>
  <text x="25" y="46" class="sub">original public repositories · source bytes</text>
  <clipPath id="bar"><rect x="25" y="55" width="250" height="8" rx="4"/></clipPath>
  <g clip-path="url(#bar)">${segments}</g>
  ${rows}
</svg>\n`;
}

await mkdir('profile', { recursive: true });
await Promise.all([
  writeFile('profile/stats.svg', buildStatsSvg(), 'utf8'),
  writeFile('profile/top-langs.svg', buildLanguagesSvg(), 'utf8'),
]);

console.log(`Generated profile cards for ${username}: ${stats.publicRepos} public repos, ${stats.followers} followers, ${topLanguages.length} languages.`);
