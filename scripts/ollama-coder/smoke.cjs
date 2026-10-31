'use strict';
// End-to-end proof in a disposable temp workspace, never application files.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEngine } = require('./engine.cjs');
(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketthrough-coder-smoke-'));
    try {
        fs.mkdirSync(path.join(directory, 'public'));
        const file = path.join(directory, 'public/demo.js');
        const before = 'function add(a, b) { return a - b; }\n';
        fs.writeFileSync(file, before);
        const engine = createEngine({ root: directory });
        const task = engine.start({ files: ['public/demo.js'], max_turns: 8,
            instruction: 'Read public/demo.js, then replace ONLY the subtraction operator in add with addition. Preserve everything else. Run node syntax check using run_check. Finish. Do not add comments or exports.' });
        console.log(JSON.stringify({ task_id: task.task_id, state: task.state, model: task.model }));
        let previous = '';
        const progress = setInterval(() => { const status = engine.status(task.task_id); const value = status.turns + ':' + status.last_action; if (value !== previous) { previous = value; console.log(JSON.stringify({ state: status.state, turns: status.turns, action: status.last_action })); } }, 5000);
        let result;
        try { result = await engine.wait(task.task_id); } finally { clearInterval(progress); }
        if (result.state !== 'ready_for_review') throw new Error(JSON.stringify(result));
        const review = engine.review(task.task_id);
        console.log(JSON.stringify({ state: review.state, diffs: review.diffs, checks: review.checks, local_model_tokens: review.local_model_tokens }));
        if (fs.readFileSync(file, 'utf8') !== before) throw new Error('Original changed before integration');
        if (fs.readFileSync(path.join(review.staged_directory, 'public/demo.js'), 'utf8') !== before.replace('a - b', 'a + b')) throw new Error('Unexpected model edit; not applied');
        const applied = engine.apply(task.task_id, review.review_token);
        if (fs.readFileSync(file, 'utf8') !== before.replace('a - b', 'a + b')) throw new Error('Integration failed');
        console.log(JSON.stringify({ state: applied.state, proof: 'Local model read file, edited staged copy, ran parser, and host integrated reviewed change. Application files untouched.' }));
    } finally {
        const target = path.resolve(directory), base = path.resolve(os.tmpdir());
        if (!target.startsWith(base + path.sep + 'marketthrough-coder-smoke-')) throw new Error('Unsafe cleanup path');
        fs.rmSync(target, { recursive: true, force: true });
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
