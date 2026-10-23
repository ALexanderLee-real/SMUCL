'use strict';
/**
 * Modrinth 整合包来源
 * 公开 API，不需要 key。搜索 facets 限定 project_type:modpack。
 * 安装方式：下 .mrpack（zip）→ 读 modrinth.index.json → 交给 core/modpack 安装。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');

const net = require('./net');
const modpack = require('./modpack');

const API = 'https://api.modrinth.com/v2';

function facets() {
  return encodeURIComponent(JSON.stringify([['project_type:modpack']]));
}

async function search(query, { limit = 20, offset = 0 } = {}) {
  const url =
    `${API}/search?query=${encodeURIComponent(query || '')}&facets=${facets()}` +
    `&limit=${limit}&offset=${offset}&index=relevance`;
  const data = await net.fetchJson(url, { timeout: 20000 });
  return {
    total: data.total_hits || 0,
    hits: (data.hits || []).map((h) => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      icon: h.icon_url,
      downloads: h.downloads,
      follows: h.follows,
      author: h.author,
      categories: h.categories || [],
      versions: h.versions || [],
    })),
  };
}

async function versions(projectId) {
  const data = await net.fetchJson(`${API}/project/${encodeURIComponent(projectId)}/version`, {
    timeout: 20000,
  });
  return (Array.isArray(data) ? data : []).map((v) => ({
    id: v.id,
    name: v.name,
    number: v.version_number,
    type: v.version_type,
    gameVersions: v.game_versions || [],
    loaders: v.loaders || [],
    date: v.date_published,
    downloads: v.downloads || 0,
    file: (v.files || []).find((f) => f.primary) || (v.files || [])[0] || null,
    dependencies: v.dependencies || [],
  }));
}

/** 从 .mrpack 里解析出安装所需的 spec */
function readIndex(zipPath) {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry('modrinth.index.json');
  if (!entry) throw new Error('这不是有效的 Modrinth 整合包（缺 modrinth.index.json）');
  const index = JSON.parse(entry.getData().toString('utf8'));

  const dep = index.dependencies || {};
  let loader = '';
  let loaderVersion = '';
  if (dep['fabric-loader']) {
    loader = 'fabric';
    loaderVersion = dep['fabric-loader'];
  } else if (dep['quilt-loader']) {
    loader = 'quilt';
    loaderVersion = dep['quilt-loader'];
  } else if (dep.neoforge) {
    loader = 'neoforge';
    loaderVersion = dep.neoforge;
  } else if (dep.forge) {
    loader = 'forge';
    loaderVersion = dep.forge;
  }

  const files = (index.files || [])
    .filter((f) => !(f.env && f.env.client === 'unsupported'))
    .map((f) => ({
      path: f.path,
      url: f.downloads && f.downloads[0],
      sha1: f.hashes && f.hashes.sha1,
      size: f.fileSize || 0,
    }))
    .filter((f) => f.url);

  return {
    name: index.name || path.basename(zipPath, '.mrpack'),
    packVersion: index.versionId || '',
    mcVersion: dep.minecraft || '',
    loader,
    loaderVersion,
    files,
  };
}

/**
 * 安装指定版本
 * @param {object} opts { versionId, downloadUrl, gameDir, javaPath, source, baseUrl, onProgress }
 */
async function installVersion({ versionId, downloadUrl, fileName, gameDir, javaPath, source, baseUrl, onProgress }) {
  const report = (p) => onProgress && onProgress(p);
  const tmp = path.join(os.tmpdir(), `smucl-mrpack-${Date.now()}.mrpack`);

  try {
    report({ stage: 'download', message: '下载整合包', percent: 4 });
    await net.download(downloadUrl, tmp, { retries: 3, timeout: 180000 });

    const spec = readIndex(tmp);
    if (!spec.mcVersion) return { ok: false, error: '整合包没有声明 minecraft 版本' };

    spec.overridesZip = tmp;
    spec.overridesPrefix = 'overrides/';
    spec.source = 'modrinth';

    const r = await modpack.install({
      gameDir,
      spec,
      javaPath,
      source: source || 'bmcl',
      baseUrl,
      onProgress,
    });
    if (!r.ok) return r;
    return { ok: true, data: { ...r.data, versionId, file: fileName || '' } };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 临时文件清不掉不影响结果 */
    }
  }
}

module.exports = { search, versions, readIndex, installVersion, API };
