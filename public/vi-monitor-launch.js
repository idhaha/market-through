(() => {
    'use strict';
    document.addEventListener('DOMContentLoaded',()=>{
        const controls=document.getElementById('rankIndependentControls');
        const platform=navigator.userAgentData?.platform||navigator.platform||'';
        if(!controls||!/Win/i.test(platform))return;
        const button=document.createElement('button'),status=document.createElement('span');
        button.type='button';button.className='btn-secondary';button.textContent='VI';button.title='VI 실시간 모니터링 독립창';status.setAttribute('role','status');button.dataset.independent='vi';status.dataset.independent='vi-status';// Place VI right after the 수급 independent-window button.
        const rankButton=controls.querySelector('[data-independent="rank"]');
        if(rankButton)rankButton.after(button,status);else controls.append(button,status);
        // Report browser zoom changes to open VI windows, like the 수급 window follows the main page.
        const openTokens=new Set(JSON.parse(sessionStorage.getItem('vi-window-tokens')||'[]'));
        const saveTokens=()=>sessionStorage.setItem('vi-window-tokens',JSON.stringify([...openTokens].slice(-20)));
        let lastScale=devicePixelRatio;
        window.addEventListener('resize',()=>{
            if(Math.abs(devicePixelRatio-lastScale)<0.001||!openTokens.size)return;lastScale=devicePixelRatio;
            for(const token of openTokens)fetch('/api/vi-monitor/window-scale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,scale:devicePixelRatio})})
                .then(r=>{if(r.status===404){openTokens.delete(token);saveTokens();}}).catch(()=>{});
        });
        button.addEventListener('click',async()=>{
            button.disabled=true;status.textContent='VI 독립창 실행 중';
            try {
                const response=await fetch('/api/vi-monitor/window',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scale:devicePixelRatio})});if(!response.ok)throw Error('로그인과 서버 연결을 확인하세요.');
                const {token}=await response.json();openTokens.add(token);saveTokens();
                location.href='marketthrough://open?url='+encodeURIComponent(location.origin+'/vi-monitor.html#token='+token);
                let attempts=0;
                const check=async()=>{
                    try{const r=await fetch('/api/vi-monitor/window-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});const result=await r.json();if(result.connected){status.textContent='';button.disabled=false;return;}}catch{}
                    if(++attempts<20){setTimeout(check,1000);return;}
                    status.textContent='창이 열리지 않으면 최신 독립창 앱을 설치하세요. ';
                    const link=document.createElement('a');link.href='/downloads/MarketThroughSetup.exe';link.download='MarketThroughSetup.exe';link.textContent='설치 파일 다운로드';status.append(link);button.disabled=false;
                };setTimeout(check,1000);
            }catch(error){status.textContent=error.message;button.disabled=false;}
        });
    });
})();
