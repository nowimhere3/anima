// Loaded only by the additive Fusion lighting page; World remains standalone.
window.AnimaLightingSubscriber = (() => {
    const clock=Index2ColorClock(), buffer=document.createElement('canvas');
    const row=document.createElement('div');row.className='row';
    const button=document.createElement('button');button.id='lightingJoin';button.className='btn';button.textContent='Join Lighting';
    const label=document.createElement('small');label.id='lightingSyncStatus';label.setAttribute('role','status');label.textContent='Independent lighting';
    label.title='Shared colors affect layers using Light, Backlight or Both. Artwork and optics remain local.';
    row.append(button,label);document.querySelector('#panel header').append(row);
    const preset=document.getElementById('lightPreset'), speed=document.getElementById('lightSpeed'), val=document.getElementById('lightVal');
    let state=null,wanted=false,saved=null;
    let lastPhase=null;
    function updateStatus(scene=window.AnimaFusion?.scene) {
        if(!state)return;
        const enabled=(scene?.layers||[]).filter(r=>r.spec.visible&&r.spec.opacity>0&&r.spec.light?.strength>0&&['light','backlight','both'].includes(r.spec.light.mode));
        const p=lastPhase||phase(state,clock.time(0));
        label.textContent=enabled.length
            ? `Shared: ${state.master||p.rgb} · ${state.speed.toFixed(2)}x · ${enabled.length} lit layer(s)`
            : 'Lighting connected — no visible lit layers. Choose Color Tint or Backlight and raise Light strength.';
    }
    function restore() {
        if (!saved) return;
        preset.disabled=saved.presetDisabled;speed.disabled=saved.speedDisabled;
        const local=window.AnimaFusion?.scene?.light;
        preset.value=local?.preset??saved.preset;speed.value=local?.speed??saved.speed;
        val.textContent=local?Number(local.speed).toFixed(2):saved.val;saved=null;
    }
    const transport=Index2LightingChannel.subscriber((s,w) => {
        const wasJoined=!!state;state=s;wanted=w;
        if(s){ clock.adopt(s.color);if(!saved)saved={preset:preset.value,speed:speed.value,val:val.textContent,presetDisabled:preset.disabled,speedDisabled:speed.disabled}; preset.disabled=true;speed.disabled=true; }
        else restore();
        button.textContent=w?'Leave Lighting':'Join Lighting';
        label.textContent=s?'Shared lighting':w?'Waiting for an Index 2 pair…':'Independent lighting';
        if(s)updateStatus();
        if(wasJoined&&!s)window.AnimaFusion?.refreshLighting();
    });
    button.addEventListener('click',()=>wanted?transport.leave():transport.join());
    function phase(s,t) {
        let rgb=s.rgb,next=rgb,alpha=0;
        if(s.master){
            const n=Math.floor(t/6),p=t%6,list=s.list;
            rgb=s.master==='smooth'?list[n%list.length]:list[Math.floor(Math.abs(Math.sin(n*91.3))*list.length)];
            next=s.master==='smooth'?list[(n+1)%list.length]:list[Math.floor(Math.abs(Math.sin((n+1)*91.3))*list.length)];
            if(p>4)alpha=Math.sin((p-4)/2*Math.PI/2);
        }
        return{rgb,next,alpha};
    }
    function draw(ctx,w,h,s,wall=Date.now()) {
        const t=clock.time(0,wall),p=phase(s,t),args={width:w,height:h,time:t,colorTime:t,currentBreathHue:clock.hue(t)};
        ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.clearRect(0,0,w,h);
        Index2LightColors.draw(p.rgb,ctx,args);
        if(p.alpha>0){
            if(buffer.width!==w||buffer.height!==h){buffer.width=w;buffer.height=h;}
            const c=buffer.getContext('2d');c.clearRect(0,0,w,h);Index2LightColors.draw(p.next,c,args);
            ctx.globalAlpha=p.alpha;ctx.drawImage(buffer,0,0);
        }
        ctx.restore();return p;
    }
    return {
        joined:()=>!!state,
        updateStatus,
        get snapshot(){return state;},
        phase,
        draw(ctx,w,h,s,wall){clock.adopt(s.color);return draw(ctx,w,h,s,wall);},
        render(ctx,w,h){
            if(!state)return false;
            const p=draw(ctx,w,h,state);
            lastPhase=p;
            preset.disabled=true;speed.disabled=true;
            preset.value=({ 'chroma-shift':'chroma-hypershift','spiral-wave':'spiral-rainbow' })[p.rgb]||p.rgb;
            speed.value=state.speed;val.textContent=state.speed.toFixed(2);
            updateStatus();
            return true;
        }
    };
})();
