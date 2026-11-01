(() => {
    let source,ready,resolveReady,active=false;
    function start(){
        active=true;if(source)return ready;
        ready=new Promise(resolve=>{resolveReady=resolve;});
        source=new EventSource('/api/background-refresh/presence');
        source.onmessage=event=>{
            try{if(JSON.parse(event.data).ready){resolveReady?.();resolveReady=null;}}catch{}
        };
        source.onerror=()=>{if(source?.readyState===EventSource.CLOSED){resolveReady?.();resolveReady=null;source=null;}};
        return ready;
    }
    function stop(){active=false;source?.close();source=null;resolveReady?.();resolveReady=null;ready=null;}
    window.addEventListener('pagehide',stop);
    // Restored back/forward-cache pages do not run application startup again.
    window.addEventListener('pageshow',event=>{if(event.persisted)void start();});
    window.BackgroundRefreshPresence={start,stop,get active(){return active;}};
})();
