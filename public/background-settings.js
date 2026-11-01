(() => {
    document.addEventListener('DOMContentLoaded',()=>{
        const input=document.getElementById('backgroundRefreshEnabled'),message=document.getElementById('backgroundRefreshMessage');
        if(!input||!message)return;
        let enabled=false,editable=false,revision=0;
        function show(state){
            enabled=state.enabled===true;editable=state.editable===true;
            input.checked=enabled;input.disabled=!editable;message.classList.remove('is-error');
            const failed=(state.jobs||[]).filter(job=>job.error).length;
            message.textContent=enabled?(state.paused?'브라우저 접속 중에는 기존 자동갱신을 사용합니다. 모든 접속이 종료되면 서버가 이어받습니다.':state.lastSuccessAt?'최근 수집: '+new Date(state.lastSuccessAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'서버 자동갱신이 켜져 있습니다. 수집 가능한 시간에 동작합니다.'):'자동갱신이 꺼져 있습니다.';
            if(failed)message.textContent+=' · 일부 데이터 수집에 실패했습니다.';
            if(!editable)message.textContent+=' · 관리자만 변경할 수 있습니다.';
        }
        async function load(){
            const id=++revision;input.disabled=true;
            try{const response=await fetch('/api/background-refresh',{cache:'no-store'});if(!response.ok)throw Error();const state=await response.json();if(id===revision)show(state);}
            catch{if(id!==revision)return;input.disabled=true;message.textContent='자동갱신 설정을 불러오지 못했습니다. 설정을 다시 열어 주세요.';message.classList.add('is-error');}
        }
        document.getElementById('profileBtn')?.addEventListener('click',load);
        input.addEventListener('change',async()=>{
            if(!editable){input.checked=enabled;return;}
            const previous=enabled,id=++revision;input.disabled=true;message.textContent='설정 저장 중…';
            try{
                if(typeof window.saveAppData==='function' && await window.saveAppData()===false)throw Error();
                const response=await fetch('/api/background-refresh',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:input.checked})});
                if(!response.ok)throw Error();const state=await response.json();if(id===revision)show(state);
            }catch{if(id!==revision)return;input.checked=previous;input.disabled=!editable;message.textContent='설정을 저장하지 못했습니다. 다시 시도해 주세요.';message.classList.add('is-error');}
        });
    });
})();
