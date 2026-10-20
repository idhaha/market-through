const fs = require('node:fs/promises');

async function diskSpace(directory, statfs = fs.statfs) {
    const stats = await statfs(directory, { bigint: true });
    const total = Number(stats.blocks * stats.bsize);
    const available = Number(stats.bavail * stats.bsize);
    if (!(total > 0) || available < 0) throw new Error('디스크 용량을 확인할 수 없습니다.');
    return { success: true, total_bytes: total, available_bytes: available,
        used_percent: Math.round((1 - available / total) * 100), checked_at: new Date().toISOString() };
}

module.exports = { diskSpace };
