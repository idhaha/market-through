// Share the KIS quotation request budget across cards, collectors and rank enrichment.
function createKisHttp({ http, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    let queue = Promise.resolve();
    return {
        ...http,
        quotationRateLimited: true,
        get(url, options) {
            const parsed = new URL(url);
            if (!parsed.pathname.startsWith('/uapi/')) return http.get(url, options);
            const task = queue.then(async () => {
                try { return await http.get(url, options); }
                finally { await pause(550); }
            });
            queue = task.catch(() => {});
            return task;
        }
    };
}
module.exports = { createKisHttp };
