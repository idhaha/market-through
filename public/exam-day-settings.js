// 설정 창의 수능일(개장 지연) 칸(2026-11-20). 입력하면 서버가 data/trading-session/calendar.json의 openDelays에 저장하고
// market-open-delay.js가 코드 표와 합쳐 바로 쓴다. 보기는 로그인 사용자, 저장 · 삭제는 관리자만(서버가 다시 확인한다).
(() => {
    const form = document.getElementById('examDayForm'), list = document.getElementById('examDayList'), message = document.getElementById('examDayMessage');
    if (!form || !list) return;
    const say = (text, error = false) => { message.textContent = text; message.classList.toggle('is-error', error); };
    // 올해 달력만(2026-11-20): 날짜 칸을 올해(한국 시간) 1/1~12/31로 묶는다. 직접 다른 해를 쳐 넣으면 저장 전에 한국어로 막는다(서버도 다시 막음).
    const input = document.getElementById('examDayDate');
    const thisYear = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 4);
    function limitYear() { const y = thisYear(); input.min = `${y}-01-01`; input.max = `${y}-12-31`; }
    input.addEventListener('input', () => input.setCustomValidity(input.value && input.value.slice(0, 4) !== thisYear() ? `올해(${thisYear()}년) 날짜만 고를 수 있습니다.` : ''));
    limitYear();
    let canEdit = false;
    function render(days) {
        list.replaceChildren();
        if (!days.length) { const li = document.createElement('li'); li.textContent = '등록된 수능일이 없습니다.'; list.appendChild(li); }
        for (const d of days) {
            const li = document.createElement('li'), label = document.createElement('span'), note = document.createElement('small');
            label.textContent = `${d.date} · 정규장 10:00~16:30`;
            note.textContent = d.source === 'code' ? '코드 기본값' : '설정에서 입력';
            label.appendChild(note); li.appendChild(label);
            if (d.source === 'settings' && canEdit) {
                const remove = document.createElement('button');
                remove.type = 'button'; remove.className = 'authorized-email-remove'; remove.textContent = '삭제';
                remove.addEventListener('click', () => void send(`/api/trading-session/exam-days/${encodeURIComponent(d.date)}`, { method: 'DELETE' }, `${d.date} 수능일을 삭제했습니다.`));
                li.appendChild(remove);
            }
            list.appendChild(li);
        }
        for (const el of form.elements) el.disabled = !canEdit;
        if (!canEdit) say('수능일은 관리자만 바꿀 수 있습니다.');
    }
    async function accept(response, done) {
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) throw new Error(result.error || '수능일 설정을 처리하지 못했습니다.');
        canEdit = !!result.canEdit; render(result.days || []);
        if (done) { say(done); document.dispatchEvent(new CustomEvent('exam-days-updated', { detail: result.days || [] })); }
    }
    async function send(url, options, done) {
        try { await accept(await fetch(url, options), done); } catch (error) { say(error.message, true); }
    }
    async function load() {
        say('');
        try { await accept(await fetch('/api/trading-session/exam-days', { cache: 'no-store' })); } catch (error) { say(error.message, true); }
    }
    form.addEventListener('submit', event => {
        event.preventDefault();
        const date = document.getElementById('examDayDate').value;
        void send('/api/trading-session/exam-days', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date }) },
            `${date} 수능일을 저장했습니다. 바로 적용됩니다.`);
    });
    document.getElementById('profileBtn')?.addEventListener('click', () => { limitYear(); void load(); });
})();
